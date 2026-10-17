import { describe, expect, it } from "vitest";
import { OBJECT_SCALE, objectPlacements, PLACEMENT_X, propPlacements } from "./layout";
import type { ResolvedScene } from "./normalize";

const scene = (over: Partial<ResolvedScene>): ResolvedScene => ({ setting: "shore", time_of_day: "dusk", weather: "clear", characters: [], crowd: 0, props: [], objects: [], illustration: "library", background_svg: null, ...over });
const person = (action: "sit" | "walk", placement: "left" | "center" | "right" = "center") => ({ character_id: "hero", action, expression: "neutral" as const, placement, facing: "right" as const });

describe("propPlacements", () => {
  it("puts a listed bench under the sitter instead of in a far slot (the bug seen in a live storyboard)", () => {
    const out = propPlacements(scene({ props: ["bench"], characters: [person("sit", "center")] }));
    expect(out).toEqual([{ kind: "bench", x: PLACEMENT_X.center, seat: true }]);
  });

  it("adds a bench under a sitter when none was listed, and keeps other props", () => {
    const out = propPlacements(scene({ props: ["lamp"], characters: [person("sit", "right")] }));
    expect(out.map((p) => p.kind).sort()).toEqual(["bench", "lamp"]);
    expect(out.find((p) => p.kind === "bench")!.x).toBe(PLACEMENT_X.right);
  });

  it("draws a bench in its slot when nobody sits", () => {
    const out = propPlacements(scene({ props: ["bench", "tree"], characters: [person("walk")] }));
    expect(out.filter((p) => p.kind === "bench")).toHaveLength(1);
    expect(out.find((p) => p.kind === "bench")!.x).not.toBe(PLACEMENT_X.center);
    expect(out.every((p) => !p.seat)).toBe(true); // set dressing scrolls past with the world
  });

  it("gives each seated character their own bench, once per spot", () => {
    const two = propPlacements(scene({ characters: [person("sit", "left"), person("sit", "right")] }));
    expect(two.map((p) => p.x).sort()).toEqual([PLACEMENT_X.left, PLACEMENT_X.right].sort());
    const sameSpot = propPlacements(scene({ characters: [person("sit", "center"), person("sit", "center")] }));
    expect(sameSpot).toHaveLength(1);
  });

  it("returns nothing for an empty scene", () => {
    expect(propPlacements(scene({}))).toEqual([]);
  });
});

describe("objectPlacements", () => {
  const guitar = { id: "guitar", size: "small" as const, svg: "<svg/>" };
  it("places each drawn object at its spot, scaled by size", () => {
    const out = objectPlacements(scene({ objects: [{ object_id: "guitar", placement: "left" }] }), [guitar]);
    expect(out).toEqual([{ id: "guitar", svg: "<svg/>", x: PLACEMENT_X.left, scale: OBJECT_SCALE.small }]);
  });

  it("skips unknown objects and objects that are not drawn yet", () => {
    const refs = [{ object_id: "ghost", placement: "left" as const }, { object_id: "plain", placement: "right" as const }];
    expect(objectPlacements(scene({ objects: refs }), [{ id: "plain", size: "large", svg: null }])).toEqual([]);
  });
});
