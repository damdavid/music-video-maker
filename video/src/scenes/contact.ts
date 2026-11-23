import { armTo, layout, type Pose, type Pt } from "./rig";
import type { Pairing } from "./layout";

/** Where a figure stands: its ground point and size in the frame, and which way it faces (-1 left, 1 right). */
export type Body = { pose: Pose; x: number; y: number; size: number; flip: 1 | -1 };

const toWorld = (b: Body, p: Pt): Pt => ({ x: b.x + b.flip * b.size * p.x, y: b.y + b.size * p.y });
const toLocal = (b: Body, p: Pt): Pt => ({ x: ((p.x - b.x) / b.size) * b.flip, y: (p.y - b.y) / b.size });

/** The pose with one arm reaching for a point in the frame. */
function reach(b: Body, side: "armL" | "armR", target: Pt): Pose {
  const shoulder = layout(b.pose).shoulder;
  const t = toLocal(b, target);
  return { ...b.pose, [side]: armTo(t.x - shoulder.x, t.y - shoulder.y) };
}

const joints = (b: Body) => {
  const j = layout(b.pose);
  return { hip: toWorld(b, j.hip), shoulder: toWorld(b, j.shoulder), head: toWorld(b, j.head), j };
};

/** A point on a figure's back, `along` figure-heights below the shoulder. */
const backOf = (b: Body, along: number): Pt => {
  const { shoulder } = layout(b.pose);
  return toWorld(b, { x: shoulder.x - 0.075, y: shoulder.y + along });
};

/**
 * Poses for the figures in touching pairs: they lean and tilt toward each other and an arm of each is solved so the
 * hands meet: round the other's back for a hug, joined between them for holding hands, an arm round the shoulder,
 * or meeting high up in a high five. Everyone else keeps their pose.
 */
export function contactPoses(pairs: (Pairing | null)[], bodies: Body[]): Pose[] {
  const out = bodies.map((b) => b.pose);
  pairs.forEach((p, i) => {
    if (!p || p.role !== "a") return;
    const j = p.partner;
    const a = bodies[i];
    const b = bodies[j];
    if (!b) return;
    // Lean and head tilt first, since where the shoulders are depends on them.
    const tilt: Record<Pairing["kind"], [number, number, number, number]> = {
      hug: [6, 5, 4, 4],
      hold_hands: [0, 0, 1, 1],
      high_five: [4, 4, -2, -2],
      arm_around: [0, 4, 5, 4],
    };
    const [la, lb, ha, hb] = tilt[p.kind];
    const pa: Body = { ...a, pose: { ...a.pose, lean: a.pose.lean + la, head: a.pose.head + ha } };
    const pb: Body = { ...b, pose: { ...b.pose, lean: b.pose.lean + lb, head: b.pose.head + hb } };
    switch (p.kind) {
      case "hug": {
        // The near arm of each goes round the other's upper back, the far arm to the lower back.
        const aNear = reach(pa, "armR", backOf(pb, 0.1));
        const bNear = reach(pb, "armR", backOf(pa, 0.1));
        out[i] = reach({ ...pa, pose: aNear }, "armL", backOf(pb, 0.2));
        out[j] = reach({ ...pb, pose: bNear }, "armL", backOf(pa, 0.2));
        break;
      }
      case "hold_hands": {
        // One hand of each meets between them, about hip height.
        const A = joints(pa);
        const B = joints(pb);
        const meet = { x: (A.hip.x + B.hip.x) / 2, y: (A.hip.y + B.hip.y) / 2 - 0.07 * a.size };
        out[i] = reach(pa, "armL", meet);
        out[j] = reach(pb, "armR", meet);
        break;
      }
      case "high_five": {
        const A = joints(pa);
        const B = joints(pb);
        const meet = { x: (A.head.x + B.head.x) / 2, y: Math.min(A.head.y, B.head.y) - 0.04 * a.size };
        out[i] = reach(pa, "armR", meet);
        out[j] = reach(pb, "armR", meet);
        break;
      }
      case "arm_around": {
        // The one behind puts a near arm round the other's shoulders; the one in front reaches back to their waist.
        const A = joints(pa);
        const B = joints(pb);
        out[j] = reach(pb, "armR", { x: A.shoulder.x + a.flip * 0.05 * a.size, y: A.shoulder.y + 0.015 * a.size });
        out[i] = reach(pa, "armL", { x: B.hip.x + a.flip * 0.02 * a.size, y: B.hip.y - 0.03 * a.size });
        break;
      }
    }
  });
  return out;
}
