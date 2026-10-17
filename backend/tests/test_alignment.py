from types import SimpleNamespace

from app import alignment


def test_low_confidence_flags_unaligned_words_but_not_missing_probabilities(monkeypatch):
    def word(text, p):
        return SimpleNamespace(start=0.0, end=0.5, word=f" {text}", probability=p)

    seg = SimpleNamespace(words=[word("sure", 0.9), word("shaky", 0.2), word("unaligned", 0.0), word("unknown", None), word(" ", 0.0)])
    monkeypatch.setattr(alignment, "_get_model", lambda: SimpleNamespace(align=lambda *a, **kw: SimpleNamespace(segments=[seg])))
    (line,) = alignment.align("vocals.wav", "sure shaky unaligned unknown").lines
    assert {w.text: w.low_confidence for w in line.words} == {"sure": False, "shaky": True, "unaligned": True, "unknown": False}
