"""LRC and Enhanced LRC (`<mm:ss.xx>` word tags) parsing and serialization."""

import re

from app.models import Line, Lyrics, Word

_LINE_TAG = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
_WORD_TAG = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")
# Applied to the last line only, which has no following line to end it.
LAST_LINE_S = 4.0


def _secs(minutes: str, seconds: str) -> float:
    return int(minutes) * 60 + float(seconds)


def _stamp(t: float, bracket: str) -> str:
    cs = round(max(t, 0) * 100)
    body = f"{cs // 6000:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"
    return f"[{body}]" if bracket == "[" else f"<{body}>"


def parse(text: str) -> Lyrics:
    entries: list[tuple[float, str]] = []
    for raw in text.splitlines():
        tags = list(_LINE_TAG.finditer(raw))
        if not tags:
            continue  # metadata ([ti:...]) and blank lines
        body = raw[tags[-1].end() :].strip()
        for t in tags:
            entries.append((_secs(*t.groups()), body))
    entries.sort(key=lambda e: e[0])

    lines: list[Line] = []
    for i, (start, body) in enumerate(entries):
        end = entries[i + 1][0] if i + 1 < len(entries) else start + LAST_LINE_S
        lines.append(_build_line(start, end, body))
    return Lyrics(lines=lines)


def _build_line(start: float, end: float, body: str) -> Line:
    tags = list(_WORD_TAG.finditer(body))
    if not tags:
        return Line(start=start, end=end, text=body)
    last = tags[-1]
    if not body[last.end() :].strip():
        end = _secs(*last.groups())  # trailing end tag is authoritative
    words: list[Word] = []
    for i, tag in enumerate(tags):
        seg_end = tags[i + 1].start() if i + 1 < len(tags) else len(body)
        word = body[tag.end() : seg_end].strip()
        if not word:
            continue  # trailing end tag
        w_start = _secs(*tag.groups())
        w_end = _secs(*tags[i + 1].groups()) if i + 1 < len(tags) else end
        words.append(Word(start=w_start, end=w_end, text=word))
    return Line(start=start, end=end, text=" ".join(w.text for w in words), words=words)


def serialize(lyrics: Lyrics, enhanced: bool = False) -> str:
    out = []
    for line in lyrics.lines:
        if enhanced and line.words:
            parts = [f"{_stamp(w.start, '<')}{w.text}" for w in line.words]
            body = " ".join(parts) + f" {_stamp(line.words[-1].end, '<')}"
        else:
            body = line.text
        out.append(f"{_stamp(line.start, '[')}{body}")
    return "\n".join(out) + "\n"
