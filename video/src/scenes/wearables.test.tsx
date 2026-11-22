import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { poseFor } from "./actions";
import { Figure } from "./Figure";
import { holdPose } from "./held";
import { crowdAction } from "./crowd";
import { PropShape } from "./props";
import type { Accessory, Hat, HeldKind, Outfit, PropKind } from "./normalize";
import type { SceneColors } from "./sky";

const COLORS = { body: "#d9a37e", hair: "#2b1d14", top: "#c0392b", bottom: "#1f2a44", accent: "#f1c40f" };
const ctx = { t: 1, beat: 2.25, beatLen: 0.5, energy: 0.6, seed: 3, variant: 0 };
const HATS: Hat[] = ["cowboy", "beanie", "cap", "top_hat", "beret", "sun_hat"];
const ACCESSORIES: Accessory[] = ["glasses", "sunglasses", "scarf", "headphones", "backpack"];
const OUTFITS: Outfit[] = ["tee", "coat", "dress", "hoodie", "jacket", "suit", "overalls"];
const HELD: HeldKind[] = ["umbrella", "suitcase", "microphone", "flowers", "lantern", "book", "guitar", "phone", "flag", "balloon", "cup"];

const draw = (over: Partial<Parameters<typeof Figure>[0]> = {}) =>
  renderToStaticMarkup(
    <svg>
      <Figure pose={poseFor("idle", ctx)} colors={COLORS} hair="short" outfit="tee" x={0} y={0} size={100} facing="right" face={{ mood: "happy", t: 0 }} {...over} />
    </svg>,
  );
const clean = (svg: string) => {
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  return svg;
};

describe("wearables", () => {
  it("draws every hat, on top of the hair, in the character's accent colour", () => {
    const plain = draw();
    for (const hat of HATS) {
      const svg = clean(draw({ hat }));
      expect(svg).not.toBe(plain);
      expect(svg).toContain(COLORS.accent);
    }
    expect(new Set(HATS.map((hat) => draw({ hat }))).size).toBe(HATS.length);
  });

  it("draws every accessory and every outfit without breaking", () => {
    const plain = draw();
    for (const a of ACCESSORIES) expect(clean(draw({ accessories: [a] }))).not.toBe(plain);
    for (const outfit of OUTFITS) clean(draw({ outfit }));
    expect(draw({ outfit: "suit" })).not.toBe(draw({ outfit: "tee" }));
    expect(draw({ outfit: "overalls" })).not.toBe(draw({ outfit: "tee" }));
  });

  it("draws hats and the clothes in one flat colour on a silhouette, without any face gear", () => {
    const svg = clean(draw({ mono: "#101010", face: undefined, hat: "cowboy", outfit: "suit", accessories: ["glasses", "scarf"] }));
    expect(svg).not.toContain(COLORS.accent);
    expect(svg).not.toContain(COLORS.top);
  });

  it("draws every held item, with its arm in the grip", () => {
    for (const held of HELD) {
      const pose = holdPose(poseFor("idle", ctx), held, { t: 1, beat: 2.25, energy: 0.6 });
      expect(clean(draw({ pose, held, t: 1 }))).not.toBe(draw());
    }
  });

  it("draws every scene prop", () => {
    const c = { ink: "#101018", light: "#ffcf7a", near: "#33405a", mid: "#44506a", fg: "#eeeeee", time: "night" } as unknown as SceneColors;
    const kinds: PropKind[] = ["lamp", "bench", "tree", "house", "suitcase", "campfire", "fence", "signpost"];
    for (const kind of kinds) {
      const svg = clean(renderToStaticMarkup(<svg><PropShape kind={kind} x={0} gy={0} unit={100} c={c} t={1} pulse={0.5} sway={0} /></svg>));
      expect(svg.length).toBeGreaterThan(40);
    }
  });

  it("keeps the crowd's actions to ones every figure can do", () => {
    for (const intensity of [0.1, 0.5, 0.8, 1]) for (const pick of [0, 0.4, 0.9]) expect(() => poseFor(crowdAction(intensity, pick, pick > 0.5), ctx)).not.toThrow();
  });
});
