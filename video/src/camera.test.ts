import { describe, expect, it } from "vitest";
import { cameraState, depthTransform, flatTransform, type CameraCtx } from "./Camera";

const ctx = (over: Partial<CameraCtx> = {}): CameraCtx => ({ t: 2, progress: 0.5, pulse: 0, intensity: 1, energy: 0.5, seed: 3, ...over });
const scaleOf = (transform: string) => Number(/scale\(([\d.]+)\)/.exec(transform)![1]);

describe("cameraState / flatTransform", () => {
  it("none does nothing", () => {
    expect(flatTransform("none", cameraState("none", ctx({ pulse: 1 })))).toBe("none");
  });

  it("slowZoom eases from 1 to 1.1 over the section", () => {
    expect(cameraState("slowZoom", ctx({ progress: 0 })).zoom).toBe(1);
    expect(cameraState("slowZoom", ctx({ progress: 1 })).zoom).toBeCloseTo(1.1, 9);
    expect(cameraState("slowZoom", ctx({ progress: 0.25 })).zoom).toBeLessThan(1.025); // eased: slower than linear at the start
  });

  it("pulse punches in on the beat and rests at 1 between beats, scale only", () => {
    expect(cameraState("pulse", ctx({ pulse: 0 })).zoom).toBe(1);
    expect(cameraState("pulse", ctx({ pulse: 1 })).zoom).toBeCloseTo(1.035, 9);
    expect(cameraState("pulse", ctx({ pulse: 1, intensity: 0 })).zoom).toBe(1);
    expect(flatTransform("pulse", cameraState("pulse", ctx({ pulse: 1 })))).toBe("scale(1.035)");
  });

  it("drift tracks slowly sideways across the section", () => {
    const start = cameraState("drift", ctx({ progress: 0, t: 0 })).x;
    const end = cameraState("drift", ctx({ progress: 1, t: 0 })).x;
    expect(start).toBeGreaterThan(0.01);
    expect(end).toBeLessThan(-0.01);
  });

  it("handheld wanders smoothly and is livelier when the music is louder", () => {
    const spread = (energy: number) => {
      const xs = Array.from({ length: 300 }, (_, i) => cameraState("handheld", ctx({ t: i / 30, energy })).x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(1)).toBeGreaterThan(spread(0) * 1.5);
    for (let i = 0; i < 300; i++) {
      const a = cameraState("handheld", ctx({ t: i / 30 }));
      const b = cameraState("handheld", ctx({ t: (i + 1) / 30 }));
      expect(Math.abs(b.x - a.x)).toBeLessThan(0.003); // no frame-to-frame jitter
      expect(Math.abs(a.rot)).toBeLessThan(1);
    }
    expect(cameraState("handheld", ctx({ t: 4.2 }))).toEqual(cameraState("handheld", ctx({ t: 4.2 }))); // deterministic
  });

  it("flat layers are overscanned enough that the largest move never shows an edge", () => {
    for (const motion of ["drift", "shake", "handheld"] as const) {
      for (let i = 0; i < 200; i++) {
        const c = cameraState(motion, ctx({ t: i * 0.37, pulse: 1, energy: 1, progress: (i % 11) / 10 }));
        const s = scaleOf(flatTransform(motion, c));
        const slack = (s - 1) / 2; // how far the scaled layer reaches past each edge, as a fraction of the frame
        const tilt = Math.sin((Math.abs(c.rot) * Math.PI) / 180);
        expect(Math.abs(c.x) + tilt).toBeLessThan(slack);
        expect(Math.abs(c.y) + tilt * (16 / 9)).toBeLessThan(slack);
      }
    }
  });
});

describe("depthTransform", () => {
  const focus = { x: 960, y: 600 };

  it("leaves layers alone when the camera is still", () => {
    expect(depthTransform({ x: 0, y: 0, zoom: 1, rot: 0 }, 1, 1920, 1080, focus)).toBeUndefined();
  });

  it("moves nearer layers further than distant ones (parallax)", () => {
    const shift = (depth: number) => Number(/^translate\(([-\d.]+)/.exec(depthTransform({ x: 0.02, y: 0, zoom: 1, rot: 0 }, depth, 1920, 1080, focus)!)![1]) - focus.x;
    expect(shift(1)).toBeCloseTo(0.02 * 1920, 6);
    expect(shift(0.1)).toBeCloseTo(0.1 * shift(1), 6);
  });

  it("zooms distant layers less, and keeps the focus point fixed", () => {
    const z = (depth: number) => scaleOf(depthTransform({ x: 0, y: 0, zoom: 1.1, rot: 0 }, depth, 1920, 1080, focus)!);
    expect(z(1)).toBeCloseTo(1.1, 6);
    expect(z(0.2)).toBeCloseTo(1.02, 6);
    expect(depthTransform({ x: 0, y: 0, zoom: 1.1, rot: 0 }, 1, 1920, 1080, focus)).toMatch(/^translate\(960 600\).*translate\(-960 -600\)$/);
  });
});
