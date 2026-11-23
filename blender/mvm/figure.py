"""A 3D figure: one skinned body on an armature, over a rigid head, hands and shoes.

The pivots (empties) carry the rotations for the rigid parts; the armature's bones follow the same rotations, so the
torso, limbs and neck bend smoothly at the joints instead of being separate pieces. Faces -Y, left side toward +X.
"""

import math
import zlib

import bmesh
import bpy
from mathutils import Euler, Vector

from . import body, hairgen, materials, wear
from .body import ANKLE, HIP_X, HIP_Z, REST_Z, SHIN, SHOULDER_X, SHOULDER_Z, THIGH, UPPER_ARM, FORE_ARM, TORSO_LEN, NECK_LEN
from .motion import Pose, stance_height

SKIN_DEFAULT = "#d9a37e"
SEG = 22  # vertices round each cross-section
# Per mood: how far the inner brow ends rise (degrees; negative = drop), how far the brows lift (figure heights), how open the eyes stay, the jaw's opening.
MOODS = {
    "neutral": (0.0, 0.0, 1.0, 0.0),
    "happy": (-3.0, 0.0015, 0.55, 0.28),
    "sad": (22.0, 0.0, 0.85, 0.0),
    "surprised": (0.0, 0.004, 1.25, 0.55),
    "calm": (0.0, 0.001, 0.5, 0.0),
    "determined": (-20.0, -0.002, 0.9, 0.0),
}

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


def loft(bm, stations, origin, height: float, material=None, weights=None, seg: int = SEG):
    """A closed tube through elliptical cross-sections. `material(i)` picks a slot per band of faces; `weights(z)` the bone weights."""
    rings = []
    for st in stations:
        ring = []
        for k in range(seg):
            a = math.tau * k / seg
            v = bm.verts.new((origin[0] + st.rx * height * math.cos(a), origin[1] + (st.cy + st.ry * math.sin(a)) * height, origin[2] + st.z * height))
            if weights:
                for group, w in weights(st.z).items():
                    v[weights.layer][group] = w
            ring.append(v)
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(seg):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
            f.material_index = material(i) if material else 0
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        f = bm.faces.new(list(reversed(ring)) if flip else ring)
        f.material_index = material(0 if flip else len(rings) - 2) if material else 0
    return rings


def _mesh_object(name: str, bm, mats, parent):
    mesh = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


class Figure:
    def __init__(self, name: str, colors: dict, hair: str, outfit: str, gender: str, height: float, hat: str | None = None, accessories=(), holding: str | None = None):
        self.name, self.h, self.gender = name, height, gender
        H = height
        self.outfit = outfit
        g = body.GENDER[gender]
        skin = materials.principled(f"{name}-skin", colors.get("body", SKIN_DEFAULT), 0.5, sss=0.3)
        top = materials.principled(f"{name}-top", colors["top"], 0.85)
        bottom = materials.principled(f"{name}-bottom", colors["bottom"], 0.8)
        shoe = materials.principled(f"{name}-shoe", colors["accent"], 0.45)
        sole = materials.principled(f"{name}-sole", "#1b1b1d", 0.7)
        hair_mat = materials.hair(f"{name}-hair", colors["hair"])
        dark = materials.principled(f"{name}-feature", "#120c0a", 0.3)
        white = materials.principled(f"{name}-eyewhite", "#f1efe9", 0.18)
        iris = materials.principled(f"{name}-iris", "#4a2f1d" if colors.get("hair", "#2b1d14") < "#555555" else "#4d6b86", 0.2)
        lips = materials.principled(f"{name}-lips", self._lip_color(colors.get("body", SKIN_DEFAULT), gender), 0.4)

        # Pivots for the rigid parts; the armature below follows the same rotations.
        self.root = pivot(f"{name}-root", None)
        self.pelvis = pivot(f"{name}-pelvis", self.root, (0, 0, (REST_Z + ANKLE) * H))
        self.spine = pivot(f"{name}-spine", self.pelvis)
        self.neck = pivot(f"{name}-neck", self.spine, (0, 0, TORSO_LEN * H))
        self.head = pivot(f"{name}-head", self.neck, (0, 0, NECK_LEN * H))
        self.hair_p = pivot(f"{name}-hairswing", self.head, (0, 0.025 * H, 0.13 * H))
        # How far each arm swings out from the body, degrees; a guitar's neck hand reaches out to the side.
        self.abduct = {"L": 7.0, "R": 7.0}
        self.shoulder, self.elbow, self.wrist, self.hip, self.knee, self.ankle = {}, {}, {}, {}, {}, {}
        for side, sx in (("L", 1), ("R", -1)):
            sh = pivot(f"{name}-shoulder{side}", self.spine, (sx * SHOULDER_X * g["shoulder"] * H, 0, SHOULDER_Z * H))
            el = pivot(f"{name}-elbow{side}", sh, (0, 0, -UPPER_ARM * H))
            wr = pivot(f"{name}-wrist{side}", el, (0, 0, -FORE_ARM * H))
            hp = pivot(f"{name}-hip{side}", self.pelvis, (sx * HIP_X * g["hip"] * H, 0, HIP_Z * H))
            kn = pivot(f"{name}-knee{side}", hp, (0, 0, -THIGH * H))
            an = pivot(f"{name}-ankle{side}", kn, (0, 0, -SHIN * H))
            self.shoulder[side], self.elbow[side], self.wrist[side] = sh, el, wr
            self.hip[side], self.knee[side], self.ankle[side] = hp, kn, an
            self._hand(wr, sx, H, skin)
            self._shoe(an, H, shoe, sole)

        self._body(skin, top, bottom, outfit, g)
        self._head(skin, hair_mat, dark, white, iris, lips, g, H)
        self._hair_and_clothes(hair, outfit, top, hair_mat, colors, H)
        wear.add_outfit_details(self, outfit, colors)
        if hat:
            wear.add_hat(self, hat, colors)
        wear.add_accessories(self, list(accessories or ()), colors)
        self.held = wear.Held(self, holding, colors) if holding else None
        self.extra_held: dict[str, wear.Held] = {}
        self._holding = "?"  # nothing decided yet, so the first hold() keys everything

    def gender_scale(self) -> float:
        return body.GENDER[self.gender]["shoulder"]

    @staticmethod
    def _lip_color(skin_hex: str, gender: str) -> str:
        h = skin_hex.lstrip("#")
        r, gr, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
        k = 0.55 if gender == "female" else 0.35
        return "#%02x%02x%02x" % (int(r + (190 - r) * k), int(gr + (88 - gr) * k), int(b + (96 - b) * k))

    # ------------------------------------------------------------------ parts

    def _hand(self, wrist, sx: int, H: float, skin):
        blob("hand", wrist, (0.019 * H, 0.011 * H, 0.031 * H), (0, 0, -0.026 * H), skin)
        blob("fingers", wrist, (0.017 * H, 0.009 * H, 0.022 * H), (0, -0.001 * H, -0.05 * H), skin)
        blob("thumb", wrist, (0.006 * H, 0.007 * H, 0.017 * H), (-sx * 0.014 * H, -0.011 * H, -0.03 * H), skin, rot=(math.radians(-12), 0, math.radians(sx * 14)))

    def _shoe(self, ankle, H: float, shoe, sole):
        blob("shoe", ankle, (0.032 * H, 0.074 * H, 0.027 * H), (0, -0.032 * H, -0.02 * H), shoe)
        blob("sole", ankle, (0.034 * H, 0.077 * H, 0.008 * H), (0, -0.033 * H, -0.039 * H), sole)

    def _body(self, skin, top, bottom, outfit: str, g: dict) -> None:
        """One mesh for torso, neck, arms and legs, weighted to the bones so joints bend smoothly."""
        H = self.h
        arm = bpy.data.armatures.new(f"{self.name}-rig")
        self.arm = bpy.data.objects.new(f"{self.name}-rig", arm)
        bpy.context.scene.collection.objects.link(self.arm)
        self.arm.parent = self.root
        bpy.context.view_layer.objects.active = self.arm
        bpy.ops.object.mode_set(mode="EDIT")
        z0 = (REST_Z + ANKLE) * H
        sx_ = SHOULDER_X * g["shoulder"] * H
        hx = HIP_X * g["hip"] * H

        def bone(name, head, tail, parent=None, connect=False):
            b = arm.edit_bones.new(name)
            b.head, b.tail = Vector(head), Vector(tail)
            if parent:
                b.parent = arm.edit_bones[parent]
                b.use_connect = connect
            return b

        bone("pelvis", (0, 0, z0), (0, 0, z0 + 0.06 * H))
        bone("spine", (0, 0, z0), (0, 0, z0 + TORSO_LEN * H), "pelvis")
        bone("head", (0, 0, z0 + (TORSO_LEN + NECK_LEN) * H), (0, 0, z0 + (TORSO_LEN + NECK_LEN + 0.12) * H), "spine")
        for side, sx in (("L", 1), ("R", -1)):
            sz = z0 + SHOULDER_Z * H
            bone(f"upperarm.{side}", (sx * sx_, 0, sz), (sx * sx_, 0, sz - UPPER_ARM * H), "spine")
            bone(f"forearm.{side}", (sx * sx_, 0, sz - UPPER_ARM * H), (sx * sx_, 0, sz - (UPPER_ARM + FORE_ARM) * H), f"upperarm.{side}", True)
            hz = z0 + HIP_Z * H
            bone(f"thigh.{side}", (sx * hx, 0, hz), (sx * hx, 0, hz - THIGH * H), "pelvis")
            bone(f"shin.{side}", (sx * hx, 0, hz - THIGH * H), (sx * hx, 0, hz - (THIGH + SHIN) * H), f"thigh.{side}", True)
        bpy.ops.object.mode_set(mode="OBJECT")
        self.rest = {b.name: b.matrix_local.to_3x3() for b in arm.bones}
        self.bone_names = list(self.rest)

        mesh_obj = bpy.data.objects.new(f"{self.name}-body", bpy.data.meshes.new(f"{self.name}-body"))
        bpy.context.scene.collection.objects.link(mesh_obj)
        groups = {n: mesh_obj.vertex_groups.new(name=n).index for n in self.bone_names}
        bm = bmesh.new()
        layer = bm.verts.layers.deform.verify()

        class W:  # weights callable carrying the deform layer
            def __init__(self, fn):
                self.fn, self.layer = fn, layer

            def __call__(self, z):
                return {groups[n]: w for n, w in self.fn(z).items() if w > 1e-4}

        pants = outfit in ("tee", "hoodie", "coat", "jacket", "suit", "overalls")
        torso = body.shaped(body.TORSO, self.gender)
        torso_w = W(lambda z: {"pelvis": body.blend(z, 0.045, 0.045), "spine": 1 - body.blend(z, 0.045, 0.045)})
        loft(bm, torso, (0, 0, z0), H, lambda i: 2 if pants and torso[i].z < 0.02 else 1, torso_w)
        neck = body.shaped(body.NECK, self.gender)
        neck_w = W(lambda z: {"head": body.smoothstep((z - 0.31) / 0.06), "spine": 1 - body.smoothstep((z - 0.31) / 0.06)})
        loft(bm, neck, (0, 0, z0), H, lambda i: 0, neck_w)
        long_sleeve = outfit in ("hoodie", "coat", "jacket", "suit", "robe")
        for side, sx in (("L", 1), ("R", -1)):
            arm_st = body.shaped(body.ARM, self.gender)
            arm_w = W(lambda z, s=side: self._arm_weights(z, s))
            loft(bm, arm_st, (sx * sx_, 0, z0 + SHOULDER_Z * H), H, lambda i, a=arm_st: 1 if (a[i].z > -0.30 if long_sleeve else a[i].z > -0.10) else 0, arm_w)
            leg_st = body.shaped(body.LEG, self.gender)
            leg_w = W(lambda z, s=side: self._leg_weights(z, s))
            loft(bm, leg_st, (sx * hx, 0, z0 + HIP_Z * H), H, lambda i: 0 if outfit in ("dress", "robe") else 2, leg_w)
        mesh = mesh_obj.data
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            f.smooth = True
        bm.to_mesh(mesh)
        bm.free()
        for m in (skin, top, bottom):
            mesh.materials.append(m)
        mesh_obj.parent = self.arm
        mod = mesh_obj.modifiers.new("rig", "ARMATURE")
        mod.object = self.arm
        sub = mesh_obj.modifiers.new("smooth", "SUBSURF")
        sub.levels = sub.render_levels = 1
        self.body = mesh_obj

    @staticmethod
    def _arm_weights(z: float, side: str) -> dict:
        into = body.blend(z, 0.0, 0.035)
        fore = body.blend(z, -UPPER_ARM, 0.035)
        return {"spine": 1 - into, f"upperarm.{side}": into * (1 - fore), f"forearm.{side}": into * fore}

    @staticmethod
    def _leg_weights(z: float, side: str) -> dict:
        down = body.blend(z, HIP_Z, 0.05)
        shin = body.blend(z, -THIGH, 0.04)
        return {"pelvis": 1 - down, f"thigh.{side}": down * (1 - shin), f"shin.{side}": down * shin}

    def _head(self, skin, hair_mat, dark, white, iris, lips, g: dict, H: float) -> None:
        bm = bmesh.new()
        stations = body.shaped(body.HEAD, self.gender)
        loft(bm, stations, (0, 0, 0), H)
        head = _mesh_object(f"{self.name}-skull", bm, [skin], self.head)
        sub = head.modifiers.new("smooth", "SUBSURF")
        sub.levels = sub.render_levels = 1
        eye_x, eye_z, eye_y = 0.0185 * (0.95 if self.gender == "female" else 1.0), 0.098 * H, -0.0475 * H
        self.eyes = []
        for sx in (-1, 1):
            white_ball = blob(f"{self.name}-eye", self.head, (0.0078 * H, 0.0072 * H, 0.0078 * H), (sx * eye_x * H, eye_y, eye_z), white)
            blob(f"{self.name}-iris", white_ball, (0.46, 0.3, 0.46), (0, -0.88, 0), iris)
            blob(f"{self.name}-pupil", white_ball, (0.22, 0.2, 0.22), (0, -1.0, 0), dark)
            # An upper lid over the eyeball, so it reads as an eye in a face rather than a bulb.
            blob(f"{self.name}-lid", self.head, (0.0092 * H, 0.0082 * H, 0.0046 * H), (sx * eye_x * H, eye_y - 0.0012 * H, eye_z + 0.0052 * H), skin)
            self.eyes.append(white_ball)
        brow = 0.0045 * H * (0.8 + 0.4 * g["brow"])
        self.brows = [
            blob(f"{self.name}-brow", self.head, (0.0185 * H, 0.0045 * H, brow), (sx * 0.0195 * H, -0.0585 * H, (0.1145 if self.gender == "male" else 0.1175) * H), hair_mat, rot=(0, 0, math.radians(sx * -6)))
            for sx in (-1, 1)
        ]
        self.brow_rest = [(b.location.z, tuple(b.rotation_euler)) for b in self.brows]
        blob(f"{self.name}-bridge", self.head, (0.0068 * H, 0.009 * H, 0.016 * H), (0, -0.0585 * H, 0.085 * H), skin)
        blob(f"{self.name}-nose", self.head, (0.0088 * H, 0.0092 * H, 0.0085 * H), (0, -0.0645 * H, 0.0705 * H), skin)
        for sx in (-1, 1):
            blob(f"{self.name}-ear", self.head, (0.006 * H, 0.011 * H, 0.0185 * H), (sx * 0.0465 * H, 0.004 * H, 0.08 * H), skin)
        lip_w = 0.0165 if self.gender == "female" else 0.0155
        self.upper_lip = blob(f"{self.name}-lipu", self.head, (lip_w * H, 0.0048 * H, 0.0036 * H), (0, -0.0605 * H, 0.0385 * H), lips)
        self.lower_lip = blob(f"{self.name}-lipl", self.head, (lip_w * 0.95 * H, 0.0052 * H, 0.0044 * H), (0, -0.0597 * H, 0.0302 * H), lips)
        self.cavity = blob(f"{self.name}-mouth", self.head, (0.0125 * H, 0.0035 * H, 0.0006 * H), (0, -0.0578 * H, 0.0345 * H), dark)
        self.lip_rest = (0.0302 * H, 0.0006 * H)

    def _hair_and_clothes(self, hair: str, outfit: str, top, hair_mat, colors: dict, H: float) -> None:
        self.hair_swing = 0.0
        if hair in ("short", "long", "bun", "hat"):
            # A hat sits over short hair, which shows at the sides and back.
            style = "short" if hair == "hat" else hair
            strands = hairgen.generate(style, zlib.crc32(self.name.encode()))
            if style == "long":
                self.hair_swing = 0.4  # the roots are near the pivot, so the whole mass swings only gently
                self._locks("hair", strands, self.hair_p, hair_mat, H, hairgen.PIVOT)
            else:
                self._locks("hair", strands, self.head, hair_mat, H, (0.0, 0.0, 0.0))
            if style == "bun":
                c = hairgen.BUN_CENTRE
                blob(f"{self.name}-bun", self.head, (0.03 * H, 0.03 * H, 0.027 * H), (c[0] * H, c[1] * H, c[2] * H), hair_mat)
        if hair == "hat":
            accent = materials.principled(f"{self.name}-hat", colors["accent"], 0.7)
            blob(f"{self.name}-brim", self.head, (0.085 * H, 0.085 * H, 0.0045 * H), (0, -0.004 * H, 0.115 * H), accent)
            blob(f"{self.name}-crown", self.head, (0.053 * H, 0.055 * H, 0.045 * H), (0, 0.003 * H, 0.14 * H), accent)
        if hair == "hood":
            blob(f"{self.name}-hood", self.head, (0.064 * H, 0.062 * H, 0.074 * H), (0, 0.027 * H, 0.085 * H), top)
        if outfit == "hoodie":
            blob(f"{self.name}-hoodcollar", self.spine, (0.07 * H, 0.06 * H, 0.04 * H), (0, 0.03 * H, TORSO_LEN * H), top)
        if outfit == "coat":
            blob(f"{self.name}-collar", self.spine, (0.075 * H, 0.06 * H, 0.025 * H), (0, 0.005 * H, (TORSO_LEN - 0.005) * H), top)
        # A dress or a long coat: a flared panel hung from the hips, swinging with the legs.
        self.skirt = None
        if outfit in ("dress", "coat", "robe"):
            bm = bmesh.new()
            flare = [(0.005, 0.112, 0.082), (-0.05, 0.125, 0.092), (-0.12, 0.15, 0.108), (-0.2, 0.185, 0.13)] if outfit == "dress" else [(0.005, 0.112, 0.082), (-0.12, 0.15, 0.1), (-0.26, 0.178, 0.118), (-0.41, 0.2, 0.134)] if outfit == "robe" else [(0.005, 0.112, 0.082), (-0.08, 0.12, 0.088), (-0.18, 0.13, 0.096), (-0.27, 0.142, 0.104)]
            loft(bm, [body.Station(z, rx, ry) for z, rx, ry in flare], (0, 0, 0), H)
            panel = _mesh_object(f"{self.name}-skirt", bm, [top], self.pelvis)
            self.skirt = panel

    def _locks(self, name: str, strands, parent, mat, H: float, origin) -> None:
        """Hair as one curve object: each strand a tapered tube, positioned relative to `origin` in the parent's frame."""
        curve = bpy.data.curves.new(f"{self.name}-{name}", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 1.0  # each point's radius scales this, so tubes taper along their length
        curve.bevel_resolution = 0
        curve.use_fill_caps = True
        for strand in strands:
            sp = curve.splines.new("POLY")
            sp.points.add(len(strand) - 1)
            for pt, (x, y, z, r) in zip(sp.points, strand):
                pt.co = ((x - origin[0]) * H, (y - origin[1]) * H, (z - origin[2]) * H, 1.0)
                pt.radius = r * H
        curve.materials.append(mat)
        obj = bpy.data.objects.new(f"{self.name}-{name}", curve)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent  # a pivot parent's own origin is already `origin`, so the points are relative to it

    # ------------------------------------------------------------------ posing

    def _rotate_bone(self, name: str, euler_deg) -> None:
        """Rotate a bone about the same axes the matching pivot rotates about (its parent's frame)."""
        pb = self.arm.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        m = self.rest[name]
        r = Euler([math.radians(a) for a in euler_deg], "XYZ").to_matrix()
        pb.rotation_quaternion = (m.inverted() @ r @ m).to_quaternion()

    def add_held(self, kind: str, colors: dict) -> None:
        """Builds an item that may be handed to this figure later (see hold())."""
        if kind != (self.held.kind if self.held else None) and kind not in self.extra_held:
            self.extra_held[kind] = wear.Held(self, kind, colors)

    def helds(self):
        return ([self.held] if self.held else []) + list(self.extra_held.values())

    def hold(self, frame: int, kind: str | None) -> None:
        """What is in the hand from this frame on; items not held are hidden, and a guitar's neck hand reaches out."""
        if kind == self._holding:
            return
        self._holding = kind
        for h in self.helds():
            h.show(frame, h.kind == kind)
        self.abduct["L"] = wear.GUITAR_ABDUCT if kind == "guitar" else 7.0

    def apply(self, p: Pose, mouth_open: float = 0.0, blink: float = 1.0, mood: str = "neutral", strength: float = 1.0, look: tuple[float, float] = (0.35, 0.0), eye_yaw: float | None = None) -> None:
        d = math.radians
        H = self.h
        dz = (stance_height(p) - REST_Z) * H
        self.pelvis.location.z = (REST_Z + ANKLE) * H + dz
        self.pelvis.rotation_euler = (0.0, 0.0, d(p.yaw))
        self.spine.rotation_euler = (d(p.lean), 0.0, d(p.twist))
        self.head.rotation_euler = (d(p.head), d(p.side), 0.0)
        self.hair_p.rotation_euler = (d(p.hair * self.hair_swing), 0.0, 0.0)
        pelvis = self.arm.pose.bones["pelvis"]
        self._rotate_bone("pelvis", (0.0, 0.0, p.yaw))
        pelvis.location = self.rest["pelvis"].inverted() @ Vector((0.0, 0.0, dz))
        self._rotate_bone("spine", (p.lean, 0.0, p.twist))
        self._rotate_bone("head", (p.head, p.side, 0.0))
        for side, arm, sign in (("L", p.arm_l, 1), ("R", p.arm_r, -1)):
            abd = self.abduct[side]
            self.shoulder[side].rotation_euler = (d(-arm[0]), d(-sign * abd), 0.0)
            self.elbow[side].rotation_euler = (d(-arm[1]), 0.0, 0.0)
            self._rotate_bone(f"upperarm.{side}", (-arm[0], -sign * abd, 0.0))
            self._rotate_bone(f"forearm.{side}", (-arm[1], 0.0, 0.0))
        for side, leg in (("L", p.leg_l), ("R", p.leg_r)):
            self.hip[side].rotation_euler = (d(-leg[0]), 0.0, 0.0)
            self.knee[side].rotation_euler = (d(-leg[1]), 0.0, 0.0)
            self._rotate_bone(f"thigh.{side}", (-leg[0], 0.0, 0.0))
            self._rotate_bone(f"shin.{side}", (-leg[1], 0.0, 0.0))
        inner_up, lift, squint, jaw = (v * strength if i != 2 else 1 + (v - 1) * strength for i, v in enumerate(MOODS.get(mood, MOODS["neutral"])))
        for sx, brow, (rest_z, rest_rot) in zip((-1, 1), self.brows, self.brow_rest):
            brow.location.z = rest_z + lift * H
            brow.rotation_euler = (rest_rot[0], math.radians(sx * inner_up), rest_rot[2])
        for eye in self.eyes:
            eye.scale.z = 0.0078 * H * max(blink * squint, 0.08)
        jaw_drop = 0.011 * H * min(1.0, max(mouth_open, jaw))
        lower_z, cavity_z = self.lip_rest
        self.lower_lip.location.z = lower_z - jaw_drop
        self.cavity.scale.z = cavity_z + jaw_drop * 0.7
        for h in self.helds():
            h.update(p)
        # The eyes turn in their sockets: up or down with the look, a little sideways (or round toward the camera).
        pitch = math.radians(look[1] * 16.0)
        yaw = math.radians(14.0 * (look[0] - 0.6)) if eye_yaw is None else math.radians(eye_yaw)
        for eye in self.eyes:
            eye.rotation_euler = (pitch, 0.0, yaw)
        if self.skirt is not None:
            spread = 1 + 0.12 * min(1.0, abs(p.leg_l[0] - p.leg_r[0]) / 40)
            self.skirt.scale.x = spread

    def key(self, frame: int) -> None:
        """Keyframe everything apply() and the caller moved."""
        self.root.keyframe_insert("location", frame=frame)
        self.root.keyframe_insert("rotation_euler", frame=frame)
        self.pelvis.keyframe_insert("location", frame=frame, index=2)
        for obj in (self.pelvis, self.spine, self.head, self.hair_p, *self.shoulder.values(), *self.elbow.values(), *self.hip.values(), *self.knee.values()):
            obj.keyframe_insert("rotation_euler", frame=frame)
        for name in self.bone_names:
            self.arm.pose.bones[name].keyframe_insert("rotation_quaternion", frame=frame)
        self.arm.pose.bones["pelvis"].keyframe_insert("location", frame=frame)
        self.lower_lip.keyframe_insert("location", frame=frame, index=2)
        self.cavity.keyframe_insert("scale", frame=frame, index=2)
        for eye in self.eyes:
            eye.keyframe_insert("scale", frame=frame, index=2)
        for brow in self.brows:
            brow.keyframe_insert("location", frame=frame, index=2)
            brow.keyframe_insert("rotation_euler", frame=frame, index=1)
        for h in self.helds():
            h.key(frame)
        for eye in self.eyes:
            eye.keyframe_insert("rotation_euler", frame=frame)
        if self.skirt is not None:
            self.skirt.keyframe_insert("scale", frame=frame, index=0)
