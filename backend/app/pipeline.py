"""The analyze -> (separate vocals -> align lyrics) pipeline run as a single background job."""

from pathlib import Path

from app.alignment import align
from app.analysis import analyze
from app.jobs import ProcessJob
from app.models import Project
from app.projects_store import write_atomic
from app.separation import isolate_vocals

# Share of the progress bar each stage owns; separation dominates the wall-clock time.
ANALYZE_END = 0.15
SEPARATE_END = 0.65
# Refining word timings is most of the time alignment takes.
REFINE_START = 0.75


def run(d: Path, project: Project, job: ProcessJob) -> None:
    job.report("analyzing", 0.02)
    write_atomic(d / "analysis.json", analyze(d / "audio.mp3").model_dump_json())
    job.report("analyzing", ANALYZE_END)

    if not (project.lyrics_text.strip() and project.settings.lyric_video):
        return

    vocals = d / "vocals.wav"
    if not vocals.exists():  # separation is the slow step; reuse across re-aligns
        job.report("separating vocals", ANALYZE_END)
        isolate_vocals(
            d / "audio.mp3",
            vocals,
            on_progress=lambda frac: job.report("separating vocals", ANALYZE_END + frac * (SEPARATE_END - ANALYZE_END)),
        )
    job.report("aligning lyrics", SEPARATE_END)
    lyrics = align(vocals, project.lyrics_text, on_stage=lambda stage: job.report(stage, REFINE_START))
    write_atomic(d / "lyrics.json", lyrics.model_dump_json())
