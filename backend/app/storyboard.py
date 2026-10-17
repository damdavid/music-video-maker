"""Claude writes the storyboard: a small cast plus one scene per song section, drawn from the renderer's library."""

import json
import re

import anthropic
from pydantic import BaseModel, Field

from app.models import (
    AnalysisData,
    CustomObject,
    Hair,
    Illustration,
    Lyrics,
    Outfit,
    Project,
    Prop,
    Scene,
    SceneCharacter,
    SceneObject,
    Setting,
    Storyboard,
    StylePlan,
    TimeOfDay,
    Weather,
)
from app.style_plan import _brief, _call, _clamp, _hex

SYSTEM = """You are the storyboard artist for a music video drawn entirely in code as flat, stylized illustration.
Characters are flat figures with simple faces; emotion comes from expression, posture, action, setting, light and weather.
Given a song's meaning, mood, structure and lyrics, you design a cast and one scene per song section.

Rules:
- Choose only from the allowed values; the renderer supports nothing else.
- Cast: usually ONE protagonist (id like "hero", lowercase letters/digits/underscores). Add a second character only if the song is clearly about two people. Give them a short description, a hair style, an outfit, and five hex colors (body, hair, top, bottom, accent). Pick clothing colors that stand out against the scene palette you are given, and keep the same cast across every scene.
- One scene per section, in order. Follow the song's arc: settings, time of day and weather should change with the story and the energy, not repeat for every section.
- Actions: walk/run for journeys and urgency, sit for reflection, slump for sadness or defeat, look_up for hope or wonder, reach for longing, wave for greeting or farewell, dance and jump for joy or release, idle for stillness.
- Expressions (neutral, happy, sad, surprised, calm, determined) are simple dot-eye faces. Set one when the moment's feeling differs from what the action suggests (a sad walk, a calm sit after a storm); leave it out to let the action pick.
- Use "crowd" (0-8 faceless background silhouettes) for loneliness-in-a-crowd, parties, streets; use 0 for solitude.
- Props are set dressing (lamp, bench, tree, house, suitcase). Use few, and only when they add to the story.
- A section's "user_description" is the creator's direction for that scene; follow it.
- Custom objects (listed under "Custom objects", if any) are the creator's own props. Place them in scenes where they fit, by object_id, using only the given ids; never invent ids.
- Each scene's description is one short line a non-technical reader can follow.
- Scenes may leave the protagonist out (an empty street, a window) when that serves the song."""


# What Claude writes. The SDK can only describe ranges, patterns and list limits to the model, so these accept any value of
# the right type and _cast/_scene repair it; one stray value must not fail the whole storyboard.
class LooseColors(BaseModel):
    body: str = Field(description="Hex color like #1a2b3c")
    hair: str = Field(description="Hex color like #1a2b3c")
    top: str = Field(description="Hex color like #1a2b3c")
    bottom: str = Field(description="Hex color like #1a2b3c")
    accent: str = Field(description="Hex color like #1a2b3c")


class LooseCharacter(BaseModel):
    id: str = Field(description='Short id of lowercase letters, digits and underscores, like "hero"')
    name: str = ""
    description: str = Field(default="", description="Who they are; shown in the editor and given to Claude for continuity")
    hair: Hair = "short"
    outfit: Outfit = "tee"
    build: float = Field(default=1.0, description="Height scale, 0.85 to 1.15")
    colors: LooseColors


class LooseScene(BaseModel):
    section_ref: int
    description: str = Field(default="", description="One-line storyboard note")
    setting: Setting
    time_of_day: TimeOfDay = "night"
    weather: Weather = "clear"
    characters: list[SceneCharacter] = Field(default_factory=list, description="At most 3")
    crowd: int = Field(default=0, description="Faceless background silhouettes, 0 to 8")
    props: list[Prop] = Field(default_factory=list, description="At most 4")
    objects: list[SceneObject] = Field(default_factory=list, description="At most 3")


class LooseStoryboard(BaseModel):
    cast: list[LooseCharacter] = Field(default_factory=list, description="Usually one character, at most 6")
    scenes: list[LooseScene] = Field(default_factory=list)


MAX_CAST = 6
DEFAULT_COLORS = {"body": "#d9a37e", "hair": "#2b1d14", "top": "#3a6ea5", "bottom": "#2e2e3a", "accent": "#e85d4a"}


def _ident(raw: str, fallback: str = "") -> str:
    return re.sub(r"[^a-z0-9_]+", "_", raw.strip().lower()).strip("_")[:40] or fallback


def _cast(cast: list[LooseCharacter]) -> list[dict]:
    out: dict[str, dict] = {}
    for i, c in enumerate(cast):
        cid = _ident(c.id, f"character_{i + 1}")
        if cid in out:
            continue
        colors = {k: _hex(v) or DEFAULT_COLORS[k] for k, v in c.colors.model_dump().items()}
        out[cid] = {**c.model_dump(include={"name", "description", "hair", "outfit"}), "id": cid, "build": _clamp(c.build, 0.85, 1.15), "colors": colors}
    return list(out.values())[:MAX_CAST]


def _scene(s: LooseScene, cast_ids: set[str], object_ids: set[str]) -> dict:
    """References are matched the way ids were repaired, so "Hero" in a scene still finds the cast's "hero"."""
    characters = [{**c.model_dump(), "character_id": _ident(c.character_id)} for c in s.characters]
    objects = [{**o.model_dump(), "object_id": _ident(o.object_id)} for o in s.objects]
    return {
        **s.model_dump(include={"section_ref", "description", "setting", "time_of_day", "weather"}),
        "characters": [c for c in characters if c["character_id"] in cast_ids][:3],
        "objects": [o for o in objects if o["object_id"] in object_ids][:3],
        "props": list(dict.fromkeys(s.props))[:4],
        "crowd": int(_clamp(s.crowd, 0, 8)),
    }


def _normalize(board: Storyboard, n_sections: int) -> Storyboard:
    """Drops what the renderer could not draw: duplicate cast/object ids, scenes for missing/duplicate sections, unknown characters and objects."""
    cast, seen_ids = [], set()
    for c in board.cast:
        if c.id not in seen_ids:
            seen_ids.add(c.id)
            cast.append(c)
    objects, object_ids = [], set()
    for o in board.objects:
        if o.id not in object_ids:
            object_ids.add(o.id)
            objects.append(o)
    scenes, seen_refs = [], set()
    for sc in board.scenes:
        if not 0 <= sc.section_ref < n_sections or sc.section_ref in seen_refs:
            continue
        seen_refs.add(sc.section_ref)
        scenes.append(
            sc.model_copy(
                update={
                    "characters": [ch for ch in sc.characters if ch.character_id in seen_ids],
                    "objects": [o for o in sc.objects if o.object_id in object_ids],
                }
            )
        )
    scenes.sort(key=lambda s: s.section_ref)
    return board.model_copy(update={"cast": cast, "objects": objects, "scenes": scenes})


def _context(
    project: Project, analysis: AnalysisData, lyrics: Lyrics | None, plan: StylePlan | None, objects: list[CustomObject] = ()
) -> str:
    palette = plan.global_.palette if plan else None
    note = f"\n\nScene palette (dark to light) from the style plan: {json.dumps(palette)}" if palette else ""
    if objects:
        listing = [o.model_dump(include={"id", "name", "description", "size"}) for o in objects]
        note += f"\n\nCustom objects: {json.dumps(listing)}"
    return _brief(project, analysis, lyrics) + note


def generate_storyboard(
    project: Project,
    analysis: AnalysisData,
    lyrics: Lyrics | None,
    plan: StylePlan | None,
    client: anthropic.Anthropic,
    illustration: Illustration = "library",
    objects: list[CustomObject] = (),
) -> Storyboard:
    user = f"Design the cast and a scene for every section of this song.\n\n{_context(project, analysis, lyrics, plan, objects)}"
    draft = _call(client, user, LooseStoryboard, project.settings.style_effort, system=SYSTEM)
    cast = _cast(draft.cast)
    cast_ids, object_ids = {c["id"] for c in cast}, {o.id for o in objects}
    # Art is drawn in separate calls, so a fresh storyboard starts without any; the illustration mode carries over.
    board = Storyboard.model_validate(
        {
            "illustration": illustration,
            "cast": cast,
            "objects": [o.model_dump() for o in objects],
            "scenes": [_scene(s, cast_ids, object_ids) for s in draft.scenes],
        }
    )
    return _normalize(board, len(analysis.sections))


def regenerate_scene(
    project: Project,
    analysis: AnalysisData,
    lyrics: Lyrics | None,
    plan: StylePlan | None,
    board: Storyboard,
    index: int,
    client: anthropic.Anthropic,
) -> Scene:
    if not 0 <= index < len(analysis.sections):
        raise IndexError(index)
    current = board.model_dump()
    user = (
        f"Here is the song:\n{_context(project, analysis, lyrics, plan, board.objects)}\n\nHere is the current storyboard:\n{json.dumps(current, indent=1)}\n\n"
        f"Redesign only the scene for section {index} with a fresh take that still fits the story. Use only characters from the existing cast and objects from the existing custom objects. "
        f"Return it with section_ref={index}."
    )
    draft = _call(client, user, LooseScene, project.settings.style_effort, system=SYSTEM)
    old = next((s for s in board.scenes if s.section_ref == index), None)
    # The old backdrop no longer matches the redesigned scene, so it is dropped; the per-scene mode choice is kept.
    return Scene.model_validate(
        {
            **_scene(draft, {c.id for c in board.cast}, {o.id for o in board.objects}),
            "section_ref": index,
            "illustration": old.illustration if old else None,
        }
    )
