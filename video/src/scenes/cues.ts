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
  /** How long the item has been in hand. */
  holdAge: number | null;
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
  const held = holding && t - holding.at <= HOLD_S ? holding : null;
  return {
    symbol: symbol && t - symbol.at <= SYMBOL_S ? { name: symbol.name, age: t - symbol.at } : null,
    holding: held ? held.kind : null,
    holdAge: held ? t - held.at : null,
  };
}

/** The colour each symbol and handed-over item gives the lyric line while it is in play. */
export const SYMBOL_COLOR: Record<SymbolName, string> = { heart: "#ff6b86", star: "#ffd84a", rose: "#e24a66", key: "#f0c24a", door: "#d89a64", moon: "#f4e7a8", bird: "#5ab4ea", clock: "#e8e2d0" };
export const HELD_COLOR: Record<HeldKind, string> = { umbrella: "#e8a33d", suitcase: "#c98f5a", microphone: "#d4d8e2", flowers: "#f08aa8", lantern: "#ffcf7a", book: "#d96a6a", guitar: "#d9944a", phone: "#bfe3ff", sword: "#c9d0dc", flag: "#e8566a", balloon: "#e8566a", cup: "#f1e6d8" };

/** A soft tint for the lyrics: strong while a symbol is up (in and out over a fraction of a second), gentler while an item is in hand. */
export function cueTint(state: CueState): { color: string; amount: number } | null {
  const ramp = (age: number, length: number) => Math.max(0, Math.min(1, age / 0.3, (length - age) / 0.6));
  const symbol = state.symbol ? { color: SYMBOL_COLOR[state.symbol.name], amount: 0.6 * ramp(state.symbol.age, SYMBOL_S) } : null;
  const held = state.holding && state.holdAge !== null ? { color: HELD_COLOR[state.holding], amount: 0.3 * ramp(state.holdAge, HOLD_S) } : null;
  const best = symbol && held ? (symbol.amount >= held.amount ? symbol : held) : (symbol ?? held);
  return best && best.amount > 0.005 ? best : null;
}
