import type { ContactKind, ObjectSize, Placement, PropKind, ResolvedObject, ResolvedScene } from "./normalize";

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


/** How far apart (in figure heights) two touching figures stand, centre to centre. */
export const CONTACT_GAP: Record<ContactKind, number> = { hug: 0.26, hold_hands: 0.36, high_five: 0.54, arm_around: 0.3 };
/** A hug or a high five is face to face; holding hands or an arm round the shoulder is side by side. */
export const faceToFace = (kind: ContactKind) => kind === "hug" || kind === "high_five";

/** Where a figure in a touching pair stands and which way it faces. `a` is the one the contact was set on. */
export type Pairing = {
  kind: ContactKind;
  role: "a" | "b";
  /** The other figure's index in scene.characters. */
  partner: number;
  /** Centre of the pair as a fraction of the frame width (the first figure's place), and this figure's offset from it in figure heights. */
  x: number;
  dx: number;
  facing: "left" | "right";
};

/**
 * Pairs the storyboard sets touching, per character (null for everyone else). The pair stands together at the first
 * figure's place: face to face with that one on the left, or side by side facing the way that one faces, that one ahead.
 */
export function pairings(scene: ResolvedScene): (Pairing | null)[] {
  const out: (Pairing | null)[] = scene.characters.map(() => null);
  scene.characters.forEach((a, i) => {
    const j = a.contact ? scene.characters.findIndex((c, k) => k !== i && c.character_id === a.contact!.partner) : -1;
    if (!a.contact || j < 0 || out[i] || out[j]) return;
    const { kind } = a.contact;
    const x = PLACEMENT_X[a.placement];
    const gap = CONTACT_GAP[kind];
    if (faceToFace(kind)) {
      out[i] = { kind, role: "a", partner: j, x, dx: -gap / 2, facing: "right" };
      out[j] = { kind, role: "b", partner: i, x, dx: gap / 2, facing: "left" };
    } else {
      const s = a.facing === "right" ? 1 : -1;
      out[i] = { kind, role: "a", partner: j, x, dx: (s * gap) / 2, facing: a.facing };
      out[j] = { kind, role: "b", partner: i, x, dx: (-s * gap) / 2, facing: a.facing };
    }
  });
  return out;
}

/**
 * Which way each character in the scene faces. A touching pair is posed by its contact; someone who looks at another
 * character turns to face them (so two people who look at each other face each other); everyone else keeps the facing
 * the storyboard gave them.
 */
export function facings(scene: ResolvedScene): ("left" | "right")[] {
  const x = new Map(scene.characters.map((c) => [c.character_id, PLACEMENT_X[c.placement]]));
  const pairs = pairings(scene);
  return scene.characters.map((c, i) => {
    const pair = pairs[i];
    if (pair) return pair.facing;
    const target = c.lookAt && c.lookAt !== "camera" ? x.get(c.lookAt) : undefined;
    const mine = PLACEMENT_X[c.placement];
    return target === undefined || target === mine ? c.facing : target < mine ? "left" : "right";
  });
}
