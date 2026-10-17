import { describe, expect, it } from "vitest";
import type { Action } from "../../../shared/types";
import { beatPhase } from "../timing";
import { groundSpeed, poseFor, type ActionCtx } from "./actions";
import { layout, SEG } from "./rig";

const ACTIONS: Action[] = ["idle", "walk", "run", "sit", "wave", "look_up", "reach", "dance", "jump", "slump"];
// 120 BPM: a beat every 0.5 s.
const ctx = (t: number, energy = 0.5): ActionCtx => ({ t, beat: t / 0.5, beatLen: 0.5, energy, seed: 7, variant: 0 });
const times = Array.from({ length: 80 }, (_, i) => i * 0.083);

describe("rig layout", () => {
  it("stands upright with the head top just under 1 figure-height", () => {
    const j = layout(poseFor("idle", ctx(0)));
    const top = -j.head.y + SEG.headR;
    expect(top).toBeGreaterThan(0.88);
    expect(top).toBeLessThan(1.0);
  });

  it("keeps the lowest foot on the ground for every action, except while airborne", () => {
    for (const action of ACTIONS) {
      for (const t of times) {
        const p = poseFor(action, ctx(t));
        const j = layout(p);
        const lowestAnkle = Math.max(j.ankleL.y, j.ankleR.y);
        // Ankle height above ground equals the pose's own vertical offset (0 unless jumping/bouncing).
        expect(lowestAnkle).toBeCloseTo(p.y, 6);
        if (action !== "jump" && action !== "dance" && action !== "walk" && action !== "run") expect(p.y).toBe(0);
      }
    }
  });

  it("produces finite, sane joint positions for every action over time", () => {
    for (const action of ACTIONS)
      for (const t of times) {
        const j = layout(poseFor(action, ctx(t)));
        for (const pt of Object.values(j)) {
          if (typeof pt === "number") continue;
          expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
          expect(Math.abs(pt.x)).toBeLessThan(1.2); // nothing flies far from the body
          expect(pt.y).toBeGreaterThan(-1.3);
          expect(pt.y).toBeLessThan(0.05); // nothing below the ground
        }
      }
  });
});

describe("actions", () => {
  it("walk repeats every 1.1s, the feet taking turns: one planted while the other swings clear", () => {
    const a = poseFor("walk", ctx(0.37));
    const b = poseFor("walk", ctx(0.37 + 1.1));
    expect(a.legR[0]).toBeCloseTo(b.legR[0], 6);
    expect(a.armL[0]).toBeCloseTo(b.armL[0], 6);
    for (const t of times) {
      const p = poseFor("walk", ctx(t));
      const j = layout(p);
      expect(p.armL[0]).toBeCloseTo(-p.armR[0], 6); // the arms swing against each other
      expect(Math.min(j.ankleL.y, j.ankleR.y)).toBeLessThanOrEqual(Math.max(j.ankleL.y, j.ankleR.y)); // one foot carries the weight
    }
    // Mid-swing the moving foot is clearly off the ground.
    const mid = layout(poseFor("walk", ctx(1.1 * 0.75)));
    expect(Math.abs(mid.ankleL.y - mid.ankleR.y)).toBeGreaterThan(0.03);
  });

  it("run is faster and wider than walk", () => {
    const peak = (a: Action) => Math.max(...times.map((t) => Math.abs(poseFor(a, ctx(t)).legR[0])));
    expect(peak("run")).toBeGreaterThan(peak("walk") * 1.3);
    expect(groundSpeed("run")).toBeGreaterThan(groundSpeed("walk"));
    expect(groundSpeed("idle")).toBe(0);
  });

  it.each(["walk", "run"] as const)("%s: the planted foot moves back at the ground speed, so a world scrolled at it doesn't slide", (action) => {
    const dt = 1 / 240;
    let travelled = 0;
    let time = 0;
    for (let t = 0; t < 2.2; t += dt) {
      const a = layout(poseFor(action, ctx(t)));
      const b = layout(poseFor(action, ctx(t + dt)));
      // Only while the same foot stays planted.
      const plantedNow = a.ankleL.y > a.ankleR.y ? "L" : "R";
      const plantedNext = b.ankleL.y > b.ankleR.y ? "L" : "R";
      if (plantedNow !== plantedNext) continue;
      const k = plantedNow === "L" ? "ankleL" : "ankleR";
      travelled += a[k].x - a.hip.x - (b[k].x - b.hip.x);
      time += dt;
    }
    expect(travelled / time).toBeCloseTo(groundSpeed(action), 2);
  });

  it.each(ACTIONS)("%s moves continuously: no limb jumps between frames", (action) => {
    const dt = 1 / 120;
    const angles = (t: number) => {
      const p = poseFor(action, ctx(t, 0.8));
      return [p.lean, p.head, ...p.armL, ...p.armR, ...p.legL, ...p.legR, (p.hair ?? 0) / 2, (p.stretch ?? 1) * 100];
    };
    let prev = angles(0);
    for (let t = dt; t < 8; t += dt) {
      const cur = angles(t);
      for (let k = 0; k < cur.length; k++) expect(Math.abs(cur[k] - prev[k])).toBeLessThan(25);
      prev = cur;
    }
  });

  it("sit puts the hips at bench height (thighs level)", () => {
    const hipHeight = -layout(poseFor("sit", ctx(0))).hip.y;
    expect(hipHeight).toBeGreaterThan(0.2);
    expect(hipHeight).toBeLessThan(0.33);
    expect(-layout(poseFor("idle", ctx(0))).hip.y).toBeGreaterThan(0.44); // standing hips are far higher
  });

  it("jump leaves the ground and touches down on every other beat, crouching before take-off", () => {
    const ys = times.map((t) => poseFor("jump", ctx(t)).y);
    expect(Math.min(...ys)).toBeLessThan(-0.15);
    expect(Math.max(...ys)).toBeCloseTo(0, 1);
    for (const beat of [0, 2, 4]) expect(poseFor("jump", ctx(beat * 0.5)).y).toBeCloseTo(0, 6);
    expect(poseFor("jump", ctx(1.5 * 0.5)).y).toBeLessThan(-0.1); // mid-air between them
    // The anticipation: knees deeply bent and the body squashed shortly before leaving the ground.
    const crouch = poseFor("jump", ctx(0.25 * 2 * 0.5));
    expect(crouch.legR[1]).toBeLessThan(-60);
    expect(crouch.stretch).toBeLessThan(0.97);
  });

  it("dance sinks on every beat and rises between beats, whichever move it is doing", () => {
    for (let beat = 0; beat < 16; beat++) {
      expect(poseFor("dance", ctx(beat * 0.5, 0)).y).toBeCloseTo(0, 6);
      expect(poseFor("dance", ctx((beat + 0.5) * 0.5, 0)).y).toBeLessThan(-0.015);
    }
  });

  it("dance follows the detected beats, not a fixed tempo", () => {
    const beats = [0, 0.5, 1.2, 1.6];
    const at = (t: number): ActionCtx => ({ ...ctx(t, 0), beat: beatPhase(beats, t, 120) });
    for (const b of beats) expect(poseFor("dance", at(b)).y).toBeCloseTo(0, 6);
    expect(poseFor("dance", at(0.85)).y).toBeLessThan(-0.015); // halfway between the irregular beats
  });

  it("dance changes moves from bar to bar, and figures with different variants move differently", () => {
    const armsAt = (variant: number, beat: number) => poseFor("dance", { ...ctx(beat * 0.5), variant }).armR[0];
    const bars = Array.from({ length: 8 }, (_, bar) => armsAt(0, bar * 4 + 1.5).toFixed(1));
    expect(new Set(bars).size).toBeGreaterThan(1);
    expect(Array.from({ length: 8 }, (_, bar) => armsAt(1, bar * 4 + 1.5).toFixed(1))).not.toEqual(bars);
  });

  it("long hair trails behind: it swings back while running", () => {
    const hair = times.map((t) => poseFor("run", ctx(t)).hair ?? 0);
    expect(hair.reduce((a, b) => a + b, 0) / hair.length).toBeGreaterThan(5);
    for (const h of hair) expect(h).toBeGreaterThanOrEqual(-10);
  });

  it("wave raises one arm above the shoulder; slump drops the head", () => {
    const w = layout(poseFor("wave", ctx(0.2)));
    expect(w.handR.y).toBeLessThan(w.shoulder.y);
    expect(poseFor("slump", ctx(0)).head).toBeGreaterThan(20);
    expect(poseFor("look_up", ctx(0)).head).toBeLessThan(-10);
  });
});
