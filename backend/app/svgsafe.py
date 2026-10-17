"""Strict allowlist sanitizer for SVG written by an LLM.

Anything not explicitly allowed is dropped. Scripts, event handlers, foreignObject, external references, CSS and
animation never survive. The renderer re-validates with the same rules (video/src/scenes/safeSvg.ts) and rebuilds
React elements from the allowlisted tree rather than injecting markup, so this is defense in depth plus early,
readable errors.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from xml.sax.saxutils import quoteattr

MAX_CHARS = 60_000
MAX_ELEMENTS = 900
MAX_DEPTH = 14
MAX_VALUE = 9_000

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

ELEMENTS = {
    "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "linearGradient", "radialGradient", "stop", "clipPath", "use",
}  # fmt: skip

ATTRIBUTES = {
    "id", "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
    "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "clip-rule", "clip-path",
    "data-pivot", "data-face", "d", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "points",
    "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "fx", "fy",
    "clipPathUnits", "viewBox", "preserveAspectRatio", "href",
}  # fmt: skip

ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-:.]{0,59}$")
PIVOT_RE = re.compile(r"^\s*-?\d+(\.\d+)?\s*[ ,]\s*-?\d+(\.\d+)?\s*$")
# Face center and head radius: "cx,cy,r".
FACE_RE = re.compile(r"^\s*-?\d+(\.\d+)?\s*[ ,]\s*-?\d+(\.\d+)?\s*[ ,]\s*\d+(\.\d+)?\s*$")
INTERNAL_URL_RE = re.compile(r"url\(\s*#[A-Za-z][A-Za-z0-9_\-:.]*\s*\)")
URL_RE = re.compile(r"url\(", re.IGNORECASE)
# Attributes are parsed as CSS, so backslash escapes ("\75 rl(" is "url(") and protocol-relative "//" are refused too.
BAD_VALUE_RE = re.compile(r"javascript:|data:|https?:|ftp:|expression\(|@import|//|[<>`\"\\]", re.IGNORECASE)
VIEWBOX_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)\s*$")

# Expected aspect ratio (width / height) of the drawing area for each kind of asset.
ASPECT = {"figure": 0.5, "background": 16 / 9, "object": 1.0}
DEFAULT_VIEWBOX = {"figure": "0 0 100 200", "background": "0 0 1600 900", "object": "0 0 200 200"}


class SvgRejected(ValueError):
    """The SVG can't be made safe or usable; the message says why, so it can be fed back to the model."""


@dataclass
class Sanitized:
    svg: str
    removed: list[str] = field(default_factory=list)


def _local(tag: str) -> tuple[str, str | None]:
    if tag.startswith("{"):
        ns, _, name = tag[1:].partition("}")
        return name, ns
    return tag, None


def _clean_value(name: str, value: str) -> str | None:
    if len(value) > MAX_VALUE or BAD_VALUE_RE.search(value):
        return None
    if URL_RE.search(value):
        # Only references to gradients/clip paths defined in the same drawing.
        rest = INTERNAL_URL_RE.sub("", value)
        if URL_RE.search(rest) or "url(" in rest.lower():
            return None
    if name == "id" and not ID_RE.match(value):
        return None
    if name == "data-pivot" and not PIVOT_RE.match(value):
        return None
    if name == "data-face" and not FACE_RE.match(value):
        return None
    if name == "href" and not (value.startswith("#") and ID_RE.match(value[1:])):
        return None
    return value


def _walk(el: ET.Element, depth: int, state: dict, removed: list[str]) -> str | None:
    name, ns = _local(el.tag)
    if ns not in (None, SVG_NS) or name not in ELEMENTS:
        removed.append(f"<{name}>")
        return None
    if depth > MAX_DEPTH:
        raise SvgRejected(f"drawing is nested more than {MAX_DEPTH} levels deep")
    state["count"] += 1
    if state["count"] > MAX_ELEMENTS:
        raise SvgRejected(f"drawing has more than {MAX_ELEMENTS} elements; simplify it")

    attrs: list[tuple[str, str]] = []
    for raw, value in el.attrib.items():
        aname, ans = _local(raw)
        if ans == XLINK_NS and aname == "href":
            aname = "href"
        elif ans is not None:
            removed.append(f"@{aname}")
            continue
        if name == "svg" and aname in ("width", "height"):
            continue  # the renderer sizes the drawing itself
        cleaned = _clean_value(aname, value) if aname in ATTRIBUTES else None
        if cleaned is None:
            removed.append(f"@{aname}")
            continue
        attrs.append((aname, cleaned))

    if name == "use" and not any(a == "href" for a, _ in attrs):
        removed.append("<use> without an internal href")
        return None

    children = "".join(c for child in el if (c := _walk(child, depth + 1, state, removed)))
    attr_s = "".join(f" {a}={quoteattr(v)}" for a, v in attrs)
    if name == "svg":
        attr_s = f' xmlns="{SVG_NS}"' + attr_s
    return f"<{name}{attr_s}>{children}</{name}>" if children else f"<{name}{attr_s}/>"


def sanitize_svg(text: str, kind: str = "figure") -> Sanitized:
    """Returns cleaned SVG, or raises SvgRejected. `kind` is "figure" (1:2 portrait), "background" (16:9) or "object" (1:1)."""
    if len(text) > MAX_CHARS:
        raise SvgRejected(f"drawing is larger than {MAX_CHARS} characters; simplify it")
    if re.search(r"<!\s*(DOCTYPE|ENTITY)", text, re.IGNORECASE):
        raise SvgRejected("DOCTYPE and ENTITY declarations are not allowed")
    try:
        root = ET.fromstring(text.strip())
    except ET.ParseError as e:
        raise SvgRejected(f"not well-formed SVG: {e}") from e
    name, ns = _local(root.tag)
    if name != "svg" or ns not in (None, SVG_NS):
        raise SvgRejected("the root element must be <svg>")

    box = root.get("viewBox")
    m = VIEWBOX_RE.match(box) if box else None
    if m:
        w, h = float(m.group(3)), float(m.group(4))
        if w <= 0 or h <= 0 or abs((w / h) / ASPECT[kind] - 1) > 0.05:
            want = DEFAULT_VIEWBOX[kind]
            raise SvgRejected(f"viewBox must have the same aspect ratio as {want} (got {box})")
    else:
        root.set("viewBox", DEFAULT_VIEWBOX[kind])

    removed: list[str] = []
    out = _walk(root, 0, {"count": 0}, removed)
    assert out is not None
    # Escaping and the added xmlns can grow the text; stored art must still pass this same check when reloaded.
    if len(out) > MAX_CHARS:
        raise SvgRejected(f"drawing is larger than {MAX_CHARS} characters once cleaned; simplify it")
    return Sanitized(svg=out, removed=sorted(set(removed)))
