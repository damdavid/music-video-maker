import type { Action } from "../../../shared/types";

/** Most background figures a scene shows. */
export const MAX_CROWD = 8;
/** Below this section intensity the renderer adds no crowd of its own. */
const AUTO_FROM = 0.55;
/** Lone, inward actions: a figure sitting or slumped is alone on purpose, so no crowd turns up. */
const SOLO: Action[] = ["sit", "slump", "look_up"];

/**
 * How many background figures a scene has. A number the storyboard gave (including 0) is used as it is; otherwise
 * intense sections get a few, more as the intensity rises, unless the lead is alone on purpose or crowds are off.
 */
export function crowdSize(set: number | null, intensity: number, lead: Action | undefined, enabled: boolean): number {
  if (set !== null) return Math.max(0, Math.min(MAX_CROWD, Math.round(set)));
  if (!enabled || intensity < AUTO_FROM || (lead && SOLO.includes(lead))) return 0;
  return Math.round(2 + ((intensity - AUTO_FROM) / (1 - AUTO_FROM)) * 4);
}

export type CrowdAction = Extract<Action, "idle" | "walk" | "dance" | "wave" | "jump">;

/**
 * What a background figure does: they follow the music, so the crowd livens up with the section (swaying, cheering with
 * a raised arm, jumping). `pick` (0..1) is the figure's own die roll, so no two do the same thing at the same time.
 */
export function crowdAction(intensity: number, pick: number, walker: boolean): CrowdAction {
  if (intensity < 0.4) return walker ? "walk" : "idle";
  if (intensity < 0.7) return pick < 0.35 ? "dance" : walker ? "walk" : "idle";
  if (intensity < 0.85) return pick < 0.5 ? "dance" : pick < 0.8 ? "wave" : "idle";
  return pick < 0.35 ? "jump" : pick < 0.7 ? "wave" : "dance";
}
