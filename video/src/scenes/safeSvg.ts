// Strict allowlist parser for SVG written by an LLM. Mirrors backend/app/svgsafe.py: anything not explicitly allowed is
// dropped, and the result is a plain tree that React rebuilds element by element. Raw markup is never injected.
// Both implementations are tested against shared/svg-fixtures.json.

export type SafeNode = { tag: string; attrs: Record<string, string>; children: SafeNode[] };

const MAX_CHARS = 60_000;
const MAX_ELEMENTS = 900;
const MAX_DEPTH = 14;
const MAX_VALUE = 9_000;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const ELEMENTS = new Set([
  "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "linearGradient", "radialGradient", "stop", "clipPath", "use",
]);
const ATTRIBUTES = new Set([
  "id", "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "opacity",
  "fill-opacity", "stroke-opacity", "fill-rule", "clip-rule", "clip-path", "data-pivot", "data-face", "d", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
  "x1", "y1", "x2", "y2", "points", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "fx", "fy",
  "clipPathUnits", "viewBox", "preserveAspectRatio", "href",
]);

const ID_RE = /^[A-Za-z][A-Za-z0-9_\-:.]{0,59}$/;
const PIVOT_RE = /^\s*-?\d+(\.\d+)?\s*[ ,]\s*-?\d+(\.\d+)?\s*$/;
const FACE_RE = /^\s*-?\d+(\.\d+)?\s*[ ,]\s*-?\d+(\.\d+)?\s*[ ,]\s*\d+(\.\d+)?\s*$/;
const INTERNAL_URL_RE = /url\(\s*#[A-Za-z][A-Za-z0-9_\-:.]*\s*\)/g;
// Attributes are parsed as CSS, so backslash escapes ("\75 rl(" is "url(") and protocol-relative "//" are refused too.
const BAD_VALUE_RE = /javascript:|data:|https?:|ftp:|expression\(|@import|\/\/|[<>`"\\]/i;

function cleanValue(name: string, value: string): string | null {
  if (value.length > MAX_VALUE || BAD_VALUE_RE.test(value)) return null;
  if (/url\(/i.test(value) && /url\(/i.test(value.replace(INTERNAL_URL_RE, ""))) return null; // only same-drawing references
  if (name === "id" && !ID_RE.test(value)) return null;
  if (name === "data-pivot" && !PIVOT_RE.test(value)) return null;
  if (name === "data-face" && !FACE_RE.test(value)) return null;
  if (name === "href" && !(value.startsWith("#") && ID_RE.test(value.slice(1)))) return null;
  return value;
}

function walk(el: Element, depth: number, state: { count: number }): SafeNode | null {
  const name = el.localName;
  const ns = el.namespaceURI;
  if ((ns !== null && ns !== SVG_NS) || !ELEMENTS.has(name)) return null;
  if (depth > MAX_DEPTH) throw new Error("nested too deep");
  if (++state.count > MAX_ELEMENTS) throw new Error("too many elements");

  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    let aname = a.localName;
    if (a.namespaceURI === XLINK_NS && aname === "href") aname = "href";
    else if (a.namespaceURI !== null && a.namespaceURI !== "") continue;
    else aname = a.name; // keep dashes ("stroke-width") exactly as written
    if (name === "svg" && (aname === "width" || aname === "height")) continue; // the renderer sizes the drawing
    if (!ATTRIBUTES.has(aname)) continue;
    const v = cleanValue(aname, a.value);
    if (v !== null) attrs[aname] = v;
  }
  if (name === "use" && attrs.href === undefined) return null;

  const children: SafeNode[] = [];
  for (const child of Array.from(el.children)) {
    const c = walk(child, depth + 1, state);
    if (c) children.push(c);
  }
  return { tag: name, attrs, children };
}

/** Returns a sanitized tree, or null if the drawing can't be made safe or usable. */
export function parseSafeSvg(text: string): SafeNode | null {
  if (text.length > MAX_CHARS || /<!\s*(DOCTYPE|ENTITY)/i.test(text)) return null;
  try {
    const doc = new DOMParser().parseFromString(text.trim(), "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.localName === "parsererror" || doc.getElementsByTagName("parsererror").length > 0) return null;
    if (root.localName !== "svg" || (root.namespaceURI !== null && root.namespaceURI !== SVG_NS)) return null;
    return walk(root, 0, { count: 0 });
  } catch {
    return null;
  }
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Canonical markup for a sanitized tree (used by tests and debugging; rendering goes through React instead). */
export function serializeSafe(node: SafeNode): string {
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  const ns = node.tag === "svg" ? ` xmlns="${SVG_NS}"` : "";
  return `<${node.tag}${ns}${attrs}>${node.children.map(serializeSafe).join("")}</${node.tag}>`;
}

const cache = new Map<string, SafeNode | null>();

/** Parsing is per-string, not per-frame: scenes call this every frame with the same text. */
export function parseSafeSvgCached(text: string): SafeNode | null {
  if (!cache.has(text)) {
    if (cache.size > 64) cache.clear();
    cache.set(text, parseSafeSvg(text));
  }
  return cache.get(text) ?? null;
}

export function* walkNodes(node: SafeNode): Generator<SafeNode> {
  yield node;
  for (const c of node.children) yield* walkNodes(c);
}
