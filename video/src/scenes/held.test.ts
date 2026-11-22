import { describe, expect, it } from "vitest";
import { poseFor } from "./actions";
import { holdPose, TWO_HANDED } from "./held";
import { facings } from "./layout";
import { layout } from "./rig";
import { resolveScene, type HeldKind } from "./normalize";

const ctx = { t: 1, beat: 2.25, beatLen: 0.5, energy: 0.6, seed: 3, variant: 0 };
const KINDS: HeldKind[] = ["umbrella", "suitcase", "microphone", "flowers", "lantern", "book", "guitar", "phone", "flag", "balloon", "cup"];

describe("holdPose", () => {
  it("changes only the arms that hold the item", () => {
    const base = poseFor("idle", ctx);
    for (const kind of KINDS) {
      const held = holdPose(base, kind, { t: 1, beat: 2.25, energy: 0.6 });
      expect(held.armR).not.toEqual(base.armR);
      expect({ ...held, armR: base.armR, armL: base.armL }).toEqual(base);
      if (!TWO_HANDED.includes(kind)) expect(held.armL).toEqual(base.armL);
    }
  });

  it("holds a guitar with both hands, and strums on the beat", () => {
    const base = poseFor("idle", ctx);
    const a = holdPose(base, "guitar", { t: 1, beat: 2.25, energy: 0.6 });
    const b = holdPose(base, "guitar", { t: 1, beat: 2.75, energy: 0.6 });
    expect(a.armL).not.toEqual(base.armL);
    expect(a.armR).not.toEqual(b.armR);
  });

  it("brings the hand up to the mouth for a microphone and lets an umbrella arm hang low", () => {
    const base = poseFor("idle", ctx);
    const handY = (kind: HeldKind) => layout(holdPose(base, kind, { t: 1, beat: 0, energy: 0.5 })).handR.y;
    expect(handY("microphone")).toBeLessThan(handY("umbrella"));
    expect(handY("suitcase")).toBeGreaterThan(handY("book"));
  });

  it("keeps every grip's joints finite while the action moves", () => {
    for (const action of ["walk", "run", "dance", "wave", "sit", "jump"] as const)
      for (const kind of KINDS)
        for (let i = 0; i < 40; i++) {
          const t = i / 10;
          const p = holdPose(poseFor(action, { ...ctx, t, beat: t * 2 }), kind, { t, beat: t * 2, energy: 0.7 });
          for (const pt of Object.values(layout(p))) if (typeof pt !== "number") expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
  });
});

describe("facings", () => {
  const scene = (characters: object[]) => resolveScene({ section_ref: 0, setting: "road", characters } as never);

  it("turns a character toward the one they look at, and leaves the rest alone", () => {
    const s = scene([
      { character_id: "a", placement: "left", facing: "right", looks_at: "b" },
      { character_id: "b", placement: "right", facing: "right", looks_at: "a" },
      { character_id: "c", placement: "center", facing: "left" },
    ]);
    expect(facings(s)).toEqual(["right", "left", "left"]);
  });

  it("ignores a gaze at the camera, at nobody in the scene, or at someone standing in the same spot", () => {
    const s = scene([
      { character_id: "a", placement: "left", facing: "left", looks_at: "camera" },
      { character_id: "b", placement: "center", facing: "right", looks_at: "ghost" },
      { character_id: "c", placement: "center", facing: "left", looks_at: "b" },
    ]);
    expect(facings(s)).toEqual(["left", "right", "left"]);
  });
});
