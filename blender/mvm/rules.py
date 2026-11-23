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
    return "jump" if pick < 0.35 else "cheer" if pick < 0.7 else "dance"


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


# ------------------------------------------------------------------ lyric cues, eyes and weather

SYMBOL_S = 2.6
HOLD_S = 8.0


def cues_at(cues: list[dict] | None, t: float) -> dict:
    """What the lyric cues call for at t: a symbol beside the lead (with its age) and an item put in their hand."""
    symbol = holding = None
    for c in cues or []:
        if c["at"] > t:
            continue
        if c.get("symbol") and (symbol is None or c["at"] > symbol[0]):
            symbol = (c["at"], c["symbol"])
        if c.get("holding") and (holding is None or c["at"] > holding[0]):
            holding = (c["at"], c["holding"])
    held = holding if holding and t - holding[0] <= HOLD_S else None
    return dict(
        symbol=(symbol[1], t - symbol[0]) if symbol and t - symbol[0] <= SYMBOL_S else None,
        holding=held[1] if held else None,
        hold_age=t - held[0] if held else None,
    )


SYMBOL_COLOR = {"heart": "#ff6b86", "star": "#ffd84a", "rose": "#e24a66", "key": "#f0c24a", "door": "#d89a64", "moon": "#f4e7a8", "bird": "#5ab4ea", "clock": "#e8e2d0"}
HELD_COLOR = {"umbrella": "#e8a33d", "suitcase": "#c98f5a", "microphone": "#d4d8e2", "flowers": "#f08aa8", "lantern": "#ffcf7a", "book": "#d96a6a", "guitar": "#d9944a", "phone": "#bfe3ff", "sword": "#c9d0dc", "flag": "#e8566a", "balloon": "#e8566a", "cup": "#f1e6d8"}


def cue_tint(state: dict) -> tuple[str, float] | None:
    """A soft tint for the lyrics: strong while a symbol is up, gentler while an item is in hand (the same as the other renderer's)."""
    ramp = lambda age, length: max(0.0, min(1.0, age / 0.3, (length - age) / 0.6))
    symbol = (SYMBOL_COLOR[state["symbol"][0]], 0.6 * ramp(state["symbol"][1], SYMBOL_S)) if state["symbol"] else None
    held = (HELD_COLOR[state["holding"]], 0.3 * ramp(state["hold_age"], HOLD_S)) if state["holding"] and state["hold_age"] is not None else None
    best = (symbol if symbol[1] >= held[1] else held) if symbol and held else (symbol or held)
    return best if best and best[1] > 0.005 else None


_LOOK = {"look_up": (0.2, -0.85), "sit": (0.3, 0.4), "slump": (0.1, 0.65), "cross_arms": (0.2, 0.45), "reach": (0.7, -0.2), "point": (0.85, 0.0)}


def eye_look(noise, action: str, camera: bool, lift: float, target_lift: float | None = None) -> tuple[float, float]:
    """Where the eyes look, each -1..1 (y negative is up; `lift` is how far the figure is off the ground, up positive).
    `noise(channel, rate)` gives smooth noise in -1..1 for this figure and moment."""
    clamp = lambda v: max(-1.0, min(1.0, v))
    gx, gy = 0.3 * noise(0, 0.5), 0.25 * noise(1, 0.4)
    if camera:
        return 0.06 * gx, 0.06 * gy
    if target_lift is not None:
        return clamp(0.85 + 0.15 * gx), clamp((lift - target_lift) * 9 + 0.5 * gy)
    bx, by = _LOOK.get(action, (0.35, 0.0))
    return clamp(bx + gx), clamp(by + gy)


def weather_mood(energy: float, onset: float) -> float:
    """How much weather the music asks for, 0.2..1: heavier rain, snow and fog when louder."""
    return min(1.0, max(0.2, 0.25 + 0.7 * energy + 0.15 * onset))


def symbol_size(age: float) -> float:
    """How big a symbol is `age` seconds after it appears: a pop (a little overshoot) then a fade at the end, 0..~1.1."""
    c1 = 1.70158
    p = min(1.0, max(0.0, age / 0.35))
    pop = p if p in (0.0, 1.0) else 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2
    return max(0.0, pop) * min(1.0, max(0.0, (SYMBOL_S - age) / 0.6))


def scenery_mood(energy: float, onset: float, pulse: float) -> dict:
    """What the music asks of the scenery (the same as the other renderer's): gusts on hard hits, glow on beats, flicker."""
    clamp = lambda v: max(0.0, min(1.0, v))
    return dict(gust=clamp((onset - 0.4) / 0.6), energy=clamp(energy), glow=clamp(0.45 * energy + 0.55 * pulse), flicker=clamp(0.15 + 0.85 * onset))
