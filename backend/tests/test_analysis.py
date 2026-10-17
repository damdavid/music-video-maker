import math

import numpy as np
import pytest
import soundfile as sf

from app.analysis import SR, analyze
from app.models import FPS, StylePlan

BPM = 120
DURATION = 20.0


@pytest.fixture(scope="module")
def click_track(tmp_path_factory):
    """Decaying 1kHz clicks every beat, so beat times are known exactly."""
    y = np.zeros(int(SR * DURATION), dtype=np.float32)
    t = np.arange(int(0.05 * SR)) / SR
    click = (np.sin(2 * np.pi * 1000 * t) * np.exp(-t * 80)).astype(np.float32)
    interval = 60 / BPM
    for k in range(int(DURATION / interval)):
        s = int(k * interval * SR)
        y[s : s + len(click)] += click[: len(y) - s]
    path = tmp_path_factory.mktemp("audio") / "click.wav"
    sf.write(path, y, SR)
    return path


@pytest.fixture(scope="module")
def result(click_track):
    return analyze(click_track)


def test_bpm(result):
    # Trackers may lock to a tempo octave; accept 120 or its double/half.
    assert any(abs(result.bpm - b) <= 1 for b in (BPM, BPM * 2, BPM / 2))


def test_beat_times_near_grid(result):
    interval = 60 / BPM
    errors = [abs(b / interval - round(b / interval)) * interval for b in result.beats]
    assert errors and max(errors) <= 0.03


def test_per_frame_series_cover_video(result):
    n = math.ceil(result.duration * FPS)
    for name in ("rms", "low", "mid", "high", "spectral_centroid", "onset_strength"):
        series = getattr(result, name)
        assert len(series) == n, name
        assert 0 <= min(series) and max(series) <= 1, name
    assert len(result.chroma) == n and len(result.chroma[0]) == 12


def test_sections_cover_duration(result):
    assert result.sections[0].start == 0
    assert result.sections[-1].end == pytest.approx(result.duration)


def test_style_plan_validates():
    plan = StylePlan.model_validate(
        {
            "global": {
                "palette": ["#111111", "#ff3366"],
                "font_family": "Inter",
                "typography_style": "bold",
                "background_preset": "gradientFlow",
            },
            "sections": [{"section_ref": 0, "visual_preset": "particleField", "intensity": 0.7}],
        }
    )
    assert plan.global_.background_preset == "gradientFlow"
    with pytest.raises(ValueError):
        StylePlan.model_validate({"global": {}, "sections": []})


@pytest.mark.filterwarnings("ignore::UserWarning")  # librosa notes the clip is shorter than one FFT window
@pytest.mark.parametrize("samples", [10, 300, 700])
def test_audio_too_short_to_cluster_is_one_section(tmp_path, samples):
    path = tmp_path / "blip.wav"
    sf.write(path, (np.random.default_rng(0).standard_normal(samples) * 0.1).astype("float32"), SR)
    data = analyze(path)
    assert [(s.start, s.end) for s in data.sections] == [(0.0, data.duration)]
