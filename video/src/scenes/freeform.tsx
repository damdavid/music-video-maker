import { createElement, type ReactNode } from "react";
import type { Action } from "../../../shared/types";
import { Face, type Mood } from "./face";
import { ContactShadow } from "./Figure";
import type { Pose } from "./rig";
import { walkNodes, type SafeNode } from "./safeSvg";

export const PARTS = ["head", "torso", "arm_l", "forearm_l", "arm_r", "forearm_r", "leg_l", "shin_l", "leg_r", "shin_r"] as const;
export type Part = (typeof PARTS)[number];

/**
 * Rotation (degrees, SVG clockwise) for each named part. A figure is drawn facing right with limbs hanging down, so a
 * forward swing (positive in the rig) is counter-clockwise. Nested parts (forearm inside arm) compose automatically.
 */
export function partAngles(pose: Pose): Record<Part, number> {
  return {
    head: pose.head,
    torso: pose.lean,
    arm_l: -pose.armL[0],
    forearm_l: -pose.armL[1],
    arm_r: -pose.armR[0],
    forearm_r: -pose.armR[1],
    leg_l: -pose.legL[0],
    shin_l: -pose.legL[1],
    leg_r: -pose.legR[0],
    shin_r: -pose.legR[1],
  };
}

const camel = (name: string) => (name.startsWith("data-") ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

/** Gives every id (and reference to it) in a drawing a unique prefix, so two drawings on screen never clash. */
function prefixed(value: string, prefix: string): string {
  return value.replace(/url\(\s*#([^)\s]+)\s*\)/g, (_, id: string) => `url(#${prefix}${id})`);
}

export function parsePivot(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const [x, y] = raw.split(/[ ,]+/).map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export function parseFace(raw: string | undefined): [number, number, number] | null {
  if (!raw) return null;
  const [cx, cy, r] = raw.split(/[ ,]+/).map(Number);
  return Number.isFinite(cx) && Number.isFinite(cy) && r > 0 ? [cx, cy, r] : null;
}

/** Rebuilds React elements from a sanitized tree. `extra` can add a transform to a node (used to animate parts) and
 *  `append` can add children after a node's own (used to draw the face inside the head, so it turns with it). */
export function renderSafe(
  node: SafeNode,
  key: string | number,
  prefix: string,
  extra?: (n: SafeNode) => string | undefined,
  append?: (n: SafeNode) => ReactNode,
): ReactNode {
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === "viewBox" || name === "preserveAspectRatio") continue;
    if (name === "id") props.id = prefix + value;
    else if (name === "href") props.href = "#" + prefix + value.slice(1);
    else props[camel(name)] = prefixed(value, prefix);
  }
  const added = extra?.(node);
  if (added) props.transform = [node.attrs.transform, added].filter(Boolean).join(" ");
  const children = node.children.map((c, i) => renderSafe(c, i, prefix, extra, append));
  const appended = append?.(node);
  if (appended) children.push(appended);
  // The root <svg> becomes a <g>: the caller supplies the one real <svg> and viewBox.
  return createElement(node.tag === "svg" ? "g" : node.tag, props, ...children);
}

export function viewBoxOf(art: SafeNode, fallback: [number, number, number, number]): [number, number, number, number] {
  const parts = (art.attrs.viewBox ?? "").split(/[ ,]+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? (parts as [number, number, number, number]) : fallback;
}

type FigureProps = {
  art: SafeNode;
  uid: string;
  pose: Pose;
  action: Action;
  t: number;
  /** Beats elapsed (see beatPhase). */
  beat: number;
  x: number;
  y: number;
  size: number;
  facing: "left" | "right";
  mood: Mood;
  faceColor: string;
  shadow?: string;
};

const SEAT_HEIGHT = 0.26; // seat height in figure-heights; matches the library bench

/** Sway applied to the whole drawing when it has no limbs to animate, so a static figure still moves. */
function genericSway(action: Action, t: number, beat: number): number {
  switch (action) {
    case "walk":
      return 2.5 * Math.sin((t / 1.1) * Math.PI * 2);
    case "run":
      return 3.5 * Math.sin((t / 0.65) * Math.PI * 2);
    case "dance":
      return 5 * Math.sin(Math.PI * beat);
    case "wave":
      return 1.5 * Math.sin(t * Math.PI * 2);
    default:
      return 0;
  }
}

// A drawing is parsed once and drawn every frame, so its id lookup is kept with it.
const idIndex = new WeakMap<SafeNode, Map<string, SafeNode>>();

function nodesById(art: SafeNode): Map<string, SafeNode> {
  let present = idIndex.get(art);
  if (!present) {
    present = new Map();
    for (const n of walkNodes(art)) if (n.attrs.id) present.set(n.attrs.id, n);
    idIndex.set(art, present);
  }
  return present;
}

export const FreeformFigure = ({ art, uid, pose, action, t, beat, x, y, size, facing, mood, faceColor, shadow }: FigureProps) => {
  const [minX, minY, vbW, vbH] = viewBoxOf(art, [0, 0, 100, 200]);
  const present = nodesById(art);
  const hasLimbs = ["arm_l", "arm_r", "leg_l", "leg_r"].some((p) => present.has(p));
  const angles = partAngles(pose);

  const hipPivot = parsePivot(present.get("leg_l")?.attrs["data-pivot"] ?? present.get("leg_r")?.attrs["data-pivot"]);
  const hipHeight = hipPivot ? (minY + vbH - hipPivot[1]) / vbH : 0.5;
  const sitDrop = action === "sit" ? Math.max(0, hipHeight - SEAT_HEIGHT) * vbH : 0;

  const sway = (present.has("torso") ? 0 : pose.lean * 0.6) + (hasLimbs ? 0 : genericSway(action, t, beat));
  const cx = minX + vbW / 2;
  const bottom = minY + vbH;
  const s = size / vbH;
  const flip = facing === "left" ? -1 : 1;

  const rotatePart = (n: SafeNode): string | undefined => {
    const id = n.attrs.id as Part | undefined;
    if (!id || !(PARTS as readonly string[]).includes(id)) return undefined;
    const pivot = parsePivot(n.attrs["data-pivot"]);
    if (!pivot) return undefined; // without a pivot there is no sensible place to rotate about
    return `rotate(${angles[id].toFixed(2)} ${pivot[0]} ${pivot[1]})`;
  };

  // Drawings made before faces existed have no data-face and stay faceless.
  const face = (n: SafeNode): ReactNode => {
    if (n.attrs.id !== "head" || n.tag !== "g") return null;
    const spot = parseFace(n.attrs["data-face"]);
    if (!spot) return null;
    return <Face key="face" mood={mood} cx={spot[0]} cy={spot[1]} r={spot[2]} color={faceColor} t={t} />;
  };

  const stretch = pose.stretch ?? 1;
  const squash = stretch === 1 ? "" : ` translate(${cx} ${bottom}) scale(${(1 / Math.sqrt(stretch)).toFixed(4)} ${stretch.toFixed(4)}) translate(${-cx} ${-bottom})`;

  return (
    <g transform={`translate(${x} ${y}) scale(${flip * s} ${s}) translate(${-cx} ${-bottom})`}>
      {shadow && (
        <g transform={`translate(${cx} ${bottom}) scale(${vbH})`}>
          <ContactShadow x={0} lift={-pose.y} color={shadow} />
        </g>
      )}
      <g transform={`translate(0 ${pose.y * vbH + sitDrop}) rotate(${sway.toFixed(2)} ${cx} ${bottom})${squash}`}>
        {art.children.map((c, i) => renderSafe(c, i, `${uid}-`, rotatePart, face))}
      </g>
    </g>
  );
};

export const FreeformBackground = ({ art, uid, w, h }: { art: SafeNode; uid: string; w: number; h: number }) => {
  const [minX, minY, vbW, vbH] = viewBoxOf(art, [0, 0, 1600, 900]);
  return (
    <svg width={w} height={h} viewBox={`${minX} ${minY} ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {art.children.map((c, i) => renderSafe(c, i, `${uid}-`))}
    </svg>
  );
};
