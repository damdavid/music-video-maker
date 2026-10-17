import type { ComponentType } from "react";
import type { VisualPreset } from "../../../shared/types";
import { GeometricGrid } from "./GeometricGrid";
import { GradientFlow } from "./GradientFlow";
import { HalftoneBloom } from "./HalftoneBloom";
import { Orbits } from "./Orbits";
import { ParticleField } from "./ParticleField";
import { Ripples } from "./Ripples";
import { SpectrumRings } from "./SpectrumRings";
import { Tunnel } from "./Tunnel";
import { WaveformRibbon } from "./WaveformRibbon";
import type { PresetProps } from "./types";

// Typed over the schema's VisualPreset union, so adding a preset to the backend fails to compile until it's here.
export const PRESETS: Record<VisualPreset, ComponentType<PresetProps>> = {
  gradientFlow: GradientFlow,
  particleField: ParticleField,
  spectrumRings: SpectrumRings,
  geometricGrid: GeometricGrid,
  tunnel: Tunnel,
  waveformRibbon: WaveformRibbon,
  ripples: Ripples,
  halftoneBloom: HalftoneBloom,
  orbits: Orbits,
};
