import type { ObjectSize, Placement, PropKind, ResolvedObject, ResolvedScene } from "./normalize";

/** Horizontal position of each placement, as a fraction of the frame width. */
export const PLACEMENT_X: Record<Placement, number> = { left: 0.26, center: 0.5, right: 0.74 };
/** Height of a custom object relative to the scene unit (a standing figure is 1). */
export const OBJECT_SCALE: Record<ObjectSize, number> = { small: 0.22, medium: 0.4, large: 0.65 };
const PROP_SLOTS = [0.09, 0.92, 0.38, 0.64];

/**
 * Where each prop is drawn. A bench always goes under whoever sits (storyboards often list a bench among the props
 * and also have someone sit), and only falls back to a fixed slot when nobody sits.
 */
export type PropPlacement = {
  kind: PropKind;
  x: number;
  /** A bench under someone sitting, or something leant on: it stays with them rather than scrolling past with the world. */
  seat: boolean;
  /** Where it sits relative to the figure it stays with, in figure-heights (behind them for something leant on). */
  offset?: number;
};

/** What a leaning figure can lean on, in order of preference. */
const LEANABLE: PropKind[] = ["signpost", "lamp", "tree", "fence"];

export function propPlacements(scene: ResolvedScene): PropPlacement[] {
  const sitterXs = [...new Set(scene.characters.filter((c) => c.action === "sit").map((c) => PLACEMENT_X[c.placement]))];
  const out: PropPlacement[] = [];
  scene.props.forEach((kind, i) => {
    if (kind === "bench" && sitterXs.length > 0) return;
    out.push({ kind, x: PROP_SLOTS[i % PROP_SLOTS.length], seat: false });
  });
  for (const x of sitterXs) out.push({ kind: "bench", x, seat: true });
  // Someone leaning has something behind them: one of the scene's own props if there is one, else a lamp.
  const faces = facings(scene);
  scene.characters.forEach((c, i) => {
    if (c.action !== "lean") return;
    const at = out.findIndex((p) => !p.seat && LEANABLE.includes(p.kind));
    const kind = at >= 0 ? out.splice(at, 1)[0].kind : "lamp";
    out.push({ kind, x: PLACEMENT_X[c.placement], seat: true, offset: faces[i] === "right" ? -0.11 : 0.11 });
  });
  return out;
}

/** Custom objects to draw: skips references to objects that don't exist or have no art yet. */
export function objectPlacements(scene: ResolvedScene, objects: ResolvedObject[]): { id: string; svg: string; x: number; scale: number }[] {
  return scene.objects.flatMap((ref) => {
    const o = objects.find((x) => x.id === ref.object_id);
    return o?.svg ? [{ id: o.id, svg: o.svg, x: PLACEMENT_X[ref.placement], scale: OBJECT_SCALE[o.size] }] : [];
  });
}


/**
 * Which way each character in the scene faces. Someone who looks at another character turns to face them (so two people
 * who look at each other face each other); everyone else keeps the facing the storyboard gave them.
 */
export function facings(scene: ResolvedScene): ("left" | "right")[] {
  const x = new Map(scene.characters.map((c) => [c.character_id, PLACEMENT_X[c.placement]]));
  return scene.characters.map((c) => {
    const target = c.lookAt && c.lookAt !== "camera" ? x.get(c.lookAt) : undefined;
    const mine = PLACEMENT_X[c.placement];
    return target === undefined || target === mine ? c.facing : target < mine ? "left" : "right";
  });
}
