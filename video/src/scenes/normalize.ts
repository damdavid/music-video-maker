import { defaultExpression, type Mood } from "./face";
import type { Action, Character, CharacterColors, CustomObject, Scene, Setting, TimeOfDay, Weather } from "../../../shared/types";

// The generated types mark defaulted fields optional; resolve them once here so drawing code never checks.
export type Hair = NonNullable<Character["hair"]>;
export type Outfit = NonNullable<Character["outfit"]>;
export type PropKind = NonNullable<Scene["props"]>[number];
export type Placement = "left" | "center" | "right";

export type ObjectSize = NonNullable<CustomObject["size"]>;

export type Illustration = "library" | "freeform";
export type ResolvedObject = { id: string; size: ObjectSize; svg: string | null };
export type ResolvedSceneObject = { object_id: string; placement: Placement };
export type ResolvedCharacter = { id: string; hair: Hair; outfit: Outfit; build: number; colors: CharacterColors; svg: string | null };
export type ResolvedSceneCharacter = { character_id: string; action: Action; expression: Mood; placement: Placement; facing: "left" | "right" };
export type ResolvedScene = {
  setting: Setting;
  time_of_day: TimeOfDay;
  weather: Weather;
  characters: ResolvedSceneCharacter[];
  crowd: number;
  props: PropKind[];
  objects: ResolvedSceneObject[];
  /** The mode this scene is drawn in (its own override, else the storyboard's default). */
  illustration: Illustration;
  background_svg: string | null;
};

export const resolveCharacter = (c: Character): ResolvedCharacter => ({
  id: c.id,
  hair: c.hair ?? "short",
  outfit: c.outfit ?? "tee",
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
    return { character_id: c.character_id, action, expression: c.expression ?? defaultExpression(action), placement: c.placement ?? "center", facing: c.facing ?? "right" };
  }),
  crowd: s.crowd ?? 0,
  props: s.props ?? [],
  objects: (s.objects ?? []).map((o) => ({ object_id: o.object_id, placement: o.placement ?? "right" })),
  illustration: s.illustration ?? boardDefault,
  background_svg: s.background_svg ?? null,
});
