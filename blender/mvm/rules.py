"""Decisions shared with the Remotion renderer (crowds, moods, colour grades, lighting), kept free of bpy so they can be tested outside Blender.

Each mirrors the function of the same name in video/src (scenes/crowd.ts, scenes/mood.ts, grade.ts, scenes/lighting.ts).
"""

import math

MAX_CROWD = 8
AUTO_FROM = 0.55
SOLO = ("sit", "slump", "look_up")


def crowd_size(given, intensity: float, lead_action: str | None, enabled: bool) -> int:
    """A number the storyboard gave (0 included) is used as it is; otherwise intense sections get a few, unless the lead is alone on purpose."""
    if given is not None:
        return max(0, min(MAX_CROWD, round(given)))
    if not enabled or intensity < AUTO_FROM or lead_action in SOLO:
        return 0
    return round(2 + (intensity - AUTO_FROM) / (1 - AUTO_FROM) * 4)


def crowd_action(intensity: float, pick: float, walker: bool) -> str:
    """What a background figure does: they follow the music, so the crowd livens up with the section."""
    if intensity < 0.4:
        return "walk" if walker else "idle"
    if intensity < 0.7:
        return "dance" if pick < 0.35 else "walk" if walker else "idle"
    if intensity < 0.85:
        return "dance" if pick < 0.5 else "wave" if pick < 0.8 else "idle"
    return "jump" if pick < 0.35 else "wave" if pick < 0.7 else "dance"


MOOD_HOLD_S = 8.0


def mood_at(moods: list[dict] | None, t: float) -> str | None:
    """The expression the lyrics call for at t: the latest mood set at or before t, while it still holds."""
    found = None
    for m in moods or []:
        if m["at"] <= t and (found is None or m["at"] > found["at"]):
            found = m
    return found["expression"] if found and t - found["at"] <= MOOD_HOLD_S else None


def expression_strength(energy: float) -> float:
    return 0.7 + 0.55 * min(1.0, max(0.0, energy))


# ------------------------------------------------------------------ colour grades

NEUTRAL = dict(saturate=1.0, contrast=1.0, brightness=1.0, sepia=0.0, hue=0.0, tint="#808080", tint_amount=0.0)
GRADES = {
    "none": NEUTRAL,
    "warm": dict(saturate=1.1, contrast=1.03, brightness=1.02, sepia=0.12, hue=-6.0, tint="#ffb366", tint_amount=0.12),
    "cool": dict(saturate=0.94, contrast=1.04, brightness=0.99, sepia=0.0, hue=8.0, tint="#4aa3ff", tint_amount=0.13),
    "faded": dict(saturate=0.62, contrast=0.88, brightness=1.06, sepia=0.1, hue=0.0, tint="#d8d2c4", tint_amount=0.14),
    "noir": dict(saturate=0.12, contrast=1.28, brightness=0.92, sepia=0.0, hue=0.0, tint="#202838", tint_amount=0.1),
    "vivid": dict(saturate=1.5, contrast=1.1, brightness=1.03, sepia=0.0, hue=0.0, tint="#808080", tint_amount=0.0),
    "dream": dict(saturate=0.9, contrast=0.92, brightness=1.08, sepia=0.0, hue=10.0, tint="#ffc8ff", tint_amount=0.15),
}


def _mix_hex(a: str, b: str, k: float) -> str:
    pa, pb = (tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)) for h in (a, b))
    return "#%02x%02x%02x" % tuple(round(x + (y - x) * k) for x, y in zip(pa, pb))


def blend_grades(a: str, b: str, k: float, strength: float = 1.0) -> dict:
    """One grade moving into another, as its change from neutral scaled by `strength`."""
    ga, gb = GRADES.get(a, NEUTRAL), GRADES.get(b, NEUTRAL)
    p = min(1.0, max(0.0, k))
    lerp = lambda key: ga[key] + (gb[key] - ga[key]) * p
    scaled = lambda key: NEUTRAL[key] + (lerp(key) - NEUTRAL[key]) * strength
    tint = gb["tint"] if ga["tint_amount"] == 0 else ga["tint"] if gb["tint_amount"] == 0 else _mix_hex(ga["tint"], gb["tint"], p)
    return dict(
        saturate=max(0.0, scaled("saturate")), contrast=max(0.3, scaled("contrast")), brightness=max(0.3, scaled("brightness")),
        sepia=min(1.0, max(0.0, scaled("sepia"))), hue=scaled("hue"), tint=tint, tint_amount=min(0.4, lerp("tint_amount") * strength),
    )


def grade_strength(energy: float) -> float:
    return 0.8 + 0.35 * min(1.0, max(0.0, energy))


# ------------------------------------------------------------------ light that follows the song

ORDER = ("dawn", "day", "dusk", "night")
DRIFT = 0.35
SHOWS = {"dawn": 0.75, "day": 0.35, "dusk": 0.95, "night": 1.0}


def next_time_of_day(tod: str) -> str:
    return ORDER[(ORDER.index(tod) + 1) % len(ORDER)] if tod in ORDER else tod


def drift_amount(progress: float) -> float:
    p = min(1.0, max(0.0, progress))
    return DRIFT * p * p * (3 - 2 * p)


def lighting_at(tod: str, beat: float, down: float, energy: float) -> dict:
    """What the music adds to the light at one moment: a flash on beats and a rim on the cast. `beat` and `down` are 1 on the beat, decaying."""
    shows = SHOWS.get(tod, 1.0)
    flash = min(0.1, 0.05 * beat * beat + 0.06 * down * down) * (0.4 + 0.6 * energy) * (0.5 + 0.5 * shows)
    rim = min(0.7, max(0.0, (0.14 + 0.32 * energy + 0.24 * beat) * shows))
    return dict(flash=flash, rim=rim)


def beat_envelope(beats: list[float], t: float, decay: float = 0.22) -> float:
    """1 right on a beat, falling away over `decay` seconds."""
    last = None
    for b in beats:
        if b > t:
            break
        last = b
    return 0.0 if last is None else math.exp(-((t - last) / decay) ** 2 * 1.5)
