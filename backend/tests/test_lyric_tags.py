"""Metatags in the lyrics: [scene], [Chorus] and the like start sections when the lyrics are aligned."""

import time

from app import jobs, lyric_tags, main, pipeline
from app.models import AnalysisData, Line, Lyrics, Project, Scene, Section, Storyboard, StyleGlobal, StylePlan, StyleSection
from tests.client import make_client
from tests.test_style_plan import _analysis


def _lyrics(starts: list[float]) -> Lyrics:
    return Lyrics(lines=[Line(start=s, end=s + 2, text=f"line {i}") for i, s in enumerate(starts)])


def _old(*edges: float) -> list[Section]:
    return [Section(start=a, end=b, label=f"s{i}") for i, (a, b) in enumerate(zip(edges, edges[1:]))]


class TestParse:
    def test_takes_the_tags_out_and_says_which_line_each_precedes(self):
        text, tags = lyric_tags.parse("[Verse 1]\nfirst line\nsecond line\n\n[Chorus]\nthird line")
        assert text == "first line\nsecond line\nthird line"
        assert [(t.label, t.before) for t in tags] == [("Verse 1", 0), ("Chorus", 2)]

    def test_numbers_a_bare_scene_tag_and_keeps_a_numbered_one_as_written(self):
        _, tags = lyric_tags.parse("[scene]\na\n[SCENE]\nb\n[scene 7]\nc\n[]\nd")
        assert [t.label for t in tags] == ["scene 1", "scene 2", "scene 7", "scene 3"]

    def test_lyrics_after_a_tag_on_the_same_line_stay_and_brackets_mid_line_are_not_tags(self):
        text, tags = lyric_tags.parse("[Chorus] la la la\nhello [laughs] world\n[a][b] last")
        assert text == "la la la\nhello [laughs] world\nlast"
        assert [(t.label, t.before) for t in tags] == [("Chorus", 0), ("b", 2)]  # tags in a row: the last one wins

    def test_no_tags_leaves_the_lyrics_as_they_were_aligned(self):
        text, tags = lyric_tags.parse("  one \n\n two\n")
        assert (text, tags) == ("one\ntwo", [])

    def test_a_tag_after_the_last_line_precedes_nothing(self):
        text, tags = lyric_tags.parse("one\n[outro]")
        assert text == "one" and [(t.label, t.before) for t in tags] == [("outro", 1)]

    def test_a_long_tag_is_cut_to_the_label_limit(self):
        _, tags = lyric_tags.parse("[" + "x" * 200 + "]\nline")
        assert len(tags[0].label) == 60


class TestSectionsFromTags:
    def build(self, text, starts, sources=None, old=None, duration=60.0):
        clean, tags = lyric_tags.parse(text)
        lyrics = _lyrics(starts)
        return lyric_tags.sections_from_tags(tags, lyrics, sources if sources is not None else list(range(len(starts))), old or [], duration)

    def test_cuts_at_the_first_line_after_each_tag_and_keeps_an_instrumental_intro(self):
        edits = self.build("[scene]\na\nb\n[scene]\nc", [8.0, 12.0, 30.0])
        assert [(e.start, e.end, e.label) for e in edits] == [(0.0, 8.0, "intro"), (8.0, 30.0, "scene 1"), (30.0, 60.0, "scene 2")]

    def test_a_tag_right_at_the_start_has_no_intro(self):
        edits = self.build("[Verse]\na\n[Chorus]\nb", [0.4, 20.0])
        assert [(e.start, e.label) for e in edits] == [(0.0, "Verse"), (20.0, "Chorus")]

    def test_drops_a_cut_that_would_make_a_section_too_short_and_one_too_near_the_end(self):
        edits = self.build("[a]\nx\n[b]\ny\n[c]\nz", [10.0, 10.4, 59.5])
        assert [e.label for e in edits] == ["intro", "a"]
        assert edits[-1].end == 60.0

    def test_a_trailing_tag_and_a_tag_before_a_line_that_was_not_aligned_use_what_follows(self):
        # Lines 0 and 2 were aligned; line 1 had no words. The tag before line 1 cuts where line 2 starts.
        edits = self.build("[a]\nx\n[b]\ny\nz\n[end]", [5.0, 30.0], sources=[0, 2])
        assert [(e.start, e.label) for e in edits] == [(0.0, "intro"), (5.0, "a"), (30.0, "b")]

    def test_nothing_when_no_tag_lands_on_a_sung_line(self):
        assert self.build("[a]\nx", [], sources=[]) is None
        assert self.build("x\n[outro]", [5.0]) is None

    def test_each_new_section_starts_from_the_old_one_it_overlaps_most(self):
        old = _old(0, 10, 30, 60)
        edits = self.build("[a]\nx\n[b]\ny\n[c]\nz", [12.0, 28.0, 45.0], old=old)
        # intro 0-12 mostly overlaps old 0 (10 s); a 12-28 is inside old 1; b 28-45 overlaps old 2 (15 s) more than old 1; c 45-60 is old 2.
        assert [e.from_index for e in edits] == [0, 1, 2, 2]

    def test_is_blank_when_there_were_no_sections_before(self):
        assert all(e.from_index is None for e in self.build("[a]\nx", [10.0]))

    def test_never_makes_more_than_the_editor_allows(self):
        _, tags = lyric_tags.parse("\n".join(f"[t{i}]\nline {i}" for i in range(60)))
        edits = lyric_tags.sections_from_tags(tags, _lyrics([i * 5.0 + 5 for i in range(60)]), list(range(60)), [], 400.0)
        assert len(edits) == 40 and edits[-1].end == 400.0


def _fakes(monkeypatch, sections: int, duration: float, lines: list[float]):
    seen = {}
    jobs.JOBS.clear()
    monkeypatch.setattr(pipeline, "analyze", lambda p: _analysis(sections).model_copy(update={"duration": duration, "sections": [Section(start=duration * i / sections, end=duration * (i + 1) / sections, label=f"d{i}") for i in range(sections)]}))
    monkeypatch.setattr(pipeline, "isolate_vocals", lambda src, out, on_progress=None: out.write_bytes(b"v"))

    def fake_align(audio, text, on_stage=None):
        seen["text"] = text
        return _lyrics(lines), list(range(len(lines)))

    monkeypatch.setattr(pipeline, "align_lines", fake_align)
    return seen


def test_the_pipeline_aligns_the_lyrics_without_the_tags_and_makes_the_tags_the_sections(tmp_path, monkeypatch):
    seen = _fakes(monkeypatch, 4, 100.0, [10.0, 40.0, 70.0])
    project = Project(id="p", lyrics_text="[scene]\na\n[scene]\nb\n[scene]\nc")
    edits = pipeline.run(tmp_path, project, jobs.ProcessJob(project_id="p"))
    assert seen["text"] == "a\nb\nc"
    assert [(e.label, e.start) for e in edits] == [("intro", 0.0), ("scene 1", 10.0), ("scene 2", 40.0), ("scene 3", 70.0)]
    saved = AnalysisData.model_validate_json((tmp_path / "analysis.json").read_text())
    assert [(s.label, s.start, s.end) for s in saved.sections] == [("intro", 0.0, 10.0), ("scene 1", 10.0, 40.0), ("scene 2", 40.0, 70.0), ("scene 3", 70.0, 100.0)]
    assert saved.sections_edited is False  # the cuts are snapped to the downbeat like the detected ones


def test_without_tags_the_detected_sections_stay_and_nothing_is_returned(tmp_path, monkeypatch):
    _fakes(monkeypatch, 3, 90.0, [5.0])
    assert pipeline.run(tmp_path, Project(id="p", lyrics_text="just words"), jobs.ProcessJob(project_id="p")) is None
    assert [s.label for s in AnalysisData.model_validate_json((tmp_path / "analysis.json").read_text()).sections] == ["d0", "d1", "d2"]


def test_tags_do_nothing_when_lyric_video_is_off(tmp_path, monkeypatch):
    _fakes(monkeypatch, 3, 90.0, [5.0])
    project = Project(id="p", lyrics_text="[scene]\nwords", settings={"lyric_video": False})
    assert pipeline.run(tmp_path, project, jobs.ProcessJob(project_id="p")) is None


def test_a_run_with_tags_carries_the_plan_scenes_and_notes_over_to_the_new_sections(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}, data={"lyrics_text": "[scene]\na\n[scene]\nb"}).json()["id"]
    d = tmp_path / pid
    (d / "vocals.wav").write_bytes(b"v")
    # Four sections of 25 s from an earlier run, each with its own style, scene and note.
    old = [Section(start=25.0 * i, end=25.0 * (i + 1), label=f"old{i}") for i in range(4)]
    (d / "analysis.json").write_text(_analysis(4).model_copy(update={"duration": 100.0, "sections": old}).model_dump_json())
    plan = StylePlan.model_validate({"global": StyleGlobal(palette=["#000000", "#ffffff"], font_family="Inter", typography_style="bold", background_preset="tunnel"), "sections": [StyleSection(section_ref=i, visual_preset="orbits", intensity=0.1 * (i + 1)) for i in range(4)]})
    assert client.put(f"/projects/{pid}/style-plan", json=plan.model_dump(by_alias=True)).status_code == 200
    assert client.put(f"/projects/{pid}/storyboard", json=Storyboard(scenes=[Scene(section_ref=i, setting=s) for i, s in enumerate(["road", "city", "field", "shore"])]).model_dump()).status_code == 200
    client.put(f"/projects/{pid}/section-descriptions", json=["a", "b", "c", "d"])

    # Re-analysis finds two sections, and the tags put cuts at 30 s and 80 s.
    monkeypatch.setattr(pipeline, "analyze", lambda p: _analysis(2).model_copy(update={"duration": 100.0, "sections": [Section(start=0, end=50, label="d0"), Section(start=50, end=100, label="d1")]}))
    monkeypatch.setattr(pipeline, "align_lines", lambda audio, text, on_stage=None: (_lyrics([30.0, 80.0]), [0, 1]))
    assert client.post(f"/projects/{pid}/process").status_code == 202
    for _ in range(100):
        if client.get(f"/projects/{pid}/process").json()["state"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert client.get(f"/projects/{pid}/process").json()["state"] == "done"

    sections = client.get(f"/projects/{pid}/analysis").json()["sections"]
    assert [(s["label"], s["start"], s["end"]) for s in sections] == [("intro", 0.0, 30.0), ("scene 1", 30.0, 80.0), ("scene 2", 80.0, 100.0)]
    # intro 0-30 overlaps old 0 most (25 s); scene 1 30-80 overlaps old 2 most (25 s, against 20 s for old 1); scene 2 80-100 is inside old 3.
    saved_plan = client.get(f"/projects/{pid}/style-plan").json()
    assert [round(s["intensity"], 1) for s in saved_plan["sections"]] == [0.1, 0.3, 0.4]
    scenes = client.get(f"/projects/{pid}/storyboard").json()["scenes"]
    assert [(s["section_ref"], s["setting"]) for s in scenes] == [(0, "road"), (1, "field"), (2, "shore")]
    assert client.get(f"/projects/{pid}").json()["section_descriptions"] == ["a", "c", "d"]
