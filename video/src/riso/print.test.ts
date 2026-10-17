import { describe, expect, it } from "vitest";
import { registrationOffsets, specks } from "./print";

describe("registrationOffsets", () => {
  it("keeps green put and pushes red and blue 1-3 px at 1080p", () => {
    for (const seed of [1, 42, 999, 123456]) {
      const o = registrationOffsets(1080, seed);
      expect(o.g).toEqual({ dx: 0, dy: 0 });
      for (const c of [o.r, o.b]) {
        const mag = Math.hypot(c.dx, c.dy);
        expect(mag).toBeGreaterThanOrEqual(1);
        expect(mag).toBeLessThanOrEqual(3.05);
      }
    }
  });

  it("is fixed for a video, differs between videos, and scales with the frame", () => {
    expect(registrationOffsets(1080, 7)).toEqual(registrationOffsets(1080, 7));
    expect(registrationOffsets(1080, 7)).not.toEqual(registrationOffsets(1080, 8));
    const small = registrationOffsets(540, 7);
    const big = registrationOffsets(1080, 7);
    expect(Math.hypot(small.r.dx, small.r.dy) * 2).toBeCloseTo(Math.hypot(big.r.dx, big.r.dy), 6);
  });
});

describe("specks", () => {
  it("is deterministic, bounded, inside the frame, and mixes dark flecks with paper voids", () => {
    const a = specks(5, 1920, 1080);
    expect(specks(5, 1920, 1080)).toEqual(a);
    expect(a.length).toBeGreaterThanOrEqual(30);
    expect(a.length).toBeLessThanOrEqual(420);
    for (const s of a) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1920);
      expect(s.y).toBeLessThanOrEqual(1080);
      expect(s.r).toBeGreaterThan(0);
      expect(s.r).toBeLessThan(4);
    }
    expect(new Set(a.map((s) => s.kind))).toEqual(new Set(["dark", "void"]));
  });

  it("does not drown tiny frames or huge ones", () => {
    expect(specks(1, 100, 100).length).toBe(30);
    expect(specks(1, 8000, 8000).length).toBe(420);
  });
});
