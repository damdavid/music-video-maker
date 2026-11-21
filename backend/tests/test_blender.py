"""The Blender renderer: how the backend launches it, and the bpy-free logic it is built on."""

import math
import sys
from pathlib import Path

import pytest

from app import main, render
from app.models import Project, Settings
from tests.client import make_client

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blender"))
from mvm import motion, timing  # noqa: E402


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
