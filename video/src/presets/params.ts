import type { VisualPreset } from "../../../shared/types";

export type ParamSpec = { key: string; label: string; min: number; max: number; step: number; default: number };

// One definition drives both the renderer (clamping/defaults) and the editor's sliders.
export const PRESET_PARAMS: Record<VisualPreset, ParamSpec[]> = {
  gradientFlow: [
    { key: "blobs", label: "Blobs", min: 2, max: 7, step: 1, default: 4 },
    { key: "speed", label: "Drift speed", min: 0.2, max: 3, step: 0.1, default: 1 },
  ],
  particleField: [
    { key: "density", label: "Density", min: 0.3, max: 1.5, step: 0.1, default: 1 },
    { key: "size", label: "Particle size", min: 0.5, max: 2.5, step: 0.1, default: 1 },
  ],
  spectrumRings: [
    { key: "rings", label: "Rings", min: 3, max: 10, step: 1, default: 6 },
    { key: "bars", label: "Bars", min: 6, max: 24, step: 1, default: 12 },
  ],
  geometricGrid: [
    { key: "cells", label: "Cells across", min: 6, max: 24, step: 1, default: 14 },
    { key: "spin", label: "Spin", min: 0, max: 2, step: 0.1, default: 1 },
  ],
  tunnel: [
    { key: "layers", label: "Layers", min: 6, max: 24, step: 1, default: 14 },
    { key: "speed", label: "Speed", min: 0.2, max: 3, step: 0.1, default: 1 },
  ],
  waveformRibbon: [
    { key: "window", label: "History (s)", min: 2, max: 12, step: 1, default: 6 },
    { key: "amplitude", label: "Amplitude", min: 0.5, max: 1.5, step: 0.1, default: 1 },
  ],
  ripples: [
    { key: "every", label: "Ring every N beats", min: 1, max: 4, step: 1, default: 1 },
    { key: "life", label: "Ring life (s)", min: 0.5, max: 2, step: 0.1, default: 1 },
    { key: "lens", label: "Lens ring (0 off, 1 on)", min: 0, max: 1, step: 1, default: 1 },
  ],
  halftoneBloom: [
    { key: "petals", label: "Petals", min: 5, max: 12, step: 1, default: 8 },
    { key: "dots", label: "Dot density", min: 0.5, max: 1.4, step: 0.1, default: 1 },
    { key: "spin", label: "Spin", min: 0, max: 2, step: 0.1, default: 1 },
  ],
  orbits: [
    { key: "orbits", label: "Orbits", min: 2, max: 5, step: 1, default: 4 },
    { key: "speed", label: "Speed", min: 0, max: 2, step: 0.1, default: 1 },
  ],
};

/** Fills defaults, drops unknown keys and non-numeric values, clamps to range, and rounds whole-number params. */
export function resolveParams(preset: VisualPreset, raw: Record<string, number | string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of PRESET_PARAMS[preset]) {
    const v = raw?.[spec.key];
    const n = typeof v === "number" && Number.isFinite(v) ? v : spec.default;
    const clamped = Math.min(spec.max, Math.max(spec.min, n));
    out[spec.key] = Number.isInteger(spec.step) ? Math.round(clamped) : clamped;
  }
  return out;
}
