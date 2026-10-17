import type { AnalysisData } from "../../shared/types";

export type Series = "rms" | "low" | "mid" | "high" | "spectral_centroid" | "onset_strength";

export const at = (arr: number[], frame: number): number => arr[Math.min(Math.max(Math.round(frame), 0), arr.length - 1)] ?? 0;

/** Index into the analysis series for time t; they are sampled at the analysis fps, which needn't match the video's. */
export const seriesFrame = (a: AnalysisData, t: number): number => t * (a.fps ?? 30);

export const feature = (a: AnalysisData, name: Series, frame: number): number => at(a[name], frame);

export const chromaAt = (a: AnalysisData, frame: number): number[] =>
  a.chroma[Math.min(Math.max(Math.round(frame), 0), a.chroma.length - 1)] ?? new Array(12).fill(0);

/**
 * Attack/release envelope follower: rises within `attack` seconds and falls back over `release`, so motion driven by
 * it doesn't jitter frame to frame. Computed over the whole series from frame 0, so every frame stays a pure lookup.
 */
export function envelope(series: number[], fps: number, attack: number, release: number): number[] {
  const up = 1 - Math.exp(-1 / Math.max(attack * fps, 1e-6));
  const down = 1 - Math.exp(-1 / Math.max(release * fps, 1e-6));
  const out = new Array<number>(series.length);
  let e = series[0] ?? 0;
  for (let i = 0; i < series.length; i++) {
    const x = series[i];
    e += (x > e ? up : down) * (x - e);
    out[i] = e;
  }
  return out;
}

// Keyed by the series array itself: one analysis object is shared by every frame of a render.
const smoothCache = new WeakMap<number[], number[]>();

/** `name` at time t through a fast-attack, slow-release envelope; use it for motion amplitudes rather than the raw value. */
export function smoothed(a: AnalysisData, name: Series, t: number): number {
  const raw = a[name];
  let env = smoothCache.get(raw);
  if (!env) {
    env = envelope(raw, a.fps ?? 30, 0.04, 0.3);
    smoothCache.set(raw, env);
  }
  return at(env, seriesFrame(a, t));
}
