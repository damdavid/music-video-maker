import type { Action, BackgroundPreset, Character, SceneCharacter, Storyboard, StyleSection, CameraMotion, CustomObject, Expression, Hair, Look, LyricAnimation, Outfit, Placement, Setting, StyleEffort, TimeOfDay, TransitionIn, TypographyStyle, VisualMode, Weather } from "../../shared/types";

// Must match the Literals in backend/app/models.py; `satisfies` flags values the types don't allow.
export const VISUAL_PRESETS = ["gradientFlow", "particleField", "spectrumRings", "geometricGrid", "tunnel", "waveformRibbon", "ripples", "halftoneBloom", "orbits"] as const satisfies readonly BackgroundPreset[];
export const CAMERA_MOTIONS = ["none", "slowZoom", "drift", "shake", "pulse", "handheld"] as const satisfies readonly CameraMotion[];
export const LYRIC_ANIMATIONS = ["karaoke", "pop", "typewriter", "kinetic", "inkStamp", "dotDissolve", "handwrite"] as const satisfies readonly LyricAnimation[];
export const TRANSITIONS = ["crossfade", "flash", "zoomThrough", "iris", "dive", "push", "whip", "wipe", "punch"] as const satisfies readonly TransitionIn[];
export const TYPOGRAPHY = ["bold", "elegant", "handwritten", "mono", "condensed"] as const satisfies readonly TypographyStyle[];
export const LOOKS = ["clean", "riso"] as const satisfies readonly Look[];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly StyleEffort[];

export const VISUAL_MODES = ["abstract", "scenes", "both"] as const satisfies readonly VisualMode[];
export const SETTINGS = ["road", "city", "field", "room", "shore", "forest", "void"] as const satisfies readonly Setting[];
export const TIMES = ["dawn", "day", "dusk", "night"] as const satisfies readonly TimeOfDay[];
export const WEATHERS = ["clear", "rain", "snow", "fog"] as const satisfies readonly Weather[];
export const ACTIONS = ["idle", "walk", "run", "sit", "wave", "look_up", "reach", "dance", "jump", "slump", "point", "lean", "cross_arms", "cheer"] as const satisfies readonly Action[];
export const EXPRESSIONS = ["neutral", "happy", "sad", "surprised", "calm", "determined"] as const satisfies readonly NonNullable<Expression>[];
export const PLACEMENTS = ["left", "center", "right"] as const satisfies readonly Placement[];
export const HAIRS = ["none", "short", "long", "bun", "hat", "hood"] as const satisfies readonly Hair[];
export const OUTFITS = ["tee", "coat", "dress", "hoodie", "jacket", "suit", "overalls"] as const satisfies readonly Outfit[];
export const HATS = ["cowboy", "beanie", "cap", "top_hat", "beret", "sun_hat"] as const satisfies readonly NonNullable<Character["hat"]>[];
export const ACCESSORIES = ["glasses", "sunglasses", "scarf", "headphones", "backpack"] as const satisfies readonly NonNullable<Character["accessories"]>[number][];
export const GRADES = ["none", "warm", "cool", "faded", "noir", "vivid", "dream"] as const satisfies readonly NonNullable<StyleSection["grade"]>[];
/** Pictures that can pop up beside the lead at a lyric line; must match `Symbol` in backend/app/models.py. */
export const SYMBOLS = ["heart", "star", "rose", "key", "door", "moon", "bird", "clock"] as const satisfies readonly NonNullable<NonNullable<Storyboard["cues"]>[number]["symbol"]>[];
export const GENDERS = ["male", "female"] as const;
/** What a character can carry; must match `Held` in backend/app/models.py. */
export const HELD = ["umbrella", "suitcase", "microphone", "flowers", "lantern", "book", "guitar", "phone", "flag", "balloon", "cup"] as const satisfies readonly NonNullable<SceneCharacter["holding"]>[];

/** For characters made before gender was a choice: a guess from hair and outfit, shown in the editor so it can be changed. */
export const legacyGender = (hair: Hair | undefined, outfit: Outfit | undefined): (typeof GENDERS)[number] =>
  outfit === "dress" || hair === "long" || hair === "bun" ? "female" : "male";
export const PROP_KINDS = ["lamp", "bench", "tree", "house", "suitcase", "campfire", "fence", "signpost"] as const;
export const ILLUSTRATIONS = ["library", "freeform"] as const;
export const OBJECT_SIZES = ["small", "medium", "large"] as const satisfies readonly NonNullable<CustomObject["size"]>[];
