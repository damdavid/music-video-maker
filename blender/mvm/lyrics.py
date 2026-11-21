"""Lyrics as 3D text hung in front of the camera at the focus distance, so depth of field never softens them."""

import os

import bpy
from mathutils import Vector

from . import materials
from .timing import REVEAL_LEAD, appear_times, line_words

FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Avenir Next.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
DEPTH = 3.0  # metres in front of the camera the text is laid out at (rescaled per frame to the focus distance)
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


def _word_material(name: str, base: str, hi: str, t0: float, t1: float, fps: int, fade: tuple[float, float, float, float]):
    """Emission that fades in with the line, turns to the highlight colour as the word is sung, and fades out."""
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
    for frame, color in ((a0 - 1, rgb), (t0 * fps - 1, rgb), (t0 * fps + 2, hrgb)):
        em.inputs["Color"].default_value = color
        em.inputs["Color"].keyframe_insert("default_value", frame=frame)
    return mat


def build(scene, cam_obj, lines: list[dict], fps: int, palette: tuple[str, str], max_frame: int, size: tuple[int, int]):
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
        fade = (start_f, start_f + 0.25 * fps, line["end"] * fps + 0.1 * fps, line["end"] * fps + 0.5 * fps)
        for obj, w in zip(objs, words):
            mat = _word_material(f"{obj.name}-m", base, hi, w["start"], w["end"], fps, fade)
            obj.data.materials.append(mat)
            obj.hide_render = True
            for frame, hidden in ((0, True), (int(start_f) - 2, False), (int(fade[3]) + 2, True)):
                obj.hide_render = hidden
                obj.keyframe_insert("hide_render", frame=max(frame, 0))
    return anchor
