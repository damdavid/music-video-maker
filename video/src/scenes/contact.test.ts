import { describe, expect, it } from "vitest";
import { poseFor } from "./actions";
import { contactPoses, type Body } from "./contact";
import { CONTACT_GAP, facings, pairings } from "./layout";
import { resolveScene, type ContactKind } from "./normalize";
import { layout } from "./rig";

const KINDS: ContactKind[] = ["hug", "hold_hands", "high_five", "arm_around"];
const scene = (kind: ContactKind, over: { facing?: "left" | "right"; placement?: "left" | "center" | "right" } = {}) =>
  resolveScene({ section_ref: 0, setting: "road", characters: [{ character_id: "a", contact: { partner: "b", kind }, placement: over.placement ?? "center", facing: over.facing ?? "right" }, { character_id: "b", placement: "left" }] });

const SIZE = 400;
const bodiesFor = (kind: ContactKind, facing: "left" | "right" = "right") => {
  const s = scene(kind, { facing });
  const pairs = pairings(s);
  const ctx = (i: number) => ({ t: 1.5 + i, beat: 2.3, beatLen: 0.5, energy: 0.5, seed: 3, variant: i });
  const bodies: Body[] = [0, 1].map((i) => ({ pose: poseFor("idle", ctx(i)), x: 800 + pairs[i]!.dx * SIZE, y: 600, size: SIZE, flip: pairs[i]!.facing === "left" ? -1 : 1 }));
  return { pairs, bodies, poses: contactPoses(pairs, bodies) };
};
const world = (b: Body, pose: Body["pose"], joint: "handL" | "handR") => {
  const p = layout(pose)[joint];
  return { x: b.x + b.flip * b.size * p.x, y: b.y + b.size * p.y };
};

describe("pairings", () => {
  it("stands a hug or a high five face to face, the first figure on the left", () => {
    for (const kind of ["hug", "high_five"] as const) {
      const [a, b] = pairings(scene(kind));
      expect(a).toMatchObject({ role: "a", partner: 1, facing: "right" });
      expect(b).toMatchObject({ role: "b", partner: 0, facing: "left" });
      expect(b!.dx - a!.dx).toBeCloseTo(CONTACT_GAP[kind]);
      expect(a!.x).toBe(b!.x);
    }
  });

  it("stands holding hands or an arm round the shoulder side by side, the first figure ahead", () => {
    for (const kind of ["hold_hands", "arm_around"] as const)
      for (const facing of ["right", "left"] as const) {
        const [a, b] = pairings(scene(kind, { facing }));
        expect(a!.facing).toBe(facing);
        expect(b!.facing).toBe(facing);
        expect((a!.dx - b!.dx) * (facing === "right" ? 1 : -1)).toBeCloseTo(CONTACT_GAP[kind]);
      }
  });

  it("ignores a partner who is not in the scene, and gives each character one pair", () => {
    const lone = resolveScene({ section_ref: 0, setting: "road", characters: [{ character_id: "a", contact: { partner: "ghost", kind: "hug" } }] });
    expect(pairings(lone)).toEqual([null]);
    const three = resolveScene({ section_ref: 0, setting: "road", characters: [{ character_id: "a", contact: { partner: "b", kind: "hug" } }, { character_id: "b" }, { character_id: "c", contact: { partner: "b", kind: "hold_hands" } }] });
    expect(pairings(three).map((p) => p?.kind ?? null)).toEqual(["hug", "hug", null]);
  });

  it("turns the pair to the way they stand, over looking at someone else", () => {
    expect(facings(scene("hug"))).toEqual(["right", "left"]);
    expect(facings(scene("hold_hands", { facing: "left" }))).toEqual(["left", "left"]);
  });
});

describe("contactPoses", () => {
  it("brings the hands together for holding hands and a high five", () => {
    for (const kind of ["hold_hands", "high_five"] as const) {
      const { pairs, bodies, poses } = bodiesFor(kind);
      const a = world(bodies[0], poses[0], kind === "hold_hands" ? "handL" : "handR");
      const b = world(bodies[1], poses[1], "handR");
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.02 * SIZE);
      expect(pairs[0]!.kind).toBe(kind);
    }
  });

  it("puts a hand on the other's back in a hug, and on the shoulder in an arm round", () => {
    const hug = bodiesFor("hug");
    const aHand = world(hug.bodies[0], hug.poses[0], "handR");
    const bShoulder = layout(hug.poses[1]).shoulder;
    const bWorld = { x: hug.bodies[1].x + hug.bodies[1].flip * SIZE * bShoulder.x, y: 600 + SIZE * bShoulder.y };
    expect(Math.abs(aHand.x - bWorld.x)).toBeLessThan(0.14 * SIZE); // beside the other's back
    expect(Math.abs(aHand.y - bWorld.y)).toBeLessThan(0.2 * SIZE);

    const arm = bodiesFor("arm_around");
    const hand = world(arm.bodies[1], arm.poses[1], "handR");
    const shoulder = layout(arm.poses[0]).shoulder;
    const target = { x: arm.bodies[0].x + arm.bodies[0].flip * SIZE * shoulder.x, y: 600 + SIZE * shoulder.y };
    expect(Math.hypot(hand.x - target.x, hand.y - target.y)).toBeLessThan(0.1 * SIZE);
  });

  it("leans the pair toward each other, leaves everyone else alone, and stays finite", () => {
    for (const kind of KINDS)
      for (const facing of ["right", "left"] as const) {
        const { bodies, poses } = bodiesFor(kind, facing);
        poses.forEach((p) => expect(Object.values(p).flat().every((v) => v === undefined || Number.isFinite(v))).toBe(true));
        if (kind === "hug") expect(poses[0].lean).toBeGreaterThan(bodies[0].pose.lean);
      }
    const idle = poseFor("idle", { t: 1, beat: 0, beatLen: 0.5, energy: 0.5, seed: 1, variant: 0 });
    const body: Body = { pose: idle, x: 100, y: 600, size: SIZE, flip: 1 };
    expect(contactPoses([null], [body])[0]).toEqual(idle);
  });
});
