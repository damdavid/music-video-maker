import type { AnalysisData } from "../../../shared/types";

export type PresetProps = {
  /** Unique per layer on screen, so ids a preset defines (gradients, filters) cannot clash during a transition. */
  uid: string;
  frame: number;
  t: number;
  width: number;
  height: number;
  analysis: AnalysisData;
  /** Darkest first, lightest last. */
  palette: string[];
  /** 0 calm .. 1 maximal. */
  intensity: number;
  seed: number;
  /** Resolved (defaulted + clamped) per-section tuning params; see params.ts. */
  params: Record<string, number>;
};
