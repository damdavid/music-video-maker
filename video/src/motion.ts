import { noise2D } from "@remotion/noise";
import { lastStartedIndex } from "./timing";

/**
 * Smooth noise in -1..1 that changes `rate` times per second; `channel` picks an independent stream.
 * One song seed is used throughout (noise2D keeps only a few seeds cached), with streams separated along y.
 */
export const wobble = (seed: number, t: number, channel: number, rate = 1) => noise2D(seed, t * rate, channel * 7.31 + 0.5);

/** Two octaves of `wobble`, for hand-held camera style motion that has both sway and tremor. */
export const wobble2 = (seed: number, t: number, channel: number, rate = 1) =>
  (wobble(seed, t, channel, rate) * 2 + wobble(seed, t, channel + 101, rate * 3.1)) / 3;

/** A hit that rises in `rise` seconds then decays: tau/rise * e^(1 - tau/rise), peaking at 1. Zero before the hit. */
export const impulse = (tau: number, rise: number) => (tau < 0 ? 0 : (tau / rise) * Math.exp(1 - tau / rise));

/**
 * Sum of `impulse` over the recent events (beats, downbeats, landings) before t, each weighted by `weight(i)`.
 * Only events within ~8 rise times matter, so this stays a short scan back from the binary-searched latest event.
 */
export function impulses(events: number[], t: number, rise: number, weight: (i: number) => number = () => 1): number {
  let sum = 0;
  for (let i = lastStartedIndex(events, t); i >= 0 && t - events[i] < rise * 8; i--) sum += weight(i) * impulse(t - events[i], rise);
  return sum;
}

/**
 * Closed-form response of an underdamped spring released from 1 at tau=0 (0 before): a jiggle that settles to 0.
 * `freq` is in Hz, `damping` is the damping ratio (0..1).
 */
export function jiggle(tau: number, freq: number, damping: number): number {
  if (tau < 0) return 0;
  const w = 2 * Math.PI * freq;
  const wd = w * Math.sqrt(Math.max(1 - damping * damping, 1e-6));
  return Math.exp(-damping * w * tau) * Math.cos(wd * tau);
}

/** smoothstep over 0..1 (input clamped). */
export const smooth = (x: number) => {
  const p = Math.min(1, Math.max(0, x));
  return p * p * (3 - 2 * p);
};
