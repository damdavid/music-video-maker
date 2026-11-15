import type { Section, SectionEdit } from "../../shared/types";

/** Matches the backend's floor for a hand-placed section. */
export const MIN_SECTION_S = 1;

const round = (t: number) => Math.round(t * 1000) / 1000;
const keep = (sections: Section[]): SectionEdit[] => sections.map((s, i) => ({ start: s.start, end: s.end, label: s.label, from_index: i }));

/** Splits section i at t (default: its middle). The new second half starts from a copy of section i's scene, style and description. */
export function splitSection(sections: Section[], i: number, at?: number): SectionEdit[] {
  const s = sections[i];
  const t = round(at ?? (s.start + s.end) / 2);
  if (t - s.start < MIN_SECTION_S || s.end - t < MIN_SECTION_S) throw new Error(`Each half must be at least ${MIN_SECTION_S}s long`);
  const edits = keep(sections);
  edits.splice(i, 1, { ...edits[i], end: t }, { start: t, end: s.end, label: `${s.label} 2`, from_index: i });
  return edits;
}

/** Moves the start of section i (and so the end of the one before) to t. */
export function moveStart(sections: Section[], i: number, t: number): SectionEdit[] {
  const at = round(t);
  const lo = sections[i - 1].start + MIN_SECTION_S;
  const hi = sections[i].end - MIN_SECTION_S;
  if (!Number.isFinite(at) || at < lo || at > hi) throw new Error(`Section ${i + 1} must start between ${lo.toFixed(2)}s and ${hi.toFixed(2)}s`);
  const edits = keep(sections);
  edits[i - 1].end = at;
  edits[i].start = at;
  return edits;
}

/** Removes section i; the neighbour before it (or after, for the first) takes over its time and keeps its own scene. */
export function removeSection(sections: Section[], i: number): SectionEdit[] {
  if (sections.length < 2) throw new Error("A song needs at least one section");
  const edits = keep(sections);
  if (i > 0) edits[i - 1].end = sections[i].end;
  else edits[1].start = 0;
  edits.splice(i, 1);
  return edits;
}

export function renameSection(sections: Section[], i: number, label: string): SectionEdit[] {
  const edits = keep(sections);
  edits[i].label = label.trim() || sections[i].label;
  return edits;
}
