from app import lyrics_repair, main
from app.models import Line, Lyrics, Word
from tests.client import make_client


def line(*words, start=None, end=None):
    ws = [Word(start=s, end=e, text=t) for t, s, e in words]
    return Line(start=ws[0].start if start is None else start, end=ws[-1].end if end is None else end, text=" ".join(w.text for w in ws), words=ws)


class TestRepair:
    def test_leaves_good_lyrics_alone(self):
        good = Lyrics(lines=[line(("a", 1.0, 1.4), ("b", 1.4, 2.0)), line(("c", 3.0, 3.5))])
        assert lyrics_repair.repair(good, 100.0) == good

    def test_a_word_that_ends_thousands_of_seconds_out_ends_where_the_next_begins(self):
        corrupt = Lyrics(lines=[line(("fly", 95.38, 9362.0), ("so", 96.88, 397.0), ("high", 98.88, 893.5))])
        fixed = lyrics_repair.repair(corrupt, 199.5).lines[0]
        assert [(w.start, w.end) for w in fixed.words] == [(95.38, 96.88), (96.88, 98.88), (98.88, 99.38)]
        assert (fixed.start, fixed.end) == (95.38, 99.38)

    def test_line_bounds_are_the_extent_of_their_words(self):
        # A word edited past the line's end, as the editor used to allow: the line grows to hold it.
        stray = Lyrics(lines=[line(("a", 10.0, 11.0), ("b", 15.0, 16.0), start=10.0, end=11.0)])
        fixed = lyrics_repair.repair(stray, 100.0).lines[0]
        assert (fixed.start, fixed.end) == (10.0, 16.0)

    def test_times_stay_inside_the_song(self):
        beyond = Lyrics(lines=[line(("a", -2.0, 1.0)), line(("z", 120.0, 130.0))])
        fixed = lyrics_repair.repair(beyond, 100.0)
        assert fixed.lines[0].words[0].start == 0.0
        assert fixed.lines[1].words[0].start == 100.0 and fixed.lines[1].words[0].end == 100.0

    def test_lines_without_word_times_are_clamped_and_ordered(self):
        out = lyrics_repair.repair(Lyrics(lines=[Line(start=5.0, end=2.0, text="x"), Line(start=99.0, end=500.0, text="y")]), 100.0)
        assert (out.lines[0].start, out.lines[0].end) == (5.0, 5.0)
        assert out.lines[1].end == 100.0

    def test_works_without_a_known_song_length(self):
        corrupt = Lyrics(lines=[line(("a", 1.0, 5000.0), ("b", 2.0, 2.5))])
        assert lyrics_repair.repair(corrupt, None).lines[0].words[0].end == 2.0


def test_saved_and_served_lyrics_are_repaired_but_a_good_save_is_unchanged(tmp_path, monkeypatch):
    from tests.test_style_plan import _analysis

    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    (tmp_path / pid / "analysis.json").write_text(_analysis().model_dump_json())  # 30 s long
    corrupt = Lyrics(lines=[line(("fly", 5.0, 9362.0), ("so", 6.0, 6.5))])

    # A corrupt file that is already on disk is repaired when read (and so in renders and the editor)...
    (tmp_path / pid / "lyrics.json").write_text(corrupt.model_dump_json())
    served = client.get(f"/projects/{pid}/lyrics").json()
    assert served["lines"][0]["words"][0]["end"] == 6.0
    # ...and a corrupt save is repaired before it is stored.
    saved = client.put(f"/projects/{pid}/lyrics", json=corrupt.model_dump()).json()
    assert saved["lines"][0]["words"][0]["end"] == 6.0
    assert Lyrics.model_validate_json((tmp_path / pid / "lyrics.json").read_text()).lines[0].words[0].end == 6.0

    good = Lyrics(lines=[line(("a", 1.0, 1.5), ("b", 1.5, 2.0))])
    assert client.put(f"/projects/{pid}/lyrics", json=good.model_dump()).json() == good.model_dump()
