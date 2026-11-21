"""Shared materials, cached by name so thousands of objects don't each get their own."""

import bpy


def _rgba(hex_color: str) -> tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    # Blender takes linear colour in node sockets.
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)


def principled(name: str, color: str, roughness: float = 0.6, metallic: float = 0.0, sss: float = 0.0, emission: float = 0.0, specular: float = 0.5):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    rgba = _rgba(color)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Specular IOR Level"].default_value = specular
    if sss:
        bsdf.inputs["Subsurface Weight"].default_value = sss
        bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
        bsdf.inputs["Subsurface Scale"].default_value = 0.02
    if emission:
        bsdf.inputs["Emission Color"].default_value = rgba
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def emissive(name: str, color: str, strength: float):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = _rgba(color)
    em.inputs["Strength"].default_value = strength
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def textured(name: str, c1: str, c2: str, scale: float = 6.0, roughness: float = 0.85, bump: float = 0.3, detail: float = 8.0):
    """A surface that varies between two colours with a noise texture, with matching bumps, for ground and walls."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = _rgba(c1)
    ramp.color_ramp.elements[1].color = _rgba(c2)
    bmp = nodes.new("ShaderNodeBump")
    bmp.inputs["Strength"].default_value = bump
    links.new(coord.outputs["Object"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bmp.inputs["Height"])
    links.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def ground(name: str, c1: str, c2: str, scale: float, roughness: float, bump: float, detail: float, weather: str = "clear"):
    """`textured`, wet and darker in rain, and white under snow."""
    if weather == "rain":
        dark = lambda h: "#%02x%02x%02x" % tuple(int(int(h.lstrip("#")[i : i + 2], 16) * 0.62) for i in (0, 2, 4))
        return textured(f"{name}-wet", dark(c1), dark(c2), scale, min(roughness, 0.22), bump * 0.6, detail)
    if weather == "snow":
        return textured(f"{name}-snow", "#cfd9e6", "#f3f6fa", scale * 0.7, 0.85, 0.55, detail)
    return textured(name, c1, c2, scale, roughness, bump, detail)


def windows(name: str, wall: str, lit: str, density: float = 0.45, seed: float = 1.0):
    """A building face: dark glass in a grid of panes, a random share of them lit from within."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Location"].default_value = (seed * 7.0, seed * 3.0, 0.0)
    brick = nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.0
    brick.inputs["Scale"].default_value = 0.4
    brick.inputs["Mortar Size"].default_value = 0.16
    brick.inputs["Mortar Smooth"].default_value = 0.0
    brick.inputs["Brick Width"].default_value = 1.5
    brick.inputs["Row Height"].default_value = 1.6
    brick.inputs["Color1"].default_value = (1, 1, 1, 1)
    brick.inputs["Color2"].default_value = (0, 0, 0, 1)
    brick.inputs["Color2"].default_value = (0, 0, 0, 1)
    # The brick colour is random per pane, so thresholding it lights panes at random.
    split = nodes.new("ShaderNodeSeparateColor")
    on = nodes.new("ShaderNodeMath")
    on.operation = "GREATER_THAN"
    on.inputs[1].default_value = 1.0 - density
    pane = nodes.new("ShaderNodeMath")
    pane.operation = "MULTIPLY"
    inside = nodes.new("ShaderNodeMath")  # 1 inside a pane, 0 in the gaps between them
    inside.operation = "SUBTRACT"
    inside.inputs[0].default_value = 1.0
    glow = nodes.new("ShaderNodeMath")
    glow.operation = "MULTIPLY"
    glow.inputs[1].default_value = 2.5
    mix = nodes.new("ShaderNodeMixRGB")
    mix.inputs["Color1"].default_value = _rgba(wall)
    mix.inputs["Color2"].default_value = _rgba("#06090e")
    # A wall varies along x on its front and along y on its sides, and always along z; the brick texture wants (u, v).
    xyz = nodes.new("ShaderNodeSeparateXYZ")
    across = nodes.new("ShaderNodeMath")
    across.operation = "ADD"
    uv = nodes.new("ShaderNodeCombineXYZ")
    links.new(coord.outputs["Object"], xyz.inputs["Vector"])
    links.new(xyz.outputs["X"], across.inputs[0])
    links.new(xyz.outputs["Y"], across.inputs[1])
    links.new(across.outputs[0], uv.inputs["X"])
    links.new(xyz.outputs["Z"], uv.inputs["Y"])
    links.new(uv.outputs["Vector"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], brick.inputs["Vector"])
    links.new(brick.outputs["Color"], split.inputs["Color"])
    links.new(split.outputs["Red"], on.inputs[0])
    links.new(on.outputs[0], pane.inputs[0])
    links.new(brick.outputs["Fac"], inside.inputs[1])
    links.new(inside.outputs[0], pane.inputs[1])
    links.new(pane.outputs[0], glow.inputs[0])
    links.new(glow.outputs[0], bsdf.inputs["Emission Strength"])
    # Between the panes (the mortar) is the wall; inside them is dark glass.
    links.new(inside.outputs[0], mix.inputs["Fac"])
    links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Emission Color"].default_value = _rgba(lit)
    bsdf.inputs["Roughness"].default_value = 0.35
    return mat


def hair(name: str, color: str):
    """Hair: glossy, with the colour varying a little from lock to lock so a head of it doesn't read as one flat plastic."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 140.0
    noise.inputs["Detail"].default_value = 1.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.55, 0.55, 0.55, 1)
    ramp.color_ramp.elements[1].color = (1.25, 1.25, 1.25, 1)
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs["Fac"].default_value = 1.0
    mix.inputs["Color1"].default_value = _rgba(color)
    links.new(coord.outputs["Object"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mix.inputs["Color2"])
    links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.34
    bsdf.inputs["Coat Weight"].default_value = 0.25
    bsdf.inputs["Coat Roughness"].default_value = 0.25
    bsdf.inputs["Specular IOR Level"].default_value = 0.7
    return mat
