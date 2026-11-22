import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { poseFor } from "./actions";
import { SYMBOL_S, type SymbolName } from "./cues";
import { propPlacements } from "./layout";
import { dressed, resolveScene, type ResolvedCharacter } from "./normalize";
import { SymbolArt } from "./Symbols";

const ctx = { t: 1, beat: 2.25, beatLen: 0.5, energy: 0.6, seed: 3, variant: 0 };
const NAMES: SymbolName[] = ["heart", "star", "rose", "key", "door", "moon", "bird", "clock"];
const hero = { id: "hero", gender: "male", hair: "short", outfit: "tee", hat: "cap", accessories: ["glasses"], build: 1, colors: {} as never, svg: null } as ResolvedCharacter;

describe("new actions", () => {
  it("point has an arm out, cross_arms folds both, cheer raises both, lean sits back", () => {
    expect(poseFor("point", ctx).armR[0]).toBeGreaterThan(70);
    const crossed = poseFor("cross_arms", ctx);
    expect(crossed.armR[1]).toBeGreaterThan(90);
    expect(crossed.armL[1]).toBeGreaterThan(90);
    const cheer = poseFor("cheer", ctx);
    expect(Math.min(cheer.armR[0], cheer.armL[0])).toBeGreaterThan(140);
    expect(poseFor("lean", ctx).lean).toBeLessThan(-5);
  });

  it("cheering bounces on the beat", () => {
    const y = (beat: number) => poseFor("cheer", { ...ctx, beat }).y;
    expect(y(2.5)).toBeLessThan(y(2.0)); // higher (more negative) between beats than on one
  });
});

describe("symbols", () => {
  const draw = (name: SymbolName, age: number) => renderToStaticMarkup(<svg><SymbolArt name={name} age={age} x={100} y={100} size={80} ink="#111" t={1} /></svg>);

  it("draws every symbol", () => {
    for (const name of NAMES) {
      const svg = draw(name, 1);
      expect(svg).not.toMatch(/NaN|undefined/);
      expect(svg.length).toBeGreaterThan(80);
    }
    expect(new Set(NAMES.map((n) => draw(n, 1))).size).toBe(NAMES.length);
  });

  it("pops in, and fades out before it is gone", () => {
    expect(draw("heart", 0)).toBe("<svg></svg>"); // nothing yet at the very start of the pop
    expect(draw("heart", SYMBOL_S + 0.1)).toBe("<svg></svg>");
    expect(draw("heart", 0.2)).toContain("scale(");
    expect(draw("heart", SYMBOL_S - 0.1)).toMatch(/opacity="0\.\d+"/);
  });
});

describe("costume changes", () => {
  it("takes the scene's choices over the cast's own and keeps the rest", () => {
    expect(dressed(hero, null)).toEqual({ outfit: "tee", hat: "cap", accessories: ["glasses"] });
    expect(dressed(hero, { outfit: "suit", hat: null, accessories: null })).toEqual({ outfit: "suit", hat: "cap", accessories: ["glasses"] });
    expect(dressed(hero, { outfit: null, hat: "none", accessories: [] })).toEqual({ outfit: "tee", hat: null, accessories: [] });
    expect(dressed(hero, { outfit: null, hat: "cowboy", accessories: ["scarf"] })).toEqual({ outfit: "tee", hat: "cowboy", accessories: ["scarf"] });
  });

  it("is resolved from the storyboard", () => {
    const scene = resolveScene({ section_ref: 0, setting: "road", characters: [{ character_id: "hero", wear: { outfit: "coat", hat: "none" } }, { character_id: "b" }] });
    expect(scene.characters[0].wear).toEqual({ outfit: "coat", hat: "none", accessories: null });
    expect(scene.characters[1].wear).toBeNull();
  });
});

describe("leaning", () => {
  const scene = (props: string[], action: "lean" | "idle" = "lean") => resolveScene({ section_ref: 0, setting: "road", props: props as never, characters: [{ character_id: "hero", action, placement: "left", facing: "right" }] });

  it("puts something behind a leaning figure, a lamp if the scene has nothing to lean on", () => {
    const [p] = propPlacements(scene([]));
    expect(p).toMatchObject({ kind: "lamp", seat: true });
    expect(p.offset).toBeLessThan(0); // behind a figure facing right
  });

  it("uses the scene's own signpost, fence or tree and leaves other props alone", () => {
    const placed = propPlacements(scene(["bench", "signpost"]));
    expect(placed.map((p) => p.kind).sort()).toEqual(["bench", "signpost"]);
    expect(placed.find((p) => p.kind === "signpost")?.seat).toBe(true);
    expect(propPlacements(scene(["signpost"], "idle"))[0].seat).toBe(false);
  });
});
