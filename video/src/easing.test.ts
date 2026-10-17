import { describe, expect, it } from "vitest";
import { easeInOutCubic, easeInOutSine, easeInQuad, easeOutBack, easeOutCubic } from "./easing";

const all = { easeOutCubic, easeInOutCubic, easeInOutSine, easeInQuad, easeOutBack };

describe("easing", () => {
  it.each(Object.entries(all))("%s starts at 0, ends at 1 and clamps its input", (_, fn) => {
    expect(fn(0)).toBeCloseTo(0, 6);
    expect(fn(1)).toBeCloseTo(1, 6);
    expect(fn(-3)).toBeCloseTo(0, 6);
    expect(fn(7)).toBeCloseTo(1, 6);
  });

  it("the non-overshooting curves never decrease", () => {
    for (const fn of [easeOutCubic, easeInOutCubic, easeInOutSine, easeInQuad]) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const v = fn(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it("easeOutCubic is fast early and easeInQuad is slow early", () => {
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25);
    expect(easeInQuad(0.25)).toBeLessThan(0.25);
  });

  it("easeOutBack overshoots 1 mid-way and settles on it", () => {
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.15);
    expect(easeOutBack(1)).toBe(1);
  });
});
