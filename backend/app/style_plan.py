"""Turns song meaning/genre/mood + analysis + lyrics into an editable StylePlan via Claude."""

import json
import re

import anthropic
import numpy as np
from pydantic import BaseModel, Field, ValidationError

from app import lyric_tags
from app.models import (
    VISUAL_PRESETS,
    AnalysisData,
    CameraMotion,
    Grade,
    Look,
    LyricAnimation,
    Lyrics,
    Project,
    StyleGlobal,
    StylePlan,
    StyleSection,
    Transition,
    Typography,
    VisualPreset,
)

MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
LYRIC_EXCERPT_CHARS = 400
DEFAULT_PALETTE = ["#0b1020", "#3b4a8a", "#c06c84", "#e8a87c", "#f8e9d2"]

SYSTEM = f"""You are the art director for an audio-reactive music video that is generated entirely in code.
Given a song's meaning, genre, mood, structure and lyrics, you design a style plan the renderer executes.

Rules:
- Choose only from the allowed values; the renderer supports nothing else.
- Visual presets: {", ".join(VISUAL_PRESETS)}.
- Make the video follow the song's arc: intensity should rise and fall with the section energy you are given, \
but you may deliberately hold back or contrast when the meaning calls for it.
- Vary presets across sections where it serves the song; repeat a preset when a section (e.g. a chorus) returns.
- Transitions: iris and dive open the new section from the centre of the frame, so use them for a section that begins on a focal moment (a chorus landing, a drop); keep crossfade for gentle changes.
- Transitions land on the nearest downbeat and last about two beats. push shoves the old section off sideways and keeps momentum (verse into pre-chorus); whip is a fast blurred pan for energetic changes; wipe sweeps an angled edge across for clean, graphic changes; punch punches both shots in and cuts hard on the downbeat with a flash, for a chorus or drop landing.
- Camera: pulse punches the frame in on each beat; use it on high-energy sections. handheld is a gentle organic wander that grows livelier with loudness; use it for intimate, raw or live-feeling sections. Lyric animations: inkStamp prints words with a slightly misregistered second ink; dotDissolve ends each line by breaking the words into shrinking dots. Both suit stylized, graphic songs; prefer simpler ones otherwise.
- Grade: a colour treatment for each section's whole picture (none, warm, cool, faded, noir, vivid, dream). Use it to carry the feeling: warm for tenderness or nostalgia, cool for loneliness or distance, faded for memory, noir for tension or grief, vivid for joy or release, dream for wonder. Keep most sections at none or subtle, and let a change of grade mark a change of mood.
- Look: riso gives the whole video a printed-poster finish (paper grain, slightly misregistered inks, a dot screen); choose it for graphic, retro, indie or analog-feeling songs and keep clean for everything else. With riso, the palette should be a few flat, saturated inks on a dark or paper-toned background.
- New presets: ripples (a centre dot sending out a ring on each beat, with a lens ring), halftoneBloom (a spinning flower of dot-screen petals), orbits (counter-rotating rings of medallions). They suit riso; use them sparingly in clean videos.
- handwrite is a lyric animation that writes each word with a pen as it is sung; it suits sparse, intimate sections and works only for plain Latin text.
- Keep one coherent palette (3-5 colors, dark to light) that suits the mood; use palette_shift (-1..1) for per-section warmth/coolness.
- font_family must be a Google Fonts family name.
- Emphasis words are lyric words that deserve a kinetic accent; pick few, and only words that appear in the lyrics.
- The creator's directions are given first in the request, ahead of everything else: they are the main brief for what each part should look and feel like. Follow them before your own ideas, and let them decide the preset, palette shift, camera and grade of the sections they describe.
- Give a short rationale (2-4 sentences) a non-technical reader can follow."""


class StyleError(RuntimeError):
    pass


class SectionDraft(BaseModel):
    section_ref: int = Field(description="Index of the song section this entry styles")
    visual_preset: VisualPreset
    intensity: float = Field(description="0 (calm) to 1 (maximal)")
    palette_shift: float = Field(description="-1 (cooler) to 1 (warmer)")
    camera_motion: CameraMotion
    lyric_animation: LyricAnimation
    transition_in: Transition
    grade: Grade = Field(default="none", description="Colour treatment for the section")


class PlanDraft(BaseModel):
    palette: list[str] = Field(description="3-5 hex colors like #1a2b3c, dark to light")
    font_family: str
    typography_style: Typography
    background_preset: VisualPreset
    grain: float = Field(description="0 to 1")
    vignette: float = Field(description="0 to 1")
    look: Look = Field(description="clean, or riso for a printed-poster finish")
    sections: list[SectionDraft]
    emphasis_words: list[str]
    rationale: str


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _hex(value: str) -> str | None:
    """#rrggbb from a hex color Claude wrote slightly wrong (no #, #rgb shorthand, stray spaces), else None."""
    m = re.fullmatch(r"#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})", value.strip())
    if not m:
        return None
    digits = m.group(1)
    return "#" + (digits if len(digits) == 6 else "".join(c * 2 for c in digits)).lower()


def _palette(colors: list[str]) -> list[str]:
    """At least two valid colors, since the renderer interpolates between them."""
    out = [h for c in colors if (h := _hex(c))]
    if not out:
        return list(DEFAULT_PALETTE)
    if len(out) == 1:
        light = sum(int(out[0][i : i + 2], 16) for i in (1, 3, 5)) > 3 * 128
        return ["#101820", out[0]] if light else [out[0], "#f2f2f2"]
    return out


def _section_summaries(analysis: AnalysisData, lyrics: Lyrics | None, lyrics_text: str, project_descriptions: list[str] = ()) -> list[dict]:
    fps = analysis.fps
    out = []
    for i, s in enumerate(analysis.sections):
        a, b = int(s.start * fps), max(int(s.end * fps), int(s.start * fps) + 1)
        entry = {
            "index": i,
            "label": s.label,
            "start_s": round(s.start, 1),
            "end_s": round(s.end, 1),
            "energy": round(float(np.mean(analysis.rms[a:b])), 2),
            "bass": round(float(np.mean(analysis.low[a:b])), 2),
            "treble": round(float(np.mean(analysis.high[a:b])), 2),
            "beats": sum(1 for t in analysis.beats if s.start <= t < s.end),
        }
        if i < len(project_descriptions) and project_descriptions[i].strip():
            entry["user_description"] = project_descriptions[i].strip()
        if lyrics:
            text = " / ".join(line.text for line in lyrics.lines if s.start <= line.start < s.end)
            entry["lyrics"] = text[:LYRIC_EXCERPT_CHARS]
        out.append(entry)
    if not lyrics and lyrics_text.strip():
        out.append({"lyrics_unaligned": lyrics_text[: LYRIC_EXCERPT_CHARS * 8]})
    return out


def directions_block(project: Project, analysis: AnalysisData, only: int | None = None) -> str:
    """The creator's written directions for sections, as the first thing in a request (or just section `only`), or "" when there are none."""
    notes = project.section_descriptions
    rows = []
    for i, s in enumerate(analysis.sections):
        text = notes[i].strip() if i < len(notes) else ""
        if text and (only is None or i == only):
            rows.append(f'- Section {i} ("{s.label}", {int(s.start) // 60}:{int(s.start) % 60:02d} to {int(s.end) // 60}:{int(s.end) % 60:02d}): {text}')
    if not rows:
        return ""
    head = "The creator's direction for this section" if only is not None else "The creator's directions for sections"
    return f"{head} (the main brief: follow it before anything else, and make what it describes clearly visible):\n" + "\n".join(rows) + "\n\n"


def _brief(project: Project, analysis: AnalysisData, lyrics: Lyrics | None) -> str:
    m = project.meta
    return json.dumps(
        {
            "title": m.title,
            "artist": m.artist,
            "meaning": m.meaning,
            "genre": m.genre,
            "mood_tags": m.mood_tags,
            "overall_energy": m.energy,
            "influences": m.influences,
            "lyric_video": project.settings.lyric_video,
            "bpm": round(analysis.bpm),
            "key": analysis.key,
            "duration_s": round(analysis.duration),
            "sections": _section_summaries(analysis, lyrics, lyric_tags.parse(project.lyrics_text)[0], project.section_descriptions),
        },
        indent=1,
    )


def _drop_nulls(value):
    """Nulls removed from every object, so a field Claude left null takes its default instead of failing validation."""
    if isinstance(value, dict):
        return {k: _drop_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_drop_nulls(v) for v in value]
    return value


def _json_object(text: str) -> dict:
    """The JSON object in a reply, whether or not it came in a code fence or with a sentence around it."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise StyleError("Claude's answer had no JSON in it; try again")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise StyleError("Claude's answer was not valid JSON; try again") from e


def _call_json(client: anthropic.Anthropic, user: str, model: type[BaseModel], effort: str, system: str = SYSTEM, max_tokens: int = 16000):
    """Like _call, but without the API's structured-output grammar, which refuses a schema as large as the storyboard's
    ("compiled grammar is too large"). The model is told the JSON Schema in the request and replies with JSON text, which
    is parsed and validated here; the loose models and their repair code make it forgiving."""
    prompt = (
        f"{user}\n\nReply with ONLY one JSON object that follows this JSON Schema: no prose before or after, and no code fence. "
        f"Leave out any field you have nothing for.\n\n{json.dumps(model.model_json_schema())}"
    )
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        output_config={"effort": effort},
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise StyleError("Claude declined this request")
    if response.stop_reason == "max_tokens":
        raise StyleError("Claude's answer was cut off before it finished; try again, or lower the effort setting")
    text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
    try:
        return model.model_validate(_drop_nulls(_json_object(text)))
    except ValidationError as e:
        raise StyleError(f"Claude returned an invalid answer: {e.error_count()} validation errors") from e


def _call(client: anthropic.Anthropic, user: str, output_format: type[BaseModel], effort: str, system: str = SYSTEM, max_tokens: int = 16000):
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=max_tokens,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            output_config={"effort": effort},
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=output_format,
        )
    except ValidationError as e:  # the schema can't enforce constraints like the hex pattern
        # Structured output is always valid JSON unless it was cut off at max_tokens.
        if any(err["type"] == "json_invalid" and "EOF" in err["msg"] for err in e.errors()):
            raise StyleError("Claude's answer was cut off before it finished; try again, or lower the effort setting") from e
        raise StyleError(f"Claude returned an invalid plan: {e.error_count()} validation errors") from e
    if response.stop_reason == "refusal":
        raise StyleError("Claude declined this request")
    if response.parsed_output is None:
        if response.stop_reason == "max_tokens":
            raise StyleError("No structured output: Claude's answer was cut off before it finished (stop_reason=max_tokens)")
        raise StyleError(f"No structured output (stop_reason={response.stop_reason})")
    return response.parsed_output


def _section(d: SectionDraft) -> StyleSection:
    return StyleSection(
        section_ref=d.section_ref,
        visual_preset=d.visual_preset,
        intensity=_clamp(d.intensity, 0, 1),
        palette_shift=_clamp(d.palette_shift, -1, 1),
        camera_motion=d.camera_motion,
        lyric_animation=d.lyric_animation,
        transition_in=d.transition_in,
        grade=d.grade,
    )


def _to_plan(draft: PlanDraft, n_sections: int) -> StylePlan:
    # One entry per song section: drop out-of-range/duplicate refs, fill gaps from the global look.
    by_ref: dict[int, SectionDraft] = {}
    for s in draft.sections:
        if 0 <= s.section_ref < n_sections and s.section_ref not in by_ref:
            by_ref[s.section_ref] = s
    sections = [
        _section(by_ref[i])
        if i in by_ref
        else StyleSection(section_ref=i, visual_preset=draft.background_preset, intensity=0.5)
        for i in range(n_sections)
    ]
    return StylePlan.model_validate(
        {
            "global": StyleGlobal(
                palette=_palette(draft.palette),
                font_family=draft.font_family,
                typography_style=draft.typography_style,
                background_preset=draft.background_preset,
                grain=_clamp(draft.grain, 0, 1),
                vignette=_clamp(draft.vignette, 0, 1),
                look=draft.look,
            ),
            "sections": sections,
            "emphasis_words": draft.emphasis_words,
            "rationale": draft.rationale,
        }
    )


def generate_plan(
    project: Project, analysis: AnalysisData, lyrics: Lyrics | None, client: anthropic.Anthropic
) -> StylePlan:
    brief = _brief(project, analysis, lyrics)
    draft = _call(client, f"{directions_block(project, analysis)}Design the style plan for this song.\n\n{brief}", PlanDraft, project.settings.style_effort)
    return _to_plan(draft, len(analysis.sections))


def regenerate_section(
    project: Project,
    analysis: AnalysisData,
    lyrics: Lyrics | None,
    plan: StylePlan,
    index: int,
    client: anthropic.Anthropic,
) -> StyleSection:
    if not 0 <= index < min(len(analysis.sections), len(plan.sections)):
        raise IndexError(index)
    brief = _brief(project, analysis, lyrics)
    current = plan.model_dump(by_alias=True, exclude={"sections": {"__all__": {"preset_params"}}})
    user = (
        f"{directions_block(project, analysis, index)}Here is the song:\n{brief}\n\nHere is the current style plan:\n{json.dumps(current, indent=1)}\n\n"
        f"Redesign only section {index} with a fresh take that still fits the overall look. "
        f"Return it with section_ref={index}."
    )
    draft = _call(client, user, SectionDraft, project.settings.style_effort)
    section = _section(draft.model_copy(update={"section_ref": index}))
    # User-set overrides survive a redo; preset params only make sense for the same preset.
    old = plan.sections[index]
    section.palette_override = old.palette_override
    if section.visual_preset == old.visual_preset:
        section.preset_params = old.preset_params
    return section

