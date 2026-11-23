import { defaultExpression, type Mood } from "./face";
import type { Action, Character, CharacterColors, CustomObject, Scene, SceneCharacter, Setting, TimeOfDay, Weather } from "../../../shared/types";

// The generated types mark defaulted fields optional; resolve them once here so drawing code never checks.
export type Hair = NonNullable<Character["hair"]>;
export type Outfit = NonNullable<Character["outfit"]>;
export type Gender = NonNullable<Character["gender"]>;
export type Hat = NonNullable<Character["hat"]>;
export type Accessory = NonNullable<Character["accessories"]>[number];
export type HeldKind = NonNullable<SceneCharacter["holding"]>;
export type PropKind = NonNullable<Scene["props"]>[number];
export type Placement = "left" | "center" | "right";

/** What a character wears in one scene in place of their usual look; null fields keep the cast's own. */
export type ResolvedWear = { outfit: Outfit | null; hat: Hat | "none" | null; accessories: Accessory[] | null };

export type ContactKind = NonNullable<NonNullable<SceneCharacter["contact"]>["kind"]>;

export type ObjectSize = NonNullable<CustomObject["size"]>;

export type Illustration = "library" | "freeform";
export type ResolvedObject = { id: string; size: ObjectSize; svg: string | null };
export type ResolvedSceneObject = { object_id: string; placement: Placement };
export type ResolvedCharacter = { id: string; gender: Gender; hair: Hair; outfit: Outfit; hat: Hat | null; accessories: Accessory[]; build: number; colors: CharacterColors; svg: string | null };
export type ResolvedSceneCharacter = { character_id: string; action: Action; expression: Mood; placement: Placement; facing: "left" | "right"; holding: HeldKind | null; lookAt: string | null; wear: ResolvedWear | null; contact: { partner: string; kind: ContactKind } | null };
export type ResolvedScene = {
  setting: Setting;
  time_of_day: TimeOfDay;
  weather: Weather;
  characters: ResolvedSceneCharacter[];
  /** Background figures; null leaves it to the renderer (see crowd.ts). */
  crowd: number | null;
  props: PropKind[];
  objects: ResolvedSceneObject[];
  /** The mode this scene is drawn in (its own override, else the storyboard's default). */
  illustration: Illustration;
  background_svg: string | null;
};

/** For characters made before gender was a choice: a guess from hair and outfit. */
export const legacyGender = (hair: Hair, outfit: Outfit): Gender => (outfit === "dress" || hair === "long" || hair === "bun" ? "female" : "male");

export const resolveCharacter = (c: Character): ResolvedCharacter => ({
  id: c.id,
  gender: c.gender ?? legacyGender(c.hair ?? "short", c.outfit ?? "tee"),
  hair: c.hair ?? "short",
  outfit: c.outfit ?? "tee",
  hat: c.hat ?? null,
  accessories: c.accessories ?? [],
  build: c.build ?? 1,
  colors: c.colors,
  svg: c.svg ?? null,
});

export const resolveObject = (o: CustomObject): ResolvedObject => ({ id: o.id, size: o.size ?? "medium", svg: o.svg ?? null });

export const resolveScene = (s: Scene, boardDefault: Illustration = "library"): ResolvedScene => ({
  setting: s.setting,
  time_of_day: s.time_of_day ?? "night",
  weather: s.weather ?? "clear",
  characters: (s.characters ?? []).map((c) => {
    const action = c.action ?? "idle";
    return { character_id: c.character_id, action, expression: c.expression ?? defaultExpression(action), placement: c.placement ?? "center", facing: c.facing ?? "right", holding: c.holding ?? null, lookAt: c.looks_at ?? null, wear: c.wear ? { outfit: c.wear.outfit ?? null, hat: c.wear.hat ?? null, accessories: c.wear.accessories ? [...c.wear.accessories] : null } : null, contact: c.contact ? { partner: c.contact.partner, kind: c.contact.kind } : null };
  }),
  crowd: s.crowd ?? null,
  props: s.props ?? [],
  objects: (s.objects ?? []).map((o) => ({ object_id: o.object_id, placement: o.placement ?? "right" })),
  illustration: s.illustration ?? boardDefault,
  background_svg: s.background_svg ?? null,
});

/** What a cast member wears in a scene: the scene's own choices over their usual look. */
export const dressed = (ch: ResolvedCharacter, wear: ResolvedWear | null): { outfit: Outfit; hat: Hat | null; accessories: Accessory[] } => ({
  outfit: wear?.outfit ?? ch.outfit,
  hat: wear?.hat === "none" ? null : (wear?.hat ?? ch.hat),
  accessories: wear?.accessories ?? ch.accessories,
});
