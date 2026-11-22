import { describe, expect, it } from "vitest";
import { easeAnticipate, easeInOutCubic, easeInOutSine, easeInQuad, easeOutBack, easeOutCubic } from "./easing";

const all = { easeOutCubic, easeInOutCubic, easeInOutSine, easeInQuad, easeOutBack, easeAnticipate };

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

  it("easeAnticipate backs away from the target first, then overshoots it and settles", () => {
    const v = Array.from({ length: 201 }, (_, i) => easeAnticipate(i / 200));
    const low = Math.min(...v);
    const high = Math.max(...v);
    expect(low).toBeLessThan(-0.05);
    expect(low).toBeGreaterThan(-0.25);
    expect(high).toBeGreaterThan(1.03);
    expect(high).toBeLessThan(1.25);
    expect(v.indexOf(low)).toBeLessThan(v.indexOf(high)); // wind-up before follow-through
    expect(easeAnticipate(1)).toBe(1);
  });

  it("easeAnticipate can be made subtler", () => {
    const high = (fn: (x: number) => number) => Math.max(...Array.from({ length: 201 }, (_, i) => fn(i / 200)));
    expect(high((x) => easeAnticipate(x, 0.05, 0.8))).toBeLessThan(high((x) => easeAnticipate(x)));
  });
});
