"""Procedural body motion as joint angles per action, kept free of bpy so it can be tested outside Blender.

Angles are degrees. Limbs are [upper, lower]: upper is measured from hanging straight down, positive = forward;
lower is relative to upper (elbow: + bends forward; knee: - bends backward).
"""

import math
from dataclasses import dataclass, field, replace

from .timing import hash_noise

TAU = math.tau
# Segment lengths as fractions of the figure's height.
THIGH, SHIN = 0.245, 0.235
LEG = THIGH + SHIN


@dataclass
class Ctx:
    t: float
    beat: float
    beat_len: float
    energy: float
    seed: int
    variant: int = 0


@dataclass
class Pose:
    lean: float = 0.0
    head: float = 0.0
    # Rotation of the hips and the counter-rotation of the shoulders about the vertical, for a body that is not flat.
    yaw: float = 0.0
    twist: float = 0.0
    arm_l: tuple[float, float] = (4.0, 8.0)
    arm_r: tuple[float, float] = (-4.0, 8.0)
    leg_l: tuple[float, float] = (0.0, -2.0)
    leg_r: tuple[float, float] = (0.0, -2.0)
    # Lift above standing, in figure heights (a jump).
    y: float = 0.0
    # Swing of long hair relative to the head, degrees; positive = back.
    hair: float = 0.0
    side: float = 0.0  # head roll


def frac(x: float) -> float:
    return x - math.floor(x)


def smooth(x: float) -> float:
    p = min(1.0, max(0.0, x))
    return p * p * (3 - 2 * p)


def impulse(tau: float, rise: float) -> float:
    return 0.0 if tau < 0 else (tau / rise) * math.exp(1 - tau / rise)


def own(c: Ctx, channel: int, rate: float) -> float:
    return hash_noise(c.seed + 19 * c.variant + channel, c.t * rate * TAU)


def nod(c: Ctx, depth: float) -> float:
    return depth * c.energy * impulse(frac(c.beat) * c.beat_len, 0.09)


def leg_to(dx: float, dy: float) -> tuple[float, float]:
    """Two-bone IK: thigh and knee angles that put the ankle at (dx forward, dy down) from the hip, knee forward."""
    d = min(math.hypot(dx, dy), LEG * 0.9999)
    to_ankle = math.atan2(dx, dy)
    at_hip = math.acos(min(1.0, (THIGH**2 + d * d - SHIN**2) / (2 * THIGH * d)))
    at_ankle = math.acos(min(1.0, (SHIN**2 + d * d - THIGH**2) / (2 * SHIN * d)))
    return math.degrees(to_ankle + at_hip), -math.degrees(at_hip + at_ankle)


@dataclass
class Gait:
    period: float
    reach: float
    lift: float
    stance: float
    float_: float
    arm_swing: float
    elbow: float
    lean: float


WALK = Gait(1.1, 0.2, 0.05, 0.99, 0.0, 22, 12, 3)
RUN = Gait(0.65, 0.29, 0.13, 0.93, 0.025, 55, 80, 13)


def _foot(u: float, g: Gait) -> tuple[float, float]:
    """Foot position relative to the hip: planted and sweeping back for half the cycle, then swinging forward on an arc."""
    if u < 0.5:
        return g.reach * (1 - 4 * u), 0.0
    s = (u - 0.5) * 2
    return -g.reach * math.cos(math.pi * s), g.lift * math.sin(math.pi * s)


def ground_speed(action: str) -> float:
    """Figure-heights per second the body travels while walking or running, so planted feet don't slide."""
    g = RUN if action == "run" else WALK if action == "walk" else None
    return 4 * g.reach / g.period if g else 0.0


def _gait(t: float, g: Gait) -> Pose:
    u = frac(t / g.period)
    reach_leg = LEG * g.stance
    hip = lambda x: math.sqrt(max(reach_leg**2 - x * x, 0.0))
    rx, rl = _foot(u, g)
    lx, ll = _foot(frac(u + 0.5), g)
    planted = (rx, rl) if rl == 0 else (lx, ll)
    height = hip(planted[0])
    arm = g.arm_swing * math.cos(TAU * u)
    sway = math.sin(TAU * u)
    return Pose(
        lean=g.lean,
        y=g.float_ * math.cos(TAU * u) ** 2,
        head=-1.5 * abs(math.sin(TAU * u)),
        yaw=7 * sway * (1.5 if g is RUN else 1),
        twist=-9 * sway * (1.5 if g is RUN else 1),
        leg_r=leg_to(rx, height - rl),
        leg_l=leg_to(lx, height - ll),
        arm_r=(-arm, g.elbow),
        arm_l=(arm, g.elbow),
    )


def breath(t: float) -> float:
    return 0.6 * math.sin(t / 3.4 * TAU)


def idle(c: Ctx) -> Pose:
    t = c.t
    b = math.sin(t / 3.2 * TAU)
    drift, glance = own(c, 11, 0.18), own(c, 12, 0.12)
    return Pose(
        lean=0.8 + 0.6 * b + 1.4 * drift + breath(t) * 0.4,
        head=1.5 * math.sin(t / 4.5 * TAU) + 5 * glance + nod(c, 4),
        yaw=2.5 * drift,
        twist=-3 * drift,
        arm_l=(4 + 1.5 * b, 8 + 3 * drift),
        arm_r=(-4 - 1.5 * b, 8 - 3 * drift),
    )


def sit(c: Ctx) -> Pose:
    b = math.sin(c.t / 3.6 * TAU)
    return Pose(lean=2 + 0.6 * b, head=2 + nod(c, 5), leg_l=(86, -88), leg_r=(90, -90), arm_l=(22, 55), arm_r=(30, 45))


def wave(c: Ctx) -> Pose:
    t = c.t
    return Pose(lean=1, head=3 + nod(c, 3), arm_r=(158 + 4 * math.sin(t * TAU * 0.8), 12 * math.sin(t * TAU * 1.6)), yaw=-4)


def look_up(c: Ctx) -> Pose:
    return Pose(lean=-3 + 0.8 * own(c, 13, 0.15), head=-20 + 2 * math.sin(c.t / 4 * TAU), arm_l=(3, 6), arm_r=(-3, 6))


def reach(c: Ctx) -> Pose:
    b = math.sin(c.t / 2.4 * TAU)
    return Pose(lean=10 + b, head=-6, arm_r=(112 + 4 * b, 4 + 3 * b), arm_l=(-22, 14), leg_r=(24, -10), leg_l=(-16, -6), yaw=-10, twist=6)


def point(c: Ctx) -> Pose:
    b = math.sin(c.t / 2.8 * TAU)
    return Pose(lean=3 + 0.5 * b + nod(c, 2), head=1, arm_r=(86 + 2 * b, 4), arm_l=(4, 8), leg_r=(6, -6), leg_l=(-4, -2), yaw=-6)


def lean(c: Ctx) -> Pose:
    b = math.sin(c.t / 3.8 * TAU)
    return Pose(lean=-12 + 0.6 * b, head=4 + nod(c, 3), arm_l=(8, 36), arm_r=(-2, 24), leg_r=(14, -6), leg_l=(-6, -2))


def cross_arms(c: Ctx) -> Pose:
    b = math.sin(c.t / 3.4 * TAU)
    return Pose(lean=3 + 0.4 * b, head=7, arm_r=(34, 118), arm_l=(28, 124))


def cheer(c: Ctx) -> Pose:
    s = math.sin(math.pi * c.beat)
    bounce = abs(s)
    return Pose(y=0.022 * bounce * (0.6 + 0.8 * c.energy), lean=-2, head=-7 + 2 * s, arm_r=(166 + 8 * s, 6), arm_l=(160 - 8 * s, 6),
                leg_r=(4 * s, -6 - 10 * (1 - bounce)), leg_l=(-4 * s, -6 - 10 * bounce))


def slump(c: Ctx) -> Pose:
    b = math.sin(c.t / 4.2 * TAU)
    return Pose(lean=15 + b, head=30 + 2 * b, arm_l=(10, 10), arm_r=(2, 8), leg_l=(4, -10), leg_r=(-3, -8))


def _sway(beat: float, amp: float) -> Pose:
    bounce, s = abs(math.sin(math.pi * beat)), math.sin(math.pi * beat)
    return Pose(y=0.0, lean=6 * math.sin(math.pi * beat / 2) * amp, head=4 * s, yaw=14 * s * amp, twist=-18 * s * amp,
                arm_r=(118 + 38 * s * amp, 30), arm_l=(118 - 38 * s * amp, 30),
                leg_r=(10 * s, -22 * (1 - bounce)), leg_l=(-10 * s, -22 * bounce))


def _pump(beat: float, amp: float) -> Pose:
    bounce, s = abs(math.sin(math.pi * beat)), math.sin(math.pi * beat)
    up = lambda x: max(0.0, x)
    return Pose(lean=4 * s * amp, head=5 * (1 - bounce), yaw=10 * s * amp, twist=-12 * s * amp,
                arm_r=(50 + 85 * up(s) * amp, 100 - 70 * up(s)), arm_l=(50 + 85 * up(-s) * amp, 100 - 70 * up(-s)),
                leg_r=(14 * s, -30 * (1 - bounce)), leg_l=(-14 * s, -30 * (1 - bounce)))


def _clap(beat: float, amp: float) -> Pose:
    open_ = abs(math.sin(math.pi * beat))
    return Pose(lean=-2, head=-6 + 6 * (1 - open_), arm_r=(160 - 28 * open_ * amp, 18), arm_l=(160 + 28 * open_ * amp, 18),
                leg_r=(6, -18 * (1 - open_)), leg_l=(-4, -18 * (1 - open_)))


MOVES = [_sway, _pump, _clap]
BAR, BLEND_BEATS = 4, 0.5


def lerp_pose(a: Pose, b: Pose, k: float) -> Pose:
    f = lambda x, y: x + (y - x) * k
    pair = lambda p, q: (f(p[0], q[0]), f(p[1], q[1]))
    return Pose(f(a.lean, b.lean), f(a.head, b.head), f(a.yaw, b.yaw), f(a.twist, b.twist), pair(a.arm_l, b.arm_l), pair(a.arm_r, b.arm_r),
                pair(a.leg_l, b.leg_l), pair(a.leg_r, b.leg_r), f(a.y, b.y), f(a.hair, b.hair), f(a.side, b.side))


def _move_for(seed: int, bar: int):
    return MOVES[(seed * 2654435761 + (bar + 1) * 40503) % len(MOVES)]


def dance(c: Ctx) -> Pose:
    amp = 0.75 + 0.45 * c.energy
    bar = math.floor(c.beat / BAR)
    into = (c.beat - bar * BAR) / BLEND_BEATS
    seed = c.seed + 7919 * c.variant
    now = _move_for(seed, bar)(c.beat, amp)
    if into >= 1:
        return now
    return lerp_pose(_move_for(seed, bar - 1)(c.beat, amp), now, ease_anticipate(into, 0.08, 1.2))


def jump(c: Ctx) -> Pose:
    jump_beats, ground, snap = 2.0, 0.32, 0.07
    u = frac(c.beat / jump_beats)
    if u < ground:
        k = smooth(u / snap) * (1 - smooth((u - ground + snap) / snap)) * (1 - 0.2 * math.sin(math.pi * u / ground))
        return Pose(lean=8 * k, head=-4 * k, leg_r=(55 * k, -105 * k), leg_l=(45 * k, -95 * k), arm_r=(25 - 60 * k, 15 + 10 * k), arm_l=(25 - 53 * k, 15 + 10 * k))
    v = (u - ground) / (1 - ground)
    air = 4 * v * (1 - v)
    return Pose(y=(0.18 + 0.08 * c.energy) * air, lean=2 * air, arm_r=(25 + 135 * air, 15), arm_l=(25 + 135 * air, 15),
                leg_r=(36 * air, -72 * air), leg_l=(20 * air, -50 * air))


ACTIONS = {
    "idle": idle,
    "walk": lambda c: _gait(c.t, WALK),
    "run": lambda c: _gait(c.t, RUN),
    "sit": sit,
    "wave": wave,
    "look_up": look_up,
    "reach": reach,
    "dance": dance,
    "jump": jump,
    "slump": slump,
    "point": point,
    "lean": lean,
    "cross_arms": cross_arms,
    "cheer": cheer,
}
# How much each action feels the beat; dancing and jumping carry their own accents.
GROOVE = {"idle": 1.0, "sit": 0.5, "wave": 1.0, "look_up": 0.5, "reach": 0.6, "slump": 0.25, "walk": 0.5, "run": 0.3, "point": 0.6, "lean": 0.4, "cross_arms": 0.3}
LAG_UPPER, LAG_LOWER, LAG_HAIR = 0.045, 0.09, 0.16


def _earlier(c: Ctx, dt: float) -> Ctx:
    return replace(c, t=c.t - dt, beat=c.beat - dt / max(c.beat_len, 1e-3))


def accent(c: Ctx) -> float:
    """A pitch pulse around each beat: a dip just before it, a lift on it, a small rebound after. Scaled by loudness."""
    phase = frac(c.beat)
    to_next, since = (1 - phase) * c.beat_len, phase * c.beat_len
    squash = math.exp(-((to_next / 0.09) ** 2))
    return c.energy * (0.032 * impulse(since, 0.06) - 0.011 * impulse(since - 0.14, 0.08) - 0.02 * squash)


def pose_for(action: str, c: Ctx) -> Pose:
    f = ACTIONS.get(action, idle)
    now, upper, lower, late = f(c), f(_earlier(c, LAG_UPPER)), f(_earlier(c, LAG_LOWER)), f(_earlier(c, LAG_HAIR))
    # The head keeps its angle in space a moment longer than the torso does.
    head = upper.lean + upper.head - now.lean
    turn = now.lean + head - (late.lean + late.head)
    fall = (now.y - late.y) / LAG_HAIR
    stream = {"walk": 5, "run": 14}.get(action, 0)
    hair = max(-10.0, min(30.0, 1.3 * turn + 40 * fall + stream + 2 * own(c, 14, 0.4)))
    return replace(
        now,
        lean=now.lean + 28 * GROOVE.get(action, 0.0) * accent(c),
        head=head,
        arm_l=(upper.arm_l[0], lower.arm_l[1]),
        arm_r=(upper.arm_r[0], lower.arm_r[1]),
        hair=hair,
    )


ENTER_S, ENTER_STAGGER = 0.7, 0.12


def ease_out_back(x: float, c1: float = 1.70158) -> float:
    p = min(1.0, max(0.0, x))
    if p in (0.0, 1.0):
        return p
    c3 = c1 + 1
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2


def ease_anticipate(x: float, dip: float = 0.12, c1: float = 1.70158) -> float:
    """A move that first backs away from its target by `dip` (anticipation), then snaps past it and settles (overshoot)."""
    p = min(1.0, max(0.0, x))
    wind = 0.22
    if p < wind:
        return -dip * (-(math.cos(math.pi * p / wind) - 1) / 2)
    return -dip + (1 + dip) * ease_out_back((p - wind) / (1 - wind), c1)


def pose_with_entrance(action: str, c: Ctx, since: float) -> Pose:
    """The pose `since` seconds after the figure appears: it winds up, eases from standing into its action and overshoots."""
    target = pose_for(action, c)
    if since >= ENTER_S or action == "idle":
        return target
    return lerp_pose(pose_for("idle", c), target, ease_anticipate(since / ENTER_S))


def stance_height(p: Pose) -> float:
    """Hip height above the ground, in figure heights, that puts the lowest foot on the floor."""
    def reach(leg):
        a1, a2 = math.radians(leg[0]), math.radians(leg[0] + leg[1])
        return THIGH * math.cos(a1) + SHIN * math.cos(a2)
    return max(reach(p.leg_l), reach(p.leg_r)) + p.y


# ------------------------------------------------------------------ held items

TWO_HANDED = ("guitar",)
HELD = ("umbrella", "suitcase", "microphone", "flowers", "lantern", "book", "guitar", "phone", "flag", "balloon", "cup", "sword")


def hold_pose(p: Pose, kind: str, t: float, beat: float, energy: float) -> Pose:
    """The arms that hold an item, in the item's grip (the same angles as the Remotion renderer). The other arm keeps doing what the action does."""
    sway = math.sin(t / 2.6 * TAU)
    if kind == "umbrella":
        return replace(p, arm_r=(14 + 1.5 * sway, 82.0))
    if kind == "suitcase":
        return replace(p, arm_r=(6 + 4 * energy * sway, 4.0))
    if kind == "microphone":
        return replace(p, arm_r=(30 + 2 * sway, 132.0))
    if kind == "flowers":
        return replace(p, arm_r=(30.0, 52 + 2 * sway))
    if kind == "lantern":
        return replace(p, arm_r=(24.0, 22 + 3 * sway))
    if kind == "book":
        return replace(p, arm_r=(12.0, 98.0))
    if kind == "phone":
        return replace(p, arm_r=(26 + 2 * sway, 116.0))
    if kind == "flag":
        return replace(p, arm_r=(30.0, 58 + 2 * sway))
    if kind == "balloon":
        return replace(p, arm_r=(42.0, 20 + 3 * sway))
    if kind == "cup":
        return replace(p, arm_r=(22.0, 106.0))
    if kind == "sword":
        return replace(p, arm_r=(34 + 1.5 * sway, 70.0))
    if kind == "guitar":
        strum = math.sin(beat * TAU)
        # In 3D the far hand reaches out to the figure's left along the neck (see Figure.abduct), not straight ahead.
        return replace(p, arm_r=(24 + 5 * strum, 58 + 14 * strum * (0.4 + energy)), arm_l=(40.0, 30.0))
    return p
