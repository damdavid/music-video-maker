// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { poseFor } from "./actions";
import { artHand, FreeformFigure, parseFace, parsePivot, partAngles, renderSafe, viewBoxOf } from "./freeform";
import { parseSafeSvg, walkNodes } from "./safeSvg";
import { holdPose } from "./held";

const S = 'xmlns="http://www.w3.org/2000/svg"';
const ctx = (t: number) => ({ t, beat: t / 0.5, beatLen: 0.5, energy: 0.5, seed: 1, variant: 0 });

describe("partAngles (rig convention -> SVG rotation)", () => {
  it("a forward arm swing rotates counter-clockwise (negative), because the art hangs down facing right", () => {
    const reach = partAngles(poseFor("reach", ctx(0)));
    expect(reach.arm_r).toBeLessThan(-90); // arm raised well forward
    expect(partAngles(poseFor("idle", ctx(0))).arm_r).toBeCloseTo(4, 0); // hanging: near zero
  });

  it("a knee bent backward rotates the shin clockwise (positive); head tilt forward is clockwise", () => {
    const sit = partAngles(poseFor("sit", ctx(0)));
    expect(sit.leg_r).toBeLessThan(-80); // thigh forward
    expect(sit.shin_r).toBeGreaterThan(80); // shin hangs back down relative to the thigh
    expect(partAngles(poseFor("slump", ctx(0))).head).toBeGreaterThan(20);
    expect(partAngles(poseFor("look_up", ctx(0))).head).toBeLessThan(-10);
  });

  it("walk swings opposite limbs in opposite directions", () => {
    // A quarter-cycle in, one leg is planted ahead and the other swings from behind.
    for (const t of [0.05, 0.6]) {
      const a = partAngles(poseFor("walk", ctx(t)));
      expect(Math.sign(a.leg_l)).toBe(-Math.sign(a.leg_r));
      expect(a.arm_l).toBeCloseTo(-a.arm_r, 6);
    }
  });
});

describe("helpers", () => {
  it("parses pivots and viewBoxes, with fallbacks", () => {
    expect(parsePivot("55,60")).toEqual([55, 60]);
    expect(parsePivot("55 60.5")).toEqual([55, 60.5]);
    expect(parsePivot(undefined)).toBeNull();
    expect(parsePivot("a,b")).toBeNull();
    const art = parseSafeSvg(`<svg ${S} viewBox="0 0 200 400"/>`)!;
    expect(viewBoxOf(art, [0, 0, 100, 200])).toEqual([0, 0, 200, 400]);
    expect(viewBoxOf({ tag: "svg", attrs: {}, children: [] }, [0, 0, 100, 200])).toEqual([0, 0, 100, 200]);
  });
});

describe("renderSafe", () => {
  const art = parseSafeSvg(
    `<svg ${S} viewBox="0 0 100 200"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><circle id="dot" r="2"/></defs>` +
      `<rect fill="url(#g)" stroke-width="3" x="0" y="0" width="5" height="5"/><use href="#dot"/><g id="arm_r" data-pivot="10,20" transform="translate(1 2)"/></svg>`,
  )!;

  it("prefixes every id and every reference to one, so two drawings on screen can't clash", () => {
    const html = renderToStaticMarkup(<svg>{art.children.map((c, i) => renderSafe(c, i, "a-"))}</svg>);
    expect(html).toContain('id="a-g"');
    expect(html).toContain("url(#a-g)");
    expect(html).toContain('href="#a-dot"');
    expect(html).not.toContain('id="g"');
    expect(html).toContain('stroke-width="3"'); // React maps strokeWidth back to the dashed attribute
    expect(html).toContain('stop-color="#fff"');
  });

  it("composes an extra transform after the element's own", () => {
    const html = renderToStaticMarkup(<svg>{art.children.map((c, i) => renderSafe(c, i, "a-", (n) => (n.attrs.id === "arm_r" ? "rotate(30 10 20)" : undefined)))}</svg>);
    expect(html).toContain('transform="translate(1 2) rotate(30 10 20)"');
  });

  it("never emits anything outside the allowlist, even from a hostile source", () => {
    const hostile = parseSafeSvg(`<svg ${S} viewBox="0 0 100 200" onload="x()"><script>alert(1)</script><g onclick="y()"><rect fill="url(http://evil.example/a)" x="0" y="0" width="1" height="1"/></g></svg>`)!;
    const html = renderToStaticMarkup(<svg>{hostile.children.map((c, i) => renderSafe(c, i, "h-"))}</svg>);
    expect(html).not.toMatch(/script|onclick|onload|evil|alert/);
  });
});

describe("freeform faces", () => {
  const draw = (head: string) => {
    const art = parseSafeSvg(`<svg ${S} viewBox="0 0 100 200">${head}<g id="torso" data-pivot="50,100" data-face="50,80,10"><rect x="40" y="50" width="20" height="50"/></g></svg>`)!;
    const props = { art, uid: "f", pose: poseFor("idle", ctx(1)), action: "idle" as const, t: 1, beat: 2, x: 0, y: 0, size: 100, facing: "right" as const, mood: "surprised" as const, faceColor: "#111111" };
    return renderToStaticMarkup(<svg><FreeformFigure {...props} /></svg>);
  };

  it("draws the face inside the head group at its data-face spot, so it turns with the head", () => {
    const html = draw(`<g id="head" data-pivot="50,40" data-face="56,30,12"><circle cx="50" cy="30" r="12" fill="#eca"/></g>`);
    const head = html.slice(html.indexOf('id="f-head"'), html.indexOf('id="f-torso"'));
    expect(head).toContain('fill="#111111"');
    expect(html.split('fill="#111111"')).toHaveLength(4); // two eyes and an open mouth, and nothing on the torso
  });

  it("leaves older drawings without data-face faceless", () => {
    expect(draw(`<g id="head" data-pivot="50,40"><circle cx="50" cy="30" r="12"/></g>`)).not.toContain("#111111");
  });

  it("parses data-face, rejecting a missing or non-positive radius", () => {
    expect(parseFace("56,30,12")).toEqual([56, 30, 12]);
    expect(parseFace("56 30 0")).toBeNull();
    expect(parseFace("56,30")).toBeNull();
    expect(parseFace(undefined)).toBeNull();
  });
});


describe("held items on a drawn figure", () => {
  // 100 x 200, ground at 200: shoulder at (50, 60), elbow (50, 100), both arms hanging.
  const art = parseSafeSvg(
    `<svg ${S} viewBox="0 0 100 200"><g id="arm_r" data-pivot="50,60"><rect x="46" y="60" width="8" height="40"/><g id="forearm_r" data-pivot="50,100"><rect x="46" y="100" width="8" height="38"/></g></g><g id="arm_l" data-pivot="50,60"><rect x="46" y="60" width="8" height="40"/></g><g id="leg_l" data-pivot="50,110"><rect x="46" y="110" width="8" height="90"/></g><g id="leg_r" data-pivot="50,110"><rect x="46" y="110" width="8" height="90"/></g><g id="torso"><rect x="40" y="55" width="20" height="60"/></g></svg>`,
  )!;
  const index = () => {
    const m = new Map<string, import("./safeSvg").SafeNode>();
    for (const n of walkNodes(art)) if (n.attrs.id) m.set(n.attrs.id, n);
    return m;
  };
  const COLORS = { body: "#d9a37e", hair: "#2b1d14", top: "#3a6ea5", bottom: "#2e2e3a", accent: "#e8a33d" };
  const draw = (held?: string, pose = poseFor("idle", ctx(1))) =>
    renderToStaticMarkup(
      <svg>
        <FreeformFigure art={art} uid="f" pose={pose} action="idle" t={1} beat={2} x={0} y={0} size={200} facing="right" mood="neutral" faceColor="#222" held={held as never} colors={COLORS} />
      </svg>,
    );

  it("finds the hand from the drawing's own shoulder and elbow, below the shoulder when the arm hangs and ahead of it when raised", () => {
    const hanging = artHand(index(), "r", { ...poseFor("idle", ctx(0)), armR: [0, 0] }, 50, 200, 200)!;
    expect(hanging.x).toBeCloseTo(0, 2);
    expect(hanging.y).toBeCloseTo((60 + 40 + 38 * 1 - 200) / 200, 1); // about the end of the forearm, up is negative
    const raised = artHand(index(), "r", { ...poseFor("idle", ctx(0)), armR: [90, 0] }, 50, 200, 200)!;
    expect(raised.x).toBeGreaterThan(0.3); // forward
    expect(raised.y).toBeCloseTo((60 - 200) / 200, 1); // at shoulder height
  });

  it("has no hand for a drawing without arm pivots", () => {
    expect(artHand(new Map(), "r", poseFor("idle", ctx(0)), 50, 200, 200)).toBeNull();
  });

  it("draws every held item, and a guitar, on the drawing", () => {
    const plain = draw();
    for (const held of ["umbrella", "sword", "shield", "microphone", "flowers", "lantern", "guitar", "balloon"]) {
      const pose = holdPose(poseFor("idle", ctx(1)), held as never, { t: 1, beat: 2, energy: 0.5 });
      const svg = draw(held, pose);
      expect(svg).not.toMatch(/NaN|undefined/);
      expect(svg.length).toBeGreaterThan(plain.length + 100);
    }
  });

  it("draws nothing extra without a held item or without the character's colours", () => {
    expect(draw(undefined)).toBe(draw());
    const bare = renderToStaticMarkup(<svg><FreeformFigure art={art} uid="f" pose={poseFor("idle", ctx(1))} action="idle" t={1} beat={2} x={0} y={0} size={200} facing="right" mood="neutral" faceColor="#222" held="sword" /></svg>);
    expect(bare).toBe(draw());
  });
});
