import { clamp } from "./timing";

/** Easing curves over 0..1. Input is clamped, so callers can pass raw progress. */
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

export const easeInOutCubic = (x: number) => {
  const p = clamp(x);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};

export const easeInOutSine = (x: number) => -(Math.cos(Math.PI * clamp(x)) - 1) / 2;

export const easeInQuad = (x: number) => clamp(x) * clamp(x);

/** Overshoots 1 slightly on the way in, then settles. */
export const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = clamp(x);
  if (p === 0 || p === 1) return p; // the formula leaves ~1e-13 at the ends
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

/** A sharp ease: almost still at both ends with nearly all the movement in the middle (a whip pan). */
export const easeInOutQuint = (x: number) => {
  const p = clamp(x);
  return p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2;
};
