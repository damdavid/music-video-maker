import { describe, expect, it } from "vitest";
import { activeRipples, lensRadius, rippleRadius, wobblyRing } from "./rippleMath";

const beats = [0.5, 1, 1.5, 2, 2.5, 3];

describe("activeRipples", () => {
  it("has one ring per beat still alive, oldest first, with progress through its life", () => {
    const r = activeRipples(beats, 2.2, 1, 1);
    expect(r.map((x) => x.index)).toEqual([2, 3]); // the beat at 1.0 is 1.2 s old, past its life; 1.5 and 2.0 are alive
    expect(r[1].age).toBeCloseTo(0.2, 6);
    expect(r[1].life).toBeCloseTo(0.2, 6);
    expect(r[0].life).toBeCloseTo(0.7, 6);
  });

  it("is empty before the first beat and after everything has faded", () => {
    expect(activeRipples(beats, 0.2, 1, 1)).toEqual([]);
    expect(activeRipples(beats, 9, 1, 1)).toEqual([]);
  });

  it("can skip beats", () => {
    expect(activeRipples(beats, 3.1, 2, 2).map((x) => x.index)).toEqual([2, 4]);
  });

  it("copes with no beats", () => {
    expect(activeRipples([], 1, 1, 1)).toEqual([]);
  });
});

describe("rippleRadius", () => {
  it("leaves the dot fast, slows at the edge, and reaches the maximum", () => {
    expect(rippleRadius(0, 500)).toBe(0);
    expect(rippleRadius(1, 500)).toBe(500);
    expect(rippleRadius(0.25, 500)).toBeGreaterThan(125);
  });
});

describe("wobblyRing", () => {
  it("is a closed path whose radius stays within a couple of percent of the circle", () => {
    const d = wobblyRing(100, 100, 50, 3, 7);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const pts = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Math.hypot(Number(m[1]) - 100, Number(m[2]) - 100));
    expect(pts.length).toBe(73);
    for (const r of pts) expect(Math.abs(r - 50)).toBeLessThan(1.1);
    expect(Math.max(...pts) - Math.min(...pts)).toBeGreaterThan(0.2); // not a perfect circle
  });

  it("is deterministic and differs between beats", () => {
    expect(wobblyRing(0, 0, 10, 1, 1)).toBe(wobblyRing(0, 0, 10, 1, 1));
    expect(wobblyRing(0, 0, 10, 1, 1)).not.toBe(wobblyRing(0, 0, 10, 1, 2));
  });
});

describe("lensRadius", () => {
  const down = [1, 3, 5, 7];
  it("tightens a step on each downbeat, easing into it", () => {
    const before = lensRadius(down, 0.5, 1000);
    const justAfter = lensRadius(down, 1.01, 1000);
    const settled = lensRadius(down, 1.5, 1000);
    expect(before).toBeCloseTo(190, 6);
    expect(settled).toBeCloseTo(176, 6);
    expect(justAfter).toBeLessThan(before);
    expect(justAfter).toBeGreaterThan(settled);
  });

  it("only ever shrinks within a cycle and opens back out after eight downbeats", () => {
    const many = Array.from({ length: 20 }, (_, i) => i + 1);
    const radii = [0.5, ...Array.from({ length: 7 }, (_, i) => i + 1.9)].map((t) => lensRadius(many, t, 1000));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]);
    expect(lensRadius(many, 8.9, 1000)).toBeCloseTo(radii[0], 6);
  });
});
