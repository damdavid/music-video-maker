import type { Storyboard } from "../../../shared/types";
import type { HeldKind } from "./normalize";

export type SymbolName = NonNullable<NonNullable<Storyboard["cues"]>[number]["symbol"]>;

/** How long a symbol stays beside the lead, and the longest an item handed over at a line is held. */
export const SYMBOL_S = 2.6;
export const HOLD_S = 8;

export type CueState = {
  /** The symbol showing now and how long it has been there. */
  symbol: { name: SymbolName; age: number } | null;
  /** What the lead has been handed, until a later line hands them something else. */
  holding: HeldKind | null;
};

/** What the lyric cues call for at time t. */
export function cuesAt(cues: Storyboard["cues"], t: number): CueState {
  let symbol: { at: number; name: SymbolName } | null = null;
  let holding: { at: number; kind: HeldKind } | null = null;
  for (const c of cues ?? []) {
    if (c.at > t) continue;
    if (c.symbol && (!symbol || c.at > symbol.at)) symbol = { at: c.at, name: c.symbol };
    if (c.holding && (!holding || c.at > holding.at)) holding = { at: c.at, kind: c.holding };
  }
  return {
    symbol: symbol && t - symbol.at <= SYMBOL_S ? { name: symbol.name, age: t - symbol.at } : null,
    holding: holding && t - holding.at <= HOLD_S ? holding.kind : null,
  };
}
