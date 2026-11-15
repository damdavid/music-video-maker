import pytest

from app import sections
from app.models import Character, Scene, SectionEdit, Storyboard, StyleGlobal, StylePlan, StyleSection


def edits(*spans: tuple[float, float, int | None]) -> list[SectionEdit]:
    return [SectionEdit(start=a, end=b, label=f"s{i}", from_index=f) for i, (a, b, f) in enumerate(spans)]


def plan() -> StylePlan:
    return StylePlan.model_validate(
        {
            "global": StyleGlobal(palette=["#000000", "#ffffff"], font_family="Inter", typography_style="bold", background_preset="tunnel"),
            "sections": [StyleSection(section_ref=i, visual_preset="orbits", intensity=0.1 * (i + 1)) for i in range(2)],
        }
    )


class TestValidate:
    def test_snaps_sections_onto_each_other(self):
        out = sections.validate(edits((0, 10.0004, 0), (10.0, 30.0002, 1)), 30.0, 2)
        assert [(s.start, s.end) for s in out] == [(0, 10.0004), (10.0004, 30.0)]

    @pytest.mark.parametrize(
        "spans",
        [
            [(1, 10, 0), (10, 30, 1)],  # first not at 0
            [(0, 10, 0), (12, 30, 1)],  # gap
            [(0, 10, 0), (10, 25, 1)],  # last short of the end
            [(0, 10, 0), (10, 10.5, 1), (10.5, 30, None)],  # too short
            [(0, 10, 5), (10, 30, 1)],  # unknown source
        ],
    )
    def test_rejects_bad_timelines(self, spans):
        with pytest.raises(ValueError):
            sections.validate(edits(*spans), 30.0, 2)

    def test_needs_a_section(self):
        with pytest.raises(ValueError):
            sections.validate([], 30.0, 2)

    def test_a_clip_shorter_than_the_minimum_is_one_section(self):
        assert len(sections.validate(edits((0, 0.5, 0)), 0.5, 1)) == 1


class TestRemap:
    def test_split_copies_the_style_entry_and_the_scene(self):
        e = edits((0, 5, 0), (5, 10, 0), (10, 30, 1))
        out = sections.remap_plan(plan(), e)
        assert [s.section_ref for s in out.sections] == [0, 1, 2]
        assert [s.intensity for s in out.sections] == [0.1, 0.1, 0.2]

        board = Storyboard(cast=[Character(id="a", name="A", colors={"body": "#d9a37e", "hair": "#2b1d14", "top": "#c0392b", "bottom": "#1f2a44", "accent": "#f1c40f"})], scenes=[Scene(section_ref=0, setting="road", description="rain"), Scene(section_ref=1, setting="shore")])
        scenes = sections.remap_storyboard(board, e).scenes
        assert [(s.section_ref, s.setting) for s in scenes] == [(0, "road"), (1, "road"), (2, "shore")]
        assert scenes[1] is not scenes[0]

    def test_new_blank_section_gets_a_default_style_entry_and_no_scene(self):
        e = edits((0, 10, 0), (10, 20, None), (20, 30, 1))
        assert sections.remap_plan(plan(), e).sections[1].visual_preset == "tunnel"
        board = Storyboard(scenes=[Scene(section_ref=0, setting="road"), Scene(section_ref=1, setting="shore")])
        assert [s.section_ref for s in sections.remap_storyboard(board, e).scenes] == [0, 2]

    def test_deleted_sections_drop_everything_and_descriptions_follow(self):
        e = edits((0, 30, 1))
        board = Storyboard(scenes=[Scene(section_ref=0, setting="road"), Scene(section_ref=1, setting="shore")])
        assert [(s.section_ref, s.setting) for s in sections.remap_storyboard(board, e).scenes] == [(0, "shore")]
        assert sections.remap_descriptions(["a", "b"], e) == ["b"]
        assert sections.remap_descriptions(["a"], edits((0, 10, 0), (10, 20, 0), (20, 30, None))) == ["a", "a", ""]
