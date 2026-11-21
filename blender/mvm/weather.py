"""Rain and snow as geometry nodes: every drop's position is a function of the scene time and the camera, so any frame
renders the same way (no simulation to run up to it) and motion blur streaks the falling drops."""

import math

import bpy

from . import materials

# kind -> fall speed (m/s), sideways drift (m/s), drops, box width and height (m), drop size (m)
KIND = {
    "rain": dict(speed=9.0, drift=-1.6, count=12000, width=30.0, height=13.0, size=0.0036, length=0.5),
    "snow": dict(speed=1.1, drift=-0.35, count=12000, width=28.0, height=10.0, size=0.016, sway=0.4),
}


def _socket(node, name: str, kind: str | None = None, out: bool = False):
    """The first enabled socket called `name` (nodes reuse names for different data types)."""
    for s in (node.outputs if out else node.inputs):
        if s.name == name and s.enabled and (kind is None or s.type == kind):
            return s
    raise KeyError(f"{node.bl_idname}: no {name!r} {kind or ''}")


class _Tree:
    def __init__(self, name: str):
        self.tree = bpy.data.node_groups.new(name, "GeometryNodeTree")
        self.tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
        self.tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
        self.nodes, self.links = self.tree.nodes, self.tree.links
        self.out = self.nodes.new("NodeGroupOutput")

    def node(self, idname: str, **props):
        n = self.nodes.new(idname)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.links.new(a, b)

    def math(self, op: str, a=None, b=None, c=None):
        n = self.node("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                self.link(v, n.inputs[i])
        return n.outputs[0]

    def vec(self, op: str, a=None, b=None):
        n = self.node("ShaderNodeVectorMath", operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (tuple, list)):
                n.inputs[i].default_value = v
            else:
                self.link(v, n.inputs[i])
        # Distance, length and dot product are scalars, on the node's "Value" output rather than its vector one.
        return n.outputs["Value"] if op in ("DISTANCE", "LENGTH", "DOT_PRODUCT") else n.outputs[0]

    def combine(self, x, y, z):
        n = self.node("ShaderNodeCombineXYZ")
        for sock, v in zip((n.inputs[0], n.inputs[1], n.inputs[2]), (x, y, z)):
            if isinstance(v, (int, float)):
                sock.default_value = v
            else:
                self.link(v, sock)
        return n.outputs[0]

    def separate(self, vector):
        n = self.node("ShaderNodeSeparateXYZ")
        self.link(vector, n.inputs[0])
        return n.outputs[0], n.outputs[1], n.outputs[2]


def _drop_material(kind: str):
    name = f"{kind}-drop"
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if kind == "rain":
        em.inputs["Color"].default_value = (0.86, 0.91, 1.0, 1.0)
        em.inputs["Strength"].default_value = 2.2
        mix.inputs["Fac"].default_value = 0.5
    else:
        em.inputs["Color"].default_value = (0.95, 0.97, 1.0, 1.0)
        em.inputs["Strength"].default_value = 2.4
        mix.inputs["Fac"].default_value = 1.0
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    mat.use_transparent_shadow = True
    return mat


def build(kind: str, origin, camera, seed: int = 1):
    """A box of falling drops that follows `camera` around, standing on the ground at origin's height."""
    cfg = KIND[kind]
    seed %= 1_000_000  # node seeds are signed ints; the song seed is a 32-bit hash
    t = _Tree(f"{kind}-{seed}")
    L, Hh = cfg["width"], cfg["height"]
    half = L / 2

    rnd = t.node("FunctionNodeRandomValue", data_type="FLOAT_VECTOR")
    _socket(rnd, "Min", "VECTOR").default_value = (0.0, 0.0, 0.0)
    _socket(rnd, "Max", "VECTOR").default_value = (L, L, Hh)
    _socket(rnd, "Seed").default_value = seed
    base = _socket(rnd, "Value", "VECTOR", out=True)
    phase_n = t.node("FunctionNodeRandomValue", data_type="FLOAT")
    _socket(phase_n, "Min", "VALUE").default_value = 0.0
    _socket(phase_n, "Max", "VALUE").default_value = math.tau
    _socket(phase_n, "Seed").default_value = seed + 17
    phase = _socket(phase_n, "Value", "VALUE", out=True)

    time = t.node("GeometryNodeInputSceneTime").outputs["Seconds"]
    cam = t.node("GeometryNodeObjectInfo")
    cam.inputs["Object"].default_value = camera
    cx, cy, _ = t.separate(cam.outputs["Location"])

    bx, by, bz = t.separate(base)
    x = t.math("ADD", bx, t.math("MULTIPLY", time, cfg["drift"]))
    y = by
    z = t.math("SUBTRACT", bz, t.math("MULTIPLY", time, cfg["speed"]))
    if "sway" in cfg:
        x = t.math("ADD", x, t.math("MULTIPLY", t.math("SINE", t.math("ADD", t.math("MULTIPLY", time, 0.9), phase)), cfg["sway"]))
        y = t.math("ADD", y, t.math("MULTIPLY", t.math("COSINE", t.math("ADD", t.math("MULTIPLY", time, 0.7), phase)), cfg["sway"]))
    # Wrap each axis so a drop leaving one side comes back in on the other; x and y are wrapped about the camera.
    wx = t.math("ADD", cx, t.math("WRAP", t.math("SUBTRACT", x, cx), half, -half))
    wy = t.math("ADD", cy, t.math("WRAP", t.math("SUBTRACT", y, cy), half, -half))
    wz = t.math("ADD", t.math("WRAP", z, Hh, 0.0), origin[2])
    pos = t.combine(wx, wy, wz)

    points = t.node("GeometryNodePoints")
    points.inputs["Count"].default_value = cfg["count"]
    t.link(pos, points.inputs["Position"])

    if kind == "rain":
        shape = t.node("GeometryNodeMeshCylinder")
        shape.inputs["Vertices"].default_value = 4
        shape.inputs["Radius"].default_value = cfg["size"]
        shape.inputs["Depth"].default_value = cfg["length"]
        mesh = shape.outputs["Mesh"]
        tilt = math.atan2(-cfg["drift"], cfg["speed"])
        rotation = (0.0, tilt, 0.0)
    else:
        shape = t.node("GeometryNodeMeshIcoSphere")
        shape.inputs["Radius"].default_value = cfg["size"]
        shape.inputs["Subdivisions"].default_value = 1
        mesh = shape.outputs["Mesh"]
        rotation = (0.0, 0.0, 0.0)
    inst = t.node("GeometryNodeInstanceOnPoints")
    t.link(points.outputs["Points"], inst.inputs["Points"])
    # Drops right at the lens would be enormous: shrink them to nothing inside a metre and a half.
    near = t.vec("DISTANCE", pos, cam.outputs["Location"])
    fade = t.math("MAXIMUM", t.math("MINIMUM", t.math("MULTIPLY", t.math("SUBTRACT", near, 0.7), 0.7), 1.0), 0.0)
    t.link(t.combine(fade, fade, fade), inst.inputs["Scale"])
    t.link(mesh, inst.inputs["Instance"])
    inst.inputs["Rotation"].default_value = rotation
    setmat = t.node("GeometryNodeSetMaterial")
    t.link(inst.outputs["Instances"], setmat.inputs["Geometry"])
    setmat.inputs["Material"].default_value = _drop_material(kind)
    t.link(setmat.outputs["Geometry"], t.out.inputs["Geometry"])

    obj = bpy.data.objects.new(f"{kind}", bpy.data.meshes.new(f"{kind}"))
    bpy.context.scene.collection.objects.link(obj)
    # Positions are computed in world space from the camera, so the emitter itself stays at the origin.
    mod = obj.modifiers.new(kind, "NODES")
    mod.node_group = t.tree
    obj.visible_shadow = False
    return [obj]
