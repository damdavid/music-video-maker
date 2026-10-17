import type { AnalysisData, StylePlan } from "../../shared/types";

/** Used for previews before a Style Plan exists. */
export function fallbackPlan(analysis: AnalysisData): StylePlan {
  return {
    global: {
      palette: ["#0b1020", "#3b4a8a", "#c06c84", "#f8e9d2"],
      font_family: "Inter",
      typography_style: "bold",
      background_preset: "gradientFlow",
      grain: 0.1,
      vignette: 0.4,
    },
    sections: analysis.sections.map((_, i) => ({
      section_ref: i,
      visual_preset: "gradientFlow",
      intensity: 0.6,
      palette_shift: 0,
      camera_motion: "none",
      lyric_animation: "pop",
      transition_in: "crossfade",
    })),
    emphasis_words: [],
    rationale: "",
  };
}
