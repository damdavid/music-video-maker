"""A jointed 3D mannequin: pivots (empties) carry the rotations, smooth ellipsoids carry the shape.

The figure faces -Y with its left side toward +X; rotations about X swing limbs, positive pitching a hanging limb back.
"""

import math

import bpy

from . import materials
from .motion import LEG, SHIN, THIGH, Pose, stance_height

# Segment lengths and widths as fractions of the figure's height.
TORSO, NECK, HEAD_R = 0.30, 0.035, 0.066
UPPER_ARM, FORE_ARM = 0.165, 0.155
SHOULDER_X, HIP_X = 0.115, 0.055
SKIN_DEFAULT = "#d9a37e"

_sphere_mesh = None


def _sphere():
    global _sphere_mesh
    if _sphere_mesh is None:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.0)
        obj = bpy.context.active_object
        _sphere_mesh = obj.data
        for poly in _sphere_mesh.polygons:
            poly.use_smooth = True
        _sphere_mesh.materials.append(None)  # one slot, linked per object below, so figures can share this mesh
        bpy.data.objects.remove(obj)
    return _sphere_mesh


def pivot(name: str, parent, loc=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.02
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.rotation_mode = "XYZ"
    return obj


def blob(name: str, parent, size, loc, mat, rot=(0.0, 0.0, 0.0)):
    """An ellipsoid with the given radii, centred at loc in the parent's space."""
    obj = bpy.data.objects.new(name, _sphere())
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.scale = size
    obj.rotation_euler = rot
    obj.material_slots[0].link = "OBJECT"
    obj.material_slots[0].material = mat
    return obj


class Figure:
    def __init__(self, name: str, colors: dict, hair: str, outfit: str, height: float):
        self.name, self.h = name, height
        H = height
        self.hair_style, self.outfit = hair, outfit
        skin = materials.principled(f"{name}-skin", colors.get("body", SKIN_DEFAULT), 0.55, sss=0.25)
        top = materials.principled(f"{name}-top", colors["top"], 0.85)
        bottom = materials.principled(f"{name}-bottom", colors["bottom"], 0.8)
        shoe = materials.principled(f"{name}-shoe", colors["accent"], 0.45)
        hair_mat = materials.principled(f"{name}-hair", colors["hair"], 0.35)
        dark = materials.principled(f"{name}-feature", "#120c0a", 0.25)
        legs_mat = skin if outfit == "dress" else bottom
        long_sleeves = outfit in ("coat", "hoodie")

        self.root = pivot(f"{name}-root", None)
        self.pelvis = pivot(f"{name}-pelvis", self.root)
        self.spine = pivot(f"{name}-spine", self.pelvis, (0, 0, 0.0))
        self.neck = pivot(f"{name}-neck", self.spine, (0, 0, TORSO * H))
        self.head = pivot(f"{name}-head", self.neck, (0, 0, NECK * H))
        self.hair_p = pivot(f"{name}-hairswing", self.head, (0, 0.03 * H, HEAD_R * 1.6 * H))

        # Torso: a chest over an abdomen and hips, so the silhouette tapers like a body, not a tube.
        blob(f"{name}-chest", self.spine, (0.135 * H, 0.08 * H, 0.12 * H), (0, 0, 0.205 * H), top)
        blob(f"{name}-waist", self.spine, (0.112 * H, 0.074 * H, 0.11 * H), (0, 0, 0.09 * H), top)
        blob(f"{name}-hips", self.pelvis, (0.115 * H, 0.08 * H, 0.07 * H), (0, 0, 0.0), top if outfit in ("dress", "coat") else bottom)
        blob(f"{name}-neckm", self.neck, (0.026 * H, 0.026 * H, 0.04 * H), (0, 0, 0.012 * H), skin)
        if outfit == "dress":
            self.skirt = blob(f"{name}-skirt", self.pelvis, (0.14 * H, 0.11 * H, 0.1 * H), (0, 0, -0.08 * H), top)
        elif outfit == "coat":
            self.skirt = blob(f"{name}-coat", self.pelvis, (0.125 * H, 0.09 * H, 0.15 * H), (0, 0, -0.11 * H), top)
        else:
            self.skirt = None
        if outfit == "hoodie":
            blob(f"{name}-hoodcollar", self.spine, (0.07 * H, 0.06 * H, 0.04 * H), (0, 0.035 * H, TORSO * H), top)

        # Head: cranium, jaw, ears, nose, eyes, brows, and a mouth that opens to sing.
        r = HEAD_R * H
        blob(f"{name}-cranium", self.head, (r * 0.92, r * 1.02, r * 1.05), (0, 0, r * 1.0), skin)
        blob(f"{name}-jaw", self.head, (r * 0.78, r * 0.85, r * 0.78), (0, -r * 0.2, r * 0.45), skin)
        for sx in (-1, 1):
            blob(f"{name}-ear", self.head, (r * 0.1, r * 0.17, r * 0.24), (sx * r * 0.93, r * 0.05, r * 0.95), skin)
        blob(f"{name}-nose", self.head, (r * 0.13, r * 0.2, r * 0.18), (0, -r * 1.0, r * 0.82), skin)
        self.eyes = [blob(f"{name}-eye", self.head, (r * 0.13, r * 0.07, r * 0.13), (sx * r * 0.36, -r * 0.88, r * 1.1), dark) for sx in (-1, 1)]
        self.brows = [blob(f"{name}-brow", self.head, (r * 0.21, r * 0.05, r * 0.045), (sx * r * 0.36, -r * 0.9, r * 1.32), hair_mat) for sx in (-1, 1)]
        self.mouth = blob(f"{name}-mouth", self.head, (r * 0.26, r * 0.05, r * 0.05), (0, -r * 0.96, r * 0.36), dark)
        self.mouth_rest = (r * 0.26, r * 0.05, r * 0.05)
        self.r = r

        # Hair.
        if hair in ("short", "long", "bun"):
            blob(f"{name}-hair", self.head, (r * 1.04, r * 1.1, r * 1.0), (0, r * 0.12, r * 1.12), hair_mat)
            blob(f"{name}-fringe", self.head, (r * 0.98, r * 0.4, r * 0.4), (0, -r * 0.62, r * 1.5), hair_mat)
        if hair == "long":
            blob(f"{name}-hairlong", self.hair_p, (r * 0.95, r * 0.55, r * 2.4), (0, r * 0.35, -r * 2.2), hair_mat)
        if hair == "bun":
            blob(f"{name}-bun", self.head, (r * 0.42, r * 0.42, r * 0.42), (0, r * 0.55, r * 2.0), hair_mat)
        if hair == "hat":
            accent = materials.principled(f"{name}-hat", colors["accent"], 0.7)
            blob(f"{name}-brim", self.head, (r * 1.7, r * 1.7, r * 0.09), (0, -r * 0.1, r * 1.45), accent)
            blob(f"{name}-crown", self.head, (r * 1.0, r * 1.0, r * 0.8), (0, 0, r * 1.9), accent)
        if hair == "hood":
            blob(f"{name}-hood", self.head, (r * 1.2, r * 0.95, r * 1.15), (0, r * 0.5, r * 1.0), top)

        # Arms.
        self.shoulder, self.elbow = {}, {}
        for side, sx in (("L", 1), ("R", -1)):
            sh = pivot(f"{name}-shoulder{side}", self.spine, (sx * SHOULDER_X * H, 0, 0.27 * H))
            el = pivot(f"{name}-elbow{side}", sh, (0, 0, -UPPER_ARM * H))
            wr = pivot(f"{name}-wrist{side}", el, (0, 0, -FORE_ARM * H))
            sleeve_up = top if outfit != "dress" else skin
            blob(f"{name}-shoulderball", sh, (0.04 * H, 0.04 * H, 0.04 * H), (0, 0, 0), top if outfit != "dress" else skin)
            blob(f"{name}-upperarm", sh, (0.031 * H, 0.031 * H, UPPER_ARM * H * 0.56), (0, 0, -UPPER_ARM * H * 0.5), sleeve_up if outfit != "dress" else skin)
            blob(f"{name}-forearm", el, (0.025 * H, 0.025 * H, FORE_ARM * H * 0.56), (0, 0, -FORE_ARM * H * 0.5), top if long_sleeves else skin)
            blob(f"{name}-hand", wr, (0.022 * H, 0.03 * H, 0.04 * H), (0, 0, -0.03 * H), skin)
            self.shoulder[side], self.elbow[side] = sh, el

        # Legs.
        self.hip, self.knee = {}, {}
        for side, sx in (("L", 1), ("R", -1)):
            hp = pivot(f"{name}-hip{side}", self.pelvis, (sx * HIP_X * H, 0, -0.01 * H))
            kn = pivot(f"{name}-knee{side}", hp, (0, 0, -THIGH * H))
            an = pivot(f"{name}-ankle{side}", kn, (0, 0, -SHIN * H))
            blob(f"{name}-thigh", hp, (0.05 * H, 0.052 * H, THIGH * H * 0.6), (0, 0, -THIGH * H * 0.48), legs_mat)
            blob(f"{name}-shin", kn, (0.036 * H, 0.04 * H, SHIN * H * 0.58), (0, 0, -SHIN * H * 0.48), legs_mat)
            blob(f"{name}-shoe", an, (0.04 * H, 0.085 * H, 0.032 * H), (0, -0.04 * H, -0.015 * H), shoe)
            self.hip[side], self.knee[side] = hp, kn

    # Rotation helpers: forward swing is a negative rotation about X for a hanging limb.
    def apply(self, p: Pose, mouth_open: float = 0.0, blink: float = 1.0) -> None:
        d = math.radians
        H = self.h
        self.pelvis.location.z = stance_height(p) * H + 0.0
        self.pelvis.rotation_euler = (0.0, 0.0, d(p.yaw))
        self.spine.rotation_euler = (d(p.lean), 0.0, d(p.twist))
        self.head.rotation_euler = (d(p.head), d(p.side), 0.0)
        self.hair_p.rotation_euler = (d(p.hair), 0.0, 0.0)
        abd = 7.0
        for side, arm, sign in (("L", p.arm_l, 1), ("R", p.arm_r, -1)):
            self.shoulder[side].rotation_euler = (d(-arm[0]), d(-sign * abd), 0.0)
            self.elbow[side].rotation_euler = (d(-arm[1]), 0.0, 0.0)
        for side, leg in (("L", p.leg_l), ("R", p.leg_r)):
            self.hip[side].rotation_euler = (d(-leg[0]), 0.0, 0.0)
            self.knee[side].rotation_euler = (d(-leg[1]), 0.0, 0.0)
        for eye in self.eyes:
            eye.scale.z = self.r * 0.13 * max(blink, 0.08)
        sx, sy, sz = self.mouth_rest
        self.mouth.scale = (sx * (1 + 0.25 * mouth_open), sy, sz * (1 + 5.5 * mouth_open))
        if self.skirt is not None:
            spread = 1 + 0.12 * min(1.0, abs(p.leg_l[0] - p.leg_r[0]) / 40)
            self.skirt.scale.x = (0.14 if self.outfit == "dress" else 0.125) * H * spread

    def key(self, frame: int) -> None:
        """Keyframe everything apply() and the caller moved."""
        self.root.keyframe_insert("location", frame=frame)
        self.root.keyframe_insert("rotation_euler", frame=frame)
        self.pelvis.keyframe_insert("location", frame=frame, index=2)
        for obj in (self.pelvis, self.spine, self.head, self.hair_p, *self.shoulder.values(), *self.elbow.values(), *self.hip.values(), *self.knee.values()):
            obj.keyframe_insert("rotation_euler", frame=frame)
        self.mouth.keyframe_insert("scale", frame=frame)
        self.eyes[0].keyframe_insert("scale", frame=frame, index=2)
        self.eyes[1].keyframe_insert("scale", frame=frame, index=2)
        if self.skirt is not None:
            self.skirt.keyframe_insert("scale", frame=frame, index=0)
