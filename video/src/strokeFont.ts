import { SCRIPTS } from "./strokeData";
import { clamp } from "./timing";

type Point = [number, number];
export type Stroke = { points: Point[]; length: number; /** Pen travelled before this stroke starts, over the whole text. */ start: number };
export type StrokeText = { strokes: Stroke[]; width: number; total: number };

/** The font box: glyph y runs from about -4 (tall ascenders) to 33 (descenders); caps stand 21 units tall from y=1 to y=22. */
export const BOX = { top: -4, height: 37, capHeight: 21 };
const SPACE = 10;
const FONT = SCRIPTS;

/** True when every character can be drawn (printable ASCII); anything else should be set in the normal font instead. */
export const canWrite = (text: string) => text.length > 0 && [...text].every((c) => c === " " || c in FONT);

const parseGlyph = (d: string): Point[][] =>
  d
    .split("M")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .replace("L", " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((pair) => pair.split(",").map(Number) as Point),
    );

const strokeLength = (pts: Point[]) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** Lays text out left to right as pen strokes, in glyph units. Characters it can't draw are skipped (check `canWrite` first). */
export function layoutStrokes(text: string): StrokeText {
  const strokes: Stroke[] = [];
  let x = 0;
  let total = 0;
  for (const c of text) {
    const glyph = FONT[c];
    if (!glyph) {
      x += SPACE;
      continue;
    }
    for (const pts of parseGlyph(glyph[1])) {
      const moved = pts.map(([px, py]) => [px + x, py] as Point);
      const length = strokeLength(moved);
      strokes.push({ points: moved, length, start: total });
      total += length;
    }
    x += glyph[0];
  }
  return { strokes, width: Math.max(x, 1), total };
}

/** How much of each stroke is drawn when the pen has done `progress` (0..1) of the whole text, in order. */
export function strokeFractions(text: StrokeText, progress: number): number[] {
  const done = clamp(progress) * text.total;
  return text.strokes.map((s) => (s.length <= 0 ? (done > s.start ? 1 : 0) : clamp((done - s.start) / s.length)));
}

export const strokePath = (s: Stroke) => "M" + s.points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
