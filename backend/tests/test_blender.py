"""The Blender renderer: how the backend launches it, and the bpy-free logic it is built on."""

import math
import sys
from pathlib import Path

import pytest

from app import main, render
from app.models import Project, Settings
from tests.client import make_client

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blender"))
from mvm import body, contact, hairgen, motion, rules, symbols, timing  # noqa: E402


def test_the_lyric_fade_defaults_to_gentle_including_for_projects_saved_before_it_existed():
    assert Project(id="p").settings.lyric_fade == "gentle"
    assert Project.model_validate({"id": "p", "settings": {"aspect": "9:16"}}).settings.lyric_fade == "gentle"
    assert Settings(lyric_fade="hard").lyric_fade == "hard"


def test_the_title_card_is_on_by_default_including_for_projects_saved_before_it_existed():
    assert Project(id="p").settings.title_card is True
    assert Project.model_validate({"id": "p", "settings": {"aspect": "9:16"}}).settings.title_card is True
    assert Settings(title_card=False).title_card is False


def test_renderer_defaults_to_remotion_and_is_stored_per_project():
    assert Project(id="p").settings.renderer == "remotion"
    assert Project.model_validate({"id": "p", "settings": {"aspect": "9:16"}}).settings.renderer == "remotion"  # saved before the setting
    assert Settings(renderer="blender").renderer == "blender"


def test_command_launches_blender_headless_with_the_script_and_args(monkeypatch, tmp_path):
    monkeypatch.setattr(render, "find_blender", lambda: "/opt/blender")
    cmd = render.render_command(tmp_path / "p.json", tmp_path / "v.mp4", 10, "blender")
    assert cmd[:2] == ["/opt/blender", "-b"] and "--factory-startup" in cmd
    assert cmd[cmd.index("--python") + 1].endswith("blender/render.py")
    assert cmd[cmd.index("--") + 1 :] == ["--props", str(tmp_path / "p.json"), "--out", str(tmp_path / "v.mp4"), "--seconds", "10"]


def test_remotion_command_is_unchanged(monkeypatch, tmp_path):
    monkeypatch.setattr(render.shutil, "which", lambda name: "/usr/bin/node")
    cmd = render.render_command(tmp_path / "p.json", tmp_path / "v.mp4", None)
    assert cmd[0] == "/usr/bin/node" and cmd[1].endswith("video/render.mjs") and "--seconds" not in cmd


def test_missing_blender_is_a_clear_error(monkeypatch, tmp_path):
    monkeypatch.setattr(render, "find_blender", lambda: None)
    with pytest.raises(RuntimeError, match="Blender was not found"):
        render.render_command(tmp_path / "p.json", tmp_path / "v.mp4", None, "blender")


def test_blender_is_found_from_the_environment_first(monkeypatch):
    monkeypatch.setenv("MUSIC_VIDEO_MAKER_BLENDER", "/custom/blender")
    assert render.find_blender() == "/custom/blender"


def test_render_route_hands_blender_the_audio_file_and_the_renderer(tmp_path, monkeypatch):
    from tests.test_style_plan import _analysis

    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path)
    seen = {}
    monkeypatch.setattr(render, "start", lambda pid, out, props, seconds: seen.update(props=props) or render.RenderJob(project_id=pid, output=out / "v.mp4", clip=False))
    client = make_client()
    pid = client.post("/projects", files={"audio": ("a.mp3", b"x")}).json()["id"]
    (tmp_path / pid / "analysis.json").write_text(_analysis().model_dump_json())
    client.put(f"/projects/{pid}/settings", json=Settings(renderer="blender").model_dump())
    assert client.post(f"/projects/{pid}/render").status_code == 202
    assert seen["props"]["settings"]["renderer"] == "blender"
    assert seen["props"]["audioPath"] == str(tmp_path / pid / "audio.mp3")


ANALYSIS = {
    "duration": 40.0, "bpm": 120, "beats": [i * 0.5 for i in range(80)], "downbeats": [i * 2.0 for i in range(20)],
    "sections": [{"start": 0.0, "end": 20.3}, {"start": 20.3, "end": 40.0}],
}


class TestTiming:
    def test_hand_edited_sections_keep_their_times_and_detected_ones_snap(self):
        assert timing.section_spans(ANALYSIS)[1][0] == pytest.approx(20.0, abs=0.5) and timing.section_spans(ANALYSIS)[1][0] != 20.3
        assert timing.section_spans({**ANALYSIS, "sections_edited": True})[1][0] == 20.3

    def test_shots_cut_on_downbeats_open_wide_and_never_repeat(self):
        shots = timing.plan_shots(0, 20, ANALYSIS["downbeats"], 2.0, 1, "idle", 3)
        assert shots[0].kind == "wide" and shots[0].start == 0 and shots[-1].end == 20
        assert all(b.start == a.end and b.kind != a.kind for a, b in zip(shots, shots[1:]))
        assert all(s.end - s.start >= timing.MIN_SHOT_S for s in shots)
        assert all(s.kind != "close" for s in timing.plan_shots(0, 20, ANALYSIS["downbeats"], 2.0, 1, "jump", 3))

    def test_a_lyric_line_appears_early_but_never_before_the_previous_one_ends(self):
        lines = [{"start": 10, "end": 12}, {"start": 20, "end": 22}, {"start": 22.3, "end": 24}, {"start": 24, "end": 26}]
        assert timing.appear_times(lines) == pytest.approx([9.0, 19.0, 22.0, 23.85])

    def test_mouth_follows_the_words_and_blinks_are_brief(self):
        lines = [{"start": 1, "end": 3, "words": [{"start": 1, "end": 2, "text": "a"}]}]
        assert timing.mouth_open(lines, 1.5) > 0.5 and timing.mouth_open(lines, 0.2) == 0 and timing.mouth_open(lines, 5) == 0
        opens = [timing.eye_open(i / 30) for i in range(300)]
        assert min(opens) < 0.3 and sum(o < 1 for o in opens) < 30

    def test_the_title_holds_through_the_intro_and_leaves_before_the_first_lyric(self):
        line = lambda start: [{"start": start, "end": start + 3}]
        assert timing.title_window(line(6)) == pytest.approx(timing.appear_times(line(6))[0] - 0.1)
        assert timing.title_window(line(60)) == timing.TITLE_CAP_S
        assert timing.title_window(line(1)) == 0 and timing.title_window(line(2)) == 0  # no room for it
        assert timing.title_window([]) == timing.TITLE_NO_LYRICS_S

    def test_a_line_clears_quickly_when_the_next_appears_and_gently_when_it_is_alone(self):
        # Alone: starts fading just after its last word and takes 0.4 s.
        assert timing.line_fade_out(10.0, None) == pytest.approx((10.1, 0.4, False))
        assert timing.line_fade_out(10.0, 20.0) == pytest.approx((10.1, 0.4, False))
        # The next line appears while it is still on screen: it clears from that moment, in 0.22 s.
        start, length, handoff = timing.line_fade_out(10.0, 9.85)
        assert (start, length, handoff) == pytest.approx((9.85, timing.HANDOFF_S, True))
        # The next line appears just after this one's last word, before its own fade has finished.
        assert timing.line_fade_out(10.0, 10.3) == pytest.approx((10.1, timing.HANDOFF_S, True))

    def test_the_fade_setting_sets_how_slowly_a_line_hands_over(self):
        handoff = lambda mode: timing.line_fade_out(10.0, 9.85, mode)[1]
        assert handoff("hard") < handoff("normal") < handoff("gentle")
        tail = lambda mode: timing.line_fade_out(10.0, None, mode)[1]
        assert tail("hard") < tail("normal") < tail("gentle")
        assert timing.FADES["hard"]["lift"] < timing.FADES["gentle"]["lift"]
        assert all(timing.line_fade_out(10.0, 9.85, mode)[2] for mode in timing.FADES)

    def test_video_size_matches_the_remotion_side(self):
        assert timing.video_size({"aspect": "16:9", "resolution": "720p"}) == (1280, 720)
        assert timing.video_size({"aspect": "9:16", "resolution": "1080p"}) == (1080, 1920)
        assert timing.video_size({}) == (1920, 1080)


class TestMotion:
    @pytest.mark.parametrize("action", list(motion.ACTIONS))
    def test_every_action_is_finite_and_keeps_a_foot_on_the_ground(self, action):
        for i in range(120):
            t = i / 30
            p = motion.pose_with_entrance(action, motion.Ctx(t=t, beat=t * 2, beat_len=0.5, energy=0.6, seed=3), t)
            values = [p.lean, p.head, p.yaw, p.twist, p.y, p.hair, *p.arm_l, *p.arm_r, *p.leg_l, *p.leg_r]
            assert all(math.isfinite(v) for v in values)
            assert 0.2 < motion.stance_height(p) < 0.7

    def test_entrance_starts_standing_and_ends_on_the_action(self):
        c = motion.Ctx(t=3, beat=6, beat_len=0.5, energy=0.5, seed=1)
        assert motion.pose_with_entrance("walk", c, -1) == motion.pose_for("idle", c)
        assert motion.pose_with_entrance("walk", c, motion.ENTER_S) == motion.pose_for("walk", c)

    def test_beat_accent_is_small_and_silent_without_music(self):
        c = lambda beat, e: motion.Ctx(t=0, beat=beat, beat_len=0.5, energy=e, seed=1)
        samples = [motion.accent(c(i / 100, 1.0)) for i in range(400)]
        assert max(samples) < 0.04 and min(samples) > -0.04
        assert motion.accent(c(0.12, 0.0)) == 0

    def test_walking_speed_matches_the_stride(self):
        assert motion.ground_speed("walk") == pytest.approx(4 * 0.2 / 1.1)
        assert motion.ground_speed("run") > motion.ground_speed("walk") > motion.ground_speed("idle") == 0


class TestBody:
    def widest(self, stations, tag):
        return max(st.rx for st in stations if st.tag == tag)

    def test_male_shoulders_are_broader_and_female_hips_wider_with_a_narrower_waist(self):
        m, f = body.shaped(body.TORSO, "male"), body.shaped(body.TORSO, "female")
        assert self.widest(m, "shoulder") > self.widest(f, "shoulder")
        assert self.widest(m, "chest") > self.widest(f, "chest")
        assert self.widest(f, "hip") > self.widest(m, "hip")
        assert self.widest(f, "waist") < self.widest(m, "waist")

    def test_a_female_figure_has_a_bust_and_a_male_one_does_not(self):
        depth = lambda g: max(st.ry - st.cy for st in body.shaped(body.TORSO, g) if st.tag == "chest")
        assert depth("female") > depth("male") + 0.01
        assert depth("female") > max(st.ry - st.cy for st in body.TORSO if st.tag == "chest")

    def test_the_female_jaw_and_neck_are_slighter(self):
        assert self.widest(body.shaped(body.HEAD, "female"), "jaw") < self.widest(body.shaped(body.HEAD, "male"), "jaw")
        assert self.widest(body.shaped(body.NECK, "female"), "neck") < self.widest(body.shaped(body.NECK, "male"), "neck")

    def test_every_part_runs_in_one_direction_and_has_no_zero_width_sections(self):
        for gender in body.GENDER:
            for name, order in (("TORSO", 1), ("NECK", 1), ("HEAD", 1), ("LEG", -1), ("ARM", -1)):
                zs = [st.z for st in body.shaped(getattr(body, name), gender)]
                assert zs == sorted(zs, reverse=order < 0), (name, gender)
            assert all(st.rx > 0 and st.ry > 0 for part in (body.TORSO, body.LEG, body.ARM, body.HEAD, body.NECK) for st in body.shaped(part, gender))

    def test_the_legs_reach_the_ankle_and_a_figure_stands_on_its_shoes(self):
        assert abs(body.LEG[-1].z + body.THIGH + body.SHIN) < 0.02  # the last section is the ankle
        assert 0.02 < body.ANKLE < 0.08

    def test_heights_and_the_fallback_for_characters_without_a_gender(self):
        assert body.HEIGHT["male"] > body.HEIGHT["female"]
        assert body.infer_gender("long", "tee") == body.infer_gender("short", "dress") == "female"
        assert body.infer_gender("short", "hoodie") == body.infer_gender(None, None) == "male"

    def test_bone_blending_goes_from_one_bone_to_the_next_across_a_joint(self):
        assert body.blend(-0.1, -0.01, 0.05) == 1 and body.blend(0.1, -0.01, 0.05) == 0
        assert 0.4 < body.blend(-0.01, -0.01, 0.05) < 0.6


class TestHair:
    def points(self, style, seed=3):
        return [p for strand in hairgen.generate(style, seed) for p in strand]

    def skull_distance(self, p):
        return math.sqrt(sum(((p[i] - hairgen.C[i]) / hairgen.R[i]) ** 2 for i in range(3)))

    @pytest.mark.parametrize("style", ["short", "long", "bun"])
    def test_every_strand_is_a_tapering_tube_with_finite_points(self, style):
        for strand in hairgen.generate(style, 3):
            assert len(strand) >= 8
            radii = [p[3] for p in strand]
            assert all(all(math.isfinite(v) for v in p) for p in strand)
            assert radii[-1] < radii[0] * 0.5 and all(a >= b for a, b in zip(radii, radii[1:]))

    @pytest.mark.parametrize("style", ["short", "long", "bun"])
    def test_hair_sits_on_the_scalp_not_inside_the_head(self, style):
        crown = [p for p in self.points(style) if p[2] > 0.04]
        assert min(self.skull_distance(p) for p in crown) > 0.96

    def test_long_hair_keeps_off_the_face_and_out_of_the_shoulders(self):
        pts = self.points("long")
        assert not [p for p in pts if p[1] < -0.03 and 0.02 < p[2] < 0.106 and abs(p[0]) < 0.036]
        for x, y, z, _ in pts:
            if z < 0:
                rx, ry = hairgen.torso_radii(z)
                assert (x / rx) ** 2 + (y / ry) ** 2 > 0.9

    def test_long_hair_hangs_well_below_the_chin_and_short_hair_does_not(self):
        assert min(p[2] for p in self.points("long")) < -0.12
        assert min(p[2] for p in self.points("short")) > 0.0  # ends above the chin

    def test_hair_grows_only_inside_the_hairline(self):
        starts = [s[0] for s in hairgen.generate("short", 3)]
        assert all(p[2] > 0.1 for p in starts if p[1] < -0.04)  # above the brows at the front
        assert all(p[2] > 0.0 for p in starts)

    def test_bun_locks_wind_in_around_the_bun(self):
        ends = [s[-1] for s in hairgen.generate("bun", 3)]
        near = [e for e in ends if math.dist(e[:3], hairgen.BUN_CENTRE) < 0.045]
        assert len(near) > 0.7 * len(ends)

    def test_hair_is_deterministic_per_seed(self):
        assert hairgen.generate("long", 5) == hairgen.generate("long", 5)
        assert hairgen.generate("long", 5) != hairgen.generate("long", 6)


class TestWeather:
    def test_rain_and_snow_are_defined_with_sane_physics(self):
        weather = pytest.importorskip("mvm.weather", reason="needs bpy")  # imports bpy at module level
        assert weather.KIND["rain"]["speed"] > weather.KIND["snow"]["speed"] > 0


def test_transitions_come_from_the_music_and_motion_blur_is_off_unless_asked_for():
    assert Project(id="p").settings.transitions == "music"
    assert Project(id="p").settings.motion_blur == "off"
    old = Project.model_validate({"id": "p", "settings": {"aspect": "9:16"}}).settings
    assert (old.transitions, old.motion_blur) == ("music", "off")
    assert Settings(transitions="plan", motion_blur="strong").motion_blur == "strong"


def test_entrances_wind_up_then_overshoot():
    ctx = motion.Ctx(t=1.0, beat=2.25, beat_len=0.5, energy=0.6, seed=3)
    idle, wave = motion.pose_for("idle", ctx), motion.pose_for("wave", ctx)
    along = lambda since: (motion.pose_with_entrance("wave", ctx, since).arm_r[0] - idle.arm_r[0]) / (wave.arm_r[0] - idle.arm_r[0])
    k = [along(i / 70 * motion.ENTER_S) for i in range(71)]
    assert min(k) < -0.03 and max(k) > 1.03
    assert motion.pose_with_entrance("wave", ctx, 0.0) == idle
    assert motion.pose_with_entrance("wave", ctx, motion.ENTER_S) == wave
    assert motion.ease_anticipate(0.0) == 0.0 and motion.ease_anticipate(1.0) == 1.0


def test_held_items_move_only_the_arms_they_hold():
    ctx = motion.Ctx(t=1.0, beat=2.25, beat_len=0.5, energy=0.6, seed=3)
    base = motion.pose_for("idle", ctx)
    for kind in motion.HELD:
        held = motion.hold_pose(base, kind, 1.0, 2.25, 0.6)
        assert held.arm_r != base.arm_r
        assert (held.arm_l != base.arm_l) == (kind in motion.TWO_HANDED)
        assert held.lean == base.lean and held.leg_l == base.leg_l
    assert motion.hold_pose(base, "phone", 1.0, 2.25, 0.6).arm_r[1] > motion.hold_pose(base, "suitcase", 1.0, 2.25, 0.6).arm_r[1]


def test_the_crowd_rules_match_the_other_renderer():
    assert rules.crowd_size(0, 1.0, "dance", True) == 0
    assert rules.crowd_size(40, 0.1, "idle", False) == rules.MAX_CROWD
    assert rules.crowd_size(None, 0.3, "dance", True) == 0
    assert 1 < rules.crowd_size(None, 0.6, "dance", True) < rules.crowd_size(None, 1.0, "dance", True) <= rules.MAX_CROWD
    assert rules.crowd_size(None, 1.0, "sit", True) == 0 and rules.crowd_size(None, 1.0, "dance", False) == 0
    assert {rules.crowd_action(0.95, p, False) for p in (0, 0.2, 0.5, 0.95)} >= {"jump", "cheer", "dance"}
    assert rules.crowd_action(0.5, 0.9, True) == "walk" and rules.crowd_action(0.5, 0.9, False) == "idle"


def test_moods_hold_until_the_next_and_then_let_go():
    moods = [{"at": 10, "expression": "sad"}, {"at": 20, "expression": "determined"}]
    assert rules.mood_at(moods, 5) is None and rules.mood_at([], 5) is None
    assert rules.mood_at(moods, 15) == "sad" and rules.mood_at(list(reversed(moods)), 25) == "determined"
    assert rules.mood_at(moods, 10 + rules.MOOD_HOLD_S + 0.5) is None


def test_grades_blend_and_stay_in_range():
    assert rules.blend_grades("none", "none", 0.5)["tint_amount"] == 0
    mid = rules.blend_grades("none", "warm", 0.5)
    assert mid["tint"] == rules.GRADES["warm"]["tint"] and abs(mid["tint_amount"] - rules.GRADES["warm"]["tint_amount"] / 2) < 1e-9
    assert rules.blend_grades("none", "vivid", 1, 1.15)["saturate"] > rules.blend_grades("none", "vivid", 1, 0.8)["saturate"]
    for a in rules.GRADES:
        for b in rules.GRADES:
            g = rules.blend_grades(a, b, 0.4, 1.15)
            assert g["saturate"] >= 0 and g["contrast"] > 0 and g["sepia"] <= 1 and g["tint_amount"] <= 0.4


def test_light_follows_the_song():
    rest = rules.lighting_at("night", 0.0, 0.0, 0.6)
    beat = rules.lighting_at("night", 1.0, 0.0, 0.6)
    down = rules.lighting_at("night", 1.0, 1.0, 0.6)
    assert rest["flash"] == 0 < beat["flash"] < down["flash"]
    assert rules.lighting_at("day", 1, 1, 1)["rim"] < rules.lighting_at("night", 1, 1, 1)["rim"] <= 0.7
    assert rules.next_time_of_day("dusk") == "night" and rules.next_time_of_day("night") == "dawn"
    assert rules.drift_amount(0) == 0 and 0 < rules.drift_amount(1) <= rules.DRIFT
    assert rules.beat_envelope([1.0, 2.0], 1.0) == 1.0 and rules.beat_envelope([1.0, 2.0], 1.5) < 0.2 and rules.beat_envelope([1.0], 0.5) == 0.0


def test_the_new_actions_pose_the_arms_as_described():
    ctx = motion.Ctx(t=1.0, beat=2.25, beat_len=0.5, energy=0.6, seed=3)
    assert motion.pose_for("point", ctx).arm_r[0] > 70
    crossed = motion.pose_for("cross_arms", ctx)
    assert crossed.arm_r[1] > 90 and crossed.arm_l[1] > 90
    cheer = motion.pose_for("cheer", ctx)
    assert min(cheer.arm_r[0], cheer.arm_l[0]) > 140
    assert motion.pose_for("lean", ctx).lean < -5
    assert motion.pose_for("cheer", motion.Ctx(t=1.0, beat=2.5, beat_len=0.5, energy=0.6, seed=3)).y > motion.pose_for("cheer", motion.Ctx(t=1.0, beat=2.0, beat_len=0.5, energy=0.6, seed=3)).y
    for action in ("point", "lean", "cross_arms", "cheer"):
        assert action in timing.KINDS and action in motion.ACTIONS
        p = motion.pose_with_entrance(action, ctx, 0.2)
        assert all(math.isfinite(v) for v in (p.lean, p.head, p.y, *p.arm_l, *p.arm_r, *p.leg_l, *p.leg_r))


def test_lyric_cues_show_a_symbol_for_a_while_and_hold_an_item_until_the_next():
    cues = [{"at": 10, "symbol": "heart"}, {"at": 14, "holding": "umbrella"}, {"at": 20, "symbol": "door", "holding": "suitcase"}]
    none = {"symbol": None, "holding": None, "hold_age": None}
    assert rules.cues_at(cues, 5) == none and rules.cues_at(None, 5) == none
    assert rules.cues_at(cues, 11)["symbol"] == ("heart", 1.0)
    assert rules.cues_at(cues, 10 + rules.SYMBOL_S + 0.1)["symbol"] is None
    assert rules.cues_at(cues, 15)["holding"] == "umbrella" and rules.cues_at(cues, 21)["holding"] == "suitcase"
    assert rules.cues_at(cues, 20 + rules.HOLD_S + 0.5)["holding"] is None


def test_eyes_follow_the_other_character_look_down_when_sitting_and_hold_still_for_the_camera():
    quiet = lambda channel, rate: 0.0
    assert rules.eye_look(quiet, "sit", False, 0.0)[1] > rules.eye_look(quiet, "idle", False, 0.0)[1]
    assert rules.eye_look(quiet, "look_up", False, 0.0)[1] < 0
    assert rules.eye_look(quiet, "idle", True, 0.0) == (0.0, 0.0)
    up = rules.eye_look(quiet, "idle", False, 0.0, target_lift=0.2)[1]  # the other is off the ground
    assert up < rules.eye_look(quiet, "idle", False, 0.0, target_lift=0.0)[1]
    assert rules.eye_look(quiet, "idle", False, 0.0, target_lift=0.0)[0] > 0.6


def test_the_music_asks_for_heavier_weather_when_louder():
    assert rules.weather_mood(0.9, 0) > rules.weather_mood(0.1, 0)
    assert all(0.2 <= rules.weather_mood(e, o) <= 1.0 for e in (0, 0.5, 1) for o in (0, 1))


def test_every_symbol_is_a_sensible_flat_shape():
    assert set(symbols.SYMBOLS) == {"heart", "star", "rose", "key", "door", "moon", "bird", "clock"}
    for name, layers in symbols.SYMBOLS.items():
        assert layers
        for outline, color in layers:
            assert len(outline) >= 3 and color.startswith("#") and len(color) == 7
            assert all(math.isfinite(x) and math.isfinite(z) and abs(x) <= 0.75 and abs(z) <= 0.75 for x, z in outline), name
            # A positive or negative area, not a collapsed line.
            area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1])) / 2
            assert abs(area) > 0.003, name


def test_the_crescent_is_hollow_on_the_side_of_the_cut():
    xs = [x for x, _ in symbols.moon()]
    assert min(xs) < -0.4 and max(xs) < 0.3  # open toward the right


def test_the_lyric_tint_rises_and_falls_with_a_symbol_and_is_gentler_for_an_item():
    cues = [{"at": 10, "holding": "lantern"}, {"at": 14, "symbol": "moon"}]
    assert rules.cue_tint(rules.cues_at([], 5)) is None
    held = rules.cue_tint(rules.cues_at(cues, 12))
    assert held[0] == rules.HELD_COLOR["lantern"] and held[1] < 0.35
    sym = rules.cue_tint(rules.cues_at(cues, 15))
    assert sym[0] == rules.SYMBOL_COLOR["moon"] and sym[1] > 0.4
    assert rules.cue_tint(rules.cues_at(cues, 14.0)) is not None  # the lantern still tints while the symbol starts
    assert rules.cue_tint(rules.cues_at(cues, 14 + rules.SYMBOL_S + 0.1)) is not None  # the symbol is gone, the item is still in hand
    assert rules.cue_tint(rules.cues_at(cues, 10 + rules.HOLD_S + 1)) is None


def _forward_hand(p, side, sign=1):
    """Where a hand ends up in the figure's plane (forward, up), from the same angles the arm is posed with."""
    sf, sz = contact._shoulder(p)
    upper, lower = getattr(p, side)
    u, l = math.radians(upper), math.radians(upper + lower)
    return (sf + math.sin(u) * body.UPPER_ARM + math.sin(l) * (body.FORE_ARM + contact.HAND), sz - math.cos(u) * body.UPPER_ARM - math.cos(l) * (body.FORE_ARM + contact.HAND))


def test_the_arm_solver_reaches_where_it_is_told():
    for df, dz in ((0.25, 0.05), (0.1, 0.25), (-0.1, 0.2), (0.2, -0.1), (0.0, 0.3)):
        upper, lower = contact.arm_to(df, dz)
        u, l = math.radians(upper), math.radians(upper + lower)
        U, F = body.UPPER_ARM, body.FORE_ARM + contact.HAND
        assert math.isclose(math.sin(u) * U + math.sin(l) * F, df, abs_tol=1e-6)
        assert math.isclose(math.cos(u) * U + math.cos(l) * F, dz, abs_tol=1e-6)


def test_pairs_stand_face_to_face_or_side_by_side_and_each_character_joins_one():
    chars = [{"character_id": "a", "placement": "left", "facing": "left", "contact": {"partner": "b", "kind": "hug"}}, {"character_id": "b"}]
    a, b = contact.pairings(chars)
    assert (a.sign, b.sign) == (1.0, -1.0) and math.isclose(b.dx - a.dx, contact.GAP["hug"]) and a.placement == "left"
    side = contact.pairings([{**chars[0], "contact": {"partner": "b", "kind": "hold_hands"}}, chars[1]])
    assert side[0].sign == side[1].sign == -1.0 and math.isclose((side[0].dx - side[1].dx) * -1, contact.GAP["hold_hands"])
    three = contact.pairings([chars[0], chars[1], {"character_id": "c", "contact": {"partner": "b", "kind": "hug"}}])
    assert [p is not None for p in three] == [True, True, False]
    assert contact.pairings([{"character_id": "a", "contact": {"partner": "ghost", "kind": "hug"}}]) == [None]


def test_the_hands_meet_when_holding_hands_and_in_a_high_five():
    ctx = motion.Ctx(t=1.0, beat=2.25, beat_len=0.5, energy=0.5, seed=3)
    for kind in ("hold_hands", "high_five"):
        pairs = contact.pairings([{"character_id": "a", "contact": {"partner": "b", "kind": kind}}, {"character_id": "b"}])
        h = 1.75
        bodies = [contact.Body(motion.pose_for("idle", ctx), 10.0 + pairs[i].dx * h, h, pairs[i].sign) for i in (0, 1)]
        poses = contact.contact_poses(pairs, bodies)
        side_a = (contact._far(bodies[0]) if kind == "hold_hands" else contact._near(bodies[0]))
        side_b = contact._near(bodies[1])
        wa = contact._world(bodies[0], _forward_hand(poses[0], side_a))
        wb = contact._world(bodies[1], _forward_hand(poses[1], side_b))
        assert math.hypot(wa[0] - wb[0], wa[1] - wb[1]) < 0.03 * h, kind
    assert contact.contact_poses([None], [contact.Body(motion.pose_for("idle", ctx), 0.0, 1.7, 1.0)])[0] == motion.pose_for("idle", ctx)


def test_the_scenery_mood_gusts_on_hits_glows_on_beats_and_stays_in_range():
    assert rules.scenery_mood(0.5, 0.2, 0)["gust"] == 0 and rules.scenery_mood(0.5, 1, 0)["gust"] == 1
    assert rules.scenery_mood(0.5, 0, 1)["glow"] > rules.scenery_mood(0.5, 0, 0)["glow"]
    assert rules.scenery_mood(0.5, 1, 0)["flicker"] > rules.scenery_mood(0.5, 0, 0)["flicker"]
    for e in (-1, 0, 0.5, 1, 3):
        for o in (0, 0.5, 1):
            assert all(0 <= v <= 1 for v in rules.scenery_mood(e, o, 0.5).values())
