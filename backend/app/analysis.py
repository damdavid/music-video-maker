import math
from pathlib import Path

import librosa
import numpy as np

from app.models import FPS, AnalysisData, Section

SR = 22050
N_FFT = 2048
# One feature frame per video frame; keeps preview/render indexing trivial.
HOP = SR // FPS
assert HOP * FPS == SR

MIN_SECTION_S = 2.0
LOW_HZ = 250
HIGH_HZ = 2000

_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Krumhansl-Schmuckler key profiles.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _norm(x: np.ndarray) -> np.ndarray:
    # 99th percentile rather than max so one transient doesn't flatten the curve.
    scale = np.percentile(x, 99)
    if scale <= 0:
        return np.zeros_like(x)
    return np.clip(x / scale, 0, 1)


def _fit(x: np.ndarray, n: int) -> np.ndarray:
    """Pad (edge) or trim along the last axis to exactly n frames."""
    cur = x.shape[-1]
    if cur >= n:
        return x[..., :n]
    return np.pad(x, [(0, 0)] * (x.ndim - 1) + [(0, n - cur)], mode="edge")


def _detect_key(chroma: np.ndarray) -> str:
    profile = chroma.mean(axis=1)
    best, best_score = "C major", -2.0
    for i in range(12):
        for name, ref in (("major", _MAJOR), ("minor", _MINOR)):
            score = np.corrcoef(profile, np.roll(ref, i))[0, 1]
            if score > best_score:
                best, best_score = f"{_NOTES[i]} {name}", score
    return best


def _sections(chroma: np.ndarray, mfcc: np.ndarray, duration: float) -> list[Section]:
    # Roughly one section per 25s, bounded so short clips still segment sensibly.
    k = int(np.clip(round(duration / 25), 2, 10))
    if chroma.shape[1] <= k:  # clustering needs more frames than clusters; a clip this short is one section
        return [Section(start=0.0, end=duration, label="section_1")]
    feats = np.vstack([librosa.util.normalize(chroma, axis=1), librosa.util.normalize(mfcc, axis=1)])
    bounds = librosa.segment.agglomerative(feats, k)
    candidates = sorted({0.0, *librosa.frames_to_time(bounds, sr=SR, hop_length=HOP).tolist()})
    # Drop boundaries too close to the previous one (or the end) so sections stay contiguous.
    times = [0.0]
    for t in candidates[1:]:
        if t - times[-1] >= MIN_SECTION_S and duration - t >= MIN_SECTION_S:
            times.append(t)
    times.append(duration)
    return [
        Section(start=float(a), end=float(b), label=f"section_{i + 1}")
        for i, (a, b) in enumerate(zip(times[:-1], times[1:]))
    ]


def analyze(path: str | Path) -> AnalysisData:
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    duration = float(len(y) / SR)
    n = math.ceil(duration * FPS)

    stft = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)
    power = stft**2

    def band(lo: float, hi: float) -> np.ndarray:
        mask = (freqs >= lo) & (freqs < hi)
        return _norm(_fit(np.sqrt(power[mask].mean(axis=0)), n))

    rms = _norm(_fit(librosa.feature.rms(S=stft, frame_length=N_FFT)[0], n))
    centroid = _norm(_fit(librosa.feature.spectral_centroid(S=stft, sr=SR)[0], n))
    onset_env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    chroma = librosa.feature.chroma_stft(S=power, sr=SR)
    mfcc = librosa.feature.mfcc(y=y, sr=SR, hop_length=HOP, n_mfcc=13)

    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR, hop_length=HOP)
    beats = librosa.frames_to_time(beat_frames, sr=SR, hop_length=HOP)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=HOP, units="time")

    return AnalysisData(
        duration=duration,
        bpm=float(np.atleast_1d(tempo)[0]),
        key=_detect_key(chroma),
        beats=beats.tolist(),
        # Assumes 4/4 with the first detected beat on the downbeat; the editor can correct it.
        downbeats=beats[::4].tolist(),
        onsets=onsets.tolist(),
        sections=_sections(chroma, mfcc, duration),
        rms=rms.tolist(),
        low=band(0, LOW_HZ).tolist(),
        mid=band(LOW_HZ, HIGH_HZ).tolist(),
        high=band(HIGH_HZ, SR / 2 + 1).tolist(),
        spectral_centroid=centroid.tolist(),
        onset_strength=_norm(_fit(onset_env, n)).tolist(),
        chroma=_fit(chroma, n).T.round(4).tolist(),
    )
