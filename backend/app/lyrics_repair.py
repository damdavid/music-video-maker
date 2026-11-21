"""Repairs lyric timings that cannot be right, so one bad edit can't make lines vanish from the video."""

from app.models import Line, Lyrics, Word

# No sung word lasts this long; a longer one is a corrupt time (a line rescaled from a collapsed span can reach thousands of seconds).
MAX_WORD_S = 20.0
FALLBACK_WORD_S = 0.5


def _clamp(t: float, duration: float | None) -> float:
    t = max(t, 0.0)
    return min(t, duration) if duration else t


def _repair_words(words: list[Word], duration: float | None) -> list[Word]:
    out = []
    for i, w in enumerate(words):
        start = _clamp(w.start, duration)
        broken = w.end < start or w.end - start > MAX_WORD_S or (duration is not None and w.end > duration)
        if broken:
            # The word ends where the next begins, or a short moment later if nothing follows.
            nxt = _clamp(words[i + 1].start, duration) if i + 1 < len(words) else None
            end = nxt if nxt is not None and nxt > start else start + FALLBACK_WORD_S
            end = _clamp(end, duration)
        else:
            end = w.end
        out.append(w.model_copy(update={"start": start, "end": max(end, start)}))
    return out


def repair(lyrics: Lyrics, duration: float | None = None) -> Lyrics:
    """The lyrics with every time inside the song and every line's bounds equal to its words' extent."""
    lines = []
    for line in lyrics.lines:
        if line.words:
            words = _repair_words(line.words, duration)
            lines.append(line.model_copy(update={"words": words, "start": min(w.start for w in words), "end": max(w.end for w in words)}))
        else:
            start = _clamp(line.start, duration)
            lines.append(line.model_copy(update={"start": start, "end": max(_clamp(line.end, duration), start)}))
    return Lyrics(lines=lines)
