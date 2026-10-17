import { clamp } from "./timing";

type HSL = { h: number; s: number; l: number };

export function hexToHsl(hex: string): HSL {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: HSL): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const hsl = ({ h, s, l }: HSL, alpha = 1) => `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${alpha})`;

export const withAlpha = (hex: string, alpha: number) => hsl(hexToHsl(hex), alpha);

const MAX_HUE_SHIFT = 40;

/** palette_shift -1 (cooler) .. 1 (warmer): rotates hue toward blue or toward orange/red. */
export function shiftPalette(palette: string[], shift: number): string[] {
  const s = clamp(shift, -1, 1);
  return palette.map((hex) => {
    const c = hexToHsl(hex);
    if (c.s < 4) return hex;
    // Warm = toward 30deg, cool = toward 220deg, along the shorter arc.
    const target = s >= 0 ? 30 : 220;
    let diff = ((target - c.h + 540) % 360) - 180;
    diff = Math.sign(diff) * Math.min(Math.abs(diff), MAX_HUE_SHIFT * Math.abs(s));
    // Hex, not hsla(): presets feed these back through withAlpha, which parses hex.
    return hslToHex({ ...c, h: (c.h + diff + 360) % 360 });
  });
}

export const background = (palette: string[]) => palette[0];
export const foreground = (palette: string[]) => palette[palette.length - 1];
/** Accent colors are everything between the darkest and lightest swatch. */
export const accent = (palette: string[], i: number) => {
  const accents = palette.length > 2 ? palette.slice(1, -1) : palette.slice(-1);
  return accents[((i % accents.length) + accents.length) % accents.length];
};

/** The lightest accent (excluding the background/foreground swatches): the best-contrast highlight on a dark scene. */
export function brightestAccent(palette: string[]): string {
  const accents = palette.length > 2 ? palette.slice(1, -1) : palette.slice(-1);
  return accents.reduce((best, c) => (hexToHsl(c).l > hexToHsl(best).l ? c : best), accents[0]);
}

const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

/** Linear blend of two hex colors; t=0 gives `a`, t=1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  const k = Math.min(1, Math.max(0, t));
  const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The palette's valid colours, or `fallback` when fewer than two remain (one colour can't separate text from background). */
export function safePalette(palette: string[] | null | undefined, fallback: string[]): string[] {
  const ok = (palette ?? []).filter((c) => HEX.test(c));
  return ok.length >= 2 ? ok : fallback;
}

/** `palette` resampled to `n` swatches, keeping darkest first and lightest last. */
const resample = (palette: string[], n: number) =>
  Array.from({ length: n }, (_, i) => {
    const pos = n === 1 ? 0 : (i / (n - 1)) * (palette.length - 1);
    const lo = Math.floor(pos);
    return mix(palette[lo], palette[Math.min(lo + 1, palette.length - 1)], pos - lo);
  });

/** Blend between two palettes (t=0 gives `a`, t=1 gives `b`); palettes of different lengths are matched by position. */
export function mixPalettes(a: string[], b: string[], t: number): string[] {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const n = Math.max(a.length, b.length);
  const ra = a.length === n ? a : resample(a, n);
  const rb = b.length === n ? b : resample(b, n);
  return ra.map((c, i) => mix(c, rb[i], t));
}
