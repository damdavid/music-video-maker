import { describe, expect, it } from "vitest";
import { crowdAction, crowdSize, MAX_CROWD } from "./crowd";

describe("crowdSize", () => {
  it("uses the number the storyboard gave, including none on purpose", () => {
    expect(crowdSize(0, 1, "dance", true)).toBe(0);
    expect(crowdSize(5, 0.1, "idle", false)).toBe(5);
    expect(crowdSize(40, 0.5, "idle", true)).toBe(MAX_CROWD);
  });

  it("adds a few in intense sections and more as they get more intense", () => {
    expect(crowdSize(null, 0.3, "dance", true)).toBe(0);
    const a = crowdSize(null, 0.6, "dance", true);
    const b = crowdSize(null, 1, "dance", true);
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(MAX_CROWD);
  });

  it("adds none when crowds are off or the lead is alone on purpose", () => {
    expect(crowdSize(null, 1, "dance", false)).toBe(0);
    for (const action of ["sit", "slump", "look_up"] as const) expect(crowdSize(null, 1, action, true)).toBe(0);
  });
});

describe("crowdAction", () => {
  it("is calm in calm sections and lively in intense ones", () => {
    for (const pick of [0, 0.5, 0.99]) expect(["idle", "walk"]).toContain(crowdAction(0.2, pick, pick > 0.5));
    const lively = new Set([0, 0.2, 0.5, 0.75, 0.95].map((p) => crowdAction(0.95, p, false)));
    expect(lively.has("jump")).toBe(true);
    expect(lively.size).toBeGreaterThan(1);
  });

  it("lets only those who were walking keep walking in a mid section", () => {
    expect(crowdAction(0.5, 0.9, true)).toBe("walk");
    expect(crowdAction(0.5, 0.9, false)).toBe("idle");
  });
});
