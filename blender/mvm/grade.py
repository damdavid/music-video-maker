"""Colour grading and the beat flash, as one compositor chain that is keyed over the video."""

import bpy

from . import materials

SAT_RANGE = (0.0, 2.0)


class Grade:
    """Render Layers -> hue/saturation -> brightness/contrast -> colour balance (the tint) -> exposure (the flash) -> output."""

    def __init__(self, scene):
        self.scene = scene
        self.group = bpy.data.node_groups.new("mvm-grade", "CompositorNodeTree")
        scene.compositing_node_group = self.group
        scene.render.use_compositing = True
        nodes, links = self.group.nodes, self.group.links
        self.group.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        src = nodes.new("CompositorNodeRLayers")
        self.hue = nodes.new("CompositorNodeHueSat")
        self.bc = nodes.new("CompositorNodeBrightContrast")
        self.balance = nodes.new("CompositorNodeColorBalance")
        self.exposure = nodes.new("CompositorNodeExposure")
        out = nodes.new("NodeGroupOutput")
        chain = [src.outputs["Image"], self.hue.inputs["Image"]], [self.hue.outputs["Image"], self.bc.inputs["Image"]], [self.bc.outputs["Image"], self.balance.inputs["Image"]], [self.balance.outputs["Image"], self.exposure.inputs["Image"]], [self.exposure.outputs["Image"], out.inputs[0]]
        for a, b in chain:
            links.new(a, b)
        self._last = None

    def key(self, frame: int, g: dict, flash: float = 0.0) -> None:
        """Sets and keys the chain for one frame from grade parameters (see rules.blend_grades) and a flash amount."""
        sat = max(SAT_RANGE[0], min(SAT_RANGE[1], g["saturate"] * (1.0 - 0.5 * g["sepia"])))
        tint = materials._rgba(g["tint"])[:3]
        peak = max(tint) or 1.0
        amount = min(1.0, g["tint_amount"] * 2.0)
        gain = [1.0 + (c / peak - 1.0) * amount for c in tint]
        values = (
            (self.hue.inputs["Hue"], 0.5 + g["hue"] / 360.0),
            (self.hue.inputs["Saturation"], sat),
            (self.bc.inputs["Contrast"], (g["contrast"] - 1.0) * 100.0),
            (self.bc.inputs["Brightness"], (g["brightness"] - 1.0) * 100.0 * 0.4),
            (self.exposure.inputs["Exposure"], flash * 4.0),
        )
        for sock, v in values:
            sock.default_value = v
            sock.keyframe_insert("default_value", frame=frame)
        gain_sock = next(i for i in self.balance.inputs if i.name == "Gain" and i.type == "RGBA")
        gain_sock.default_value = (*gain, 1.0)
        gain_sock.keyframe_insert("default_value", frame=frame)
