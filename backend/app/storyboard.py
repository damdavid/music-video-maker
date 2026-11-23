"""Claude writes the storyboard: a small cast plus one scene per song section, drawn from the renderer's library."""

import json
import re

import anthropic
from pydantic import BaseModel, Field

from typing import get_args

from app.models import (
    Accessory,
    Action,
    AnalysisData,
    ContactKind,
    CustomObject,
    Expression,
    Gender,
    Hair,
    Hat,
    Held,
    Illustration,
    ObjectSize,
    Placement,
    Lyrics,
    Outfit,
    Project,
    Prop,
    Scene,
    SceneCharacter,
    SceneRedo,
    SceneObject,
    Setting,
    Symbol,
    Storyboard,
    StylePlan,
    TimeOfDay,
    Weather,
)
from app.style_plan import _brief, _call, _clamp, _hex, directions_block

SYSTEM = """You are the storyboard artist for a music video drawn entirely in code as flat, stylized illustration.
Characters are flat figures with simple faces; emotion comes from expression, posture, action, setting, light and weather.
Given a song's meaning, mood, structure and lyrics, you design a cast and one scene per song section.

Rules:
- The creator's directions come first in the request and are the main brief. A section that has one must visibly be about it: choose the setting, time of day, weather, props, objects, characters and action it points to; restate it in the scene's description; list the concrete things it names (a river, a lighthouse, a stone bridge, a market) in the scene's "include", which the backdrop painting must show clearly; and when it names a single object the fixed props do not have, also define it under "new_objects" and place it in the scene with "objects". Do not drop a thing the creator asked for because it is not in the lists below.
- Choose only from the allowed values; the renderer supports nothing else.
- Cast: usually ONE protagonist (id like "hero", lowercase letters/digits/underscores). Add a second character only if the song is clearly about two people. Give them a short description, a gender (male or female, to match who they are), a hair style, an outfit, optionally a hat (cowboy, beanie, cap, top_hat, beret, sun_hat, or helmet, an ancient crested warrior's helmet that goes with the armor outfit); the "robe" outfit is a long, belted prophet's robe, for biblical, mythic or visionary characters; "armor" is an ancient warrior's bronze breastplate, shoulder guards, bracers and greaves over a leather strip skirt, for soldiers, gladiators, heroes and epic battles and up to two accessories (glasses, sunglasses, scarf, headphones, backpack) when they say something about who the character is, and five hex colors (body, hair, top, bottom, accent). Pick clothing colors that stand out against the scene palette you are given, and keep the same cast across every scene.
- One scene per section, in order. Follow the song's arc: settings, time of day and weather should change with the story and the energy, not repeat for every section.
- Actions: walk/run for journeys and urgency, sit for reflection, slump for sadness or defeat, point for showing or accusing (toward the other character or the world), lean for ease and waiting (against a lamp, signpost or fence, which the renderer adds beside them), cross_arms for being closed off, cold or guarded, cheer for triumph (both arms up), look_up for hope or wonder, reach for longing, wave for greeting or farewell, dance and jump for joy or release, idle for stillness.
- Expressions (neutral, happy, sad, surprised, calm, determined) are simple dot-eye faces. Set one when the moment's feeling differs from what the action suggests (a sad walk, a calm sit after a storm); leave it out to let the action pick.
- "crowd" is the number (0-8) of background figures, who react to the beat. Set it for loneliness-in-a-crowd, parties, concerts, streets; set 0 for deliberate solitude; leave it out to let the renderer add a few in energetic sections.
- Props are set dressing (lamp, bench, tree, house, suitcase, campfire, fence, signpost). Use few, and only when they add to the story.
- A character can hold something ("holding": umbrella, suitcase, microphone, flowers, lantern, book, phone, flag, balloon, cup, sword, shield (a round warrior's shield), or guitar, which is played with both hands). Give an item only when the moment calls for it: a microphone or guitar for a singer, an umbrella in rain, a suitcase for leaving, flowers or a lantern for tenderness or hope, a book for reflection. Most scenes need none.
- With more than one character, "looks_at" says who a character looks at: another character's id (they turn to face each other) or "camera" for an address to the viewer. Use it where the two are connected in that moment; leave it out otherwise.
- "moods" follow the lyrics: the lyric lines are numbered under "lyric_lines". Add an entry (the line number and an expression) at a line where the feeling turns or lands: a sad line, a surprise, a moment of determination or calm. A mood lasts until the next one, so a few well-placed entries beat one per line; the scene's own expression is used wherever there is none.
- "contact" on ONE character of a pair makes them touch: {"partner": the other character's id, "kind": hug, hold_hands, high_five or arm_around}. The renderer stands the two together at the first character's place, facing each other for a hug or high five and side by side for holding hands or an arm round the shoulder, and poses both. Use it for a moment of real closeness or greeting between two characters who are both in the scene; a character can be in only one pair.
- "wear" on a scene's character changes what they wear in that scene only (outfit, hat as a hat name or "none", accessories as a list): use it when the story passes time or the mood changes, such as a coat in winter, a hat put on for the journey, a suit for a wedding. Leave it out almost everywhere; the cast's own look is the default.
- "cues" attach to lyric lines (numbered under "lyric_lines") like moods. A cue has a line number and a "symbol" (heart, star, rose, key, door, moon, bird, clock), which pops up beside the lead for a couple of seconds, and/or a "holding" item (as above) the lead takes up from that line until the next cue that holds something. Use a symbol only on a line that names the thing (a heart for love, a door for leaving, a clock for time, a bird for freedom); a few well-placed cues beat many.
- Everything else in the scene (cast, actions, expressions, props) serves the creator's direction for that section when it has one.
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
    gender: str = Field(default="male", description="male or female, to match who they are")
    hair: str = "short"
    outfit: str = "tee"
    hat: str | None = None
    accessories: list[str] = Field(default_factory=list, description="At most 2")
    build: float = Field(default=1.0, description="Height scale, 0.85 to 1.15")
    colors: LooseColors


# Choices are plain text here, not enums: the API compiles the output schema into a grammar and refuses one with this many
# enum values. The allowed words are listed in the instructions (see _vocabulary) and checked afterwards.
class LooseWear(BaseModel):
    outfit: str | None = None
    hat: str | None = Field(default=None, description='A hat name, or "none" to take their hat off')
    accessories: list[str] | None = Field(default=None, description="At most 2; an empty list takes them off")


class LooseContact(BaseModel):
    partner: str = Field(description="Another character's id in the scene")
    kind: str


class LooseSceneCharacter(BaseModel):
    character_id: str
    action: str = "idle"
    expression: str | None = None
    placement: str = "center"
    facing: str = "right"
    holding: str | None = None
    looks_at: str | None = Field(default=None, description='Another character\'s id in the scene, or "camera"')
    wear: LooseWear | None = None
    contact: LooseContact | None = None


class LooseSceneObject(BaseModel):
    object_id: str
    placement: str = "right"


class LooseScene(BaseModel):
    section_ref: int
    description: str = Field(default="", description="One-line storyboard note")
    setting: str
    time_of_day: str = "night"
    weather: str = "clear"
    characters: list[LooseSceneCharacter] = Field(default_factory=list, description="At most 3")
    crowd: int | None = Field(default=None, description="Background figures, 0 to 8; leave out to let the renderer decide")
    props: list[str] = Field(default_factory=list, description="At most 4")
    objects: list[LooseSceneObject] = Field(default_factory=list, description="At most 3")
    include: list[str] = Field(default_factory=list, description="Short phrases for the concrete things from the creator's direction that the backdrop must show clearly, at most 6")


class LooseMood(BaseModel):
    line: int = Field(description="Number of the lyric line, as given under lyric_lines")
    expression: str


class LooseCue(BaseModel):
    line: int = Field(description="Number of the lyric line, as given under lyric_lines")
    symbol: str | None = None
    holding: str | None = None


class LooseNewObject(BaseModel):
    id: str = Field(description='Short id of lowercase letters, digits and underscores, like "lighthouse"')
    name: str = ""
    description: str = Field(default="", description="What it looks like; given to the artist who draws it")
    size: str = "medium"


class LooseRedo(BaseModel):
    scene: LooseScene
    new_objects: list[LooseNewObject] = Field(default_factory=list, description="Single objects the creator's direction names that the fixed props and existing objects lack; at most 2")


class LooseStoryboard(BaseModel):
    cast: list[LooseCharacter] = Field(default_factory=list, description="Usually one character, at most 6")
    scenes: list[LooseScene] = Field(default_factory=list)
    moods: list[LooseMood] = Field(default_factory=list, description="The lead's expression at chosen lyric lines")
    cues: list[LooseCue] = Field(default_factory=list, description="Symbols and held items at chosen lyric lines")
    new_objects: list[LooseNewObject] = Field(default_factory=list, description="Single objects the creator's directions name that the fixed props lack; at most 4. Place them in scenes with each scene's objects")


MAX_CAST = 6
DEFAULT_COLORS = {"body": "#d9a37e", "hair": "#2b1d14", "top": "#3a6ea5", "bottom": "#2e2e3a", "accent": "#e85d4a"}


def _ident(raw: str, fallback: str = "") -> str:
    return re.sub(r"[^a-z0-9_]+", "_", raw.strip().lower()).strip("_")[:40] or fallback


def _words(literal) -> tuple[str, ...]:
    return get_args(literal)


GENDERS, HAIRS, OUTFITS, HATS, ACCESSORIES = _words(Gender), _words(Hair), _words(Outfit), _words(Hat), _words(Accessory)
SETTINGS, TIMES, WEATHERS, PROPS = _words(Setting), _words(TimeOfDay), _words(Weather), _words(Prop)
ACTIONS, EXPRESSIONS, PLACEMENTS, HELD, SYMBOLS = _words(Action), _words(Expression), _words(Placement), _words(Held), _words(Symbol)
CONTACTS, SIZES = _words(ContactKind), _words(ObjectSize)


def _vocabulary() -> str:
    """The words Claude may use for each choice, in the instructions, since the output schema no longer lists them."""
    rows = [
        ("setting", SETTINGS), ("time_of_day", TIMES), ("weather", WEATHERS), ("props", PROPS), ("placement (of a character or object)", PLACEMENTS), ("facing", ("left", "right")),
        ("action", ACTIONS), ("expression", EXPRESSIONS), ("holding", HELD), ("contact kind", CONTACTS), ("symbol (in cues)", SYMBOLS),
        ("gender", GENDERS), ("hair", HAIRS), ("outfit (also in wear)", OUTFITS), ("hat (also in wear, where \"none\" removes it)", HATS), ("accessories", ACCESSORIES), ("object size", SIZES),
    ]
    return "\n\nAllowed values (use exactly these words, written like this; anything else is ignored and replaced by a default):\n" + "\n".join(f"- {name}: {', '.join(words)}" for name, words in rows)


SYSTEM += _vocabulary()


def _one(value: str | None, allowed: tuple[str, ...], default: str | None = None) -> str | None:
    """A choice if it is one of the allowed words (any case, spaces for underscores), else the default."""
    word = (value or "").strip().lower().replace(" ", "_").replace("-", "_")
    return word if word in allowed else default


def _list_of(values: list[str] | None, allowed: tuple[str, ...], limit: int) -> list[str]:
    return list(dict.fromkeys(w for w in (_one(v, allowed) for v in values or []) if w))[:limit]


def _character(c: LooseSceneCharacter) -> dict:
    """One character in a scene, with every choice checked; what is not allowed falls back to the default."""
    wear = None
    if c.wear:
        hat = _one(c.wear.hat, (*HATS, "none"))
        accessories = None if c.wear.accessories is None else _list_of(c.wear.accessories, ACCESSORIES, 2)
        outfit = _one(c.wear.outfit, OUTFITS)
        wear = {"outfit": outfit, "hat": hat, "accessories": accessories} if (outfit or hat or accessories is not None) else None
    kind = _one(c.contact.kind, CONTACTS) if c.contact else None
    return {
        "character_id": _ident(c.character_id),
        "action": _one(c.action, ACTIONS, "idle"),
        "expression": _one(c.expression, EXPRESSIONS),
        "placement": _one(c.placement, PLACEMENTS, "center"),
        "facing": _one(c.facing, ("left", "right"), "right"),
        "holding": _one(c.holding, HELD),
        "looks_at": c.looks_at,
        "wear": wear,
        "contact": {"partner": c.contact.partner, "kind": kind} if kind else None,
    }


def _cast(cast: list[LooseCharacter]) -> list[dict]:
    out: dict[str, dict] = {}
    for i, c in enumerate(cast):
        cid = _ident(c.id, f"character_{i + 1}")
        if cid in out:
            continue
        colors = {k: _hex(v) or DEFAULT_COLORS[k] for k, v in c.colors.model_dump().items()}
        out[cid] = {
            "name": c.name, "description": c.description, "id": cid, "colors": colors, "build": _clamp(c.build, 0.85, 1.15),
            "gender": _one(c.gender, GENDERS, "male"), "hair": _one(c.hair, HAIRS, "short"), "outfit": _one(c.outfit, OUTFITS, "tee"),
            "hat": _one(c.hat, HATS), "accessories": _list_of(c.accessories, ACCESSORIES, 2),
        }
    return list(out.values())[:MAX_CAST]


def _scene(s: LooseScene, cast_ids: set[str], object_ids: set[str]) -> dict:
    """References are matched the way ids were repaired, so "Hero" in a scene still finds the cast's "hero"."""
    characters = [_character(c) for c in s.characters]
    here = {c["character_id"] for c in characters}
    for c in characters:
        # A gaze must land on someone else who is in the scene, or the camera.
        target = c["looks_at"] and (c["looks_at"] if c["looks_at"] == "camera" else _ident(c["looks_at"]))
        c["looks_at"] = target if target == "camera" or (target in here and target != c["character_id"]) else None
    # A contact must name another character in the scene, and a character can be in only one pair.
    paired: set[str] = set()
    for c in characters:
        partner = c["contact"] and _ident(c["contact"]["partner"])
        ok = partner and partner in here and partner != c["character_id"] and not {c["character_id"], partner} & paired
        c["contact"] = {"partner": partner, "kind": c["contact"]["kind"]} if ok else None
        if ok:
            paired |= {c["character_id"], partner}
    objects = [{"object_id": _ident(o.object_id), "placement": _one(o.placement, PLACEMENTS, "right")} for o in s.objects]
    return {
        "section_ref": s.section_ref,
        "description": s.description,
        "setting": _one(s.setting, SETTINGS, "road"),
        "time_of_day": _one(s.time_of_day, TIMES, "night"),
        "weather": _one(s.weather, WEATHERS, "clear"),
        "characters": [c for c in characters if c["character_id"] in cast_ids][:3],
        "objects": [o for o in objects if o["object_id"] in object_ids][:3],
        "props": _list_of(s.props, PROPS, 4),
        "crowd": None if s.crowd is None else int(_clamp(s.crowd, 0, 8)),
        "include": list(dict.fromkeys(t[:60] for t in (i.strip() for i in s.include) if t))[:6],
    }


MAX_OBJECTS = 8


def _new_objects(draft: list[LooseNewObject], taken: set[str]) -> list[dict]:
    """Objects Claude defined for the creator's directions: ids made safe and unique, and the board's limit respected."""
    out: list[dict] = []
    for o in draft:
        oid = _ident(o.id, "")
        if not oid or oid in taken or len(taken) + len(out) >= MAX_OBJECTS:
            continue
        out.append({"id": oid, "name": o.name.strip()[:60], "description": o.description.strip()[:300], "size": _one(o.size, SIZES, "medium")})
        taken = taken | {oid}
    return out


def _direction(project: Project, ref: int) -> str:
    notes = project.section_descriptions
    return notes[ref].strip()[:2000] if 0 <= ref < len(notes) else ""


def _cues(draft: list[LooseCue], lyrics: Lyrics | None) -> list[dict]:
    """Like moods, line numbers become times; a cue that asks for nothing, or for a missing line, is dropped."""
    if not lyrics:
        return []
    at: dict[float, dict] = {}
    for c in draft:
        symbol, holding = _one(c.symbol, SYMBOLS), _one(c.holding, HELD)
        if 0 <= c.line < len(lyrics.lines) and (symbol or holding):
            at[round(lyrics.lines[c.line].start, 2)] = {"at": round(lyrics.lines[c.line].start, 2), "symbol": symbol, "holding": holding}
    return [at[t] for t in sorted(at)]


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
    return _brief(project, analysis, lyrics) + note + _numbered(lyrics)


def _numbered(lyrics: Lyrics | None) -> str:
    """The lines with their numbers, so Claude can say which line a mood belongs to."""
    if not lyrics or not lyrics.lines:
        return ""
    return f"\n\nlyric_lines: {json.dumps([{'line': i, 'text': line.text} for i, line in enumerate(lyrics.lines)])}"


def _moods(draft: list[LooseMood], lyrics: Lyrics | None) -> list[dict]:
    """Line numbers become times, so a mood stays with its moment when lines are edited later."""
    if not lyrics:
        return []
    at = {}
    for m in draft:
        expression = _one(m.expression, EXPRESSIONS)
        if expression and 0 <= m.line < len(lyrics.lines):
            at[round(lyrics.lines[m.line].start, 2)] = expression
    return [{"at": t, "expression": e} for t, e in sorted(at.items())]


def generate_storyboard(
    project: Project,
    analysis: AnalysisData,
    lyrics: Lyrics | None,
    plan: StylePlan | None,
    client: anthropic.Anthropic,
    illustration: Illustration = "library",
    objects: list[CustomObject] = (),
) -> Storyboard:
    user = f"{directions_block(project, analysis)}Design the cast and a scene for every section of this song.\n\n{_context(project, analysis, lyrics, plan, objects)}"
    draft = _call(client, user, LooseStoryboard, project.settings.style_effort, system=SYSTEM)
    cast = _cast(draft.cast)
    # Objects Claude made for the creator's directions join the creator's own; their art is drawn with "Draw art".
    made = _new_objects(draft.new_objects, {o.id for o in objects})
    cast_ids, object_ids = {c["id"] for c in cast}, {o.id for o in objects} | {o["id"] for o in made}
    # Art is drawn in separate calls, so a fresh storyboard starts without any; the illustration mode carries over.
    board = Storyboard.model_validate(
        {
            "illustration": illustration,
            "cast": cast,
            "objects": [o.model_dump() for o in objects] + made,
            "scenes": [{**_scene(s, cast_ids, object_ids), "direction_used": _direction(project, s.section_ref)} for s in draft.scenes],
            "moods": _moods(draft.moods, lyrics),
            "cues": _cues(draft.cues, lyrics),
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
) -> SceneRedo:
    if not 0 <= index < len(analysis.sections):
        raise IndexError(index)
    current = board.model_dump()
    user = (
        f"{directions_block(project, analysis, index)}Here is the song:\n{_context(project, analysis, lyrics, plan, board.objects)}\n\nHere is the current storyboard:\n{json.dumps(current, indent=1)}\n\n"
        f"Redesign only the scene for section {index} with a fresh take that still fits the story. Use only characters from the existing cast, and objects from the existing custom objects or ones you define under new_objects. "
        f"Return it with section_ref={index}."
    )
    draft = _call(client, user, LooseRedo, project.settings.style_effort, system=SYSTEM)
    old = next((s for s in board.scenes if s.section_ref == index), None)
    made = _new_objects(draft.new_objects[:2], {o.id for o in board.objects})
    # The old backdrop no longer matches the redesigned scene, so it is dropped; the per-scene mode choice is kept.
    scene = Scene.model_validate(
        {
            **_scene(draft.scene, {c.id for c in board.cast}, {o.id for o in board.objects} | {o["id"] for o in made}),
            "section_ref": index,
            "illustration": old.illustration if old else None,
            "direction_used": _direction(project, index),
        }
    )
    return SceneRedo(scene=scene, new_objects=[CustomObject.model_validate(o) for o in made])
