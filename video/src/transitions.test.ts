import { describe, expect, it } from "vitest";
import { irisRadius, punchClip, transitionLayout, whipBlur, wipeClips, type TransitionKind } from "./transitions";
import { HIT } from "./timeline";

const KINDS: TransitionKind[] = ["crossfade", "flash", "zoomThrough", "iris", "dive", "push", "whip", "wipe", "punch"];
const SIZES = [[1920, 1080], [1080, 1920], [1080, 1080]] as const;
const translateX = (transform: unknown) => Number(/translateX\(([-\d.]+)%\)/.exec(String(transform))![1]);

/** Points of a CSS polygon() in px. */
const polygon = (clip: string) => [...clip.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("transitionLayout", () => {
  it("crossfade eases the incoming opacity from 0 to 1", () => {
    expect(transitionLayout("crossfade", 0, 100, 100).incoming.opacity).toBe(0);
    expect(transitionLayout("crossfade", 1, 100, 100).incoming.opacity).toBe(1);
    expect(transitionLayout("crossfade", 0.25, 100, 100).incoming.opacity as number).toBeLessThan(0.25); // eased in, not linear
  });

  it("flash hides the outgoing section and fades its overlay out, harder when the music hits harder", () => {
    const start = transitionLayout("flash", 0, 100, 100);
    expect(start.showOutgoing).toBe(false);
    expect(start.flash).toBeCloseTo(0.85, 6);
    expect(transitionLayout("flash", 1, 100, 100).flash).toBe(0);
    expect(transitionLayout("flash", 0, 100, 100, { strength: 0 }).flash).toBeLessThan(start.flash);
  });

  it("zoomThrough puts the incoming section underneath and scales the outgoing one away", () => {
    const mid = transitionLayout("zoomThrough", 0.5, 100, 100);
    expect(mid.incomingOnTop).toBe(false);
    expect(mid.outgoing.opacity as number).toBeLessThan(1);
    expect(transitionLayout("zoomThrough", 1, 100, 100).outgoing.opacity).toBe(0);
  });

  it("the iris opens from nothing and just covers the corners, easing in and out", () => {
    for (const [w, h] of SIZES) {
      const corner = Math.hypot(w, h) / 2;
      expect(irisRadius(0, w, h)).toBe(0);
      expect(irisRadius(1, w, h)).toBeCloseTo(corner, 6);
      expect(irisRadius(0.25, w, h)).toBeLessThan(corner * 0.25); // eased in: still small a quarter of the way
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const r = irisRadius(i / 100, w, h);
        expect(r).toBeGreaterThanOrEqual(prev);
        expect(r).toBeLessThanOrEqual(corner + 1e-9);
        prev = r;
      }
    }
    expect(transitionLayout("iris", 0, 800, 600).incoming.clipPath).toBe("circle(0.0px at 50% 50%)");
  });

  it("dive grows its content into the disc, overshooting a touch before it settles at full size", () => {
    const scale = (p: number) => Number(/scale\(([\d.]+)\)/.exec(String(transitionLayout("dive", p, 800, 600).incomingInner?.transform))![1]);
    expect(scale(0)).toBeCloseTo(0.82, 6);
    expect(scale(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => scale(i / 100)))).toBeGreaterThan(1.01);
    expect(transitionLayout("dive", 1, 800, 600).outgoing.filter).toBe("brightness(0.5)");
  });

  it.each([1, -1])("push slides both sections together in direction %i, the new one ending in place", (dir) => {
    const at = (p: number) => transitionLayout("push", p, 1920, 1080, { dir });
    expect(translateX(at(0).incoming.transform)).toBe(100 * dir);
    expect(translateX(at(1).incoming.transform)).toBe(0);
    expect(translateX(at(1).outgoing.transform)).toBe(-100 * dir);
    for (const p of [0.2, 0.5, 0.8]) expect(translateX(at(p).incoming.transform) - translateX(at(p).outgoing.transform)).toBeCloseTo(100 * dir, 2); // edge to edge
  });

  it("whip is blurred in proportion to its speed: sharp at both ends, most blurred mid-move", () => {
    expect(whipBlur(0, 1920)).toBeLessThan(1);
    expect(whipBlur(1, 1920)).toBeLessThan(1);
    expect(whipBlur(0.5, 1920)).toBeGreaterThan(40);
    expect(whipBlur(0.5, 1920)).toBeGreaterThan(whipBlur(0.3, 1920));
    expect(transitionLayout("whip", 0.5, 1920, 1080).blur).toBe(whipBlur(0.5, 1920));
    expect(transitionLayout("crossfade", 0.5, 1920, 1080).blur).toBe(0);
  });

  it.each([1, -1])("wipe's edge sweeps from fully off-frame to fully past it (dir %i)", (dir) => {
    for (const [w, h] of SIZES) {
      const xs = (e: number) => polygon(wipeClips(e, w, h, dir).incoming).map(([x]) => x);
      // At the start the incoming region lies entirely off-frame; at the end it covers the frame.
      if (dir > 0) {
        expect(Math.max(...xs(0))).toBeLessThanOrEqual(0);
        expect(Math.min(...xs(1).slice(1, 3))).toBeGreaterThanOrEqual(w);
      } else {
        expect(Math.min(...xs(0))).toBeGreaterThanOrEqual(w);
        expect(Math.max(...xs(1).slice(1, 3))).toBeLessThanOrEqual(0);
      }
    }
    expect(transitionLayout("wipe", 0.5, 1920, 1080, { dir }).edge?.clipPath).toMatch(/^polygon\(/);
    expect(transitionLayout("wipe", 1, 1920, 1080, { dir }).edge).toBeUndefined();
  });

  it("punch zooms the outgoing shot in up to the hit, then bursts the new one open with a flash", () => {
    const before = transitionLayout("punch", HIT.punch * 0.9, 1920, 1080);
    expect(before.flash).toBe(0);
    expect(Number(/scale\(([\d.]+)\)/.exec(String(before.outgoing.transform))![1])).toBeGreaterThan(1.05);
    const after = transitionLayout("punch", HIT.punch + 0.02, 1920, 1080);
    expect(after.flash).toBeGreaterThan(0.3);
    expect(transitionLayout("punch", 1, 1920, 1080).incoming.clipPath).toBe("none");
    expect(transitionLayout("punch", 1, 1920, 1080).incomingInner?.transform).toBe("scale(1.0000)");
  });

  it("the punch burst covers every corner once fully open, and is a well-formed path", () => {
    for (const [w, h] of SIZES) {
      const nums = [...punchClip(0.999, w, h, 10).matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
      const pts = Array.from({ length: nums.length / 2 }, (_, i) => [nums[2 * i], nums[2 * i + 1]]);
      const nearest = Math.min(...pts.map(([x, y]) => Math.hypot(x - w / 2, y - h / 2)));
      expect(nearest).toBeGreaterThan(Math.hypot(w, h) / 2);
      expect(punchClip(0.5, w, h, 0)).toMatch(/^path\("M [\d.-]+ [\d.-]+ (L|C) /);
    }
  });

  it.each(KINDS)("%s returns finite, well-formed styles for every aspect ratio, direction and progress", (kind) => {
    for (const [w, h] of SIZES) {
      for (const dir of [1, -1]) {
        for (let i = 0; i <= 10; i++) {
          const l = transitionLayout(kind, i / 10, w, h, { dir, strength: 0.5 });
          expect(JSON.stringify(l)).not.toMatch(/NaN|Infinity/);
          expect(l.flash).toBeGreaterThanOrEqual(0);
          expect(l.flash).toBeLessThanOrEqual(1);
          expect(l.blur).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it.each(KINDS)("%s ends with the incoming section in place", (kind) => {
    const end = transitionLayout(kind, 1, 1920, 1080);
    expect(end.incoming.opacity ?? 1).toBe(1);
    const tx = /translateX\(([-\d.]+)%\)/.exec(String(end.incoming.transform ?? ""));
    if (tx) expect(Number(tx[1])).toBe(0);
  });
});
