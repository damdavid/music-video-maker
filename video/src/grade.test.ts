import { describe, expect, it } from "vitest";
import { blendGrades, GRADES, gradeFilter, gradeStrength, type GradeName } from "./grade";

const names = Object.keys(GRADES) as GradeName[];

describe("blendGrades", () => {
  it("none changes nothing", () => {
    const g = blendGrades("none", "none", 0.5);
    expect(gradeFilter(g)).toBeUndefined();
    expect(g.tintAmount).toBe(0);
  });

  it("starts at one grade and ends at the other", () => {
    const start = blendGrades("warm", "noir", 0);
    const end = blendGrades("warm", "noir", 1);
    expect(start.saturate).toBeCloseTo(GRADES.warm.saturate);
    expect(end.saturate).toBeCloseTo(GRADES.noir.saturate);
    expect(end.contrast).toBeCloseTo(GRADES.noir.contrast);
  });

  it("fades a treatment in from none without a flash of the wrong tint", () => {
    const mid = blendGrades("none", "warm", 0.5);
    expect(mid.tint).toBe(GRADES.warm.tint);
    expect(mid.tintAmount).toBeCloseTo(GRADES.warm.tintAmount / 2);
  });

  it("is turned up or down by the strength, around neutral", () => {
    const soft = blendGrades("none", "vivid", 1, 0.8);
    const hard = blendGrades("none", "vivid", 1, 1.15);
    expect(soft.saturate).toBeLessThan(hard.saturate);
    expect(blendGrades("none", "vivid", 1, 0).saturate).toBe(1);
  });

  it("stays in a range a filter accepts for every pair and strength", () => {
    for (const a of names)
      for (const b of names)
        for (const k of [0, 0.3, 1])
          for (const s of [0.8, 1.15]) {
            const g = blendGrades(a, b, k, s);
            expect(g.saturate).toBeGreaterThanOrEqual(0);
            expect(g.contrast).toBeGreaterThan(0);
            expect(g.brightness).toBeGreaterThan(0);
            expect(g.sepia).toBeLessThanOrEqual(1);
            expect(g.tintAmount).toBeLessThanOrEqual(0.4);
            expect(g.tint).toMatch(/^#[0-9a-f]{6}$/i);
          }
  });
});

describe("gradeFilter and gradeStrength", () => {
  it("writes only the parts that change", () => {
    const f = gradeFilter(blendGrades("none", "noir", 1))!;
    expect(f).toContain("saturate(");
    expect(f).toContain("contrast(");
    expect(f).not.toContain("hue-rotate");
  });

  it("is stronger when louder", () => {
    expect(gradeStrength(0)).toBeCloseTo(0.8);
    expect(gradeStrength(1)).toBeCloseTo(1.15);
  });
});
