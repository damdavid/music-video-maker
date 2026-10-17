from pathlib import Path

import stable_whisper

from app.models import Line, Lyrics, Word

MODEL = "small"
# Words Whisper aligns below this probability are flagged for the editor.
LOW_CONFIDENCE = 0.5

_model = None


def _get_model():
    global _model
    if _model is None:
        # CPU: Whisper's MPS path is unreliable with stable-ts' alignment ops.
        _model = stable_whisper.load_model(MODEL, device="cpu")
    return _model


def align(audio: Path, lyrics_text: str, language: str = "en") -> Lyrics:
    text = "\n".join(line.strip() for line in lyrics_text.splitlines() if line.strip())
    # original_split keeps the user's line breaks as the segment boundaries.
    result = _get_model().align(str(audio), text, language=language, original_split=True)
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
