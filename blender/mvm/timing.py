"""Beat, cut and lyric timing, kept free of bpy so it can be tested outside Blender."""

import bisect
import math
import random
from dataclasses import dataclass

FALLBACK_BPM = 120.0


def beat_period(analysis: dict) -> float:
    """Typical seconds per beat: the median gap between detected beats, else from the tempo."""
    beats = analysis.get("beats") or []
    if len(beats) >= 2:
        gaps = sorted(b - a for a, b in zip(beats, beats[1:]))
        return gaps[len(gaps) // 2]
    return 60.0 / (analysis.get("bpm") or FALLBACK_BPM)


def beat_phase(beats: list[float], t: float, bpm: float) -> float:
    """Beats elapsed at t, following the detected beats; integers land exactly on beats."""
    period = 60.0 / max(bpm or 100.0, 30.0)
    if not beats:
        return t / period
    i = bisect.bisect_right(beats, t) - 1
    if i < 0:
        return (t - beats[0]) / period
    if i >= len(beats) - 1:
        return i + (t - beats[i]) / period
    return i + (t - beats[i]) / max(beats[i + 1] - beats[i], 1e-3)


def _nearest(sorted_times: list[float], t: float) -> float | None:
    i = bisect.bisect_right(sorted_times, t) - 1
    cands = [sorted_times[j] for j in (i, i + 1) if 0 <= j < len(sorted_times)]
    return min(cands, key=lambda x: abs(x - t)) if cands else None


def snap_cut(analysis: dict, start: float, lo: float, hi: float) -> float:
    """A section start moved onto a nearby downbeat, else beat; never past its neighbours."""
    beat = beat_period(analysis)
    down = _nearest(analysis.get("downbeats") or [], start)
    if down is not None and abs(down - start) <= beat * 0.6 and lo < down < hi:
        return down
    near = _nearest(analysis.get("beats") or [], start)
    if near is not None and abs(near - start) <= beat / 2 and lo < near < hi:
        return near
    return start


def section_spans(analysis: dict) -> list[tuple[float, float]]:
    """(start, end) of each section as the video cuts them: detected edges snap to the beat, hand-edited ones don't."""
    sections = analysis.get("sections") or [{"start": 0.0, "end": analysis["duration"]}]
    edited = analysis.get("sections_edited", False)
    cuts = [0.0]
    for i in range(1, len(sections)):
        s = sections[i]["start"]
        nxt = sections[i + 1]["start"] if i + 1 < len(sections) else analysis["duration"]
        lo = max(cuts[i - 1], sections[i - 1]["start"]) + 0.1
        cuts.append(s if edited else snap_cut(analysis, s, lo, nxt - 0.1))
    ends = cuts[1:] + [analysis["duration"]]
    return list(zip(cuts, ends))


@dataclass
class Shot:
    start: float
    end: float
    kind: str  # wide | medium | close


# Which shots suit each action: a dancer or jumper has to stay in frame, a seated figure invites a closer look.
KINDS = {
    "idle": ["wide", "medium", "close"],
    "walk": ["wide", "medium"],
    "run": ["wide", "medium"],
    "dance": ["wide", "medium"],
    "jump": ["wide", "medium"],
    "sit": ["wide", "medium", "close"],
    "wave": ["wide", "medium"],
    "look_up": ["medium", "close"],
    "reach": ["wide", "medium"],
    "slump": ["medium", "close"],
}
MIN_SHOT_S = 1.5


def bars_per_shot(intensity: float) -> int:
    return 1 if intensity >= 0.7 else 2 if intensity >= 0.4 else 4


def plan_shots(start: float, end: float, downbeats: list[float], bar_len: float, bars: int, action: str, seed: int) -> list[Shot]:
    """Cuts a scene into shots on downbeats, at least 1.5 s apart; the first shot establishes, none repeats back to back."""
    kinds = KINDS.get(action, KINDS["idle"])
    bar = bar_len if bar_len > 0 else 2.0
    inside = [d for d in downbeats if start < d < end]
    if not inside:
        inside = [start + (i + 1) * bar for i in range(int((end - start) // bar))]
    cuts = [start]
    for i, d in enumerate(inside):
        if bars > 1 and i % bars != bars - 1:
            continue
        if d - cuts[-1] >= MIN_SHOT_S and end - d >= MIN_SHOT_S:
            cuts.append(d)
    cuts.append(end)
    rng = random.Random(seed)
    shots: list[Shot] = []
    for i in range(len(cuts) - 1):
        prev = shots[-1].kind if shots else None
        choices = [k for k in kinds if k != prev] if len(kinds) > 1 else kinds
        kind = kinds[0] if i == 0 else rng.choice(choices)
        shots.append(Shot(cuts[i], cuts[i + 1], kind))
    return shots


def shot_at(shots: list[Shot], t: float) -> tuple[Shot, int]:
    i = len(shots) - 1
    while i > 0 and t < shots[i].start:
        i -= 1
    return shots[i], i


MIN_LEAD = 0.15
LEAD = 0.5
LONG_LEAD = 1.0
LONG_GAP = 2.0
REVEAL_LEAD = 0.15


def appear_times(lines: list[dict]) -> list[float]:
    """When each lyric line starts to appear: before it is sung, but never before the previous line has ended."""
    prev_end = -math.inf
    last = -math.inf
    out = []
    for line in lines:
        room = line["start"] - prev_end
        lead = LONG_LEAD if room >= LONG_GAP else min(LEAD, max(room, MIN_LEAD))
        last = max(line["start"] - lead, last)
        prev_end = line["end"]
        out.append(last)
    return out


TITLE_CAP_S = 8.0
TITLE_MIN_S = 1.5
TITLE_NO_LYRICS_S = 4.0


def title_window(lines: list[dict]) -> float:
    """Seconds the title card shows at the start: the intro up to the cap, gone before the first lyric appears; 0 if it doesn't fit."""
    if not lines:
        return TITLE_NO_LYRICS_S
    room = min(TITLE_CAP_S, appear_times(lines)[0] - 0.1)
    return room if room >= TITLE_MIN_S else 0.0


def line_words(line: dict) -> list[dict]:
    """Word timings, splitting the line evenly when it has none."""
    words = line.get("words") or []
    if words:
        return [{"text": w["text"], "start": w["start"], "end": w["end"]} for w in words]
    parts = line["text"].split()
    step = (line["end"] - line["start"]) / max(len(parts), 1)
    return [{"text": p, "start": line["start"] + i * step, "end": line["start"] + (i + 1) * step} for i, p in enumerate(parts)]


def hash_noise(seed: float, t: float) -> float:
    """Smooth deterministic noise in -1..1, from a few summed sines."""
    return (math.sin(t * 1.0 + seed * 12.9898) + 0.5 * math.sin(t * 2.3 + seed * 78.233) + 0.25 * math.sin(t * 4.7 + seed * 37.719)) / 1.75


def mouth_open(lines: list[dict], t: float) -> float:
    """How far a singer's mouth is open (0..1): opening and closing through each aligned word, resting between lines."""
    starts = [l["start"] for l in lines]
    i = bisect.bisect_right(starts, t) - 1
    if i < 0 or t > lines[i]["end"]:
        return 0.0
    words = lines[i].get("words") or []
    for w in words:
        if w["start"] <= t <= w["end"]:
            p = (t - w["start"]) / max(w["end"] - w["start"], 1e-3)
            return math.sin(math.pi * p) ** 0.6 * (0.8 + 0.2 * math.sin(2 * math.pi * 4 * t))
    return 0.1 if words else abs(math.sin(math.pi * 5 * (t - lines[i]["start"]))) * 0.8


def eye_open(t: float, variant: int = 0) -> float:
    """1 = open, near 0 = mid-blink; blinks are irregular and differ per figure."""
    period, length = 3.7, 0.13
    k = round((t + variant * 1.3) / period)
    for n in (k - 1, k, k + 1):
        at = 0.0 if n == 0 else n * period + 1.4 * ((math.sin(n * 12.9898) * 43758.5453) % 1.0)
        p = (t + variant * 1.3 - at) / length
        if n >= 0 and 0 <= p < 1:
            return 1 - 0.85 * math.sin(math.pi * p)
    return 1.0


def video_size(settings: dict) -> tuple[int, int]:
    """Output (width, height), matching video/src/size.ts."""
    short = {"720p": 720, "1080p": 1080}[settings.get("resolution") or "1080p"]
    long = round(short * 16 / 9 / 2) * 2
    return {"9:16": (short, long), "1:1": (short, short)}.get(settings.get("aspect") or "16:9", (long, short))
