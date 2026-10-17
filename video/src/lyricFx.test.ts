import { describe, expect, it } from "vitest";
import { dissolveStyle, inkStampOffset, inkStampScale } from "./lyricFx";

const radiusOf = (css: Record<string, string | number>) => Number(/#000 ([\d.]+)px/.exec(String(css.maskImage))![1]);

describe("inkStampOffset", () => {
  it("starts wide, settles close but never exactly on register", () => {
    const start = inkStampOffset(0, 50);
    const end = inkStampOffset(1, 50);
    expect(start.dx).toBeCloseTo(6, 6);
    expect(end.dx).toBeCloseTo(2, 6);
    expect(end.dx).toBeGreaterThan(0);
    expect(inkStampOffset(2, 50)).toEqual(end); // a spring overshooting past 1 is clamped
  });

  it("over-scales while landing", () => {
    expect(inkStampScale(0)).toBeCloseTo(1.15, 6);
    expect(inkStampScale(1)).toBe(1);
  });
});

describe("dissolveStyle", () => {
  it("shows the word untouched before it starts and hides it once done", () => {
    expect(dissolveStyle(0, 0, 7, 50)).toEqual({});
    expect(dissolveStyle(1, 3, 7, 50)).toEqual({ opacity: 0 });
  });

  it("the dots only ever shrink", () => {
    let prev = Infinity;
    for (let i = 0; i <= 100; i++) {
      const css = dissolveStyle(i / 100, 2, 99, 50);
      if (!css.maskImage) continue;
      const r = radiusOf(css);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
    expect(prev).toBeLessThan(0.75 * 50 * 0.14); // ended smaller than the full-cover radius
  });

  it("starts at full coverage so nothing pops when the dissolve begins", () => {
    const css = Array.from({ length: 200 }, (_, i) => dissolveStyle(i / 200, 0, 5, 50)).find((c) => c.maskImage)!;
    expect(radiusOf(css)).toBeGreaterThan(0.7 * 50 * 0.14);
  });

  it("is deterministic, staggers words differently, and sets both mask prefixes", () => {
    expect(dissolveStyle(0.5, 1, 42, 40)).toEqual(dissolveStyle(0.5, 1, 42, 40));
    const starts = [0, 1, 2, 3, 4].map((w) => Array.from({ length: 101 }, (_, i) => i / 100).find((p) => Object.keys(dissolveStyle(p, w, 42, 40)).length > 0));
    expect(new Set(starts).size).toBeGreaterThan(1);
    const css = dissolveStyle(0.5, 0, 42, 40);
    expect(css.maskImage).toBe(css.WebkitMaskImage);
  });
});
