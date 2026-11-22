"""Builds the whole video as one Blender scene from the project's props, animated on the timeline."""

import math
import random
import zlib

import bpy
from mathutils import Vector

from . import body, camera, figure, grade as grading, lyrics as lyric_text, motion, rules, wear, weather as precipitation, world
from .timing import beat_period, beat_phase, bars_per_shot, eye_open, hash_noise, mouth_open, plan_shots, section_spans, title_window, video_size, Shot

PLACE_X = {"left": -2.4, "center": 0.0, "right": 2.4}
# Expression a character takes from what they are doing when the storyboard doesn't set one.
BY_ACTION = {"idle": "neutral", "walk": "neutral", "run": "determined", "sit": "calm", "wave": "happy", "look_up": "surprised", "reach": "sad", "dance": "happy", "jump": "happy", "slump": "sad", "point": "determined", "lean": "calm", "cross_arms": "sad", "cheer": "happy"}
CROWD_INK = "#15151c"
MAX_CROWD = 6  # every figure is keyed on every frame, so the crowd is kept lighter than the other renderer's
CROWD_HATS = (None, None, "cowboy", "beanie", "cap", "top_hat", "beret", "sun_hat")
RIM_WATTS = 900.0
# What a leaning figure can lean on, and the y each is built at (so it can be moved to stand behind them).
LEANABLE = ("signpost", "lamp", "tree", "fence")
LEAN_BASE_Y = {"lamp": 2.2, "signpost": 2.2, "fence": 2.4, "tree": 3.0}


def facing_signs(chars: list[dict]) -> list[float]:
    """Which way each character faces: toward whoever they look at (another character), else the way the storyboard gave."""
    xs = {c["character_id"]: PLACE_X[c.get("placement") or "center"] for c in chars}
    out = []
    for c in chars:
        own = 1.0 if (c.get("facing") or "right") == "right" else -1.0
        target = c.get("looks_at")
        if target and target != "camera" and target != c["character_id"] and target in xs and xs[target] != xs[c["character_id"]]:
            own = 1.0 if xs[target] > xs[c["character_id"]] else -1.0
        out.append(own)
    return out
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
    moods = board.get("moods") or []
    cues = board.get("cues") or []
    onset, onset_rate = analysis.get("onset_strength") or [], analysis.get("fps") or 30
    crowds_on = settings.get("crowds", True)
    palette_grade = grading.Grade(scene)

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
        chars_here = [c for c in (sc.get("characters") or []) if c["character_id"] in cast]
        intensity = (styles.get(i) or {}).get("intensity", 0.5)
        crowd_n = min(MAX_CROWD, rules.crowd_size(sc.get("crowd"), intensity, chars_here[0].get("action", "idle") if chars_here else None, crowds_on))

        def make():
            world.build_earth(origin, setting, weather)
            sceneinfo["weather"] = world.build_weather(origin, weather, cam.obj, seed + i)
            world.SETTINGS[setting](origin, tod, rng, weather)
            props_here = list(sc.get("props") or [])
            # Someone leaning has something behind them: one of the scene's own props, else a lamp.
            signs_here = facing_signs(chars_here)
            for c, sign in zip(chars_here, signs_here):
                if c.get("action") != "lean":
                    continue
                kind = next((k for k in props_here if k in LEANABLE), "lamp")
                if kind in props_here:
                    props_here.remove(kind)
                x = PLACE_X[c.get("placement") or "center"] - sign * 0.3
                for obj in world.build_prop(kind, origin, x, rng):
                    obj.location.y -= LEAN_BASE_Y[kind]
            for pi, kind in enumerate(props_here):
                world.build_prop(kind, origin, (-4.0, 0.0, 4.0, 8.0)[pi % 4], rng)
            members = []
            chars = sc.get("characters") or []
            for j, c in enumerate(chars):
                ch = cast.get(c["character_id"])
                if not ch:
                    continue
                hair, outfit = ch.get("hair") or "short", ch.get("outfit") or "tee"
                gender = ch.get("gender") or body.infer_gender(hair, outfit)
                # A costume change for this scene: what the scene sets replaces the cast's own, the rest stays.
                worn = c.get("wear") or {}
                hat = ch.get("hat") if worn.get("hat") is None else (None if worn["hat"] == "none" else worn["hat"])
                accessories = ch.get("accessories") or [] if worn.get("accessories") is None else worn["accessories"]
                colors = ch.get("colors") or DEFAULT_COLORS
                fig = figure.Figure(f"s{i}c{j}", colors, hair, worn.get("outfit") or outfit, gender, body.HEIGHT[gender] * (ch.get("build") or 1.0),
                                    hat=hat, accessories=accessories, holding=c.get("holding"))
                if not members:  # the lead can be handed things at lyric lines
                    for cue in cues:
                        if a - 0.1 <= cue["at"] <= b and cue.get("holding"):
                            fig.add_held(cue["holding"], colors)
                members.append((fig, c, j))
            sceneinfo["members"] = members
            sceneinfo["symbols"] = {name: wear.SymbolRig(name) for name in {cue["symbol"] for cue in cues if a - 0.1 <= cue["at"] <= b and cue.get("symbol")}}
            # Background figures in flat dark silhouettes, facing the lead and moving with the music.
            ink = dict(body=CROWD_INK, hair=CROWD_INK, top=CROWD_INK, bottom=CROWD_INK, accent=CROWD_INK)
            crowd = []
            for n in range(crowd_n):
                gender = "female" if rng.random() < 0.5 else "male"
                fig = figure.Figure(f"s{i}x{n}", ink, rng.choice(("none", "short", "long", "bun")), "tee", gender, body.HEIGHT[gender] * rng.uniform(0.92, 1.06), hat=rng.choice(CROWD_HATS))
                x0 = -8.0 + 16.0 * (n + 0.5) / max(crowd_n, 1) + rng.uniform(-0.4, 0.4)
                crowd.append(dict(fig=fig, x=x0, y=rng.uniform(2.5, 7.0), pick=rng.random(), phase=rng.uniform(0.0, 5.0)))
            sceneinfo["crowd"] = crowd
            rim = bpy.data.lights.new(f"rim{i}", "SPOT")
            rim.spot_size, rim.spot_blend, rim.use_shadow, rim.energy = math.radians(70), 0.8, False, 0.0
            rim_obj = bpy.data.objects.new(f"rim{i}", rim)
            scene.collection.objects.link(rim_obj)
            sceneinfo["rim"] = rim_obj

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
        # Over the scene the light moves part of the way on toward the next time of day.
        prev_tod = (tod, weather, (rules.next_time_of_day(tod), rules.drift_amount(1.0)))
        members = sceneinfo["members"]
        lead_action = members[0][1].get("action", "idle") if members else "idle"
        shots = plan_shots(a, b, downbeats, bar_len, bars_per_shot(intensity), lead_action, seed + i)
        if not auto_cuts:
            shots = [Shot(a, b, shots[0].kind)]
        runs.append(dict(i=i, a=a, b=b, f0=f0, f1=f1, origin=origin, setting=setting, members=members, crowd=sceneinfo["crowd"], weather=sceneinfo["weather"], symbols=sceneinfo["symbols"], rim=sceneinfo["rim"], tod=tod, grade=(styles.get(i) or {}).get("grade") or "none", intensity=intensity, shots=shots, fill=world.FILL[tod] * (0.3 if setting == "room" else 1.0)))

    if prev_tod is not None and runs:
        sky.key(min(runs[-1]["f1"], n_frames) - 1, *prev_tod)

    # The lyric text hangs off the camera, sized and placed at its focus distance each frame.
    anchor = None
    if lines:
        pal = (plan.get("global") or {}).get("palette") or []
        anchor = lyric_text.build(scene, cam.obj, lines, fps, ("#ffffff", pal[-1] if pal else "#ff9f1c"), n_frames, (w, h), settings.get("lyric_fade", "gentle"))

    # The title and artist, before the lyrics: through the intro until the first line appears.
    meta = props.get("meta") or {}
    title_anchor, title_frames = None, 0
    window = title_window(lines) if settings.get("title_card", True) and (meta.get("title") or meta.get("artist")) else 0.0
    if window > 0:
        pal = (plan.get("global") or {}).get("palette") or []
        title_anchor = lyric_text.build_title(scene, cam.obj, meta.get("title") or "", meta.get("artist") or "", window, fps, ("#ffffff", pal[-1] if pal else "#ff9f1c"), (w, h))
        title_frames = int(window * fps) + 2

    total = sum(r["f1"] - r["f0"] for r in runs) or 1
    done = 0
    for r in runs:
        members = r["members"]
        lead = members[0] if members else None
        signs = facing_signs([c for _, c, _ in members])
        facing_sign = signs[0] if signs else 1.0
        azimuths = cam.shot_azimuths(r["shots"], facing_sign, seed + r["i"])
        open_world = r["setting"] in world.OPEN
        paths = []
        for fig, c, j in members:
            action = c.get("action", "idle")
            sign = signs[len(paths)]
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
            cs = rules.cues_at(cues, t)
            # Everyone's pose first: a figure looking at another follows that one's jumps with their eyes.
            posed = []
            for k, (fig, c, j) in enumerate(members):
                action = c.get("action", "idle")
                ctx = motion.Ctx(t=t, beat=beat, beat_len=beat_len, energy=energy, seed=seed, variant=j)
                pose = motion.pose_with_entrance(action, ctx, t - r["a"] - j * motion.ENTER_STAGGER)
                # A lyric cue can hand the lead something in place of what the scene gives them.
                holding = cs["holding"] if k == 0 and cs["holding"] else c.get("holding")
                if holding:
                    pose = motion.hold_pose(pose, holding, t, beat, energy)
                posed.append((pose, holding))
            for k, (fig, c, j) in enumerate(members):
                action = c.get("action", "idle")
                x0, sign, speed = paths[k]
                pose, holding = posed[k]
                fig.hold(f, holding)
                # What the lyrics call for, else the scene's own expression, else what the action suggests; the music turns it up or down.
                mood = (rules.mood_at(moods, t) if k == 0 else None) or c.get("expression") or BY_ACTION.get(action, "neutral")
                target = next((q for q, m in enumerate(members) if m[1]["character_id"] == c.get("looks_at") and q != k), None) if c.get("looks_at") not in (None, "camera") else None
                look = rules.eye_look(lambda ch, rate, j=j: hash_noise(seed + 40 + 7 * j + ch, t * rate * math.tau), action, c.get("looks_at") == "camera", pose.y, posed[target][0].y if target is not None else None)
                fig.apply(pose, mouth_open(lines, t) if k == 0 and lines else 0.0, eye_open(t, j), mood, rules.expression_strength(energy), look, -sign * 22.0 if c.get("looks_at") == "camera" else None)
                x = x0 + sign * speed * (t - r["a"])
                fig.root.location = (x, r["origin"][1] + (j - (len(members) - 1) / 2) * 0.9, 0.0)
                # Looking at the camera turns the figure most of the way round to face it.
                yaw = 36.0 * sign if c.get("looks_at") == "camera" else 90.0 * sign
                fig.root.rotation_euler = (0.0, 0.0, math.radians(yaw))
                fig.key(f)
                if k == 0:
                    lead_pos = Vector(fig.root.location)
            lead_x = lead_pos.x
            for n, member in enumerate(r["crowd"]):
                cfig = member["fig"]
                caction = rules.crowd_action(r["intensity"], member["pick"], False)
                cctx = motion.Ctx(t=t + member["phase"], beat=beat + member["phase"], beat_len=beat_len, energy=energy, seed=seed, variant=10 + n)
                cfig.apply(motion.pose_with_entrance(caction, cctx, t - r["a"] - 0.3 - 0.1 * n), 0.0, eye_open(t, 10 + n))
                cfig.root.location = (member["x"], r["origin"][1] + member["y"], 0.0)
                cfig.root.rotation_euler = (0.0, 0.0, math.radians(90 * (1.0 if lead_x > member["x"] else -1.0)))
                cfig.key(f)
            height = members[0][0].h if members else 1.75
            action = members[0][1].get("action", "idle") if members else "idle"
            cam.key(f, t, r["shots"], azimuths, lead_pos, height, action, energy, seed, fill=r["fill"], new_scene=(f == r["f0"]))
            # The lyric symbol beside the lead's head, popping in, floating up and fading; turned to face the camera.
            for name, rig in r["symbols"].items():
                if cs["symbol"] and cs["symbol"][0] == name and members:
                    age = cs["symbol"][1]
                    shrink = rules.symbol_size(age)
                    side = signs[0] * 0.3 * height
                    pos = (lead_pos.x + side, lead_pos.y, height * (1.12 + 0.28 * age / rules.SYMBOL_S))
                    yaw = math.atan2(cam.obj.location.x - pos[0], -(cam.obj.location.y - pos[1]))
                    rig.place(f, pos, height * 0.26 * shrink, yaw)
                else:
                    rig.hide(f)
            precipitation.key_amount(r["weather"], rules.weather_mood(energy, smoothed(onset, onset_rate, t)), f)
            # Light that follows the song: an edge of light behind the lead, a lift on each beat, and the section's colour grade.
            light = rules.lighting_at(r["tod"], rules.beat_envelope(beats, t), rules.beat_envelope(downbeats, t), energy)
            tint = world.TIME_OF_DAY[r["tod"]]["color"]
            rim = r["rim"]
            back = Vector((lead_pos.x - cam.obj.location.x, lead_pos.y - cam.obj.location.y, 0.0))
            back = back.normalized() if back.length > 1e-6 else Vector((0.0, 1.0, 0.0))
            focus = Vector((lead_pos.x, lead_pos.y, height * 0.62))
            rim.location = focus + back * 2.6 + Vector((0.0, 0.0, 0.9))
            rim.rotation_euler = (focus - rim.location).to_track_quat("-Z", "Y").to_euler()
            rim.data.energy = RIM_WATTS * light["rim"]
            rim.data.color = tuple(0.5 + 0.5 * c for c in tint)
            for prop, obj in (("location", rim), ("rotation_euler", rim), ("energy", rim.data), ("color", rim.data)):
                obj.keyframe_insert(prop, frame=f)
            palette_grade.key(f, rules.blend_grades(r["grade"], r["grade"], 1.0, rules.grade_strength(energy)), light["flash"])
            # Text hangs in front of the subject (so a head never covers a word), scaled to keep its size on screen for any lens.
            d = cam.data.dof.focus_distance
            # Never further than TEXT_MAX_M: in a wide shot the lower third of the frame at the subject's distance is underground.
            d = min(max(d - 0.5, 0.6 * d), lyric_text.TEXT_MAX_M)
            fit = (d / lyric_text.DEPTH * lyric_text.REF_LENS / cam.data.lens,) * 3
            for target, until in ((anchor, n_frames), (title_anchor, title_frames)):
                if target is not None and f < until:
                    target.location = (0.0, 0.0, 0.0)
                    target.scale = fit
                    target.keyframe_insert("scale", frame=f)
            done += 1
            if done % EVENT_EVERY == 0:
                emit("building", min(0.99, done / total))
    return n_frames, fps
