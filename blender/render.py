"""Renders the project to MP4 with Blender and reports progress as JSON lines on stdout, like video/render.mjs.

Run: blender -b --factory-startup --python blender/render.py -- --props props.json --out video.mp4 [--seconds N] [--still T]
"""

import json
import os
import shutil
import subprocess
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mvm import scene as scene_builder  # noqa: E402

BUILD_SHARE = 0.15  # of the progress bar; frames take the rest
ENCODE_SHARE = 0.03


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def arg(name: str):
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return argv[argv.index(f"--{name}") + 1] if f"--{name}" in argv else None


def setup_render(scene, preview: bool) -> None:
    scene.render.engine = "BLENDER_EEVEE"
    # MVM_SAMPLES overrides the quality: fewer samples render faster and look noisier.
    scene.eevee.taa_render_samples = int(os.environ.get("MVM_SAMPLES", 16 if preview else 48))
    scene.eevee.use_raytracing = True
    scene.eevee.shadow_pool_size = "1024"  # many lights and trees overflow the default
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.4
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [e.identifier for e in scene.view_settings.bl_rna.properties["look"].enum_items] else "None"


def main() -> None:
    props_path, out = arg("props"), arg("out")
    seconds = float(arg("seconds")) if arg("seconds") else None
    still = float(arg("still")) if arg("still") else None
    if not props_path or not out:
        raise SystemExit("--props and --out are required")
    props = json.load(open(props_path))
    scene = bpy.context.scene
    emit({"type": "stage", "stage": "bundling", "progress": 0})
    n_frames, fps = scene_builder.build(
        props, (still + 0.2) if still is not None else seconds,
        lambda stage, p: emit({"type": "stage", "stage": "bundling", "progress": p * BUILD_SHARE}),
    )
    setup_render(scene, preview=seconds is not None or still is not None)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    if still is not None:
        scene.frame_set(int(still * fps))
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        emit({"type": "done", "out": out, "width": scene.render.resolution_x, "height": scene.render.resolution_y, "fps": fps})
        return

    silent = out + ".silent.mp4"
    scene.render.image_settings.media_type = "VIDEO"  # Blender 5 offers FFMPEG only once the output is video
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.ffmpeg.audio_codec = "NONE"
    scene.render.filepath = silent
    total = scene.frame_end - scene.frame_start + 1

    def on_frame(s, *_):
        done = s.frame_current - s.frame_start + 1
        emit({"type": "stage", "stage": "rendering", "progress": BUILD_SHARE + (1 - BUILD_SHARE - ENCODE_SHARE) * done / total})

    bpy.app.handlers.render_post.append(on_frame)
    bpy.ops.render.render(animation=True)
    emit({"type": "stage", "stage": "encoding", "progress": 1 - ENCODE_SHARE})
    audio = props.get("audioPath")
    ffmpeg = shutil.which("ffmpeg")
    if audio and ffmpeg and os.path.exists(audio):
        cmd = [ffmpeg, "-y", "-v", "error", "-i", silent, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{total / fps:.3f}", out]
        subprocess.run(cmd, check=True)
        os.remove(silent)
    else:
        os.replace(silent, out)
    emit({"type": "done", "out": out, "width": scene.render.resolution_x, "height": scene.render.resolution_y, "fps": fps})


try:
    main()
except SystemExit:
    raise
except Exception as e:  # reported on the same channel the backend reads
    import traceback

    traceback.print_exc()
    emit({"type": "error", "message": f"{type(e).__name__}: {e}"})
    sys.exit(1)
