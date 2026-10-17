import type { ReactNode } from "react";
import type { CameraMotion } from "../../shared/types";
import { easeInOutSine } from "./easing";
import { wobble2 } from "./motion";

export type CameraCtx = {
  t: number;
  /** 0..1 through the section. */
  progress: number;
  /** Beat envelope, 1 on a beat. */
  pulse: number;
  intensity: number;
  /** Smoothed loudness 0..1. */
  energy: number;
  seed: number;
};

/** Where the camera is: content shifted by x/y (fractions of the frame), zoomed (>= 1) and rotated (degrees). */
export type CameraState = { x: number; y: number; zoom: number; rot: number };

const STILL: CameraState = { x: 0, y: 0, zoom: 1, rot: 0 };

/** Scale applied to flat (abstract) layers so the largest shift and tilt of each motion never shows an edge. */
const OVERSCAN: Record<CameraMotion, number> = { none: 1, slowZoom: 1, drift: 1.06, shake: 1.04, pulse: 1, handheld: 1.06 };

export function cameraState(motion: CameraMotion, { t, progress, pulse, intensity, energy, seed }: CameraCtx): CameraState {
  switch (motion) {
    case "slowZoom":
      return { ...STILL, zoom: 1 + 0.1 * easeInOutSine(progress) };
    case "drift":
      // A slow sideways track across the section with a little float on top; in scenes the parallax shows the depth.
      return { ...STILL, x: 0.016 * (1 - 2 * easeInOutSine(progress)) + 0.008 * Math.sin(t * 0.3), y: 0.012 * Math.cos(t * 0.23) };
    case "shake":
      return { ...STILL, x: Math.sin(t * 61) * pulse * intensity * 0.012, y: Math.cos(t * 53) * pulse * intensity * 0.012 };
    case "pulse":
      return { ...STILL, zoom: 1 + 0.035 * intensity * pulse };
    case "handheld": {
      // Calm when the song is quiet, livelier as it gets louder: a person holding the camera reacting to the room.
      const amp = 0.005 + 0.011 * energy * (0.5 + intensity);
      return {
        x: wobble2(seed, t, 1, 0.35) * amp,
        y: wobble2(seed, t, 2, 0.35) * amp * 0.75,
        zoom: 1 + 0.01 * (1 + wobble2(seed, t, 4, 0.12)),
        rot: wobble2(seed, t, 3, 0.25) * (0.35 + 0.5 * energy),
      };
    }
    default:
      return STILL;
  }
}

const n = (x: number, digits = 4) => Number(x.toFixed(digits));

/** CSS transform for a layer with no depth (the abstract visuals). */
export function flatTransform(motion: CameraMotion, c: CameraState): string {
  if (motion === "none") return "none";
  const parts = [`scale(${n(OVERSCAN[motion] * c.zoom)})`];
  if (c.x || c.y) parts.push(`translate(${n(c.x * 100, 3)}%, ${n(c.y * 100, 3)}%)`);
  if (c.rot) parts.push(`rotate(${n(c.rot, 3)}deg)`);
  return parts.join(" ");
}

/**
 * SVG transform for a scene layer at `depth` (0 = infinitely far, 1 = the ground line the characters stand on, >1 in
 * front of them). Nearer layers move and zoom more, which is what makes the scene read as deep; `focus` is the point
 * the camera zooms toward. Scenery is drawn with a bleed past the frame edges to absorb the shift.
 */
export function depthTransform(c: CameraState, depth: number, w: number, h: number, focus: { x: number; y: number }): string | undefined {
  if (c.x === 0 && c.y === 0 && c.zoom === 1 && c.rot === 0) return undefined;
  const z = 1 + (c.zoom - 1) * depth;
  return `translate(${n(focus.x + c.x * depth * w, 2)} ${n(focus.y + c.y * depth * h, 2)}) rotate(${n(c.rot, 3)}) scale(${n(z, 5)}) translate(${n(-focus.x, 2)} ${n(-focus.y, 2)})`;
}

/** Wraps an abstract layer in its camera transform. */
export const Camera = ({ motion, state, children }: { motion: CameraMotion; state: CameraState; children: ReactNode }) => (
  <div style={{ position: "absolute", inset: 0, transform: flatTransform(motion, state), transformOrigin: "center" }}>{children}</div>
);
