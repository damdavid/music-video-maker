import type { StyleSection } from "../../shared/types";
import { mix } from "./color";
import { clamp } from "./timing";

export type GradeName = NonNullable<StyleSection["grade"]>;

/** A colour treatment as the CSS filter values it is made of, plus an optional tint laid over the picture. */
export type GradeParams = { saturate: number; contrast: number; brightness: number; sepia: number; hue: number; tint: string; tintAmount: number };

const NEUTRAL: GradeParams = { saturate: 1, contrast: 1, brightness: 1, sepia: 0, hue: 0, tint: "#808080", tintAmount: 0 };

export const GRADES: Record<GradeName, GradeParams> = {
  none: NEUTRAL,
  warm: { saturate: 1.1, contrast: 1.03, brightness: 1.02, sepia: 0.12, hue: -6, tint: "#ffb366", tintAmount: 0.12 },
  cool: { saturate: 0.94, contrast: 1.04, brightness: 0.99, sepia: 0, hue: 8, tint: "#4aa3ff", tintAmount: 0.13 },
  faded: { saturate: 0.62, contrast: 0.88, brightness: 1.06, sepia: 0.1, hue: 0, tint: "#d8d2c4", tintAmount: 0.14 },
  noir: { saturate: 0.12, contrast: 1.28, brightness: 0.92, sepia: 0, hue: 0, tint: "#202838", tintAmount: 0.1 },
  vivid: { saturate: 1.5, contrast: 1.1, brightness: 1.03, sepia: 0, hue: 0, tint: "#808080", tintAmount: 0 },
  dream: { saturate: 0.9, contrast: 0.92, brightness: 1.08, sepia: 0, hue: 10, tint: "#ffc8ff", tintAmount: 0.15 },
};

/**
 * One grade moving into another (k = 0..1), as its change from neutral scaled by `strength`, so the music can turn a
 * treatment up or down without the neutral point drifting.
 */
export function blendGrades(from: GradeName, to: GradeName, k: number, strength = 1): GradeParams {
  const a = GRADES[from];
  const b = GRADES[to];
  const p = clamp(k);
  const lerp = (x: number, y: number) => x + (y - x) * p;
  const scaled = (key: "saturate" | "contrast" | "brightness" | "sepia" | "hue") => {
    const v = lerp(a[key], b[key]);
    return NEUTRAL[key] + (v - NEUTRAL[key]) * strength;
  };
  const tintAmount = Math.min(0.4, lerp(a.tintAmount, b.tintAmount) * strength);
  return {
    saturate: Math.max(0, scaled("saturate")),
    contrast: Math.max(0.3, scaled("contrast")),
    brightness: Math.max(0.3, scaled("brightness")),
    sepia: clamp(scaled("sepia")),
    hue: scaled("hue"),
    tint: a.tintAmount === 0 ? b.tint : b.tintAmount === 0 ? a.tint : mix(a.tint, b.tint, p),
    tintAmount,
  };
}

/** The CSS filter for a grade, or undefined when it changes nothing. */
export function gradeFilter(g: GradeParams): string | undefined {
  const parts = [
    Math.abs(g.saturate - 1) > 0.005 && `saturate(${g.saturate.toFixed(3)})`,
    Math.abs(g.contrast - 1) > 0.005 && `contrast(${g.contrast.toFixed(3)})`,
    Math.abs(g.brightness - 1) > 0.005 && `brightness(${g.brightness.toFixed(3)})`,
    g.sepia > 0.005 && `sepia(${g.sepia.toFixed(3)})`,
    Math.abs(g.hue) > 0.05 && `hue-rotate(${g.hue.toFixed(1)}deg)`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/** How hard the music pushes a grade: a little stronger in loud passages, softer in quiet ones (0.8 to 1.15). */
export const gradeStrength = (energy: number) => 0.8 + 0.35 * clamp(energy);
