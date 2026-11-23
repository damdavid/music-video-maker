"""Lyrics as 3D text hung in front of the camera at the focus distance, so depth of field never softens them."""

import os

import bpy
from mathutils import Vector

from . import materials
from .timing import FADES, REVEAL_LEAD, appear_times, line_fade_out, line_words

FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Avenir Next.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
DEPTH = 3.0  # metres in front of the camera the text is laid out at (rescaled per frame to the focus distance)
TEXT_MAX_M = 3.5  # the furthest the text is hung from the camera, so a wide shot's lower third is not below the ground
REF_LENS = 42.0  # the lens the layout is designed for; other lenses rescale the text so it keeps its size on screen
SENSOR = 36.0
SIZE = 0.15
ROW_HEIGHT = 0.21
GAP = 0.09


def frame_extent(width: int, height: int) -> tuple[float, float]:
    """Half the visible width and height, in metres, at DEPTH with the reference lens."""
    long = DEPTH * SENSOR / 2 / REF_LENS
    return (long, long * height / width) if width >= height else (long * width / height, long)


def _font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return bpy.data.fonts.load(path)
            except RuntimeError:
                continue
    return None


def _rgba_sockets(node):
    return [s for s in node.inputs if s.type == "RGBA" and s.enabled]


def _word_material(name: str, base: str, hi: str, t0: float, t1: float, fps: int, fade: tuple[float, float, float, float], scene=None):
    """Emission that fades in with the line, turns to the highlight colour as the word is sung, and fades out.
    With a `scene`, a soft tint from the lyric cues (scene["mvm_tint"] = r, g, b, amount) is mixed in through drivers."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 4.0
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    a0, a1, b0, b1 = fade
    for frame, value in ((a0 - 1, 0.0), (a0, 0.0), (a1, 1.0), (b0, 1.0), (b1, 0.0), (b1 + 1, 0.0)):
        mix.inputs["Fac"].default_value = value
        mix.inputs["Fac"].keyframe_insert("default_value", frame=frame)
    rgb = materials._rgba(base)
    hrgb = materials._rgba(hi)
    target = em.inputs["Color"]
    if scene is not None:
        tint = nt.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MIX"
        a, b = _rgba_sockets(tint)
        factor = next(s for s in tint.inputs if s.name == "Factor" and s.type == "VALUE")
        nt.links.new(next(o for o in tint.outputs if o.type == "RGBA"), em.inputs["Color"])
        target = a
        # The cue tint rides on scene["mvm_tint"], which the caller keys per frame; each material reads it through drivers.
        for sock, channels in ((factor, [(None, 3)]), (b, [(i, i) for i in range(3)])):
            idx = list(tint.inputs).index(sock)
            for sub, comp in channels:
                path = f'nodes["{tint.name}"].inputs[{idx}].default_value'
                fc = nt.driver_add(path, sub) if sub is not None else nt.driver_add(path)
                fc.driver.type = "AVERAGE"
                var = fc.driver.variables.new()
                var.type = "SINGLE_PROP"
                var.targets[0].id_type = "SCENE"
                var.targets[0].id = scene
                var.targets[0].data_path = f'["mvm_tint"][{comp}]'
    for frame, color in ((a0 - 1, rgb), (t0 * fps - 1, rgb), (t0 * fps + 2, hrgb)):
        target.default_value = color
        target.keyframe_insert("default_value", frame=frame)
    return mat


def build(scene, cam_obj, lines: list[dict], fps: int, palette: tuple[str, str], max_frame: int, size: tuple[int, int], fade_mode: str = "gentle"):
    """Returns the anchor empty, parented to the camera, whose location and scale are keyed per frame by the caller."""
    anchor = bpy.data.objects.new("lyrics-anchor", None)
    scene.collection.objects.link(anchor)
    anchor.parent = cam_obj
    font = _font()
    base, hi = palette
    appears = appear_times(lines)
    half_w, half_h = frame_extent(*size)
    max_width, y_base = half_w * 1.7, -half_h * 0.62
    for li, line in enumerate(lines):
        start_f = appears[li] * fps
        if start_f > max_frame:
            break
        words = line_words(line)
        objs = []
        for wi, w in enumerate(words):
            curve = bpy.data.curves.new(f"w{li}-{wi}", "FONT")
            curve.body = w["text"]
            curve.size = SIZE
            curve.extrude = 0.004
            curve.align_x = "CENTER"
            if font:
                curve.font = font
            obj = bpy.data.objects.new(f"w{li}-{wi}", curve)
            scene.collection.objects.link(obj)
            obj.parent = anchor
            objs.append(obj)
        bpy.context.view_layer.update()
        widths = [o.dimensions.x for o in objs]
        # Wrap into rows that fit the frame.
        rows, row, row_w = [], [], 0.0
        for i, wd in enumerate(widths):
            need = wd + (GAP if row else 0)
            if row and row_w + need > max_width:
                rows.append((row, row_w))
                row, row_w, need = [], 0.0, wd
            row.append(i)
            row_w += need
        rows.append((row, row_w))
        for ri, (idxs, rw) in enumerate(rows):
            x = -rw / 2
            y = y_base - ri * ROW_HEIGHT
            for i in idxs:
                obj = objs[i]
                obj.location = Vector((x + widths[i] / 2, y, -DEPTH))
                x += widths[i] + GAP
        timings = FADES[fade_mode]
        # A line fades in over its lead-in, however slowly the setting would like to take.
        in_f = min(timings["fade_in"], max(line["start"] - appears[li], 0.05)) * fps
        out_s, out_len, handoff = line_fade_out(line["end"], appears[li + 1] if li + 1 < len(lines) else None, fade_mode)
        out_f = max(out_s * fps, start_f + in_f + 1)
        fade = (start_f, start_f + in_f, out_f, out_f + out_len * fps)
        for obj, w in zip(objs, words):
            mat = _word_material(f"{obj.name}-m", base, hi, w["start"], w["end"], fps, fade, scene)
            obj.data.materials.append(mat)
            obj.hide_render = True
            if handoff:
                # The old line rises a little as it clears, like the new one coming in beneath it.
                for frame, lift in ((int(out_f), 0.0), (int(fade[3]), timings["lift"])):
                    base_y = obj.location.y
                    obj.location.y = base_y + lift
                    obj.keyframe_insert("location", frame=frame, index=1)
                    obj.location.y = base_y
            for frame, hidden in ((0, True), (int(start_f) - 2, False), (int(fade[3]) + 2, True)):
                obj.hide_render = hidden
                obj.keyframe_insert("hide_render", frame=max(frame, 0))
    return anchor



def fade_material(name: str, color: str, fade: tuple[float, float, float, float]):
    """Emission that fades in over frames a0..a1, holds, and fades out over b0..b1."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 4.0
    em.inputs["Color"].default_value = materials._rgba(color)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    a0, a1, b0, b1 = fade
    for frame, value in ((a0 - 1, 0.0), (a0, 0.0), (a1, 1.0), (b0, 1.0), (b1, 0.0), (b1 + 1, 0.0)):
        mix.inputs["Fac"].default_value = value
        mix.inputs["Fac"].keyframe_insert("default_value", frame=frame)
    return mat


def build_title(scene, cam_obj, title: str, artist: str, window_s: float, fps: int, palette: tuple[str, str], size: tuple[int, int]):
    """The song title and artist, centred in front of the camera, fading in and out over `window_s` seconds."""
    anchor = bpy.data.objects.new("title-anchor", None)
    scene.collection.objects.link(anchor)
    anchor.parent = cam_obj
    font = _font()
    half_w, half_h = frame_extent(*size)
    end = window_s * fps
    fade_len = min(0.9, window_s / 3) * fps
    fade = (0.0, fade_len, end - fade_len, end)
    base, accent = palette
    made = []
    for text, text_size, y, color in ((title, SIZE * 1.9, half_h * 0.12, base), (artist, SIZE * 0.85, -half_h * 0.2, accent)):
        if not text.strip():
            continue
        curve = bpy.data.curves.new("title-text", "FONT")
        curve.body = text
        curve.size = text_size
        curve.extrude = 0.004
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        if font:
            curve.font = font
        obj = bpy.data.objects.new("title-text", curve)
        scene.collection.objects.link(obj)
        obj.parent = anchor
        obj.location = (0.0, y, -DEPTH)
        curve.materials.append(fade_material(f"title-{len(made)}", color, fade))
        made.append(obj)
    bpy.context.view_layer.update()
    max_width = half_w * 1.7
    for obj in made:
        if obj.dimensions.x > max_width:
            obj.scale = (max_width / obj.dimensions.x,) * 3  # a long title shrinks to fit the frame
        obj.hide_render = False
        obj.keyframe_insert("hide_render", frame=0)
        obj.hide_render = True
        obj.keyframe_insert("hide_render", frame=int(end) + 2)
    return anchor
