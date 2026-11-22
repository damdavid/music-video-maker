"""The lyric symbols as flat outlines (x right, z up, about one unit wide, centred on the origin), free of bpy so they can be tested.

Each symbol is a list of layers, (outline, colour), drawn back to front; the Blender builder extrudes every outline into a thin solid.
"""

import math

Point = tuple[float, float]


def _circle(cx: float, cz: float, r: float, n: int = 28) -> list[Point]:
    return [(cx + r * math.cos(math.tau * i / n), cz + r * math.sin(math.tau * i / n)) for i in range(n)]


def _rect(x0: float, z0: float, x1: float, z1: float) -> list[Point]:
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def heart() -> list[Point]:
    pts = []
    for i in range(36):
        t = math.tau * i / 36
        pts.append((16 * math.sin(t) ** 3 / 34, (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 34 - 0.06))
    return pts


def star() -> list[Point]:
    return [((0.5 if i % 2 == 0 else 0.2) * math.cos(math.pi * i / 5 + math.pi / 2), (0.5 if i % 2 == 0 else 0.2) * math.sin(math.pi * i / 5 + math.pi / 2)) for i in range(10)]


def moon() -> list[Point]:
    """A crescent: the part of a circle outside a smaller one that is shifted to the right."""
    r0, r1, d = 0.46, 0.4, 0.2
    x = (d * d + r0 * r0 - r1 * r1) / (2 * d)
    z = math.sqrt(max(r0 * r0 - x * x, 0.0))
    a0 = math.atan2(z, x)
    outer = [(r0 * math.cos(a0 + (math.tau - 2 * a0) * i / 24), r0 * math.sin(a0 + (math.tau - 2 * a0) * i / 24)) for i in range(25)]
    b0 = math.atan2(-z, x - d)
    inner = [(d + r1 * math.cos(b0 - (math.tau - 2 * math.atan2(z, x - d)) * i / 24), r1 * math.sin(b0 - (math.tau - 2 * math.atan2(z, x - d)) * i / 24)) for i in range(25)]
    return outer + inner


def door() -> list[Point]:
    arch = [(0.26 * math.cos(math.pi * i / 12), -0.22 + 0.28 * math.sin(math.pi * i / 12) + 0.22) for i in range(13)]
    return [(0.26, -0.5), *arch, (-0.26, -0.5)]


def bird() -> list[Point]:
    return [(-0.4, 0.05), (-0.18, 0.3), (0.0, 0.08), (0.2, 0.3), (0.4, 0.05), (0.2, 0.08), (0.14, -0.1), (-0.04, -0.12), (-0.2, 0.0)]


SYMBOLS: dict[str, list[tuple[list[Point], str]]] = {
    "heart": [(heart(), "#e0556a")],
    "star": [(star(), "#f6c945")],
    "rose": [(_rect(-0.03, -0.5, 0.03, -0.02), "#3f7a3f"), ([(0.03, -0.3), (0.3, -0.18), (0.26, -0.4)], "#4f9a4f"), (_circle(0.0, 0.2, 0.27), "#c93a52")],
    "key": [(_rect(-0.1, -0.05, 0.45, 0.05), "#e2b13c"), (_circle(-0.26, 0.0, 0.18), "#e2b13c"), (_rect(0.28, -0.19, 0.35, -0.05), "#e2b13c"), (_rect(0.4, -0.15, 0.47, -0.05), "#e2b13c")],
    "door": [(door(), "#8a5a36"), (_circle(0.14, -0.1, 0.035, 10), "#f1d27a")],
    "moon": [(moon(), "#f4e7a8")],
    "bird": [(bird(), "#4aa3d8"), (_circle(0.05, -0.07, 0.13), "#4aa3d8")],
    "clock": [(_circle(0.0, 0.0, 0.42), "#f7f3e8"), (_rect(-0.025, 0.0, 0.025, 0.26), "#222222"), (_rect(0.0, -0.03, 0.17, 0.03), "#222222")],
}
