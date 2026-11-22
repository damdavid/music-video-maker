import { describe, expect, it } from "vitest";
import { eyeLook } from "./gaze";

const base = { t: 1, seed: 5, variant: 0, action: "idle" as const, camera: false, y: 0 };

describe("eyeLook", () => {
  it("stays in range for every action and time", () => {
    for (const action of ["idle", "walk", "sit", "slump", "look_up", "reach", "point", "cheer"] as const)
      for (let t = 0; t < 30; t += 0.7) {
        const l = eyeLook({ ...base, action, t });
        expect(Math.abs(l.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(l.y)).toBeLessThanOrEqual(1);
      }
  });

  it("looks down when sitting or slumped and up when looking up", () => {
    const mean = (action: "sit" | "look_up" | "idle") => Array.from({ length: 40 }, (_, i) => eyeLook({ ...base, action, t: i * 0.9 }).y).reduce((a, b) => a + b) / 40;
    expect(mean("sit")).toBeGreaterThan(mean("idle"));
    expect(mean("look_up")).toBeLessThan(mean("idle"));
  });

  it("holds still, level and straight on, when looking at the viewer", () => {
    for (let t = 0; t < 10; t++) {
      const l = eyeLook({ ...base, camera: true, t });
      expect(Math.abs(l.x)).toBeLessThan(0.1);
      expect(Math.abs(l.y)).toBeLessThan(0.1);
    }
  });

  it("follows someone who jumps up and then comes down", () => {
    const at = (targetY: number) => eyeLook({ ...base, target: { y: targetY } });
    expect(at(-0.2).y).toBeLessThan(at(0).y);
    expect(at(0.1).y).toBeGreaterThan(at(0).y);
    expect(at(0).x).toBeGreaterThan(0.6);
  });
});
