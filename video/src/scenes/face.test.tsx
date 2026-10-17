import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { poseFor } from "./actions";
import { eyeOpen, Face, featureColor } from "./face";
import { Figure } from "./Figure";
import { resolveScene } from "./normalize";

const COLORS = { body: "#d9a37e", hair: "#2b1d14", top: "#c0392b", bottom: "#1f2a44", accent: "#f1c40f" };
const figure = (face?: { mood: "happy"; t: number }, mono?: string) =>
  renderToStaticMarkup(
    <svg>
      <Figure pose={poseFor("idle", { t: 0, beat: 0, beatLen: 0.5, energy: 0, seed: 1, variant: 0 })} colors={COLORS} hair="short" outfit="tee" x={0} y={0} size={100} facing="right" face={face} mono={mono} />
    </svg>,
  );

describe("expressions", () => {
  it("defaults from the action, and an explicit one wins", () => {
    const scene = resolveScene({ section_ref: 0, setting: "road", characters: [{ character_id: "a", action: "slump" }, { character_id: "b", action: "slump", expression: "happy" }] });
    expect(scene.characters.map((c) => c.expression)).toEqual(["sad", "happy"]);
  });

  it("features are a dark shade of the skin", () => {
    expect(featureColor(COLORS.body)).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(featureColor("#ffffff").slice(1, 3), 16)).toBeLessThan(60);
  });

  it("blinks briefly, then stays open", () => {
    expect(eyeOpen(0.05)).toBeLessThan(0.5);
    expect(eyeOpen(1)).toBe(1);
  });

  it("each mood draws something different", () => {
    const moods = ["neutral", "happy", "sad", "surprised", "calm", "determined"] as const;
    const out = new Set(moods.map((m) => renderToStaticMarkup(<svg><Face mood={m} cx={0} cy={0} r={1} color="#000000" t={1} /></svg>)));
    expect(out.size).toBe(moods.length);
  });

  it("the rig draws a face for cast members but not for silhouettes", () => {
    const ink = featureColor(COLORS.body);
    expect(figure({ mood: "happy", t: 1 })).toContain(ink);
    expect(figure(undefined)).not.toContain(ink);
    expect(figure({ mood: "happy", t: 1 }, "#222222")).not.toContain(ink);
  });
});
