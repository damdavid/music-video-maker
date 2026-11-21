"""The camera: a shot plan cut on downbeats, framed around the lead, with a slow dolly, depth of field and a little hand shake."""

import math
import random

import bpy
from mathutils import Euler, Vector

from .timing import Shot, hash_noise, shot_at

# lens (mm), distance (m), the height on the figure to aim at (fraction of its height), f-stop
KIND = {
    "wide": dict(lens=28.0, dist=7.0, aim=0.5, cam_h=1.55, fstop=5.6),
    "medium": dict(lens=42.0, dist=3.6, aim=0.7, cam_h=1.45, fstop=2.8),
    "close": dict(lens=70.0, dist=2.2, aim=0.9, cam_h=1.6, fstop=2.0),
}
PUSH = 0.12
HEAD = {"sit": 0.66, "slump": 0.78}


def _ease(x: float) -> float:
    p = min(1.0, max(0.0, x))
    return -(math.cos(math.pi * p) - 1) / 2


class CameraRig:
    def __init__(self, scene, width: int, height: int):
        data = bpy.data.cameras.new("cam")
        data.sensor_fit = "AUTO"
        data.dof.use_dof = True
        self.obj = bpy.data.objects.new("cam", data)
        scene.collection.objects.link(self.obj)
        # A soft key light riding on the camera, so the subject is lit at night however far the lamps are.
        light = bpy.data.lights.new("key", "AREA")
        light.size = 2.5
        light.use_shadow = True
        light.color = (1.0, 0.93, 0.85)
        self.key_light = light
        key_obj = bpy.data.objects.new("key", light)
        scene.collection.objects.link(key_obj)
        key_obj.parent = self.obj
        key_obj.location = (0.5, 0.4, -0.2)
        scene.camera = self.obj
        self.data = data
        self.euler = Euler((math.pi / 2, 0, 0))
        self.last_shot = None
        self.last_vals = None

    def shot_azimuths(self, shots: list[Shot], facing: float, seed: int) -> list[float]:
        """Per shot, how far round from the character's front the camera sits (radians); it favours 3/4 views toward the face."""
        rng = random.Random(seed)
        return [facing * math.radians(rng.uniform(18, 58)) * (1 if i % 2 == 0 else 0.6) for i in range(len(shots))]

    def key(self, frame: int, t: float, shots: list[Shot], azimuths: list[float], target: Vector, height: float, action: str, energy: float, seed: int, fill: float = 0.0, new_scene: bool = False) -> None:
        shot, idx = shot_at(shots, t)
        k = KIND[shot.kind]
        head = HEAD.get(action, 0.9)
        aim_h = (k["aim"] if shot.kind != "close" else head - 0.04) * height
        progress = _ease((t - shot.start) / max(shot.end - shot.start, 1e-3))
        dist = k["dist"] * (1 - PUSH * progress)
        az = azimuths[idx]
        aim = Vector((target.x, target.y, aim_h))
        cam = Vector((aim.x + dist * math.sin(az), aim.y - dist * math.cos(az), k["cam_h"] * height / 1.75))
        # Hand-held: a slow drift that grows with the music.
        amp = 0.008 + 0.03 * energy
        cam += Vector((hash_noise(seed + 1, t * 0.8), hash_noise(seed + 2, t * 0.8), 0.6 * hash_noise(seed + 3, t * 0.8))) * amp
        aim += Vector((hash_noise(seed + 4, t * 0.6), hash_noise(seed + 5, t * 0.6), 0.5 * hash_noise(seed + 6, t * 0.6))) * amp * 0.6
        rot = (aim - cam).to_track_quat("-Z", "Y").to_euler("XYZ", self.euler)
        self.euler = rot
        vals = (cam.copy(), rot.copy(), k["lens"], (aim - cam).length, k["fstop"], fill * ((aim - cam).length / 5.0) ** 2)
        cut = new_scene or (self.last_shot is not None and idx != self.last_shot)
        if cut and self.last_vals:
            # Hold the old view until just before the cut, so motion blur doesn't smear across it.
            self._set(self.last_vals)
            self._key(frame - 0.001)
        self._set(vals)
        self._key(frame)
        self.last_shot, self.last_vals = idx, vals

    def _set(self, vals) -> None:
        pos, rot, lens, focus, fstop, fill = vals
        self.key_light.energy = fill
        self.obj.location = pos
        self.obj.rotation_euler = rot
        self.data.lens = lens
        self.data.dof.focus_distance = focus
        self.data.dof.aperture_fstop = fstop

    def _key(self, frame: float) -> None:
        self.obj.keyframe_insert("location", frame=frame)
        self.obj.keyframe_insert("rotation_euler", frame=frame)
        self.data.keyframe_insert("lens", frame=frame)
        self.data.dof.keyframe_insert("focus_distance", frame=frame)
        self.data.dof.keyframe_insert("aperture_fstop", frame=frame)
        self.key_light.keyframe_insert("energy", frame=frame)
