import json
from types import SimpleNamespace

import pytest

from app import main, style_plan
from app.models import AnalysisData, Line, Lyrics, Meta, Project, Section
from app.style_plan import PlanDraft, SectionDraft, StyleError, generate_plan, regenerate_section
from tests.client import make_client


def _analysis(n_sections=3) -> AnalysisData:
    secs = [Section(start=i * 10.0, end=(i + 1) * 10.0, label=f"section_{i + 1}") for i in range(n_sections)]
    n = 30 * n_sections * 10
    flat = [0.5] * n
    return AnalysisData(
        duration=n_sections * 10.0, bpm=120, key="A minor", beats=[0.5, 11.0], downbeats=[0.5], onsets=[], sections=secs,
        rms=flat, low=flat, mid=flat, high=flat, spectral_centroid=flat, onset_strength=flat, chroma=[[0.0] * 12] * n,
    )


def _section(ref, preset="particleField"):
    return SectionDraft(section_ref=ref, visual_preset=preset, intensity=0.7, palette_shift=0.1, camera_motion="drift", lyric_animation="pop", transition_in="flash")


def _draft(sections) -> PlanDraft:
    return PlanDraft(
        palette=["#101820", "#ff3366", "#f2f2f2"], font_family="Inter", typography_style="bold", background_preset="gradientFlow",
        grain=0.2, vignette=0.4, look="clean", sections=sections, emphasis_words=["home"], rationale="Because.",
    )


class FakeClient:
    """Stands in for anthropic.Anthropic; records the parse() call."""

    def __init__(self, parsed, stop_reason="end_turn"):
        self.calls = []
        outer = self

        class Messages:
            def parse(self, **kw):
                outer.calls.append(kw)
                return SimpleNamespace(parsed_output=parsed, stop_reason=stop_reason)

        self.beta = SimpleNamespace(messages=Messages())


PROJECT = Project(id="p1", lyrics_text="la la", meta=Meta(title="T", meaning="loss", genre="folk", mood_tags=["wistful"]))


def test_generate_plan_request_shape_and_result():
    client = FakeClient(_draft([_section(0), _section(1, "tunnel"), _section(2)]))
    lyrics = Lyrics(lines=[Line(start=1.0, end=2.0, text="walk alone"), Line(start=12.0, end=13.0, text="take me home")])
    plan = generate_plan(PROJECT, _analysis(), lyrics, client=client)

    call = client.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["output_format"] is PlanDraft
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"] == {"effort": "high"}  # project default
    assert "thinking" not in call  # always on for this model; sending it risks a 400
    brief = json.loads(call["messages"][0]["content"].split("\n\n", 1)[1])
    assert brief["genre"] == "folk" and brief["sections"][0]["lyrics"] == "walk alone"
    assert brief["sections"][1]["lyrics"] == "take me home"

    assert [s.visual_preset for s in plan.sections] == ["particleField", "tunnel", "particleField"]
    assert plan.global_.palette[1] == "#ff3366" and plan.emphasis_words == ["home"]


def test_effort_setting_is_sent():
    project = PROJECT.model_copy(update={"settings": PROJECT.settings.model_copy(update={"style_effort": "xhigh"})})
    client = FakeClient(_draft([_section(0)]))
    generate_plan(project, _analysis(1), None, client=client)
    assert client.calls[0]["output_config"] == {"effort": "xhigh"}


def test_plan_is_normalized_to_one_entry_per_section():
    # duplicate ref, out-of-range ref, and a missing section
    client = FakeClient(_draft([_section(0), _section(0, "tunnel"), _section(9), _section(2)]))
    plan = generate_plan(PROJECT, _analysis(), None, client=client)
    assert [s.section_ref for s in plan.sections] == [0, 1, 2]
    assert plan.sections[0].visual_preset == "particleField"  # first duplicate wins
    assert plan.sections[1].visual_preset == "gradientFlow"  # filled from the global background


def test_out_of_range_values_are_clamped():
    bad = _section(0).model_copy(update={"intensity": 3.0, "palette_shift": -5.0})
    plan = generate_plan(PROJECT, _analysis(1), None, client=FakeClient(_draft([bad])))
    assert plan.sections[0].intensity == 1 and plan.sections[0].palette_shift == -1


def test_refusal_and_empty_output_raise():
    with pytest.raises(StyleError, match="declined"):
        generate_plan(PROJECT, _analysis(), None, client=FakeClient(None, stop_reason="refusal"))
    with pytest.raises(StyleError, match="No structured output"):
        generate_plan(PROJECT, _analysis(), None, client=FakeClient(None, stop_reason="pause_turn"))


def test_invalid_model_output_becomes_style_error():
    def bad_parse(**kw):
        PlanDraft.model_validate({**_draft([_section(0)]).model_dump(), "grain": "lots"})

    client = FakeClient(None)
    client.beta.messages.parse = bad_parse
    with pytest.raises(StyleError, match="invalid plan"):
        generate_plan(PROJECT, _analysis(), None, client=client)


def test_truncated_output_is_reported_as_cut_off():
    def truncated(**kw):
        PlanDraft.model_validate_json('{"palette": ["#000000", "#ff')

    client = FakeClient(None)
    client.beta.messages.parse = truncated
    with pytest.raises(StyleError, match="cut off"):
        generate_plan(PROJECT, _analysis(), None, client=client)
    with pytest.raises(StyleError, match="cut off"):
        generate_plan(PROJECT, _analysis(), None, client=FakeClient(None, stop_reason="max_tokens"))


def test_palette_is_repaired_and_padded_to_at_least_two_colors():
    def plan_with(palette):
        return style_plan._to_plan(_draft([_section(0)]).model_copy(update={"palette": palette}), 1).global_.palette

    assert plan_with(["#101820", "ff3366", "#ABC", "red"]) == ["#101820", "#ff3366", "#aabbcc"]
    assert plan_with([]) == style_plan.DEFAULT_PALETTE
    assert plan_with(["red", "blue"]) == style_plan.DEFAULT_PALETTE
    assert plan_with(["#202020"]) == ["#202020", "#f2f2f2"]  # dark: a light partner after it
    assert plan_with(["#eeeeee"]) == ["#101820", "#eeeeee"]  # light: a dark partner before it


def test_stored_palette_needs_two_colors():
    from pydantic import ValidationError

    from app.models import StyleGlobal

    for palette in ([], ["#000000"]):
        with pytest.raises(ValidationError):
            StyleGlobal(palette=palette, font_family="Inter", typography_style="bold", background_preset="tunnel")


def test_regenerate_section_is_bounded_by_the_plan_and_the_analysis():
    plan = generate_plan(PROJECT, _analysis(), None, client=FakeClient(_draft([_section(0), _section(1), _section(2)])))
    short = plan.model_copy(update={"sections": plan.sections[:2]})
    with pytest.raises(IndexError):
        regenerate_section(PROJECT, _analysis(), None, short, 2, client=FakeClient(_section(2)))


def test_regenerate_section_forces_ref():
    plan = generate_plan(PROJECT, _analysis(), None, client=FakeClient(_draft([_section(0), _section(1), _section(2)])))
    client = FakeClient(_section(99, "spectrumRings"))
    section = regenerate_section(PROJECT, _analysis(), None, plan, 1, client=client)
    assert section.section_ref == 1 and section.visual_preset == "spectrumRings"
    assert client.calls[0]["output_format"] is SectionDraft
    assert "section 1" in client.calls[0]["messages"][0]["content"]
    with pytest.raises(IndexError):
        regenerate_section(PROJECT, _analysis(), None, plan, 7, client=client)


def test_style_plan_routes(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]

    assert client.post(f"/projects/{pid}/style-plan").status_code == 409  # not analyzed
    (tmp_path / pid / "analysis.json").write_text(_analysis().model_dump_json())
    n = len(client.get(f"/projects/{pid}/analysis").json()["sections"])

    fake = FakeClient(_draft([_section(i) for i in range(n)]))
    monkeypatch.setattr(style_plan.anthropic, "Anthropic", lambda **_: fake)
    created = client.post(f"/projects/{pid}/style-plan")
    assert created.status_code == 200 and len(created.json()["sections"]) == n
    assert "global" in client.get(f"/projects/{pid}/style-plan").json()

    edited = client.get(f"/projects/{pid}/style-plan").json()
    edited["global"]["palette"] = ["#000000", "#ffffff"]
    assert client.put(f"/projects/{pid}/style-plan", json=edited).status_code == 200
    assert client.get(f"/projects/{pid}/style-plan").json()["global"]["palette"] == ["#000000", "#ffffff"]
    edited["global"]["palette"] = ["red"]
    assert client.put(f"/projects/{pid}/style-plan", json=edited).status_code == 422  # not a hex color

    fake.beta.messages.parse = lambda **kw: SimpleNamespace(parsed_output=_section(0, "tunnel"), stop_reason="end_turn")
    regen = client.post(f"/projects/{pid}/style-plan/sections/0/regenerate")
    assert regen.status_code == 200 and regen.json()["visual_preset"] == "tunnel"
    assert client.get(f"/projects/{pid}/style-plan").json()["sections"][0]["visual_preset"] == "tunnel"
    assert client.post(f"/projects/{pid}/style-plan/sections/99/regenerate").status_code == 404

    (tmp_path / pid / "analysis.json").write_text(_analysis(n - 1).model_dump_json())  # re-analyzed into fewer sections
    assert client.post(f"/projects/{pid}/style-plan/sections/{n - 1}/regenerate").status_code == 404


def test_palette_override_validation():
    from pydantic import ValidationError

    from app.models import StyleSection

    ok = StyleSection(section_ref=0, visual_preset="tunnel", intensity=0.5, palette_override=["#000000", "#ffffff"])
    assert ok.palette_override == ["#000000", "#ffffff"]
    assert StyleSection(section_ref=0, visual_preset="tunnel", intensity=0.5).palette_override is None
    for bad in (["#000000"], ["#000000", "red"], []):
        with pytest.raises(ValidationError):
            StyleSection(section_ref=0, visual_preset="tunnel", intensity=0.5, palette_override=bad)


def test_regenerate_keeps_palette_override_and_params_only_for_same_preset():
    plan = generate_plan(PROJECT, _analysis(), None, client=FakeClient(_draft([_section(0), _section(1), _section(2)])))
    plan.sections[1].palette_override = ["#101010", "#eeeeee"]
    plan.sections[1].preset_params = {"density": 1.4}

    same = regenerate_section(PROJECT, _analysis(), None, plan, 1, client=FakeClient(_section(1, plan.sections[1].visual_preset)))
    assert same.palette_override == ["#101010", "#eeeeee"] and same.preset_params == {"density": 1.4}

    changed = regenerate_section(PROJECT, _analysis(), None, plan, 1, client=FakeClient(_section(1, "tunnel")))
    assert changed.palette_override == ["#101010", "#eeeeee"] and changed.preset_params == {}


def test_new_motion_vocabulary_is_accepted_and_unknown_values_still_rejected():
    from pydantic import ValidationError

    from app.models import StyleSection

    def section(**kw):
        return StyleSection(section_ref=0, visual_preset="tunnel", intensity=0.5, **kw)

    s = section(camera_motion="pulse", lyric_animation="inkStamp", transition_in="iris")
    assert (s.camera_motion, s.lyric_animation, s.transition_in) == ("pulse", "inkStamp", "iris")
    assert section(lyric_animation="dotDissolve").lyric_animation == "dotDissolve"
    assert section(transition_in="dive").transition_in == "dive"
    for field in ("camera_motion", "lyric_animation", "transition_in"):
        with pytest.raises(ValidationError):
            section(**{field: "spin"})


def test_riso_look_and_new_presets_are_part_of_the_plan_vocabulary():
    from pydantic import ValidationError

    from app.models import StyleGlobal, StyleSection

    g = StyleGlobal(palette=["#000000", "#ffffff"], font_family="Inter", typography_style="bold", background_preset="ripples", look="riso")
    assert g.look == "riso"
    assert StyleGlobal(palette=["#000000", "#ffffff"], font_family="Inter", typography_style="bold", background_preset="orbits").look == "clean"
    for preset in ("ripples", "halftoneBloom", "orbits"):
        assert StyleSection(section_ref=0, visual_preset=preset, intensity=0.5).visual_preset == preset
    assert StyleSection(section_ref=0, visual_preset="tunnel", intensity=0.5, lyric_animation="handwrite").lyric_animation == "handwrite"
    with pytest.raises(ValidationError):
        StyleGlobal(palette=["#000000", "#ffffff"], font_family="Inter", typography_style="bold", background_preset="tunnel", look="sepia")


def test_generated_plan_carries_the_look():
    draft = PlanDraft(
        palette=["#000000", "#ff0000", "#ffffff"], font_family="Inter", typography_style="bold", background_preset="ripples",
        grain=0.2, vignette=0.1, look="riso", sections=[_section(0), _section(1), _section(2)], emphasis_words=[], rationale="r",
    )
    plan = style_plan._to_plan(draft, 3)
    assert plan.global_.look == "riso"
