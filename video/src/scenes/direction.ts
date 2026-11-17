import type { Action, Lyrics } from "../../../shared/types";
import { easeInOutSine } from "../easing";
import { smooth } from "../motion";
import { mulberry32 } from "../rng";
import { activeLineIndex, clamp } from "../timing";
import { PLACEMENT_X } from "./layout";
import type { Placement } from "./normalize";

export type ShotKind = "wide" | "medium" | "close";
export type Shot = { start: number; end: number; kind: ShotKind };
/** Where the camera looks: x as a fraction of the frame width, h as a fraction of the lead's height above the ground. */
export type Aim = { x: number; h: number };
export type Framing = { zoom: number; aim: Aim };

const ZOOM: Record<ShotKind, number> = { wide: 1, medium: 1.35, close: 1.85 };
/** Never zoom in further than this, however the section's own camera motion and the shot stack up. */
export const MAX_ZOOM = 2.4;

/** The shots that suit each action: a dancer or jumper has to stay in frame, a seated or slumped figure invites a closer look. */
const KINDS: Record<Action, ShotKind[]> = {
  idle: ["wide", "medium", "close"],
  walk: ["wide", "medium"],
  run: ["wide", "medium"],
  dance: ["wide", "medium"],
  jump: ["wide", "medium"],
  sit: ["wide", "medium", "close"],
  wave: ["wide", "medium"],
  look_up: ["medium", "close"],
  reach: ["wide", "medium"],
  slump: ["medium", "close"],
};

/** Head height as a fraction of a standing figure, which the close shot aims at. */
const HEAD_H: Partial<Record<Action, number>> = { sit: 0.66, slump: 0.78 };

const MIN_SHOT_S = 1.5;
const FALLBACK_BAR_S = 2;
/** The slow push-in over a shot. */
const PUSH = 0.07;
/** A cut lands slightly punched in and eases back, so it reads as a hit instead of a jump. */
const CUT_PUNCH = 0.05;
const CUT_SETTLE_S = 0.14;
const HELD_NOTE_S = 0.9;
const NOTE_ZOOM = 0.18;

const headHeight = (action: Action) => HEAD_H[action] ?? 0.9;

/** Bars per shot: busy sections cut every bar, calm ones hold for four. */
export const barsPerShot = (intensity: number) => (intensity >= 0.7 ? 1 : intensity >= 0.4 ? 2 : 4);

/**
 * Cuts a section into shots. Cuts fall on downbeats (every `bars`-th one), at least 1.5 s apart and from either end.
 * Which kind of shot comes next is drawn from the seed, never the same kind twice running.
 */
export function planShots(section: { start: number; end: number }, downbeats: number[], barLen: number, bars: number, action: Action, seed: number, index: number): Shot[] {
  const kinds = KINDS[action];
  const bar = barLen > 0 ? barLen : FALLBACK_BAR_S;
  let bounds = downbeats.filter((d) => d > section.start && d < section.end);
  // Without detected downbeats, fall back to an even grid from the start of the section.
  if (bounds.length === 0) bounds = Array.from({ length: Math.max(0, Math.floor((section.end - section.start) / bar)) }, (_, i) => section.start + (i + 1) * bar);
  const cuts: number[] = [section.start];
  bounds.forEach((d, i) => {
    if (i % bars !== bars - 1 && bars > 1) return;
    if (d - cuts[cuts.length - 1] >= MIN_SHOT_S && section.end - d >= MIN_SHOT_S) cuts.push(d);
  });
  cuts.push(section.end);

  const rand = mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const shots: Shot[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const prev = shots[i - 1]?.kind;
    const choices = kinds.length > 1 ? kinds.filter((k) => k !== prev) : kinds;
    // The first shot establishes the scene, so it is the widest this action allows.
    const kind = i === 0 ? kinds[0] : choices[Math.floor(rand() * choices.length)];
    shots.push({ start: cuts[i], end: cuts[i + 1], kind });
  }
  return shots;
}

/** One shot for the whole span, for scenes that aren't to be cut: the establishing shot, held. */
export const holdFirstShot = (shots: Shot[]): Shot[] => (shots.length ? [{ ...shots[0], end: shots[shots.length - 1].end }] : shots);

const shotAt = (shots: Shot[], t: number): { shot: Shot; first: boolean } => {
  let i = shots.length - 1;
  while (i > 0 && t < shots[i].start) i--;
  return { shot: shots[i], first: i === 0 };
};

/** 0..1: how much a held note (a sung word of a second or more) pulls the camera in; eases in and out around the word. */
export function heldNote(lyrics: Lyrics | null, t: number): number {
  if (!lyrics) return 0;
  const line = lyrics.lines[activeLineIndex(lyrics, t)];
  const word = line?.words?.find((w) => t >= w.start && t <= w.end && w.end - w.start >= HELD_NOTE_S);
  return word ? smooth((t - word.start) / 0.5) * smooth((word.end - t) / 0.25) : 0;
}

export type DirectCtx = { t: number; shots: Shot[]; action: Action; placement: Placement; lyrics: Lyrics | null };

/** Where the camera is looking, and how close, at time t: the current shot, its slow push, the hit of the cut, and held notes. */
export function framingFor({ t, shots, action, placement, lyrics }: DirectCtx): Framing {
  if (shots.length === 0) return { zoom: 1, aim: { x: PLACEMENT_X[placement], h: 0.45 } };
  const { shot, first } = shotAt(shots, t);
  const head = headHeight(action);
  const kindH = shot.kind === "wide" ? 0.45 : shot.kind === "medium" ? head * 0.66 : head - 0.04;
  const progress = clamp((t - shot.start) / Math.max(shot.end - shot.start, 1e-3));
  let zoom = ZOOM[shot.kind] * (1 + PUSH * easeInOutSine(progress));
  if (!first) zoom *= 1 + CUT_PUNCH * Math.exp(-Math.max(0, t - shot.start) / CUT_SETTLE_S);
  const note = heldNote(lyrics, t);
  zoom *= 1 + NOTE_ZOOM * note;
  const h = kindH + (head - 0.04 - kindH) * note;
  return { zoom: Math.min(zoom, MAX_ZOOM), aim: { x: PLACEMENT_X[placement], h } };
}
