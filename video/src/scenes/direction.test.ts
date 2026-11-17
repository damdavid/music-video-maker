import { describe, expect, it } from "vitest";
import type { Lyrics } from "../../../shared/types";
import { barsPerShot, framingFor, heldNote, holdFirstShot, MAX_ZOOM, planShots } from "./direction";

const downbeats = Array.from({ length: 20 }, (_, i) => 10 + i * 2);
const section = { start: 10, end: 50 };

describe("planShots", () => {
  it("cuts on downbeats, tiles the section, and keeps shots at least 1.5 s", () => {
    const shots = planShots(section, downbeats, 2, 1, "dance", 3, 0);
    expect(shots[0].start).toBe(10);
    expect(shots[shots.length - 1].end).toBe(50);
    shots.forEach((s, i) => {
      expect(s.end - s.start).toBeGreaterThanOrEqual(1.5);
      if (i > 0) expect(s.start).toBe(shots[i - 1].end);
      if (i > 0) expect(downbeats).toContain(s.start);
    });
  });

  it("cuts less often when each shot holds more bars", () => {
    const n = (bars: number) => planShots(section, downbeats, 2, bars, "dance", 3, 0).length;
    expect(n(1)).toBeGreaterThan(n(2));
    expect(n(2)).toBeGreaterThan(n(4));
    expect(barsPerShot(0.9)).toBe(1);
    expect(barsPerShot(0.5)).toBe(2);
    expect(barsPerShot(0.1)).toBe(4);
  });

  it("opens wide where the action allows, never repeats a kind back to back, and is deterministic", () => {
    const shots = planShots(section, downbeats, 2, 1, "idle", 7, 2);
    expect(shots[0].kind).toBe("wide");
    shots.forEach((s, i) => i > 0 && expect(s.kind).not.toBe(shots[i - 1].kind));
    expect(planShots(section, downbeats, 2, 1, "idle", 7, 2)).toEqual(shots);
    expect(planShots(section, downbeats, 2, 1, "idle", 8, 2)).not.toEqual(shots);
  });

  it("keeps a jumper or dancer out of close-ups", () => {
    for (const action of ["jump", "dance", "run"] as const) expect(planShots(section, downbeats, 2, 1, action, 5, 1).every((s) => s.kind !== "close")).toBe(true);
  });

  it("falls back to an even grid with no downbeats, and a short section is one shot", () => {
    expect(planShots({ start: 0, end: 20 }, [], 2, 2, "idle", 1, 0).length).toBeGreaterThan(1);
    expect(planShots({ start: 0, end: 2.5 }, downbeats, 2, 1, "idle", 1, 0)).toHaveLength(1);
  });
});

describe("holdFirstShot", () => {
  it("turns the plan into the opening shot held for the whole span", () => {
    const shots = planShots(section, downbeats, 2, 1, "idle", 7, 2);
    expect(shots.length).toBeGreaterThan(1);
    expect(holdFirstShot(shots)).toEqual([{ start: 10, end: 50, kind: "wide" }]);
    expect(holdFirstShot([])).toEqual([]);
  });

  it("still pushes in slowly and has no cut", () => {
    const held = holdFirstShot(planShots(section, downbeats, 2, 1, "idle", 7, 2));
    const zoom = (t: number) => framingFor({ t, shots: held, action: "idle", placement: "left", lyrics: null }).zoom;
    expect(zoom(48)).toBeGreaterThan(zoom(12));
    for (let t = 10; t < 49.9; t += 0.033) expect(Math.abs(zoom(t + 0.033) - zoom(t))).toBeLessThan(0.01);
  });
});

describe("framingFor", () => {
  const shots = planShots(section, downbeats, 2, 2, "idle", 4, 0);
  const at = (t: number, extra = {}) => framingFor({ t, shots, action: "idle", placement: "left", lyrics: null, ...extra });

  it("aims at the lead's side of the frame", () => {
    expect(at(12).aim.x).toBe(0.26);
  });

  it("moves smoothly inside a shot and jumps only at a cut", () => {
    const cut = shots[1].start;
    for (let t = shots[0].start; t < shots[0].end - 0.05; t += 0.033) expect(Math.abs(at(t + 0.033).zoom - at(t).zoom)).toBeLessThan(0.01);
    expect(Math.abs(at(cut + 0.001).zoom - at(cut - 0.001).zoom)).toBeGreaterThan(0.1);
  });

  it("punches in on a cut and settles back", () => {
    const cut = shots[1].start;
    expect(at(cut + 0.001).zoom / at(cut + 0.5).zoom).toBeGreaterThan(1.02);
  });

  it("never exceeds the zoom cap", () => {
    for (let t = 10; t < 50; t += 0.25) expect(at(t).zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("has a default frame when there are no shots", () => {
    expect(framingFor({ t: 3, shots: [], action: "walk", placement: "center", lyrics: null })).toEqual({ zoom: 1, aim: { x: 0.5, h: 0.45 } });
  });
});

describe("heldNote", () => {
  const lyrics: Lyrics = { lines: [{ start: 1, end: 6, text: "oh no", words: [{ start: 1, end: 1.4, text: "oh" }, { start: 2, end: 5, text: "no" }] }] };

  it("pulls in only on words held a second or more, easing in and out", () => {
    expect(heldNote(lyrics, 1.2)).toBe(0);
    expect(heldNote(lyrics, 3.5)).toBe(1);
    expect(heldNote(lyrics, 2.1)).toBeGreaterThan(0);
    expect(heldNote(lyrics, 2.1)).toBeLessThan(0.3);
    expect(heldNote(lyrics, 5.9)).toBe(0);
    expect(heldNote(null, 3.5)).toBe(0);
  });

  it("brings the camera closer and toward the face", () => {
    const base = framingFor({ t: 3.5, shots: [{ start: 0, end: 10, kind: "wide" }], action: "idle", placement: "center", lyrics: null });
    const held = framingFor({ t: 3.5, shots: [{ start: 0, end: 10, kind: "wide" }], action: "idle", placement: "center", lyrics });
    expect(held.zoom).toBeGreaterThan(base.zoom * 1.1);
    expect(held.aim.h).toBeGreaterThan(base.aim.h);
  });
});
