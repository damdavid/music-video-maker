import { easeInOutCubic } from "./easing";
import { mulberry32 } from "./rng";
import { clamp } from "./timing";

/** Length of the dissolve at the end of a line, in seconds. */
export const DISSOLVE_S = 0.45;
/** How much of the dissolve a word may wait before starting (the rest is its own duration). */
const STAGGER = 0.4;

/**
 * The second ink of an ink-stamped word. It starts far off register and settles close to it, never exactly on it.
 * `settle` is 0 when the word starts printing and 1 when it has landed.
 */
export function inkStampOffset(settle: number, size: number): { dx: number; dy: number } {
  const e = 0.12 - 0.08 * clamp(settle);
  return { dx: e * size, dy: e * size * 0.6 };
}

/** How much a freshly printed word is over-scaled while it lands. */
export const inkStampScale = (settle: number) => 1 + 0.15 * (1 - clamp(settle));

/**
 * CSS for a word dissolving into dots: it is shown only through a dot screen whose dots shrink to nothing,
 * each word starting a little later than the last by a seeded amount. `progress` runs 0..1 over the dissolve.
 */
export function dissolveStyle(progress: number, wordIndex: number, seed: number, size: number): Record<string, string | number> {
  const delay = mulberry32((seed ^ Math.imul(wordIndex + 1, 0x9e3779b1)) >>> 0)() * STAGGER;
  const local = clamp((progress - delay) / (1 - STAGGER));
  if (local <= 0) return {};
  if (local >= 1) return { opacity: 0 };
  const pitch = size * 0.14;
  const radius = pitch * 0.75 * (1 - easeInOutCubic(local)); // 0.75 of the pitch covers the whole cell
  const mask = `radial-gradient(circle at 50% 50%, #000 ${radius.toFixed(2)}px, transparent ${(radius + 0.8).toFixed(2)}px)`;
  const maskSize = `${pitch.toFixed(2)}px ${pitch.toFixed(2)}px`;
  return { WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: maskSize, maskSize };
}
