"""Hair as locks: tapered strands that grow from the scalp, flow away from a whorl at the crown, and (for long hair) hang
under gravity around the head and shoulders. Free of bpy so the shapes can be tested.

Points are in the head's frame, in fractions of the figure's height: x to the left, y backward (the face is at -y), z up
from the chin. A strand is a list of (x, y, z, radius).
"""

import math
import random

# The skull as an ellipsoid (a touch larger than the mesh so hair sits on it).
C = (0.0, 0.003, 0.0725)
R = (0.0475, 0.0625, 0.0735)
# Where long hair hangs from, so the whole mass can swing about it (matches the figure's hair pivot).
PIVOT = (0.0, 0.025, 0.13)
WHORL = (0.0, 0.58, 0.81)  # unit vector toward the crown whorl, back of the top of the head
BUN = (0.0, 0.84, 0.54)  # unit vector toward the bun

Vec = tuple[float, float, float]


def _add(a: Vec, b: Vec, k: float = 1.0) -> Vec:
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def _norm(v: Vec) -> Vec:
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def on_scalp(u: Vec, lift: float = 0.0) -> Vec:
    """The point `lift` above the skull in the direction of unit vector u (in the skull's scaled space)."""
    s = 1.0 + lift
    return (C[0] + R[0] * u[0] * s, C[1] + R[1] * u[1] * s, C[2] + R[2] * u[2] * s)


def hairline_threshold(u: Vec) -> float:
    """Hair grows where the unit vector's z is above this: a high forehead hairline, ears, a low nape."""
    return 0.05 - 0.66 * u[1]


def roots(n: int, rng: random.Random, low_back: float = 0.0) -> list[Vec]:
    """Roughly evenly spread root directions over the part of the skull that has hair."""
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    total = n * 4  # most of the sphere is face, neck or empty, so sample more and keep what lands in the hairline
    for i in range(total):
        z = 1 - 2 * (i + 0.5) / total
        r = math.sqrt(max(0.0, 1 - z * z))
        a = golden * i
        u = (r * math.cos(a), r * math.sin(a), z)
        if u[2] > hairline_threshold(u) - low_back * max(0.0, u[1]):
            out.append(u)
    rng.shuffle(out)
    return out[:n]


def _tangent_away(u: Vec, frm: Vec) -> Vec:
    """The direction along the skull's surface from `frm` through u, continuing away from it."""
    d = _add(u, frm, -_dot(u, frm))
    return _norm(d)


def _rotate_about(v: Vec, axis: Vec, ang: float) -> Vec:
    c, s = math.cos(ang), math.sin(ang)
    k = _dot(axis, v)
    cross = (axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0])
    return (v[0] * c + cross[0] * s + axis[0] * k * (1 - c), v[1] * c + cross[1] * s + axis[1] * k * (1 - c), v[2] * c + cross[2] * s + axis[2] * k * (1 - c))


def torso_radii(z: float) -> tuple[float, float]:
    """Half-width and half-depth of the neck and shoulders below the head, for hair to hang outside."""
    if z >= 0:
        return (0.043, 0.043)
    t = min(1.0, -z / 0.06)
    return (0.043 + (0.126 - 0.043) * t, 0.043 + (0.084 - 0.043) * t)


def push_out(p: Vec, clearance: float) -> Vec:
    """Moves a point that is inside the skull, or inside the neck and shoulders, out to just beyond them."""
    q = ((p[0] - C[0]) / R[0], (p[1] - C[1]) / R[1], (p[2] - C[2]) / R[2])
    d = math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2)
    limit = 1.0 + clearance / 0.06
    if d < limit and p[2] > 0.0:
        k = limit / max(d, 1e-6)
        p = (C[0] + (p[0] - C[0]) * k, C[1] + (p[1] - C[1]) * k, C[2] + (p[2] - C[2]) * k)
    if p[2] < 0.012:
        rx, ry = torso_radii(p[2])
        e = math.sqrt((p[0] / (rx + clearance)) ** 2 + ((p[1]) / (ry + clearance)) ** 2)
        if e < 1.0:
            k = 1.0 / max(e, 1e-6)
            p = (p[0] * k, p[1] * k, p[2])
    return p


def face_guard(p: Vec, rx: float, side: int) -> Vec:
    """Keeps hair off the face: a point in front of the head between chin and brow slides out to its own side of it."""
    if p[1] < 0.0 and 0.012 < p[2] < 0.108 and abs(p[0]) < rx:
        return (side * rx, p[1], p[2])
    return p


def _radius(r0: float, t: float) -> float:
    return r0 * (1 - 0.78 * t**1.4)


def short(rng: random.Random, count: int = 900) -> list[list[tuple]]:
    """A cropped cut: locks follow the skull away from the crown, about 4-6 cm, lifting a little at the ends."""
    strands = []
    side = rng.choice((-1, 1))
    for u0 in roots(count, rng):
        front = max(0.0, -u0[1])
        length = rng.uniform(0.032, 0.05) * (1 - 0.4 * front)
        n = 9
        u = u0
        # A parting: front locks sweep to one side.
        sweep = side * 0.55 * front + rng.uniform(-0.12, 0.12)
        r0 = rng.uniform(0.0036, 0.0048)
        pts = []
        for i in range(n):
            t = i / (n - 1)
            lift = r0 / 0.058 + 0.012 + 0.02 * t**1.4
            p = on_scalp(u, lift)
            pts.append((*p, _radius(r0, t)))
            d = _tangent_away(u, WHORL)
            d = _rotate_about(d, _norm(u), sweep)
            d = _norm(_add(d, (0.0, 0.0, -1.0), 0.45 * max(0.0, 0.55 - u[2])))
            step = length / (n - 1) / 0.062
            u = _norm(_add(u, d, step))
        strands.append(pts)
    return strands


def long(rng: random.Random, count: int = 1250) -> list[list[tuple]]:
    """Long hair: down the back and around the face, parted near the middle, with a loose wave. About 25% of a body's height."""
    strands = []
    part = rng.uniform(-0.06, 0.06)
    for u0 in roots(count, rng, low_back=0.9):
        length = rng.uniform(0.17, 0.27) * (0.75 + 0.25 * (u0[1] > 0))
        n = 16
        u = u0
        r0 = rng.uniform(0.0038, 0.0052)
        p = on_scalp(u, r0 / 0.058 + 0.01)
        phase = rng.uniform(0, math.tau)
        side = 1 if u0[0] > part else -1
        front = max(0.0, -u0[1])
        pts = [(*p, r0)]
        direction = (0.0, 0.0, -1.0)
        on_surface = True
        step = length / (n - 1)
        for i in range(1, n):
            t = i / (n - 1)
            if on_surface:
                d = _tangent_away(u, WHORL)
                d = _rotate_about(d, _norm(u), side * (0.25 + 1.7 * front))
                d = _norm(_add(d, (0.0, 0.0, -1.0), 0.8))
                u = _norm(_add(u, d, step * 1.15 / 0.062))
                p = face_guard(on_scalp(u, r0 / 0.058 + 0.01 + 0.01 * t), 0.06 + r0, side)
                direction = d
                # Below the ears the hair lets go of the head and hangs.
                if p[2] < 0.06 or t > 0.4:
                    on_surface = False
                    direction = _norm(_add(d, (0.0, 0.0, -1.0), 1.0))
                    direction = (direction[0] * 0.6, direction[1] * 0.6, direction[2])
            else:
                wave = (0.18 * math.sin(phase + t * 7.0), 0.05 * math.cos(phase * 1.3 + t * 6.0), 0.0)
                fall = _add(direction, (0.0, 0.05 + 0.1 * t, -1.0), 0.7)
                direction = _norm(_add(fall, wave, 0.35))
                p = _add(p, direction, step)
                # Hair falling in front stays forward of the shoulders, hair at the back stays behind them.
                p = face_guard(push_out(p, 0.007), 0.06 + r0, side)
            pts.append((*p, _radius(r0, t)))
        strands.append(pts)
    return strands


def bun(rng: random.Random, count: int = 520) -> list[list[tuple]]:
    """Hair drawn up and back into a bun: locks follow the skull toward it, then wind round it."""
    centre = BUN_CENTRE
    strands = []
    for u0 in roots(count, rng, low_back=0.5):
        n = 12
        u = u0
        r0 = rng.uniform(0.0028, 0.004)
        pts = []
        turned = rng.uniform(0, math.tau)
        wound = 0
        for i in range(n):
            t = i / (n - 1)
            pole = _dot(u, BUN)
            if pole < 0.93 and i < n - 4:
                p = on_scalp(u, r0 / 0.058 + 0.012 * t)
                d = _norm(_add(BUN, u, -_dot(u, BUN)))  # along the skull toward the bun
                u = _norm(_add(u, d, 0.06))
            else:
                a = turned + wound * 1.1
                rad = 0.026 * (1 - 0.15 * wound)
                p = (centre[0] + rad * math.cos(a), centre[1] + 0.008 * math.sin(a), centre[2] + rad * 0.9 * math.sin(a * 1.0 + 0.6))
                wound += 1
            pts.append((*p, _radius(r0, t)))
        strands.append(pts)
    return strands


STYLES = {"short": short, "long": long, "bun": bun}
# A bun is a ball of hair as well as the locks wound round it.
BUN_CENTRE = on_scalp(BUN, 0.32)  # sits on the head, not in it
BUN_RADIUS = 0.026


def generate(style: str, seed: int) -> list[list[tuple]]:
    return STYLES[style](random.Random(seed))
