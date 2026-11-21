from types import SimpleNamespace

from app import alignment


def test_low_confidence_flags_unaligned_words_but_not_missing_probabilities(monkeypatch):
    def word(text, p):
        return SimpleNamespace(start=0.0, end=0.5, word=f" {text}", probability=p)

    seg = SimpleNamespace(words=[word("sure", 0.9), word("shaky", 0.2), word("unaligned", 0.0), word("unknown", None), word(" ", 0.0)])
    monkeypatch.setattr(alignment, "_get_model", lambda: SimpleNamespace(align=lambda *a, **kw: SimpleNamespace(segments=[seg]), refine=lambda *a, **kw: None))
    (line,) = alignment.align("vocals.wav", "sure shaky unaligned unknown").lines
    assert {w.text: w.low_confidence for w in line.words} == {"sure": False, "shaky": True, "unaligned": True, "unknown": False}


def test_refines_the_alignment_in_place_and_reports_the_stage(monkeypatch):
    seg = SimpleNamespace(words=[SimpleNamespace(start=1.0, end=3.0, word=" back", probability=0.9)])
    calls = []

    def refine(audio, result):
        calls.append(("refine", audio))
        result.segments[0].words[0].start = 2.4  # refining edits the result it is given

    monkeypatch.setattr(alignment, "_get_model", lambda: SimpleNamespace(align=lambda *a, **kw: SimpleNamespace(segments=[seg]), refine=refine))
    stages = []
    (line,) = alignment.align("vocals.wav", "back", on_stage=stages.append).lines
    assert calls == [("refine", "vocals.wav")] and stages == [alignment.REFINING]
    assert line.words[0].start == 2.4 and line.start == 2.4


def test_skips_refining_when_nothing_was_aligned(monkeypatch):
    def refine(*a, **kw):
        raise AssertionError("nothing to refine")

    monkeypatch.setattr(alignment, "_get_model", lambda: SimpleNamespace(align=lambda *a, **kw: SimpleNamespace(segments=[SimpleNamespace(words=[])]), refine=refine))
    assert alignment.align("vocals.wav", "words").lines == []


def test_refinement_that_goes_wrong_is_undone_word_by_word(monkeypatch):
    def word(text, start, end):
        return SimpleNamespace(start=start, end=end, word=f" {text}", probability=0.9)

    seg = SimpleNamespace(words=[word("sane", 1.0, 1.8), word("wild", 2.0, 2.6), word("far", 3.0, 3.5), word("held", 4.0, 5.0)])

    def refine(audio, result):
        a, b, c, d = result.segments[0].words
        a.end = 1.4  # a normal refinement: kept
        b.end = 9362.0  # impossible: undone
        c.start = 9.0  # moved further than refining could mean: undone
        d.end = 4.0  # a held word collapsed to nothing is allowed (it is still a valid time)

    monkeypatch.setattr(alignment, "_get_model", lambda: SimpleNamespace(align=lambda *a, **kw: SimpleNamespace(segments=[seg]), refine=refine))
    (line,) = alignment.align("vocals.wav", "sane wild far held").lines
    times = [(w.text, w.start, w.end) for w in line.words]
    assert times == [("sane", 1.0, 1.4), ("wild", 2.0, 2.6), ("far", 3.0, 3.5), ("held", 4.0, 4.0)]
