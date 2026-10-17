import { mulberry32 } from "../rng";
import { clamp } from "../timing";

export const PAPER = "#F2EDE3";

export type Offset = { dx: number; dy: number };
export type Registration = { r: Offset; g: Offset; b: Offset };

/** Pixel size of "one riso pixel": the fringes and specks are designed at 1080 px tall and scale with the frame. */
export const printScale = (unit: number) => unit / 1080;

/**
 * Misregistration of the three colour channels: green stays put, red and blue are pushed 1-3 px (at 1080p) in
 * roughly opposite directions. Fixed for a given video, like a print run where the drum is a hair off.
 */
export function registrationOffsets(unit: number, seed: number): Registration {
  const rand = mulberry32(seed ^ 0x51ed270b);
  const k = printScale(unit);
  const angle = rand() * Math.PI * 2;
  const push = (mag: number, a: number): Offset => ({ dx: Math.cos(a) * mag * k, dy: Math.sin(a) * mag * k });
  return {
    r: push(1.6 + rand() * 1.4, angle),
    g: { dx: 0, dy: 0 },
    b: push(1.2 + rand() * 1.2, angle + Math.PI * (0.8 + rand() * 0.4)),
  };
}

export type Speck = { x: number; y: number; r: number; kind: "dark" | "void" };

/** Dust flecks (dark) and ink-starved voids (paper showing through), fixed in place on the page. */
export function specks(seed: number, width: number, height: number): Specks {
  const rand = mulberry32(seed ^ 0x2545f491);
  const k = printScale(Math.min(width, height));
  const count = Math.round(clamp((width * height) / 9000, 30, 420));
  return Array.from({ length: count }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: (0.5 + Math.pow(rand(), 3) * 2.4) * k,
    kind: rand() < 0.45 ? "dark" : "void",
  }));
}

type Specks = Speck[];

/** Centre-to-centre distance of the dot screen, in px. */
export const dotPitch = (unit: number) => unit * 0.0075;
