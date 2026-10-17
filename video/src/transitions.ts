import type { CSSProperties } from "react";
import { makeStar } from "@remotion/shapes";
import type { TransitionIn as Transition } from "../../shared/types";
import { easeInOutCubic, easeInOutQuint, easeInQuad, easeOutBack, easeOutCubic } from "./easing";
import { HIT } from "./timeline";
import { clamp } from "./timing";

export type TransitionKind = Transition;

export type TransitionLayout = {
  /** The previous section is only drawn for the kinds that show it during the change. */
  showOutgoing: boolean;
  incomingOnTop: boolean;
  incoming: CSSProperties;
  /** Wraps just the incoming content, for effects that must not move the clip (dive scales inside the disc). */
  incomingInner?: CSSProperties;
  outgoing: CSSProperties;
  /** Opacity of a flash of the foreground colour over everything. */
  flash: number;
  /** Horizontal motion blur (SVG stdDeviation in px) applied to both sections; only whip uses it. */
  blur: number;
  /** A band of the foreground colour drawn over both sections (the leading edge of a wipe). */
  edge?: CSSProperties;
};

export type TransitionOptions = {
  /** +1 / -1: direction of travel for push, whip and wipe. */
  dir?: number;
  /** 0..1: how hard the music hits at the cut; scales flashes and punches. */
  strength?: number;
};

const FLASH_PEAK = 0.85;
// The incoming content starts a little small and grows into the disc, settling with a slight overshoot.
const DIVE_FROM = 0.82;
const WIPE_TILT = Math.tan((14 * Math.PI) / 180);
const BLEED = 12;

/** How the two sections are laid out `p` (0..1) of the way through a transition into a new section. */
export function transitionLayout(kind: TransitionKind, p: number, width: number, height: number, opts: TransitionOptions = {}): TransitionLayout {
  const dir = opts.dir ?? 1;
  const strength = clamp(opts.strength ?? 1);
  const base = { showOutgoing: true, incomingOnTop: true, incoming: {}, outgoing: {}, flash: 0, blur: 0 };
  const flashPeak = FLASH_PEAK * (0.7 + 0.3 * strength);
  switch (kind) {
    case "crossfade":
      return { ...base, incoming: { opacity: easeInOutCubic(p) } };
    case "zoomThrough": {
      const e = easeInOutCubic(p);
      return { ...base, incomingOnTop: false, incoming: { transform: `scale(${0.85 + 0.15 * e})` }, outgoing: { transform: `scale(${1 + 0.8 * e})`, opacity: 1 - e } };
    }
    case "flash":
      return { ...base, showOutgoing: false, flash: (1 - easeOutCubic(p)) * flashPeak };
    case "iris":
      return { ...base, incoming: { clipPath: irisClip(p, width, height) } };
    case "dive":
      return {
        ...base,
        incoming: { clipPath: irisClip(p, width, height) },
        incomingInner: { transform: `scale(${DIVE_FROM + (1 - DIVE_FROM) * easeOutBack(p)})` },
        outgoing: { transform: `scale(${1 + 0.15 * easeOutCubic(p)})`, filter: `brightness(${1 - 0.5 * easeOutCubic(p)})` },
      };
    case "push": {
      const e = easeInOutCubic(p);
      return {
        ...base,
        incoming: { transform: `translateX(${((1 - e) * dir * 100).toFixed(3)}%)` },
        outgoing: { transform: `translateX(${(-e * dir * 100).toFixed(3)}%)`, filter: `brightness(${(1 - 0.3 * e).toFixed(3)})` },
      };
    }
    case "whip": {
      const e = easeInOutQuint(p);
      const swell = 1 + 0.05 * Math.sin(Math.PI * clamp(p));
      return {
        ...base,
        incoming: { transform: `translateX(${((1 - e) * dir * 100).toFixed(3)}%) scale(${swell.toFixed(4)})` },
        outgoing: { transform: `translateX(${(-e * dir * 100).toFixed(3)}%) scale(${swell.toFixed(4)})` },
        blur: whipBlur(p, width),
      };
    }
    case "wipe": {
      const { incoming, band } = wipeClips(easeInOutCubic(p), width, height, dir);
      return {
        ...base,
        incoming: { clipPath: incoming },
        outgoing: { transform: `scale(${(1 + 0.03 * easeOutCubic(p)).toFixed(4)})` },
        edge: p > 0 && p < 1 ? { clipPath: band } : undefined,
      };
    }
    case "punch": {
      const hit = HIT.punch;
      const pre = clamp(p / hit);
      const post = clamp((p - hit) / (1 - hit));
      const amount = 0.08 + 0.08 * strength;
      return {
        ...base,
        // Accelerating into the cut is the anticipation; the incoming shot then lands already punched in and settles.
        outgoing: { transform: `scale(${(1 + amount * easeInQuad(pre)).toFixed(4)})` },
        incoming: { clipPath: punchClip(clamp(post / 0.7), width, height, post * 25 * dir) },
        incomingInner: { transform: `scale(${(1 + amount * (1 - easeOutCubic(post))).toFixed(4)})` },
        flash: p < hit ? 0 : (1 - easeOutCubic(clamp(post / 0.45))) * flashPeak * 0.8,
      };
    }
  }
}

/** A disc from the frame centre that grows to just cover the corners. Eased in and out, with no overshoot: past the corners it would be invisible. */
export function irisRadius(p: number, width: number, height: number): number {
  return (Math.hypot(width, height) / 2) * easeInOutCubic(p);
}

const irisClip = (p: number, width: number, height: number) => `circle(${irisRadius(p, width, height).toFixed(1)}px at 50% 50%)`;

/** Motion blur for a whip: proportional to how fast the frame is moving, peaking mid-move. */
export function whipBlur(p: number, width: number): number {
  const dp = 0.01;
  const speed = (easeInOutQuint(clamp(p + dp)) - easeInOutQuint(clamp(p - dp))) / (2 * dp);
  // easeInOutQuint peaks at a speed of 1.875 (in widths per transition).
  return (speed / 1.875) * width * 0.03;
}

/** The incoming region and the leading-edge band of an angled wipe `e` (0..1) of the way across. */
export function wipeClips(e: number, width: number, height: number, dir: number): { incoming: string; band: string } {
  const slant = (height / 2) * WIPE_TILT;
  const band = width * 0.012;
  const travel = width + 2 * slant + band + 2 * BLEED;
  // Edge position along the middle of the frame, starting just off one side.
  const mid = dir > 0 ? -slant - band - BLEED + travel * e : width + slant + band + BLEED - travel * e;
  const top = -BLEED;
  const bottom = height + BLEED;
  const at = (y: number, offset: number) => (mid + offset + (y - height / 2) * WIPE_TILT).toFixed(1);
  const far = dir > 0 ? -width : 2 * width;
  const lead = dir > 0 ? -band : band;
  return {
    incoming: `polygon(${far}px ${top}px, ${at(top, 0)}px ${top}px, ${at(bottom, 0)}px ${bottom}px, ${far}px ${bottom}px)`,
    band: `polygon(${at(top, lead)}px ${top}px, ${at(top, 0)}px ${top}px, ${at(bottom, 0)}px ${bottom}px, ${at(bottom, lead)}px ${bottom}px)`,
  };
}

// A rounded twelve-point burst at unit size; scaled, spun and centred per frame.
const BURST = makeStar({ points: 12, innerRadius: 0.68, outerRadius: 1, cornerRadius: 0.05 });
const [BURST_CX, BURST_CY] = BURST.transformOrigin.split(" ").map(Number);
// The burst's dips sit inside its outer radius, so it must grow past the corners by this much to cover them.
const BURST_COVER = 1 / 0.66;

/** A starburst mask from the frame centre; `e` 0..1 grows it from nothing to covering the frame. */
export function punchClip(e: number, width: number, height: number, spinDeg: number): string {
  if (e >= 1) return "none";
  // Quick off the mark but not instant: the points of the burst need a few frames on screen to read.
  const r = (Math.hypot(width, height) / 2) * BURST_COVER * (1 - (1 - e) ** 2);
  const a = (spinDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pt = (x: number, y: number) => {
    const dx = x - BURST_CX;
    const dy = y - BURST_CY;
    return `${(width / 2 + r * (dx * cos - dy * sin)).toFixed(1)} ${(height / 2 + r * (dx * sin + dy * cos)).toFixed(1)}`;
  };
  const d = BURST.instructions
    .map((ins) => {
      switch (ins.type) {
        case "M":
        case "L":
          return `${ins.type} ${pt(ins.x, ins.y)}`;
        case "C":
          return `C ${pt(ins.cp1x, ins.cp1y)} ${pt(ins.cp2x, ins.cp2y)} ${pt(ins.x, ins.y)}`;
        case "Z":
          return "Z";
        default:
          return "";
      }
    })
    .join(" ");
  return `path("${d}")`;
}
