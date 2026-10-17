import { easeOutCubic } from "../easing";
import { mulberry32 } from "../rng";
import { clamp, lastStartedIndex } from "../timing";

export type Ripple = { index: number; /** Seconds since the beat. */ age: number; /** 0 at the beat, 1 when it has gone. */ life: number };

/** The rings alive at time t: one per beat (every `every`-th), each lasting `life` seconds. `beats` must be sorted. */
export function activeRipples(beats: number[], t: number, every: number, life: number): Ripple[] {
  const last = lastStartedIndex(beats, t);
  const out: Ripple[] = [];
  for (let i = last; i >= 0 && t - beats[i] <= life; i--) {
    if (i % Math.max(1, Math.round(every)) === 0) out.push({ index: i, age: t - beats[i], life: (t - beats[i]) / life });
  }
  return out.reverse();
}

/** Ring radius: leaves the dot fast and slows as it reaches the edge of the frame. */
export const rippleRadius = (life: number, maxRadius: number) => maxRadius * easeOutCubic(life);

/** A hand-drawn ring: the radius wobbles slowly around the circle, differently for every beat. */
export function wobblyRing(cx: number, cy: number, r: number, seed: number, index: number, points = 72): string {
  const rand = mulberry32((seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  let d = "";
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const wob = 0.5 * Math.sin(2 * a + phases[0]) + 0.3 * Math.sin(3 * a + phases[1]) + 0.2 * Math.sin(5 * a + phases[2]);
    const rr = r * (1 + 0.016 * wob);
    d += `${i === 0 ? "M" : "L"}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)} `;
  }
  return d + "Z";
}

/**
 * Radius of the lens ring around the dot. It tightens a step on each downbeat, easing into the new size, and
 * opens back out after `steps` of them.
 */
export function lensRadius(downbeats: number[], t: number, unit: number, steps = 8): number {
  const size = (n: number) => unit * (0.19 - 0.014 * (((n % steps) + steps) % steps));
  const n = lastStartedIndex(downbeats, t) + 1;
  if (n === 0) return size(0);
  const since = t - downbeats[n - 1];
  return size(n - 1) + (size(n) - size(n - 1)) * easeOutCubic(clamp(since / 0.3));
}
