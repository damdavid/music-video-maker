"""The Blender renderer: how the backend launches it, and the bpy-free logic it is built on."""

import math
import sys
from pathlib import Path

import pytest

from app import main, render
from app.models import Project, Settings
from tests.client import make_client

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blender"))
from mvm import body, hairgen, motion, timing  # noqa: E402


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
