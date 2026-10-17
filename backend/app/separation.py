import os
from collections.abc import Callable
from pathlib import Path

import torch
from demucs.api import Separator, save_audio


def _device() -> str:
    return "mps" if torch.backends.mps.is_available() else "cpu"


def isolate_vocals(audio: Path, out: Path, on_progress: Callable[[float], None] | None = None) -> Path:
    """Writes the vocals stem to `out` (wav) and returns it; `on_progress` gets a 0-1 fraction per chunk."""

    def callback(info: dict) -> None:
        if on_progress and info.get("state") == "start" and info.get("audio_length"):
            on_progress(min(1.0, info["segment_offset"] / info["audio_length"]))

    separator = Separator(model="htdemucs", device=_device(), callback=callback)
    _, stems = separator.separate_audio_file(audio)
    # Callers reuse an existing stem, so it only appears once complete; the temp name keeps .wav for format detection.
    tmp = out.with_name(f".{out.stem}.tmp{out.suffix}")
    try:
        save_audio(stems["vocals"], str(tmp), samplerate=separator.samplerate)
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)
    return out
