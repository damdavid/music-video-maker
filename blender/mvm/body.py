"""Body shape as cross-sections along each part, per gender. Free of bpy so the proportions can be tested.

Everything is in fractions of the figure's height. A station is (z, rx, ry, cy, tag): at height z the cross-section is an
ellipse with half-width rx, half-depth ry, centred cy along Y (forward is -Y). The tag says which proportion scales it.
"""

from dataclasses import dataclass

# Typical standing heights in metres before the character's own build is applied.
HEIGHT = {"male": 1.78, "female": 1.66}

# Multipliers for each part of the body, male as the reference.
GENDER = {
    "male": dict(shoulder=1.0, chest=1.0, waist=1.0, hip=1.0, bust=0.0, neck=1.0, thigh=1.0, limb=1.0, jaw=1.0, brow=1.0),
    "female": dict(shoulder=0.88, chest=0.9, waist=0.86, hip=1.12, bust=1.0, neck=0.86, thigh=1.06, limb=0.88, jaw=0.88, brow=0.4),
}


def infer_gender(hair: str | None, outfit: str | None) -> str:
    """For characters made before gender was a choice: a guess from hair and outfit."""
    return "female" if outfit == "dress" or hair in ("long", "bun") else "male"


@dataclass(frozen=True)
class Station:
    z: float
    rx: float
    ry: float
    cy: float = 0.0
    tag: str = ""


S = Station
# Relative to the pelvis joint: the crotch at the bottom, the base of the neck at the top.
TORSO = [
    S(-0.100, 0.040, 0.034, 0.0, "hip"),
    S(-0.082, 0.092, 0.068, 0.0, "hip"),
    S(-0.045, 0.112, 0.082, 0.0, "hip"),
    S(0.005, 0.106, 0.078, 0.0, "hip"),
    S(0.065, 0.092, 0.068, 0.0, "waist"),
    S(0.125, 0.098, 0.071, 0.0, "chest"),
    S(0.185, 0.112, 0.078, 0.0, "chest"),
    S(0.235, 0.123, 0.081, 0.0, "chest"),
    S(0.275, 0.124, 0.072, 0.0, "shoulder"),
    S(0.302, 0.072, 0.058, 0.004, "neck"),
    S(0.318, 0.050, 0.048, 0.006, "neck"),
]
NECK = [S(0.290, 0.052, 0.050, 0.004, "neck"), S(0.335, 0.041, 0.042, 0.004, "neck"), S(0.385, 0.038, 0.040, 0.0, "neck")]
# Relative to the hip joint, going down; the ankle is at -0.48.
LEG = [
    S(0.040, 0.050, 0.056, 0.0, "thigh"),
    S(-0.020, 0.062, 0.067, 0.0, "thigh"),
    S(-0.100, 0.059, 0.062, 0.0, "thigh"),
    S(-0.180, 0.050, 0.053, 0.0, "thigh"),
    S(-0.245, 0.041, 0.044, 0.002, "limb"),
    S(-0.300, 0.040, 0.047, 0.010, "limb"),
    S(-0.370, 0.033, 0.039, 0.006, "limb"),
    S(-0.430, 0.026, 0.029, 0.003, "limb"),
    S(-0.470, 0.022, 0.025, 0.002, "limb"),
    S(-0.488, 0.014, 0.015, 0.0, "limb"),
]
# Relative to the shoulder joint, going down; the wrist is at -0.32.
ARM = [
    S(0.022, 0.032, 0.032, 0.0, "limb"),
    S(0.002, 0.040, 0.041, 0.0, "limb"),
    S(-0.040, 0.040, 0.042, 0.0, "limb"),
    S(-0.095, 0.037, 0.040, 0.0, "limb"),
    S(-0.165, 0.030, 0.031, 0.0, "limb"),
    S(-0.212, 0.031, 0.033, 0.002, "limb"),
    S(-0.270, 0.026, 0.026, 0.0, "limb"),
    S(-0.318, 0.019, 0.018, 0.0, "limb"),
    S(-0.330, 0.010, 0.010, 0.0, "limb"),
]
# Relative to the chin, going up. The head is a skull over a jaw rather than two balls.
HEAD = [
    S(0.000, 0.010, 0.012, -0.020, "jaw"),
    S(0.008, 0.026, 0.030, -0.024, "jaw"),
    S(0.024, 0.038, 0.046, -0.015, "jaw"),
    S(0.048, 0.046, 0.057, -0.004, "jaw"),
    S(0.074, 0.047, 0.060, 0.000, ""),
    S(0.100, 0.047, 0.062, 0.003, ""),
    S(0.118, 0.045, 0.060, 0.006, ""),
    S(0.131, 0.036, 0.050, 0.008, ""),
    S(0.140, 0.022, 0.034, 0.008, ""),
    S(0.145, 0.008, 0.014, 0.008, ""),
]

# Where the joints are, relative to the pelvis joint (REST_Z above the ground).
REST_Z = 0.48
ANKLE = 0.045  # the ankle joint is this high above the floor, so the shoe has somewhere to be
SHOULDER_Z, SHOULDER_X, HIP_X, HIP_Z = 0.27, 0.108, 0.055, -0.01
THIGH, SHIN, UPPER_ARM, FORE_ARM = 0.245, 0.235, 0.165, 0.155
TORSO_LEN, NECK_LEN = 0.30, 0.035


def shaped(stations: list[Station], gender: str) -> list[Station]:
    """The stations with the gender's proportions applied: broader shoulders or hips, a bust, a heavier jaw."""
    g = GENDER[gender]
    out = []
    for st in stations:
        k = g.get(st.tag, 1.0)
        rx = st.rx * k
        ry, cy = st.ry, st.cy
        if st.tag == "chest" and g["bust"]:
            weight = max(0.0, 1.0 - abs(st.z - 0.185) / 0.07)  # a bust is centred on the lower chest
            ry += 0.012 * weight * g["bust"]
            cy -= 0.011 * weight * g["bust"]
        if st.tag in ("neck", "jaw", "limb", "thigh"):
            ry *= 0.5 + 0.5 * k
        out.append(Station(st.z, rx, ry, cy, st.tag))
    return out


def smoothstep(x: float) -> float:
    p = min(1.0, max(0.0, x))
    return p * p * (3 - 2 * p)


def blend(z: float, boundary: float, width: float) -> float:
    """0 well above the boundary, 1 well below it, smooth through it: how much a vertex follows the lower bone."""
    return smoothstep((boundary + width - z) / (2 * width))
