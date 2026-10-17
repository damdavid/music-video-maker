import { describe, expect, it } from "vitest";
import { canWrite, layoutStrokes, strokeFractions, strokePath } from "./strokeFont";

describe("canWrite", () => {
  it("accepts printable ASCII and spaces, rejects anything else", () => {
    expect(canWrite("Hold the light, in 2 hands!")).toBe(true);
    expect(canWrite("")).toBe(false);
    expect(canWrite("café")).toBe(false);
    expect(canWrite("日本")).toBe(false);
  });
});

describe("layoutStrokes", () => {
  it("lays glyphs left to right with pen strokes that start at increasing distances", () => {
    const t = layoutStrokes("Hi");
    expect(t.strokes.length).toBeGreaterThan(2);
    expect(t.width).toBeGreaterThan(10);
    let prev = -1;
    for (const s of t.strokes) {
      expect(s.start).toBeGreaterThanOrEqual(prev);
      expect(s.length).toBeGreaterThan(0);
      prev = s.start;
    }
    const last = t.strokes[t.strokes.length - 1];
    expect(last.start + last.length).toBeCloseTo(t.total, 6);
  });

  it("a longer string is wider and a space adds room", () => {
    expect(layoutStrokes("ab").width).toBeGreaterThan(layoutStrokes("a").width);
    expect(layoutStrokes("a b").width).toBeGreaterThan(layoutStrokes("ab").width);
  });

  it("stays inside the font box vertically for every printable character", () => {
    const all = String.fromCharCode(...Array.from({ length: 94 }, (_, i) => 33 + i));
    for (const s of layoutStrokes(all).strokes) for (const [, y] of s.points) expect(y).toBeGreaterThan(-8), expect(y).toBeLessThan(40);
  });

  it("makes a path with one move per stroke", () => {
    const t = layoutStrokes("i");
    for (const s of t.strokes) expect(strokePath(s)).toMatch(/^M[\d. -]+( L[\d. -]+)*$/);
  });
});

describe("strokeFractions", () => {
  it("writes nothing at 0, everything at 1, and strokes in order in between", () => {
    const t = layoutStrokes("Hold");
    expect(strokeFractions(t, 0).every((f) => f === 0)).toBe(true);
    expect(strokeFractions(t, 1).every((f) => f === 1)).toBe(true);
    const mid = strokeFractions(t, 0.5);
    const started = mid.findIndex((f) => f < 1);
    expect(started).toBeGreaterThan(0);
    expect(mid.slice(started + 1).every((f) => f === 0)).toBe(true); // only one stroke is mid-draw; the rest wait
  });

  it("clamps its input", () => {
    const t = layoutStrokes("a");
    expect(strokeFractions(t, -1)).toEqual(strokeFractions(t, 0));
    expect(strokeFractions(t, 9)).toEqual(strokeFractions(t, 1));
  });
});
