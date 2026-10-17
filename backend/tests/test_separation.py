import pytest

from app import separation


class FakeSeparator:
    samplerate = 44100

    def __init__(self, **kw):
        pass

    def separate_audio_file(self, audio):
        return None, {"vocals": b"stem"}


def test_vocals_stem_appears_only_once_fully_written(tmp_path, monkeypatch):
    out = tmp_path / "vocals.wav"
    monkeypatch.setattr(separation, "Separator", FakeSeparator)

    def interrupted(stem, path, samplerate):
        open(path, "wb").write(b"half a wav")
        raise KeyboardInterrupt

    monkeypatch.setattr(separation, "save_audio", interrupted)
    with pytest.raises(KeyboardInterrupt):
        separation.isolate_vocals(tmp_path / "audio.mp3", out)
    assert list(tmp_path.iterdir()) == []  # nothing a later run would mistake for a finished stem

    monkeypatch.setattr(separation, "save_audio", lambda stem, path, samplerate: open(path, "wb").write(stem))
    assert separation.isolate_vocals(tmp_path / "audio.mp3", out) == out and out.read_bytes() == b"stem"
    assert [p.name for p in tmp_path.iterdir()] == ["vocals.wav"]
