import { describe, expect, it } from "vitest";
import { ENTER_S, poseFor, poseWithEntrance } from "./actions";

const ctx = { t: 1, beat: 2.25, beatLen: 0.5, energy: 0.6, seed: 3, variant: 0 };

describe("poseWithEntrance", () => {
  it("starts standing, ends on the action, and settles exactly on it", () => {
    expect(poseWithEntrance("wave", ctx, 0)).toEqual(poseFor("idle", ctx));
    expect(poseWithEntrance("wave", ctx, ENTER_S)).toEqual(poseFor("wave", ctx));
  });

  it("winds up away from the action before moving into it, then overshoots", () => {
    const idle = poseFor("idle", ctx);
    const wave = poseFor("wave", ctx);
    const along = (since: number) => (poseWithEntrance("wave", ctx, since).armR[0] - idle.armR[0]) / (wave.armR[0] - idle.armR[0]);
    const k = Array.from({ length: 71 }, (_, i) => along((i / 70) * ENTER_S));
    expect(Math.min(...k)).toBeLessThan(-0.03);
    expect(Math.max(...k)).toBeGreaterThan(1.03);
  });

  it("stays finite for every action", () => {
    for (const action of ["idle", "walk", "run", "sit", "wave", "look_up", "reach", "dance", "jump", "slump", "point", "lean", "cross_arms", "cheer"] as const)
      for (let i = 0; i <= 20; i++) {
        const p = poseWithEntrance(action, ctx, (i / 20) * ENTER_S);
        expect(Object.values(p).flat().every((v) => Number.isFinite(v))).toBe(true);
        expect(p.stretch ?? 1).toBeGreaterThan(0.7);
      }
  });
});
