import type { Pose } from "./rig";
import type { HeldKind } from "./normalize";

/** Seconds-and-beats context the held items move with. */
export type HeldCtx = { t: number; beat: number; energy: number };

const sin = (x: number) => Math.sin(x);
const TAU = Math.PI * 2;

/** The items that take both hands. */
export const TWO_HANDED: readonly HeldKind[] = ["guitar"];

/**
 * The arms that hold an item, in the item's grip: [upper, lower] angles (degrees, positive = forward), with the small
 * motion each item has. Arms the item doesn't use keep whatever the character's action does with them.
 */
export function holdPose(pose: Pose, kind: HeldKind, { t, beat, energy }: HeldCtx): Pose {
  const sway = sin((t / 2.6) * TAU);
  switch (kind) {
    case "umbrella":
      return { ...pose, armR: [14 + 1.5 * sway, 82] };
    case "suitcase":
      // Hangs from a straight arm, swinging a little more the louder it is.
      return { ...pose, armR: [6 + 4 * energy * sway, 4] };
    case "microphone":
      return { ...pose, armR: [30 + 2 * sway, 132] };
    case "flowers":
      return { ...pose, armR: [30, 52 + 2 * sway] };
    case "lantern":
      return { ...pose, armR: [24, 22 + 3 * sway] };
    case "book":
      return { ...pose, armR: [12, 98] };
    case "phone":
      return { ...pose, armR: [26 + 2 * sway, 116] };
    case "flag":
      return { ...pose, armR: [30, 58 + 2 * sway] };
    case "balloon":
      return { ...pose, armR: [42, 20 + 3 * sway] };
    case "cup":
      return { ...pose, armR: [22, 106] };
    case "guitar": {
      // The near hand strums across the strings on the beat while the far hand holds the neck.
      const strum = sin(beat * TAU);
      return { ...pose, armR: [24 + 5 * strum, 58 + 14 * strum * (0.4 + energy)], armL: [74, 14] };
    }
  }
}
