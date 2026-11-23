"""Two characters touching: where the pair stands and the arm angles that make their hands meet. Free of bpy so it can be tested.

Mirrors video/src/scenes/contact.ts. Positions are in the figure's own plane: `f` forward, `z` up, in figure heights.
"""

import math
from dataclasses import dataclass, replace

from .body import ANKLE, FORE_ARM, SHOULDER_Z, TORSO_LEN, NECK_LEN, UPPER_ARM
from .motion import Pose, stance_height

GAP = {"hug": 0.26, "hold_hands": 0.36, "high_five": 0.54, "arm_around": 0.3}
FACE_TO_FACE = ("hug", "high_five")
# The hand's reach beyond the wrist pivot, so the target is where the palm ends up.
HAND = 0.04
# Lean and head tilt added to the first and second figure (degrees), as in the other renderer.
TILT = {"hug": (6, 5, 4, 4), "hold_hands": (0, 0, 1, 1), "high_five": (4, 4, -2, -2), "arm_around": (0, 4, 5, 4)}


@dataclass
class Pair:
    kind: str
    role: str  # "a" is the figure the contact was set on
    partner: int
    placement: str  # of the first figure; the pair stands there
    dx: float  # this figure's offset from the pair's centre, in figure heights (+ toward +X)
    sign: float  # +1 faces +X, -1 faces -X


def pairings(chars: list[dict]) -> list[Pair | None]:
    """Per character: its place in a touching pair, or None. A character is in one pair; the first one set wins."""
    out: list[Pair | None] = [None] * len(chars)
    for i, a in enumerate(chars):
        contact = a.get("contact")
        j = next((k for k, c in enumerate(chars) if k != i and contact and c["character_id"] == contact["partner"]), -1)
        if not contact or j < 0 or out[i] or out[j]:
            continue
        kind, gap, place = contact["kind"], GAP[contact["kind"]], a.get("placement") or "center"
        if kind in FACE_TO_FACE:
            out[i] = Pair(kind, "a", j, place, -gap / 2, 1.0)
            out[j] = Pair(kind, "b", i, place, gap / 2, -1.0)
        else:
            s = 1.0 if (a.get("facing") or "right") == "right" else -1.0
            out[i] = Pair(kind, "a", j, place, s * gap / 2, s)
            out[j] = Pair(kind, "b", i, place, -s * gap / 2, s)
    return out


def arm_to(df: float, dz_down: float) -> tuple[float, float]:
    """[upper, lower] angles putting the hand at (df forward, dz_down below) the shoulder, the elbow dropped below the line."""
    U, F = UPPER_ARM, FORE_ARM + HAND
    d = min(max(math.hypot(df, dz_down), 0.04), (U + F) * 0.9999)
    to_hand = math.atan2(df, dz_down)
    at_shoulder = math.acos(max(-1.0, min(1.0, (U * U + d * d - F * F) / (2 * U * d))))
    at_hand = math.acos(max(-1.0, min(1.0, (F * F + d * d - U * U) / (2 * F * d))))
    return math.degrees(to_hand - at_shoulder), math.degrees(at_shoulder + at_hand)


@dataclass
class Body:
    pose: Pose
    x: float  # the figure's place along X, metres
    height: float  # metres
    sign: float


def _hip_height(p: Pose) -> float:
    return stance_height(p) + ANKLE


def _shoulder(p: Pose) -> tuple[float, float]:
    r = math.radians(p.lean)
    return math.sin(r) * SHOULDER_Z, _hip_height(p) + math.cos(r) * SHOULDER_Z


def _head(p: Pose) -> tuple[float, float]:
    r, up = math.radians(p.lean), TORSO_LEN + NECK_LEN + 0.075
    return math.sin(r) * up, _hip_height(p) + math.cos(r) * up


def _world(b: Body, local: tuple[float, float]) -> tuple[float, float]:
    return b.x + b.sign * local[0] * b.height, local[1] * b.height


def _local(b: Body, w: tuple[float, float]) -> tuple[float, float]:
    return (w[0] - b.x) * b.sign / b.height, w[1] / b.height


def _near(b: Body) -> str:
    """The arm on the camera's side: the figure's right when it faces +X, its left when it faces -X."""
    return "arm_r" if b.sign > 0 else "arm_l"


def _far(b: Body) -> str:
    return "arm_l" if b.sign > 0 else "arm_r"


def _reach(b: Body, side: str, target: tuple[float, float]) -> Pose:
    sf, sz = _shoulder(b.pose)
    tf, tz = _local(b, target)
    return replace(b.pose, **{side: arm_to(tf - sf, sz - tz)})


def _back(b: Body, along: float) -> tuple[float, float]:
    sf, sz = _shoulder(b.pose)
    return _world(b, (sf - 0.075, sz - along))


def contact_poses(pairs: list[Pair | None], bodies: list[Body]) -> list[Pose]:
    """Poses for the figures in touching pairs: leaning and tilting together with an arm of each solved so the hands meet."""
    out = [b.pose for b in bodies]
    for i, p in enumerate(pairs):
        if not p or p.role != "a":
            continue
        j = p.partner
        la, lb, ha, hb = TILT[p.kind]
        a = replace(bodies[i], pose=replace(bodies[i].pose, lean=bodies[i].pose.lean + la, head=bodies[i].pose.head + ha))
        b = replace(bodies[j], pose=replace(bodies[j].pose, lean=bodies[j].pose.lean + lb, head=bodies[j].pose.head + hb))
        if p.kind == "hug":
            pa = _reach(a, _near(a), _back(b, 0.1))
            pb = _reach(b, _near(b), _back(a, 0.1))
            out[i] = _reach(replace(a, pose=pa), _far(a), _back(b, 0.2))
            out[j] = _reach(replace(b, pose=pb), _far(b), _back(a, 0.2))
        elif p.kind == "hold_hands":
            hip_a, hip_b = _world(a, (0.0, _hip_height(a.pose))), _world(b, (0.0, _hip_height(b.pose)))
            meet = ((hip_a[0] + hip_b[0]) / 2, (hip_a[1] + hip_b[1]) / 2 + 0.07 * a.height)
            out[i] = _reach(a, _far(a), meet)
            out[j] = _reach(b, _near(b), meet)
        elif p.kind == "high_five":
            ha_, hb_ = _world(a, _head(a.pose)), _world(b, _head(b.pose))
            meet = ((ha_[0] + hb_[0]) / 2, max(ha_[1], hb_[1]) + 0.04 * a.height)
            out[i] = _reach(a, _near(a), meet)
            out[j] = _reach(b, _near(b), meet)
        elif p.kind == "arm_around":
            sa = _world(a, _shoulder(a.pose))
            hb_ = _world(b, (0.0, _hip_height(b.pose)))
            out[j] = _reach(b, _near(b), (sa[0] + a.sign * 0.05 * a.height, sa[1] - 0.015 * a.height))
            out[i] = _reach(a, _far(a), (hb_[0] + a.sign * 0.02 * a.height, hb_[1] + 0.03 * a.height))
    return out
