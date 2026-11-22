"""The place a scene happens in: sky and light for the time of day, weather, and the settings built from real geometry."""

import math
import random

import bpy
from mathutils import Vector

from . import materials

STAGE_SPACING = 600.0  # scenes sit this far apart along Y, so a cut never shows the last one

# Sun elevation (degrees), sun strength, sun colour, ambient sky strength, moon light.
TIME_OF_DAY = {
    "dawn": dict(elev=6.0, rot=100.0, sun=2.0, color=(1.0, 0.72, 0.55), sky=0.45, moon=0.0),
    "day": dict(elev=48.0, rot=135.0, sun=1.6, color=(1.0, 0.95, 0.88), sky=0.22, moon=0.0),
    "dusk": dict(elev=7.0, rot=250.0, sun=1.6, color=(1.0, 0.55, 0.35), sky=0.4, moon=0.0),
    "night": dict(elev=-14.0, rot=200.0, sun=0.0, color=(0.6, 0.7, 1.0), sky=0.06, moon=0.5),
}
# Power of the soft key light on the camera per time of day (scaled with the shot distance).
FILL = {"dawn": 140.0, "day": 40.0, "dusk": 160.0, "night": 320.0}
# How much of the sun gets through the cloud.
OVERCAST = {"clear": 1.0, "fog": 0.55, "rain": 0.3, "snow": 0.45}
FOG = {"clear": 0.0, "fog": 0.012, "rain": 0.003, "snow": 0.002}


def _link(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def box(name: str, loc, dim, mat):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (dim[0] / 2, dim[1] / 2, dim[2] / 2)
    bpy.ops.object.transform_apply(scale=True)  # texture coordinates are then in metres
    return _link(obj, mat)


def cylinder(name: str, loc, radius: float, depth: float, mat, verts: int = 16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    return _link(obj, mat)


def ico(name: str, loc, radius: float, mat, scale=(1, 1, 1), subdiv: int = 2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return _link(obj, mat)


def plane(name: str, loc, size, mat):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], 1)
    return _link(obj, mat)


def point_light(name: str, loc, energy: float, color, radius: float = 0.2):
    bpy.ops.object.light_add(type="POINT", location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.energy = energy
    obj.data.color = color
    obj.data.shadow_soft_size = radius
    obj.data.use_shadow = False
    return obj


def tree(name: str, loc, rng: random.Random, tint: str = "#2f5d34", scale: float = 1.0):
    h = rng.uniform(4.5, 8.0) * scale
    trunk = cylinder(f"{name}-trunk", (loc[0], loc[1], loc[2] + h * 0.25), 0.18 * scale, h * 0.5, materials.textured("bark", "#2b1f16", "#4a3626", 14, 0.95, 0.6))
    crown = ico(f"{name}-crown", (loc[0], loc[1], loc[2] + h * 0.72), h * 0.34, materials.textured(f"leaf-{tint}", "#16331b", tint, 5, 0.8, 0.5), scale=(1, 1, 1.35))
    return [trunk, crown]


# ---------------------------------------------------------------------------- settings

def _road(origin, rng, lit: bool, width: float = 9.0, weather: str = "clear"):
    ox, oy, _ = origin
    out = []
    asphalt = materials.ground("asphalt", "#1d1e20", "#35363a", 18, 0.78, 0.35, 12, weather if weather != "snow" else "clear")
    out.append(plane("road", (ox, oy, 0.0), (500, width), asphalt))
    out.append(plane("verge-a", (ox, oy + width / 2 + 3.5, -0.02), (500, 7), materials.ground("grass", "#243a1d", "#47652f", 9, 0.95, 0.7, 8, weather)))
    out.append(plane("verge-b", (ox, oy - width / 2 - 3.5, -0.02), (500, 7), materials.ground("grass", "#243a1d", "#47652f", 9, 0.95, 0.7, 8, weather)))
    line = materials.principled("roadline", "#e8e3d0", 0.6)
    for k in range(-80, 80):
        out.append(plane(f"dash{k}", (ox + k * 6.0, oy, 0.005), (2.6, 0.18), line))
    for sign in (1, -1):
        out.append(plane(f"edge{sign}", (ox, oy + sign * (width / 2 - 0.35), 0.005), (500, 0.14), line))
    return out


def _lamps(origin, spacing: float, count: int, lit: bool, y_off: float, color=(1.0, 0.78, 0.5)):
    ox, oy, _ = origin
    out = []
    metal = materials.principled("lamp-metal", "#2a2c30", 0.4, 0.8)
    glow = materials.emissive("lamp-glow", "#ffcf8a", 40.0 if lit else 0.5)
    for k in range(-count, count + 1):
        x = ox + k * spacing
        out.append(cylinder(f"pole{k}", (x, oy + y_off, 3.2), 0.07, 6.4, metal, 10))
        out.append(box(f"arm{k}", (x, oy + y_off - math.copysign(0.7, y_off), 6.3), (0.15, 1.5, 0.12), metal))
        out.append(ico(f"bulb{k}", (x, oy + y_off - math.copysign(1.4, y_off), 6.2), 0.22, glow))
        if lit:
            out.append(point_light(f"lampl{k}", (x, oy + y_off - math.copysign(1.4, y_off), 6.0), 2200, color, 0.3))
    return out


def build_road(origin, tod, rng, weather: str = "clear"):
    lit = tod in ("night", "dusk", "dawn")
    out = _road(origin, rng, lit, 9.0, weather) + _lamps(origin, 16.0, 7, lit, 6.0)
    for k in range(7):
        out += tree(f"rt{k}", (origin[0] + rng.uniform(-90, 90), origin[1] - rng.uniform(11, 24), 0), rng, scale=rng.uniform(0.8, 1.2))
    return out


def build_city(origin, tod, rng, weather: str = "clear"):
    ox, oy, _ = origin
    lit = tod in ("night", "dusk", "dawn")
    out = _road(origin, rng, lit, 12.0, weather) + _lamps(origin, 18.0, 7, lit, 8.0)
    wall = {"night": "#1a2230", "dusk": "#4a3f4a", "dawn": "#5b5560", "day": "#8c8b8a"}[tod]
    for sign in (1, -1):
        x = ox - 130
        i = 0
        while x < ox + 130:
            w, d, h = rng.uniform(12, 24), rng.uniform(14, 22), rng.uniform(14, 62)
            mat = materials.windows(f"bld{i % 5}-{sign}", wall, "#ffd9a0" if i % 2 else "#cfe3ff", rng.uniform(0.3, 0.6), rng.uniform(0, 4))
            out.append(box(f"b{sign}{i}", (x + w / 2, oy + sign * (11 + d / 2 + 4), h / 2), (w, d, h), mat))
            x += w + rng.uniform(0.5, 3.0)
            i += 1
    return out


def build_field(origin, tod, rng, weather: str = "clear"):
    ox, oy, _ = origin
    out = [plane("field", (ox, oy, 0.0), (700, 700), materials.ground("meadow", "#27441a", "#52792a", 7, 0.95, 0.9, 10, weather))]
    fence = materials.principled("fence", "#6b5640", 0.9)
    for k in range(-40, 40):
        out.append(box(f"post{k}", (ox + k * 3.0, oy + 9, 0.55), (0.12, 0.12, 1.1), fence))
    for r in (0.5, 0.9):
        out.append(box(f"rail{r}", (ox, oy + 9, r + 0.05), (240, 0.06, 0.07), fence))
    for k in range(10):
        out += tree(f"ft{k}", (ox + rng.uniform(-110, 110), oy + rng.uniform(25, 70), 0), rng, "#4c7a3a", rng.uniform(1.0, 1.7))
    for k in range(4):
        out.append(ico(f"hill{k}", (ox + (k - 1.5) * 160, oy + 260, -20), 90, materials.textured("hill", "#2f4a25", "#5a7a3c", 3, 0.95, 0.4), scale=(1.8, 1, 0.55), subdiv=3))
    return out


def build_room(origin, tod, rng, weather: str = "clear"):
    ox, oy, _ = origin
    wallm = materials.principled("wall", "#d8d0c4", 0.9)
    out = [
        plane("floor", (ox, oy, 0.0), (18, 12), materials.textured("wood", "#5a3b22", "#7d5632", 22, 0.45, 0.15, 4)),
        plane("ceil", (ox, oy, 3.2), (18, 12), wallm),
        box("wall-b", (ox, oy + 6, 1.6), (18, 0.2, 3.2), wallm),
        box("wall-l", (ox - 9, oy, 1.6), (0.2, 12, 3.2), wallm),
        box("wall-r", (ox + 9, oy, 1.6), (0.2, 12, 3.2), wallm),
        box("wall-f", (ox, oy - 6.2, 1.6), (18, 0.2, 3.2), wallm),
    ]
    glow = materials.emissive("window", "#cfe6ff" if tod == "day" else "#27344f", 6.0 if tod == "day" else 1.2)
    out.append(box("window", (ox + 2.5, oy + 5.88, 1.7), (3.2, 0.05, 1.8), glow))
    # A ceiling light, so the room is lit for people standing in it and not only by the window.
    bpy.ops.object.light_add(type="AREA", location=(ox, oy, 3.1))
    ceiling = bpy.context.active_object
    ceiling.data.size, ceiling.data.size_y = 3.0, 3.0
    ceiling.data.energy = 600 if tod != "day" else 250
    ceiling.data.color = (1.0, 0.86, 0.68)
    out.append(ceiling)
    bpy.ops.object.light_add(type="AREA", location=(ox + 2.5, oy + 5.5, 1.7))
    area = bpy.context.active_object
    area.data.size, area.data.size_y = 3.2, 1.8
    area.data.energy = 900 if tod == "day" else 120
    area.data.color = (0.85, 0.92, 1.0)
    area.rotation_euler = (math.radians(90), 0, 0)
    out.append(area)
    sofa = materials.principled("sofa", "#41495c", 0.9)
    out += [box("sofa", (ox - 4, oy + 4.3, 0.4), (3.2, 1.2, 0.8), sofa), box("sofa-back", (ox - 4, oy + 4.8, 0.85), (3.2, 0.3, 0.9), sofa)]
    out.append(point_light("room-lamp", (ox - 6.5, oy + 3.5, 1.9), 400 if tod != "day" else 60, (1.0, 0.78, 0.55), 0.2))
    out.append(cylinder("lamp-stand", (ox - 6.5, oy + 3.5, 0.8), 0.03, 1.6, materials.principled("lamp-metal", "#2a2c30", 0.4, 0.8)))
    return out


def build_shore(origin, tod, rng, weather: str = "clear"):
    ox, oy, _ = origin
    out = [plane("sand", (ox, oy, 0.0), (600, 40), materials.ground("sand", "#b99f6b", "#dccb9d", 30, 0.95, 0.35, 6, weather))]
    sea = plane("sea", (ox, oy + 230, -0.3), (700, 400), materials.principled("sea", "#12384f", 0.06, 0.0, specular=0.8))
    sea.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Coat Weight"].default_value = 0.5
    bpy.ops.object.shade_smooth()
    out.append(sea)
    for k in range(10):
        out.append(ico(f"rock{k}", (ox + rng.uniform(-90, 90), oy + rng.uniform(14, 30), 0.2), rng.uniform(0.6, 1.6), materials.textured("rock", "#47423e", "#7a736a", 8, 0.9, 0.8), scale=(1.3, 1, 0.7)))
    return out


def build_forest(origin, tod, rng, weather: str = "clear"):
    ox, oy, _ = origin
    out = [plane("forest-floor", (ox, oy, 0.0), (500, 500), materials.ground("loam", "#2b2a19", "#4f4a2a", 14, 0.95, 0.8, 10, weather))]
    for k in range(90):
        x, y = ox + rng.uniform(-120, 120), oy + rng.uniform(-30, 70)
        if abs(y - oy) < 2.5:
            continue
        out += tree(f"t{k}", (x, y, 0), rng, rng.choice(["#2f5d34", "#3a6a38", "#27502f"]), rng.uniform(0.9, 1.5))
    return out


def build_void(origin, tod, rng, weather: str = "clear"):
    ox, oy, _ = origin
    out = [plane("stage", (ox, oy, 0.0), (400, 400), materials.principled("void-floor", "#17181f", 0.18, 0.05, specular=0.8))]
    bpy.ops.object.light_add(type="AREA", location=(ox, oy - 1.0, 7.0))
    top = bpy.context.active_object
    top.data.size, top.data.energy, top.data.color = 8.0, 700, (0.8, 0.85, 1.0)
    out.append(top)
    for k, color in enumerate(((0.9, 0.3, 0.5), (0.3, 0.5, 1.0))):
        bpy.ops.object.light_add(type="SPOT", location=(ox + (-6 if k else 6), oy - 4, 6))
        lamp = bpy.context.active_object
        lamp.data.energy, lamp.data.color, lamp.data.spot_size = 14000, color, math.radians(55)
        lamp.data.spot_blend = 0.5
        lamp.rotation_euler = (Vector((ox, oy, 1.0)) - lamp.location).to_track_quat("-Z", "Y").to_euler()
        out.append(lamp)
    return out


EARTH = dict(road=("#243a1d", "#47652f"), city=("#2b2b2e", "#4a4a50"), field=("#27441a", "#52792a"), shore=("#b99f6b", "#dccb9d"), forest=("#2b2a19", "#4f4a2a"))


def build_earth(origin, setting: str, weather: str = "clear"):
    """Ground out to the horizon, so there is never sky below it."""
    if setting not in EARTH:
        return []
    c1, c2 = EARTH[setting]
    return [plane("earth", (origin[0], origin[1], -0.06), (6000, 6000), materials.ground(f"earth-{setting}", c1, c2, 3, 0.95, 0.5, 6, weather))]


SETTINGS = dict(road=build_road, city=build_city, field=build_field, room=build_room, shore=build_shore, forest=build_forest, void=build_void)
# Where the figure may travel: walking is a real journey in open places, and in place indoors.
OPEN = {"road", "city", "field", "shore", "forest"}


def build_prop(kind: str, origin, x: float, rng):
    ox, oy, _ = origin
    wood = materials.principled("bench-wood", "#6a4a2c", 0.8)
    metal = materials.principled("lamp-metal", "#2a2c30", 0.4, 0.8)
    if kind == "bench":
        return [box("seat", (x, oy + 1.8, 0.45), (1.8, 0.5, 0.08), wood), box("back", (x, oy + 2.05, 0.8), (1.8, 0.08, 0.5), wood),
                box("leg1", (x - 0.8, oy + 1.8, 0.22), (0.08, 0.45, 0.44), metal), box("leg2", (x + 0.8, oy + 1.8, 0.22), (0.08, 0.45, 0.44), metal)]
    if kind == "lamp":
        return [cylinder("pole", (x, oy + 2.2, 2.0), 0.06, 4.0, metal, 10), ico("bulb", (x, oy + 2.2, 4.1), 0.2, materials.emissive("lamp-glow", "#ffcf8a", 40.0)),
                point_light("pl", (x, oy + 2.2, 3.9), 1800, (1.0, 0.78, 0.5), 0.3)]
    if kind == "tree":
        return tree("proptree", (x, oy + 3.0, 0), rng)
    if kind == "house":
        return [box("house", (x, oy + 12, 3.0), (7, 6, 6), materials.principled("house-wall", "#b9a58c", 0.9)), box("roof", (x, oy + 12, 6.6), (7.6, 6.6, 1.2), materials.principled("house-roof", "#5b2f2a", 0.8))]
    if kind == "campfire":
        log = materials.principled("fire-log", "#4a3020", 0.9)
        flame = materials.emissive("fire-flame", "#ff9a3c", 14.0)
        parts = [cylinder("log1", (x, oy + 1.8, 0.1), 0.07, 0.8, log, 8), cylinder("log2", (x, oy + 1.8, 0.1), 0.07, 0.8, log, 8)]
        parts[0].rotation_euler = (0.0, math.radians(90), math.radians(30))
        parts[1].rotation_euler = (0.0, math.radians(90), math.radians(-30))
        for k, (dx, dy, h) in enumerate(((0.0, 0.0, 0.5), (0.1, 0.05, 0.38), (-0.1, -0.04, 0.34))):
            f = ico(f"flame{k}", (x + dx, oy + 1.8 + dy, 0.2 + h / 2), 0.1, flame, (0.9, 0.9, h / 0.2 * 0.5))
            parts.append(f)
        return parts + [point_light("firelight", (x, oy + 1.8, 0.6), 900, (1.0, 0.6, 0.28), 0.25)]
    if kind == "fence":
        wood2 = materials.principled("fence-wood", "#7a5b3a", 0.85)
        rails = [box("rail1", (x, oy + 2.4, 0.55), (4.0, 0.06, 0.08), wood2), box("rail2", (x, oy + 2.4, 0.95), (4.0, 0.06, 0.08), wood2)]
        return rails + [box(f"post{k}", (x - 1.9 + k * 0.95, oy + 2.4, 0.6), (0.12, 0.1, 1.2), wood2) for k in range(5)]
    if kind == "signpost":
        wood2 = materials.principled("sign-wood", "#7a5b3a", 0.85)
        board = materials.principled("sign-board", "#b79563", 0.8)
        return [cylinder("signpole", (x, oy + 2.2, 1.2), 0.05, 2.4, wood2, 10), box("sign1", (x + 0.1, oy + 2.15, 2.0), (0.9, 0.05, 0.28), board), box("sign2", (x - 0.1, oy + 2.15, 1.6), (0.9, 0.05, 0.28), board)]
    if kind == "suitcase":
        return [box("suitcase", (x, oy + 1.4, 0.3), (0.6, 0.2, 0.6), materials.principled("suitcase", "#7a3b2e", 0.55))]
    return []


def build_weather(origin, weather: str, camera=None, seed: int = 1):
    """Fog, and the haze of rain and snow, as a box of volume around the stage; rain and snow fall as real drops."""
    from . import weather as precipitation

    objs = []
    if weather in precipitation.KIND and camera is not None:
        objs += precipitation.build(weather, origin, camera, seed)
    density = FOG[weather]
    if density <= 0:
        return objs
    bpy.ops.mesh.primitive_cube_add(location=(origin[0], origin[1], 30.0))
    box_ = bpy.context.active_object
    box_.name = "atmosphere"
    box_.scale = (400, 200, 30)
    bpy.ops.object.transform_apply(scale=True)
    box_.display_type = "WIRE"
    mat = bpy.data.materials.new(f"atmosphere-{weather}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Anisotropy"].default_value = 0.35
    vol.inputs["Color"].default_value = (0.82, 0.86, 0.92, 1.0)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    box_.data.materials.append(mat)
    box_["mvm_fog"] = density  # the music thins and thickens it around this (see weather.key_amount)
    return objs + [box_]


# ---------------------------------------------------------------------------- sky and weather

class Sky:
    """One sky and one sun for the whole video; the settings animate between scenes by keyframing their values."""

    def __init__(self, scene):
        world = bpy.data.worlds.new("sky")
        scene.world = world
        world.use_nodes = True
        nt = world.node_tree
        nt.nodes.clear()
        self.sky = nt.nodes.new("ShaderNodeTexSky")
        for kind in ("MULTIPLE_SCATTERING", "SINGLE_SCATTERING", "NISHITA"):
            try:
                self.sky.sky_type = kind
                break
            except TypeError:
                continue
        self.bg = nt.nodes.new("ShaderNodeBackground")
        out = nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(self.sky.outputs["Color"], self.bg.inputs["Color"])
        nt.links.new(self.bg.outputs["Background"], out.inputs["Surface"])
        self.world = world
        bpy.ops.object.light_add(type="SUN")
        self.sun = bpy.context.active_object
        self.sun.data.angle = math.radians(1.2)
        bpy.ops.object.light_add(type="SUN")
        self.moon = bpy.context.active_object
        self.moon.data.angle = math.radians(2.0)
        self.moon.rotation_euler = (math.radians(35), math.radians(-20), math.radians(40))

    def key(self, frame: int, tod: str, weather: str, drift: tuple[str, float] | None = None) -> None:
        """Keys the sky for a time of day; `drift` moves it part of the way toward another (the light slowly moving on during a scene)."""
        p = dict(TIME_OF_DAY[tod])
        if drift and drift[1] > 0:
            to, k = TIME_OF_DAY[drift[0]], drift[1]
            for name in ("elev", "rot", "sun", "sky", "moon"):
                p[name] = p[name] + (to[name] - p[name]) * k
            p["color"] = tuple(a + (b - a) * k for a, b in zip(p["color"], to["color"]))
        elev = math.radians(p["elev"])
        rot = math.radians(p["rot"])
        self.sky.sun_elevation = elev
        self.sky.sun_rotation = rot
        self.sky.keyframe_insert("sun_elevation", frame=frame)
        self.sky.keyframe_insert("sun_rotation", frame=frame)
        self.bg.inputs["Strength"].default_value = p["sky"] * (0.55 + 0.45 * OVERCAST[weather])
        self.bg.inputs["Strength"].keyframe_insert("default_value", frame=frame)
        # The sun lamp points where the sky's sun is.
        self.sun.rotation_euler = (math.pi / 2 - elev, 0.0, rot - math.pi)
        self.sun.data.energy = p["sun"] * OVERCAST[weather]
        self.sun.data.color = p["color"]
        self.moon.data.energy = p["moon"]
        for prop, obj in (("rotation_euler", self.sun), ("energy", self.sun.data), ("color", self.sun.data), ("energy", self.moon.data)):
            obj.keyframe_insert(prop, frame=frame)
