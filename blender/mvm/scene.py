"""Builds the whole video as one Blender scene from the project's props, animated on the timeline."""

import math
import random
import zlib

import bpy
from mathutils import Vector

from . import body, camera, figure, lyrics as lyric_text, motion, world
from .timing import beat_period, beat_phase, bars_per_shot, eye_open, mouth_open, plan_shots, section_spans, video_size, Shot

PLACE_X = {"left": -2.4, "center": 0.0, "right": 2.4}
DEFAULT_COLORS = dict(body="#d9a37e", hair="#2b1d14", top="#3b6fb0", bottom="#23262e", accent="#e8e2d4")
EVENT_EVERY = 10  # frames between progress events while building


def smoothed(series: list[float], rate: int, t: float, half: int = 5) -> float:
    if not series:
        return 0.5
    i = int(t * rate)
    window = series[max(0, i - half) : i + half + 1] or [series[-1]]
    return sum(window) / len(window)


def _stage(name: str, scene, builder):
    """Everything `builder` creates goes into one collection, so the stage can be switched on only while it is on screen."""
    before = set(bpy.data.objects)
    builder()
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    for obj in set(bpy.data.objects) - before:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        coll.objects.link(obj)
    return coll


def _fallback_scene(cast: list[dict]) -> dict:
    chars = [{"character_id": cast[0]["id"], "action": "dance", "expression": "happy", "placement": "center", "facing": "right"}] if cast else []
    return {"setting": "void", "time_of_day": "night", "weather": "clear", "characters": chars, "props": []}


def build(props: dict, seconds: float | None, emit):
    analysis, settings = props["analysis"], props.get("settings") or {}
    fps = int(settings.get("fps") or 30)
    duration = min(seconds, analysis["duration"]) if seconds else analysis["duration"]
    n_frames = max(1, int(round(duration * fps)))
    seed = zlib.crc32(f"{(props.get('meta') or {}).get('title', '')}|{analysis['duration']}".encode())
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    scene.frame_start, scene.frame_end = 0, n_frames - 1
    scene.render.fps = fps
    w, h = video_size(settings)
    scene.render.resolution_x, scene.render.resolution_y = w, h

    board = props.get("storyboard") or {}
    cast = {c["id"]: c for c in board.get("cast") or []}
    default_cast = {"id": "lead", "colors": DEFAULT_COLORS}
    if not cast:
        cast = {"lead": default_cast}
    scenes = {s["section_ref"]: s for s in board.get("scenes") or []}
    plan = props.get("plan") or {}
    styles = {s["section_ref"]: s for s in plan.get("sections") or []}
    lines = (props.get("lyrics") or {}).get("lines") or []
    auto_cuts = settings.get("auto_cuts", True)

    spans = section_spans(analysis)
    beats, bpm, downbeats = analysis.get("beats") or [], analysis.get("bpm") or 120, analysis.get("downbeats") or []
    bar_len = beat_period(analysis) * 4
    rms, rms_rate = analysis.get("rms") or [], analysis.get("fps") or 30

    sky = world.Sky(scene)
    cam = camera.CameraRig(scene, w, h)
    rng = random.Random(seed)
    emit("building", 0.0)
    prev_tod = None
    runs = []  # per scene: what to animate
    for i, (a, b) in enumerate(spans):
        if a >= duration:
            break
        sc = scenes.get(i) or scenes.get(max(k for k in scenes if k <= i)) if scenes else None
        sc = sc or _fallback_scene(list(cast.values()))
        setting = sc.get("setting", "void")
        tod, weather = sc.get("time_of_day") or "night", sc.get("weather") or "clear"
        origin = (0.0, i * world.STAGE_SPACING, 0.0)
        sceneinfo = {}

        def make():
            world.build_earth(origin, setting)
            world.build_weather(origin, weather)
            world.SETTINGS[setting](origin, tod, rng)
            for pi, kind in enumerate(sc.get("props") or []):
                world.build_prop(kind, origin, (-4.0, 0.0, 4.0, 8.0)[pi % 4], rng)
            members = []
            chars = sc.get("characters") or []
            for j, c in enumerate(chars):
                ch = cast.get(c["character_id"])
                if not ch:
                    continue
                hair, outfit = ch.get("hair") or "short", ch.get("outfit") or "tee"
                gender = ch.get("gender") or body.infer_gender(hair, outfit)
                fig = figure.Figure(f"s{i}c{j}", ch.get("colors") or DEFAULT_COLORS, hair, outfit, gender, body.HEIGHT[gender] * (ch.get("build") or 1.0))
                members.append((fig, c, j))
            sceneinfo["members"] = members

        coll = _stage(f"stage{i}", scene, make)
        f0, f1 = int(a * fps), min(int(b * fps), n_frames)
        # Collections can't animate their visibility, so each object is keyed on while its scene is on screen.
        for obj in coll.objects:
            for frame, hidden in ((0, f0 > 0), (f0, False), (f1 + 1, True)):
                obj.hide_render = hidden
                obj.keyframe_insert("hide_render", frame=frame)
        if prev_tod is not None:
            sky.key(f0 - 1, *prev_tod)
        sky.key(f0, tod, weather)
        prev_tod = (tod, weather)
        members = sceneinfo["members"]
        lead_action = members[0][1].get("action", "idle") if members else "idle"
        intensity = (styles.get(i) or {}).get("intensity", 0.5)
        shots = plan_shots(a, b, downbeats, bar_len, bars_per_shot(intensity), lead_action, seed + i)
        if not auto_cuts:
            shots = [Shot(a, b, shots[0].kind)]
        runs.append(dict(i=i, a=a, b=b, f0=f0, f1=f1, origin=origin, setting=setting, members=members, shots=shots, fill=world.FILL[tod] * (0.3 if setting == "room" else 1.0)))

    # The lyric text hangs off the camera, sized and placed at its focus distance each frame.
    anchor = None
    if lines:
        pal = (plan.get("global") or {}).get("palette") or []
        anchor = lyric_text.build(scene, cam.obj, lines, fps, ("#ffffff", pal[-1] if pal else "#ff9f1c"), n_frames, (w, h))

    total = sum(r["f1"] - r["f0"] for r in runs) or 1
    done = 0
    for r in runs:
        members = r["members"]
        lead = members[0] if members else None
        facing_sign = 1.0 if (lead and (lead[1].get("facing") or "right") == "right") else -1.0
        azimuths = cam.shot_azimuths(r["shots"], facing_sign, seed + r["i"])
        open_world = r["setting"] in world.OPEN
        paths = []
        for fig, c, j in members:
            action = c.get("action", "idle")
            sign = 1.0 if (c.get("facing") or "right") == "right" else -1.0
            speed = motion.ground_speed(action) * fig.h if open_world else 0.0
            span = r["b"] - r["a"]
            travel = min(speed * span / 2, 180.0)
            x0 = PLACE_X[c.get("placement") or "center"] - sign * travel
            paths.append((x0, sign, speed))
        for f in range(r["f0"], r["f1"]):
            t = f / fps
            energy = smoothed(rms, rms_rate, t)
            beat = beat_phase(beats, t, bpm)
            beat_len = beat_period(analysis)
            lead_pos = Vector((0.0, r["origin"][1], 0.0))
            for k, (fig, c, j) in enumerate(members):
                action = c.get("action", "idle")
                x0, sign, speed = paths[k]
                ctx = motion.Ctx(t=t, beat=beat, beat_len=beat_len, energy=energy, seed=seed, variant=j)
                pose = motion.pose_with_entrance(action, ctx, t - r["a"] - j * motion.ENTER_STAGGER)
                fig.apply(pose, mouth_open(lines, t) if k == 0 and lines else 0.0, eye_open(t, j))
                x = x0 + sign * speed * (t - r["a"])
                fig.root.location = (x, r["origin"][1] + (j - (len(members) - 1) / 2) * 0.9, 0.0)
                fig.root.rotation_euler = (0.0, 0.0, math.radians(90 * sign))
                fig.key(f)
                if k == 0:
                    lead_pos = Vector(fig.root.location)
            height = members[0][0].h if members else 1.75
            action = members[0][1].get("action", "idle") if members else "idle"
            cam.key(f, t, r["shots"], azimuths, lead_pos, height, action, energy, seed, fill=r["fill"], new_scene=(f == r["f0"]))
            if anchor is not None:
                # In front of the subject (so a head never covers a word), and scaled to keep its size on screen for any lens.
                d = cam.data.dof.focus_distance
                d = max(d - 0.5, 0.6 * d)
                anchor.location = (0.0, 0.0, 0.0)
                anchor.scale = (d / lyric_text.DEPTH * lyric_text.REF_LENS / cam.data.lens,) * 3
                anchor.keyframe_insert("scale", frame=f)
            done += 1
            if done % EVENT_EVERY == 0:
                emit("building", min(0.99, done / total))
    return n_frames, fps
