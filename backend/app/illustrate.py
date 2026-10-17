"""Claude draws free-form SVG art for a storyboard: one drawing per character, one per custom object and one backdrop per scene.

Each drawing is its own call (they are large and independent), sanitized before it is stored, retried once with the
rejection reason, and saved as soon as it is ready so progress is visible and partial failures lose nothing.
"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

from app.jobs import ProcessJob
from app.models import Character, CustomObject, Project, Scene, Storyboard, StylePlan
from app.projects_store import write_atomic
from app.style_plan import DEFAULT_PALETTE, StyleError, _call
from app.svgsafe import SvgRejected, sanitize_svg

# Writers of storyboard.json take this so a background drawing never overwrites an edit made while it was running.
board_lock = threading.Lock()
# The largest request the SDK allows without insisting on streaming; drawings are far smaller than this.
MAX_TOKENS = 20_000
WORKERS = 4

PARTS = "head, torso, arm_l, forearm_l, arm_r, forearm_r, leg_l, shin_l, leg_r, shin_r"
ALLOWED = "svg, g, defs, path, rect, circle, ellipse, line, polyline, polygon, linearGradient, radialGradient, stop, clipPath, use"

FIGURE_SYSTEM = f"""You draw one character for a stylized flat-vector music video, as SVG.

Return the drawing in the `svg` field and nothing else.

Canvas and pose
- Use viewBox="0 0 100 200". The figure stands upright facing RIGHT, about 190 units tall, centered on x=50, feet at y=195.
- Arms hang straight down at the sides and legs are straight and slightly apart. The renderer poses the figure by rotating named parts.
- Do NOT draw eyes, mouth or nose: the renderer adds an animated face. Keep the front half of the head (toward the right) a plain skin-colored area, with hair or headwear only on top and behind.
- Put data-face="cx,cy,r" on the head group: cx,cy is the center of that plain face area and r the head's radius, in drawing coordinates.

Animatable parts
- Wrap each part in <g id="NAME" data-pivot="x,y"> where NAME is one of: {PARTS}.
- data-pivot is the joint the part rotates around, in drawing coordinates: neck for head, hip for torso, shoulder for arm_*, hip for leg_*, elbow for forearm_*, knee for shin_*.
- Nest forearm_l inside arm_l, forearm_r inside arm_r, shin_l inside leg_l and shin_r inside leg_r, so they swing together.
- *_l is the FAR side (draw it behind, a little darker) and *_r is the NEAR side (in front).
- Draw order: far arm, far leg, torso, near leg, head, near arm. Each id appears once.
- Draw limbs as thick rounded strokes (stroke-linecap="round") or rounded shapes, so a rotated joint still looks connected.

Style and limits
- Flat solid colors, simple shapes, optional gradients. Use exactly the character's colors, hair style and outfit.
- Allowed elements only: {ALLOWED}. No text, images, filters, styles, scripts or animation.
- Keep it under about 40 elements."""

OBJECT_SYSTEM = f"""You draw one prop for a stylized flat-vector music video, as SVG.

Return the drawing in the `svg` field and nothing else.

Canvas
- Use viewBox="0 0 200 200". The object rests on the BOTTOM edge (y=200) and is centered on x=100; fill most of the canvas.
- Leave the background transparent: draw only the object.
- Draw it as the description says, seen from the side or slightly front-on. NEVER draw people or animals.

Style and limits
- Flat solid colors, simple shapes, optional gradients, in the scene palette (dark to light) where it fits.
- Allowed elements only: {ALLOWED}. No text, images, filters, styles, scripts or animation.
- Keep it under about 40 elements."""

BACKGROUND_SYSTEM = f"""You paint one backdrop for a stylized flat-vector music video, as SVG.

Return the drawing in the `svg` field and nothing else.

Canvas
- Use viewBox="0 0 1600 900" (16:9). The GROUND LINE is at y=693: everything below it is the ground plane characters stand on, everything above is sky and distant scenery. Fill the whole canvas.
- Characters stand at x=416, 800 and 1184 on the ground line. Keep those spots open at ground level (no big objects there); put scenery at the edges and in the distance.
- The picture may be cropped at the sides for tall formats, so keep what matters between x=400 and x=1200.

Content
- Paint the setting, time of day and mood you are given, with layered flat shapes: gradient sky, a sun or moon where it fits, silhouettes, buildings, hills, trees. Depth comes from layering and color value, not outlines.
- Draw the listed props. NEVER draw people or animals. Do not draw a seat for a sitting character (the renderer adds a bench).
- Weather particles (rain, snow, fog) are added by the renderer, so convey only the overcast mood, not the drops or flakes.
- Use the scene palette (dark to light) for a coherent look, shifting values for the time of day.

Style and limits
- Flat solid colors and gradients. Allowed elements only: {ALLOWED}. No text, images, filters, styles, scripts or animation.
- Keep it under about 120 elements."""


class SvgAsset(BaseModel):
    svg: str = Field(description="The complete SVG drawing")


@dataclass(frozen=True)
class Task:
    kind: Literal["character", "scene", "object"]
    key: str | int

    @property
    def label(self) -> str:
        return f"{self.kind} {self.key}"


def plan_tasks(
    board: Storyboard, scenes: set[int] | None = None, characters: set[str] | None = None, objects: set[str] | None = None
) -> list[Task]:
    """What to draw. With no explicit targets: missing art for free-form scenes, plus every custom object that has none
    (objects have no library art). Explicit targets are always redrawn."""
    out: list[Task] = []
    if scenes is None and characters is None and objects is None:
        freeform = [s for s in board.scenes if board.effective_illustration(s) == "freeform"]
        needed = {c.character_id for s in freeform for c in s.characters}
        out += [Task("character", c.id) for c in board.cast if c.id in needed and not c.svg]
        out += [Task("object", o.id) for o in board.objects if not o.svg]
        out += [Task("scene", s.section_ref) for s in freeform if not s.background_svg]
        return out
    known_chars = {c.id for c in board.cast}
    known_scenes = {s.section_ref for s in board.scenes}
    out += [Task("character", cid) for cid in sorted(characters or ()) if cid in known_chars]
    out += [Task("object", oid) for oid in sorted(objects or ()) if oid in {o.id for o in board.objects}]
    out += [Task("scene", ref) for ref in sorted(scenes or ()) if ref in known_scenes]
    return out


def _draw(client: anthropic.Anthropic, system: str, user: str, kind: str, effort: str) -> str:
    error: str | None = None
    for _ in range(2):
        prompt = user if error is None else f"{user}\n\nYour previous drawing was rejected: {error}\nFix that and return the complete corrected drawing."
        asset = _call(client, prompt, SvgAsset, effort, system=system, max_tokens=MAX_TOKENS)
        try:
            return sanitize_svg(asset.svg, kind).svg
        except SvgRejected as e:
            error = str(e)
    raise StyleError(f"drawing rejected twice: {error}")


def draw_character(client: anthropic.Anthropic, ch: Character, palette: list[str], effort: str) -> str:
    brief = ch.model_dump(include={"id", "name", "description", "hair", "outfit", "build", "colors"})
    user = f"Draw this character.\n\n{json.dumps(brief, indent=1)}\n\nScene palette (dark to light), for harmony: {json.dumps(palette)}"
    return _draw(client, FIGURE_SYSTEM, user, "figure", effort)


def draw_object(client: anthropic.Anthropic, obj: CustomObject, palette: list[str], effort: str) -> str:
    brief = obj.model_dump(include={"id", "name", "description", "size"})
    user = f"Draw this prop.\n\n{json.dumps(brief, indent=1)}\n\nScene palette (dark to light), for harmony: {json.dumps(palette)}"
    return _draw(client, OBJECT_SYSTEM, user, "object", effort)


def draw_background(client: anthropic.Anthropic, scene: Scene, palette: list[str], effort: str, direction: str = "") -> str:
    brief = scene.model_dump(include={"setting", "time_of_day", "weather", "props", "description", "crowd"})
    if direction:
        brief["creator_direction"] = direction
    brief["someone_sits"] = any(c.action == "sit" for c in scene.characters)
    user = f"Paint this backdrop.\n\n{json.dumps(brief, indent=1)}\n\nScene palette (dark to light): {json.dumps(palette)}"
    return _draw(client, BACKGROUND_SYSTEM, user, "background", effort)


def _load(d: Path) -> Storyboard:
    return Storyboard.model_validate_json((d / "storyboard.json").read_text())


def _store(d: Path, task: Task, svg: str) -> None:
    """Applies one finished drawing to whatever the storyboard looks like now (the user may have edited it meanwhile)."""
    with board_lock:
        board = _load(d)
        if task.kind == "character":
            for c in board.cast:
                if c.id == task.key:
                    c.svg = svg
        elif task.kind == "object":
            for o in board.objects:
                if o.id == task.key:
                    o.svg = svg
        else:
            for s in board.scenes:
                if s.section_ref == task.key:
                    s.background_svg = svg
        # Attribute assignment skips validation; re-validating sanitizes and size-checks the art before it is stored.
        board = Storyboard.model_validate(board.model_dump())
        write_atomic(d / "storyboard.json", board.model_dump_json())


def run(
    d: Path,
    project: Project,
    plan: StylePlan | None,
    scenes: set[int] | None,
    characters: set[str] | None,
    objects: set[str] | None,
    job: ProcessJob,
    client: anthropic.Anthropic,
) -> str:
    palette = plan.global_.palette if plan else DEFAULT_PALETTE
    effort = project.settings.style_effort
    board = _load(d)
    tasks = plan_tasks(board, scenes, characters, objects)
    if not tasks:
        return "nothing to draw"
    total = len(tasks)
    job.report(f"drawing 0 of {total}", 0.02)

    def work(task: Task) -> str:
        if task.kind == "character":
            return draw_character(client, next(c for c in board.cast if c.id == task.key), palette, effort)
        if task.kind == "object":
            return draw_object(client, next(o for o in board.objects if o.id == task.key), palette, effort)
        scene = next(s for s in board.scenes if s.section_ref == task.key)
        descriptions = project.section_descriptions
        direction = descriptions[task.key].strip() if task.key < len(descriptions) else ""
        return draw_background(client, scene, palette, effort, direction)

    failures: list[str] = []
    done = 0
    with ThreadPoolExecutor(max_workers=min(WORKERS, total)) as pool:
        futures = {pool.submit(work, t): t for t in tasks}
        for fut in as_completed(futures):
            task = futures[fut]
            try:
                _store(d, task, fut.result())
            except Exception as e:  # one failed drawing must not lose the others; it falls back to the library art
                failures.append(f"{task.label}: {e}")
            done += 1
            job.report(f"drawing {done} of {total}", 0.02 + 0.97 * done / total)

    summary = f"drew {total - len(failures)} of {total}"
    if len(failures) == total:
        raise RuntimeError(f"{summary}; {'; '.join(failures)}"[:600])
    return summary + (f"; {len(failures)} failed and use the library art ({'; '.join(failures)[:300]})" if failures else "")
