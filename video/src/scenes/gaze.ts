import type { Action } from "../../../shared/types";
import { wobble } from "../motion";

/** Where the eyes look, each -1..1: x toward what the figure faces, y up (negative) or down. */
export type Look = { x: number; y: number };

type Input = {
  t: number;
  seed: number;
  variant: number;
  action: Action;
  /** Looking at the viewer: the eyes stay level and still. */
  camera: boolean;
  /** This figure's lift off the ground (the pose's y; up is negative). */
  y: number;
  /** Someone they are looking at: their lift, so the eyes follow a jump or a rise. */
  target?: { y: number };
};

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** Looking down, up or ahead as the action suggests; what they look at wins over all of it. */
const DEFAULT: Partial<Record<Action, Look>> = {
  look_up: { x: 0.2, y: -0.85 },
  sit: { x: 0.3, y: 0.4 },
  slump: { x: 0.1, y: 0.65 },
  cross_arms: { x: 0.2, y: 0.45 },
  reach: { x: 0.7, y: -0.2 },
  point: { x: 0.85, y: 0 },
};

/** The eyes' direction: on the other character (following their jumps), on the viewer, or wandering in small glances. */
export function eyeLook({ t, seed, variant, action, camera, y, target }: Input): Look {
  const chan = 40 + 7 * variant;
  const glance = { x: 0.3 * wobble(seed, t, chan, 0.5), y: 0.25 * wobble(seed, t, chan + 1, 0.4) };
  if (camera) return { x: 0.06 * glance.x, y: 0.06 * glance.y };
  if (target) return { x: clamp(0.85 + 0.15 * glance.x), y: clamp(-(y - target.y) * 9 + 0.5 * glance.y) };
  const base = DEFAULT[action] ?? { x: 0.35, y: 0 };
  return { x: clamp(base.x + glance.x), y: clamp(base.y + glance.y) };
}
