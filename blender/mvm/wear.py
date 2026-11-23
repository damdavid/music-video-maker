"""Hats, accessories, the newer outfits' details and held items for a Figure, built from simple solids."""

import math

import bmesh
import bpy
from mathutils import Vector

from . import materials
from .body import FORE_ARM, SHOULDER_X, SHOULDER_Z, TORSO_LEN, UPPER_ARM

_meshes: dict = {}
# The guitar's far arm in 3D: [upper, lower] angles and how far it swings out to the side (degrees).
GUITAR_ARM = (40.0, 30.0)
GUITAR_ABDUCT = 62.0


def _solid_mesh(key: str, build):
    mesh = _meshes.get(key)
    if mesh is None or mesh.name not in bpy.data.meshes:
        bm = bmesh.new()
        build(bm)
        mesh = bpy.data.meshes.new(f"mvm-{key}")
        bm.to_mesh(mesh)
        bm.free()
        for poly in mesh.polygons:
            poly.use_smooth = True
        mesh.materials.append(None)  # one slot, linked per object, so every part can share the mesh
        _meshes[key] = mesh
    return mesh


def _cylinder(bm):
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=1.0, radius2=1.0, depth=1.0)


def _cone(bm):
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=1.0, radius2=0.0, depth=1.0)


def _frustum(bm):
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=1.0, radius2=0.84, depth=1.0)


def _cube(bm):
    bmesh.ops.create_cube(bm, size=1.0)


def _sphere(bm):
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)


def _torus(ratio: float):
    def build(bm):
        major, minor = 32, 8
        rings = []
        for i in range(major):
            a = math.tau * i / major
            ring = []
            for j in range(minor):
                b = math.tau * j / minor
                r = 1.0 + ratio * math.cos(b)
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), ratio * math.sin(b))))
            rings.append(ring)
        for i in range(major):
            for j in range(minor):
                bm.faces.new((rings[i][j], rings[i][(j + 1) % minor], rings[(i + 1) % major][(j + 1) % minor], rings[(i + 1) % major][j]))

    return build


SHAPES = {"cyl": _cylinder, "cone": _cone, "frustum": _frustum, "cube": _cube, "sphere": _sphere}


def part(name: str, parent, shape: str, loc, scale, mat, rot=(0.0, 0.0, 0.0)):
    """A solid placed in the parent's frame. `scale` is the radii for a sphere, cylinder or cone (its last value is the full length) and the full sizes for a cube."""
    mesh = _solid_mesh(shape, SHAPES[shape]) if shape in SHAPES else _solid_mesh(shape, _torus(float(shape.split(":")[1])))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.scale = scale
    obj.rotation_euler = rot
    obj.material_slots[0].link = "OBJECT"
    obj.material_slots[0].material = mat
    return obj


def torus(name: str, parent, loc, major: float, minor: float, mat, rot=(0.0, 0.0, 0.0)):
    return part(name, parent, f"torus:{round(minor / major, 3)}", loc, (major, major, major), mat, rot)


def between(name: str, parent, a, b, radius: float, mat, shape: str = "cyl"):
    """A cylinder (or cone) running from point a to point b in the parent's frame."""
    a, b = Vector(a), Vector(b)
    d = b - a
    obj = part(name, parent, shape, (a + b) / 2, (radius, radius, d.length), mat)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = d.to_track_quat("Z", "Y")
    return obj


def _mat(fig, name: str, color: str, rough: float = 0.6, metal: float = 0.0):
    return materials.principled(f"{fig.name}-{name}", color, rough, metal)


def _shade(color: str, d: int) -> str:
    h = color.lstrip("#")
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(h[i : i + 2], 16) + d)) for i in (0, 2, 4))


# ------------------------------------------------------------------ hats


def add_hat(fig, hat: str, colors: dict) -> None:
    H = fig.h
    main = _mat(fig, "hatmain", colors["accent"], 0.7)
    band = _mat(fig, "hatband", _shade(colors["accent"], -50), 0.6)
    head, n = fig.head, f"{fig.name}-hat"
    # The skull is about 0.047 H wide and 0.062 H deep, topping out at 0.145 H; hats sit on the hair, a touch larger.
    if hat == "cowboy":
        part(f"{n}-brim", head, "cyl", (0, 0.0, 0.106 * H), (0.13 * H, 0.108 * H, 0.005 * H), main)
        part(f"{n}-curlL", head, "sphere", (0.118 * H, 0.0, 0.112 * H), (0.024 * H, 0.07 * H, 0.006 * H), main, (0, math.radians(-30), 0))
        part(f"{n}-curlR", head, "sphere", (-0.118 * H, 0.0, 0.112 * H), (0.024 * H, 0.07 * H, 0.006 * H), main, (0, math.radians(30), 0))
        part(f"{n}-crown", head, "frustum", (0, 0.004 * H, 0.14 * H), (0.06 * H, 0.074 * H, 0.066 * H), main)
        part(f"{n}-band", head, "cyl", (0, 0.004 * H, 0.116 * H), (0.062 * H, 0.076 * H, 0.012 * H), band)
    elif hat == "beanie":
        part(f"{n}-dome", head, "sphere", (0, 0.004 * H, 0.092 * H), (0.056 * H, 0.071 * H, 0.062 * H), main)
        part(f"{n}-cuff", head, "cyl", (0, 0.004 * H, 0.1 * H), (0.058 * H, 0.073 * H, 0.02 * H), band)
        part(f"{n}-pom", head, "sphere", (0, 0.004 * H, 0.158 * H), (0.016 * H,) * 3, _mat(fig, "hatpom", _shade(colors["accent"], 40), 0.9))
    elif hat == "cap":
        part(f"{n}-dome", head, "sphere", (0, 0.004 * H, 0.098 * H), (0.055 * H, 0.07 * H, 0.052 * H), main)
        part(f"{n}-visor", head, "sphere", (0, -0.068 * H, 0.104 * H), (0.05 * H, 0.046 * H, 0.004 * H), band, (math.radians(-8), 0, 0))
        part(f"{n}-button", head, "sphere", (0, 0.004 * H, 0.15 * H), (0.007 * H,) * 3, band)
    elif hat == "top_hat":
        part(f"{n}-brim", head, "cyl", (0, 0.0, 0.108 * H), (0.082 * H, 0.094 * H, 0.005 * H), main)
        part(f"{n}-crown", head, "cyl", (0, 0.004 * H, 0.16 * H), (0.054 * H, 0.068 * H, 0.1 * H), main)
        part(f"{n}-band", head, "cyl", (0, 0.004 * H, 0.122 * H), (0.056 * H, 0.07 * H, 0.016 * H), band)
    elif hat == "beret":
        part(f"{n}-body", head, "sphere", (-0.006 * H, 0.0, 0.118 * H), (0.075 * H, 0.09 * H, 0.03 * H), main, (math.radians(-6), 0, math.radians(-8)))
        part(f"{n}-stem", head, "sphere", (-0.012 * H, 0.0, 0.148 * H), (0.007 * H,) * 3, band)
    elif hat == "sun_hat":
        part(f"{n}-brim", head, "cyl", (0, 0.0, 0.106 * H), (0.17 * H, 0.17 * H, 0.004 * H), _mat(fig, "hatbrim", _shade(colors["accent"], 25), 0.8))
        part(f"{n}-crown", head, "sphere", (0, 0.004 * H, 0.112 * H), (0.058 * H, 0.074 * H, 0.05 * H), main)
        part(f"{n}-band", head, "cyl", (0, 0.004 * H, 0.108 * H), (0.06 * H, 0.076 * H, 0.012 * H), band)


# ------------------------------------------------------------------ accessories


def add_accessories(fig, accessories: list[str], colors: dict) -> None:
    H, head = fig.h, fig.head
    n = f"{fig.name}-acc"
    ink = _mat(fig, "frame", "#16161c", 0.35, 0.6)
    eye_x, eye_z, front = 0.0185 * (0.95 if fig.gender == "female" else 1.0) * H, 0.098 * H, -0.0555 * H
    for a in accessories:
        if a == "glasses":
            for sx in (-1, 1):
                torus(f"{n}-lens", head, (sx * eye_x, front, eye_z), 0.0105 * H, 0.0013 * H, ink, (math.radians(90), 0, 0))
                between(f"{n}-arm", head, (sx * (eye_x + 0.0105 * H), front, eye_z), (sx * 0.0465 * H, 0.0, 0.092 * H), 0.0011 * H, ink)
            between(f"{n}-bridge", head, (-eye_x + 0.0105 * H, front, eye_z), (eye_x - 0.0105 * H, front, eye_z), 0.0011 * H, ink)
        elif a == "sunglasses":
            glass = materials.principled(f"{fig.name}-shade", "#101018", 0.12, 0.2)
            for sx in (-1, 1):
                part(f"{n}-lens", head, "sphere", (sx * eye_x, front, eye_z), (0.0125 * H, 0.0022 * H, 0.0095 * H), glass)
                between(f"{n}-arm", head, (sx * (eye_x + 0.0125 * H), front, eye_z), (sx * 0.0465 * H, 0.0, 0.092 * H), 0.0012 * H, ink)
            between(f"{n}-bridge", head, (-eye_x + 0.0125 * H, front, eye_z), (eye_x - 0.0125 * H, front, eye_z), 0.0012 * H, ink)
        elif a == "headphones":
            cup = _mat(fig, "cups", colors["accent"], 0.4)
            pts = [Vector((math.cos(k * math.pi / 10) * 0.058 * H * (-1), 0.0, 0.07 * H + math.sin(k * math.pi / 10) * 0.075 * H)) for k in range(11)]
            for p0, p1 in zip(pts, pts[1:]):
                between(f"{n}-band", head, p0, p1, 0.0045 * H, ink)
            for sx in (-1, 1):
                part(f"{n}-cup", head, "cyl", (sx * 0.06 * H, 0.004 * H, 0.078 * H), (0.021 * H, 0.021 * H, 0.016 * H), cup, (0, math.radians(90), 0))
        elif a == "scarf":
            cloth = _mat(fig, "scarf", colors["accent"], 0.9)
            torus(f"{n}-wrap", fig.spine, (0, 0.004 * H, (TORSO_LEN + 0.002) * H), 0.043 * H, 0.015 * H, cloth)
            part(f"{n}-tail", fig.spine, "sphere", (0.03 * H, -0.052 * H, (TORSO_LEN - 0.05) * H), (0.014 * H, 0.006 * H, 0.055 * H), cloth, (math.radians(-6), 0, math.radians(8)))
        elif a == "backpack":
            pack = _mat(fig, "pack", colors["accent"], 0.75)
            part(f"{n}-pack", fig.spine, "sphere", (0, 0.098 * H, 0.2 * H), (0.075 * H, 0.04 * H, 0.085 * H), pack)
            part(f"{n}-pocket", fig.spine, "sphere", (0, 0.133 * H, 0.17 * H), (0.05 * H, 0.014 * H, 0.04 * H), _mat(fig, "packpocket", _shade(colors["accent"], -35), 0.8))


# ------------------------------------------------------------------ outfit details


def add_outfit_details(fig, outfit: str, colors: dict) -> None:
    H, spine = fig.h, fig.spine
    n = f"{fig.name}-fit"
    top = colors["top"]
    if outfit == "jacket":
        cloth = _mat(fig, "jacketcollar", _shade(top, -18), 0.85)
        part(f"{n}-collar", spine, "sphere", (0, 0.006 * H, (TORSO_LEN - 0.006) * H), (0.074 * H, 0.058 * H, 0.022 * H), cloth)
        part(f"{n}-zip", spine, "cube", (0, -0.0805 * H, 0.17 * H), (0.004 * H, 0.002 * H, 0.2 * H), _mat(fig, "zip", "#c9c9cf", 0.3, 0.9))
    elif outfit == "suit":
        shirt = _mat(fig, "shirt", "#f2efe8", 0.7)
        tie = _mat(fig, "tie", colors["accent"], 0.6)
        part(f"{n}-shirt", spine, "sphere", (0, -0.062 * H, (TORSO_LEN - 0.055) * H), (0.026 * H, 0.02 * H, 0.06 * H), shirt)
        part(f"{n}-tie", spine, "cone", (0, -0.0815 * H, (TORSO_LEN - 0.11) * H), (0.012 * H, 0.004 * H, 0.1 * H), tie, (math.pi, 0, 0))
        for sx in (-1, 1):
            part(f"{n}-lapel", spine, "sphere", (sx * 0.03 * H, -0.075 * H, (TORSO_LEN - 0.075) * H), (0.012 * H, 0.008 * H, 0.06 * H), _mat(fig, "lapel", _shade(top, -22), 0.85), (0, math.radians(sx * 12), math.radians(-sx * 14)))
    elif outfit == "robe":
        # A sash knotted at the waist, with its ends hanging; the robe's skirt is the Figure's flared panel.
        sash = _mat(fig, "sash", colors["accent"], 0.7)
        part(f"{n}-sash", spine, "torus:0.14", (0, 0, 0.075 * H), (0.1 * H, 0.078 * H, 0.1 * H), sash)
        part(f"{n}-knot", spine, "sphere", (0.03 * H, -0.078 * H, 0.075 * H), (0.018 * H, 0.01 * H, 0.016 * H), sash)
        for dx, lean in ((0.02, 4), (0.045, -5)):
            part(f"{n}-end", spine, "sphere", (dx * H, -0.082 * H, 0.012 * H), (0.011 * H, 0.004 * H, 0.06 * H), sash, (0, math.radians(lean), 0))
        part(f"{n}-neck", spine, "sphere", (0, -0.062 * H, (TORSO_LEN - 0.05) * H), (0.022 * H, 0.014 * H, 0.05 * H), _mat(fig, "robeneck", _shade(top, -30), 0.85))
    elif outfit == "overalls":
        denim = _mat(fig, "bib", colors["bottom"], 0.85)
        part(f"{n}-bib", spine, "sphere", (0, -0.066 * H, 0.19 * H), (0.075 * H, 0.016 * H, 0.1 * H), denim)
        for sx in (-1, 1):
            between(f"{n}-strap", spine, (sx * 0.05 * H, -0.07 * H, 0.27 * H), (sx * 0.065 * H, 0.0, (TORSO_LEN - 0.01) * H), 0.008 * H, denim)


# ------------------------------------------------------------------ held items


class Held:
    """Something carried in the near (right) hand, or a guitar slung on the body. The grip stays upright as the arm swings."""

    def __init__(self, fig, kind: str, colors: dict):
        self.fig, self.kind, self.colors = fig, kind, colors
        before = set(bpy.data.objects)
        self.grip = None
        self.tilt = 0.0
        self.tilt_y = 0.0
        H = fig.h
        if kind == "guitar":
            self._guitar()
        else:
            from .figure import pivot  # figure.py imports this module for the wearables

            self.grip = pivot(f"{fig.name}-grip", fig.wrist["R"], (0.0, 0.0, -0.03 * H))
            self._build(kind)
        self.objects = list(set(bpy.data.objects) - before)
        self.visible = True

    def _build(self, kind: str) -> None:
        fig, g, H, c = self.fig, self.grip, self.fig.h, self.colors
        n = f"{fig.name}-{kind}"
        accent = _mat(fig, f"{kind}-main", c["accent"], 0.55)
        dark = _mat(fig, f"{kind}-dark", _shade(c["bottom"], -15), 0.5, 0.3)
        if kind == "umbrella":
            self.tilt_y = 12.0  # leans over the head, which is toward the middle of the body
            between(f"{n}-shaft", g, (0, 0, -0.09 * H), (0, 0, 0.62 * H), 0.004 * H, dark)
            part(f"{n}-canopy", g, "cone", (0, 0, 0.61 * H), (0.21 * H, 0.21 * H, 0.1 * H), accent)
            part(f"{n}-tip", g, "sphere", (0, 0, 0.665 * H), (0.008 * H,) * 3, dark)
            torus(f"{n}-hook", g, (0.014 * H, 0, -0.095 * H), 0.014 * H, 0.0035 * H, dark, (math.radians(90), 0, 0))
        elif kind == "suitcase":
            part(f"{n}-case", g, "cube", (0, 0, -0.145 * H), (0.1 * H, 0.04 * H, 0.08 * H), accent)
            torus(f"{n}-handle", g, (0, 0, -0.098 * H), 0.024 * H, 0.004 * H, dark, (math.radians(90), 0, 0))
            part(f"{n}-latch", g, "cube", (0, -0.0205 * H, -0.145 * H), (0.03 * H, 0.002 * H, 0.012 * H), _mat(fig, "latch", "#d8c070", 0.3, 0.9))
        elif kind == "microphone":
            between(f"{n}-handle", g, (0, 0, -0.025 * H), (0, 0, 0.05 * H), 0.008 * H, dark)
            part(f"{n}-ball", g, "sphere", (0, 0, 0.068 * H), (0.017 * H,) * 3, _mat(fig, "micball", "#b9bcc6", 0.35, 0.8))
        elif kind == "flowers":
            self.tilt = -10.0
            part(f"{n}-wrap", g, "cone", (0, 0, 0.0), (0.03 * H, 0.03 * H, 0.08 * H), _mat(fig, "wrap", "#f2ecdb", 0.8), (math.pi, 0, 0))
            for k, (dx, dy, dz, col) in enumerate(((0, 0, 0.095, "#e05a8a"), (0.02, 0.006, 0.085, "#f1c4d6"), (-0.02, -0.004, 0.088, "#3fb59a"))):
                between(f"{n}-stem", g, (0, 0, 0.03 * H), (dx * H, dy * H, dz * H), 0.002 * H, _mat(fig, "stem", "#3f7a3f", 0.8))
                part(f"{n}-bloom", g, "sphere", (dx * H, dy * H, (dz + 0.008) * H), (0.017 * H, 0.017 * H, 0.011 * H), _mat(fig, f"bloom{k}", col, 0.7))
        elif kind == "lantern":
            glow = materials.emissive(f"{fig.name}-lantern-glow", "#ffcf7a", 10.0)
            between(f"{n}-rope", g, (0, 0, 0.0), (0, 0, -0.06 * H), 0.002 * H, dark)
            part(f"{n}-cap", g, "cyl", (0, 0, -0.065 * H), (0.026 * H, 0.026 * H, 0.008 * H), dark)
            part(f"{n}-glass", g, "cyl", (0, 0, -0.1 * H), (0.022 * H, 0.022 * H, 0.062 * H), glow)
            part(f"{n}-base", g, "cyl", (0, 0, -0.136 * H), (0.026 * H, 0.026 * H, 0.008 * H), dark)
            light = bpy.data.lights.new(f"{n}-light", "POINT")
            light.energy, light.color, light.shadow_soft_size, light.use_shadow = 18.0, (1.0, 0.78, 0.45), 0.05 * H, False
            lamp = bpy.data.objects.new(f"{n}-lamp", light)
            bpy.context.scene.collection.objects.link(lamp)
            lamp.parent, lamp.location = g, (0, 0, -0.1 * H)
        elif kind == "book":
            self.tilt = -16.0
            part(f"{n}-cover", g, "cube", (0, -0.002 * H, 0.04 * H), (0.1 * H, 0.012 * H, 0.15 * H), accent)
            part(f"{n}-pages", g, "cube", (0, -0.004 * H, 0.04 * H), (0.09 * H, 0.009 * H, 0.14 * H), _mat(fig, "pages", "#f2ecdb", 0.9))
        elif kind == "phone":
            self.tilt = -14.0
            part(f"{n}-body", g, "cube", (0, -0.004 * H, 0.03 * H), (0.034 * H, 0.005 * H, 0.068 * H), _mat(fig, "phonebody", "#15151c", 0.3, 0.5))
            part(f"{n}-screen", g, "cube", (0, -0.0072 * H, 0.03 * H), (0.03 * H, 0.001 * H, 0.06 * H), materials.emissive(f"{fig.name}-screen", "#bfe3ff", 2.0))
        elif kind == "flag":
            between(f"{n}-pole", g, (0, 0, -0.1 * H), (0, 0, 0.7 * H), 0.005 * H, dark)
            part(f"{n}-cloth", g, "cube", (-0.15 * H, 0, 0.62 * H), (0.3 * H, 0.003 * H, 0.17 * H), accent)
            part(f"{n}-finial", g, "sphere", (0, 0, 0.71 * H), (0.01 * H,) * 3, _mat(fig, "finial", _shade(c["accent"], 30), 0.4, 0.5))
        elif kind == "sword":
            self.tilt = 9.0  # leans a little forward
            steel = _mat(fig, "steel", "#cfd5de", 0.25, 0.9)
            gold = _mat(fig, "swordgold", "#d9b24a", 0.35, 0.8)
            part(f"{n}-blade", g, "cube", (0, 0, 0.37 * H), (0.026 * H, 0.006 * H, 0.62 * H), steel)
            part(f"{n}-tip", g, "cone", (0, 0, 0.7 * H), (0.013 * H, 0.004 * H, 0.06 * H), steel)
            part(f"{n}-guard", g, "cube", (0, 0, 0.058 * H), (0.11 * H, 0.016 * H, 0.016 * H), gold)
            part(f"{n}-grip", g, "cyl", (0, 0, 0.0), (0.008 * H, 0.008 * H, 0.1 * H), dark)
            part(f"{n}-pommel", g, "sphere", (0, 0, -0.055 * H), (0.016 * H,) * 3, gold)
        elif kind == "balloon":
            between(f"{n}-string", g, (0, 0, 0.0), (0.02 * H, 0, 0.4 * H), 0.0012 * H, _mat(fig, "string", "#20202a", 0.6))
            part(f"{n}-balloon", g, "sphere", (0.02 * H, 0, 0.47 * H), (0.065 * H, 0.065 * H, 0.08 * H), _mat(fig, "balloon", c["accent"], 0.2))
        elif kind == "cup":
            part(f"{n}-mug", g, "cyl", (0, 0, 0.0), (0.02 * H, 0.02 * H, 0.04 * H), accent)
            torus(f"{n}-ear", g, (0.022 * H, 0, 0.0), 0.011 * H, 0.0035 * H, accent, (math.radians(90), 0, 0))

    def _guitar(self) -> None:
        """Slung across the body, face to the front, with the neck running out to the left hand."""
        from mathutils import Euler, Matrix

        fig, H, c = self.fig, self.fig.h, self.colors
        wood = _mat(fig, "guitar", c["accent"], 0.4)
        dark = _mat(fig, "guitar-dark", _shade(c["bottom"], -25), 0.5)
        # Where the far hand ends up, in the spine's frame, from the same rotations Figure.apply gives the arm.
        sh = Vector((SHOULDER_X * fig.gender_scale() * H, 0.0, SHOULDER_Z * H))
        upper = Euler((math.radians(-GUITAR_ARM[0]), math.radians(-GUITAR_ABDUCT), 0.0), "XYZ").to_matrix()
        fore = Euler((math.radians(-GUITAR_ARM[1]), 0.0, 0.0), "XYZ").to_matrix()
        hand = sh + upper @ Vector((0.0, 0.0, -UPPER_ARM * H)) + upper @ fore @ Vector((0.0, 0.0, -(FORE_ARM + 0.03) * H))
        centre = Vector((0.0, -0.105 * H, 0.04 * H))
        axis = (hand - centre).normalized()
        front = Vector((0.0, -1.0, 0.0))
        y_axis = (front - axis * front.dot(axis)).normalized()  # the thin direction: the guitar's face looks to the front
        x_axis = y_axis.cross(axis)
        quat = Matrix((x_axis, y_axis, axis)).transposed().to_quaternion()
        for name, offset, size in (("lower", 0.0, (0.085 * H, 0.03 * H, 0.1 * H)), ("upper", 0.085 * H, (0.065 * H, 0.03 * H, 0.075 * H))):
            o = part(f"{fig.name}-guitar-{name}", fig.spine, "sphere", centre + axis * offset, size, wood)
            o.rotation_mode = "QUATERNION"
            o.rotation_quaternion = quat
        end = hand + axis * 0.07 * H
        between(f"{fig.name}-guitar-neck", fig.spine, centre + axis * 0.12 * H, end, 0.011 * H, dark)
        head = part(f"{fig.name}-guitar-head", fig.spine, "cube", end + axis * 0.03 * H, (0.026 * H, 0.012 * H, 0.06 * H), dark)
        head.rotation_mode = "QUATERNION"
        head.rotation_quaternion = quat
        hole = part(f"{fig.name}-guitar-hole", fig.spine, "cyl", centre + front * 0.03 * H, (0.024 * H, 0.024 * H, 0.004 * H), _mat(fig, "guitar-hole", "#0c0806", 0.5))
        hole.rotation_mode = "QUATERNION"
        hole.rotation_quaternion = quat @ Euler((math.radians(90), 0, 0)).to_quaternion()
        strap = _mat(fig, "strap", "#171a2b", 0.8)
        between(f"{fig.name}-guitar-strap", fig.spine, (-SHOULDER_X * 0.7 * H, -0.075 * H, (TORSO_LEN - 0.01) * H), (0.04 * H, -0.09 * H, 0.04 * H), 0.004 * H, strap)

    def update(self, pose) -> None:
        """Keep the grip upright whatever the arm is doing: the arm's swing is undone about the sideways axis."""
        if self.grip is not None:
            self.grip.rotation_euler = (math.radians(pose.arm_r[0] + pose.arm_r[1] + self.tilt), math.radians(self.tilt_y), 0.0)

    def key(self, frame: int) -> None:
        if self.grip is not None:
            self.grip.keyframe_insert("rotation_euler", frame=frame)

    def show(self, frame: int, on: bool) -> None:
        """Put it in or out of sight from this frame on (an item handed over at a lyric line appears when it is)."""
        for obj in self.objects:
            obj.hide_render = not on
            obj.keyframe_insert("hide_render", frame=frame)
        self.visible = on


# ------------------------------------------------------------------ lyric symbols


def _extruded(name: str, outline, color: str, depth: float):
    """A thin solid from a flat outline in the XZ plane, `depth` thick along Y, facing -Y."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in outline]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in outline]
    bm.faces.new(list(reversed(front)))
    bm.faces.new(back)
    n = len(outline)
    for i in range(n):
        bm.faces.new((front[i], front[(i + 1) % n], back[(i + 1) % n], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(materials.principled(f"symbol-{color}", color, 0.45, emission=0.6))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


class SymbolRig:
    """A symbol's solids under one empty, which is placed, sized and turned toward the camera each frame it is on."""

    def __init__(self, name: str):
        from .figure import pivot
        from .symbols import SYMBOLS

        before = set(bpy.data.objects)
        self.root = pivot(f"symbol-{name}", None)
        for i, (outline, color) in enumerate(SYMBOLS[name]):
            part_obj = _extruded(f"symbol-{name}-{i}", outline, color, 0.07)
            part_obj.parent = self.root
            part_obj.location.y = -0.004 * i  # later layers sit a hair in front of earlier ones
        self.objects = list(set(bpy.data.objects) - before)
        self.shown = None

    def hide(self, frame: int) -> None:
        """Scale to nothing; keys only when it changes."""
        if self.shown is not False:
            self.root.scale = (0.0, 0.0, 0.0)
            self.root.keyframe_insert("scale", frame=frame)
            self.shown = False

    def place(self, frame: int, location, size: float, yaw: float) -> None:
        self.root.location = location
        self.root.scale = (size, size, size)
        self.root.rotation_euler = (0.0, 0.0, yaw)
        for prop in ("location", "scale", "rotation_euler"):
            self.root.keyframe_insert(prop, frame=frame)
        self.shown = True
