import copy
from collections.abc import Callable
from pathlib import Path

import stable_whisper

from app.models import Line, Lyrics, Word

MODEL = "medium"
# Words Whisper aligns below this probability are flagged for the editor.
LOW_CONFIDENCE = 0.5

REFINING = "refining timings"
# Refining nudges edges to where words are heard; a longer word, or a bigger move, means it went wrong.
MAX_REFINED_WORD_S = 20.0
MAX_REFINED_SHIFT_S = 1.5

_model = None


def _get_model():
    global _model
    if _model is None:
        # CPU: Whisper's MPS path is unreliable with stable-ts' alignment ops.
        _model = stable_whisper.load_model(MODEL, device="cpu")
    return _model


def _keep_sane(refined, before) -> None:
    """Puts back any word whose refined time is impossible, or has moved further than refining could really mean."""
    old = [w for seg in before.segments for w in seg.words]
    new = [w for seg in refined.segments for w in seg.words]
    if len(old) != len(new):
        return
    limit = max((w.end for w in old), default=0.0) + 2.0
    for was, now in zip(old, new):
        if now.start < 0 or now.end < now.start or now.end > limit or now.end - now.start > MAX_REFINED_WORD_S or abs(now.start - was.start) > MAX_REFINED_SHIFT_S:
            now.start, now.end = was.start, was.end
    # Refining clips held notes, so only starts are taken; a word keeps the end it was aligned with unless the next word now starts sooner.
    for i, (was, now) in enumerate(zip(old, new)):
        following = new[i + 1].start if i + 1 < len(new) else was.end
        now.end = max(now.start, min(was.end, following))


def align(audio: Path, lyrics_text: str, language: str = "en", on_stage: Callable[[str], None] | None = None) -> Lyrics:
    text = "\n".join(line.strip() for line in lyrics_text.splitlines() if line.strip())
    # original_split keeps the user's line breaks as the segment boundaries.
    model = _get_model()
    result = model.align(str(audio), text, language=language, original_split=True)
    if any(seg.words for seg in result.segments):
        if on_stage:
            on_stage(REFINING)
        # Alignment places a word as soon as the model is confident of it; refining mutes the audio around each edge and
        # moves it to where the word is actually heard. Slow (about 14x the alignment itself on CPU).
        before = copy.deepcopy(result)
        model.refine(str(audio), result)
        _keep_sane(result, before)
    lines = []
    for seg in result.segments:
        words = [
            Word(start=w.start, end=w.end, text=w.word.strip(), low_confidence=w.probability is not None and w.probability < LOW_CONFIDENCE)
            for w in seg.words
            if w.word.strip()
        ]
        if words:
            lines.append(Line(start=words[0].start, end=words[-1].end, text=" ".join(w.text for w in words), words=words))
    return Lyrics(lines=lines)
