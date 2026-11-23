"""Metatags in the lyrics: a line like [scene], [scene 1] or [Chorus] starts a new song section at the next sung line.

The tags are taken out before the lyrics are aligned (they are never sung, shown or exported), and once the lines have times
the tags become the song's sections.
"""

import re
from dataclasses import dataclass

from app.models import Lyrics, Section, SectionEdit
from app.sections import MAX_SECTIONS, MIN_SECTION_S

# A tag at the start of a line; whatever follows it on the line is ordinary lyric text.
TAG = re.compile(r"^\s*\[([^\]]*)\]\s*(.*)$")
INTRO = "intro"


@dataclass(frozen=True)
class Tag:
    label: str
    # Index of the lyric line (in the text without tags and blank lines) that this tag precedes.
    before: int


def parse(text: str) -> tuple[str, list[Tag]]:
    """The lyrics without the tags (and without blank lines, as they are aligned), and the tags in order.

    Tags in a row before the same line collapse to the last one, and a bare [scene] (or an empty tag) is numbered
    scene 1, scene 2, ... in order.
    """
    lines: list[str] = []
    found: dict[int, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        while (m := TAG.match(line)):
            found[len(lines)] = m.group(1).strip()
            line = m.group(2).strip()
        if line:
            lines.append(line)
    tags, scenes = [], 0
    for before in sorted(found):
        label = found[before]
        if not label or label.lower() == "scene":
            scenes += 1
            label = f"scene {scenes}"
        tags.append(Tag(label[:60], before))
    return "\n".join(lines), tags


def _overlap(a: Section, start: float, end: float) -> float:
    return max(0.0, min(a.end, end) - max(a.start, start))


def sections_from_tags(tags: list[Tag], lyrics: Lyrics, sources: list[int], old: list[Section], duration: float) -> list[SectionEdit] | None:
    """The song's sections as the tags set them, or None when no tag lands on a sung line.

    A tag cuts where the first line after it starts. Whatever comes before the first cut is its own section (an
    instrumental intro) unless the first tag is right at the start. Cuts that would leave a section shorter than the
    editor allows are dropped (the earlier one stays), and each new section starts from the old one it overlaps most.
    """
    cuts: list[tuple[float, str]] = []
    for tag in tags:
        j = next((j for j, src in enumerate(sources) if src >= tag.before), None)
        if j is not None:
            cuts.append((lyrics.lines[j].start, tag.label))
    kept: list[tuple[float, str]] = []
    for t, label in cuts:
        if t > duration - MIN_SECTION_S:
            break
        if kept and t - kept[-1][0] < MIN_SECTION_S:
            continue
        kept.append((t, label))
    if not kept:
        return None
    if kept[0][0] < MIN_SECTION_S:
        kept[0] = (0.0, kept[0][1])
    else:
        kept.insert(0, (0.0, INTRO))
    kept = kept[:MAX_SECTIONS]

    edits = []
    for i, (start, label) in enumerate(kept):
        end = kept[i + 1][0] if i + 1 < len(kept) else duration
        overlaps = [_overlap(s, start, end) for s in old]
        best = max(range(len(old)), key=lambda k: overlaps[k]) if old and max(overlaps) > 0 else None
        edits.append(SectionEdit(start=start, end=end, label=label, from_index=best))
    return edits
