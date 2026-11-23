"""The analyze -> (separate vocals -> align lyrics) pipeline run as a single background job."""

from pathlib import Path

from app import lyric_tags, sections as section_edits
from app.alignment import align_lines
from app.analysis import analyze
from app.jobs import ProcessJob
from app.models import AnalysisData, Project, SectionEdit
from app.projects_store import write_atomic
from app.separation import isolate_vocals

# Share of the progress bar each stage owns; separation dominates the wall-clock time.
ANALYZE_END = 0.15
SEPARATE_END = 0.65
# Refining word timings is most of the time alignment takes.
REFINE_START = 0.75


def run(d: Path, project: Project, job: ProcessJob) -> list[SectionEdit] | None:
    """Returns the section edits the lyrics' metatags made (so the caller can re-index the plan, storyboard and notes), else None."""
    # The sections before this run, for carrying the style and scenes over to new ones.
    previous = AnalysisData.model_validate_json((d / "analysis.json").read_text()) if (d / "analysis.json").exists() else None
    job.report("analyzing", 0.02)
    analysis = analyze(d / "audio.mp3")
    write_atomic(d / "analysis.json", analysis.model_dump_json())
    job.report("analyzing", ANALYZE_END)

    text, tags = lyric_tags.parse(project.lyrics_text)
    if not (text.strip() and project.settings.lyric_video):
        return None

    vocals = d / "vocals.wav"
    if not vocals.exists():  # separation is the slow step; reuse across re-aligns
        job.report("separating vocals", ANALYZE_END)
        isolate_vocals(
            d / "audio.mp3",
            vocals,
            on_progress=lambda frac: job.report("separating vocals", ANALYZE_END + frac * (SEPARATE_END - ANALYZE_END)),
        )
    job.report("aligning lyrics", SEPARATE_END)
    lyrics, sources = align_lines(vocals, text, on_stage=lambda stage: job.report(stage, REFINE_START))
    write_atomic(d / "lyrics.json", lyrics.model_dump_json())
    if not tags:
        return None

    # The tags set the sections. The cuts are left as the lines' starts: they are snapped to the downbeat when the video is made.
    old = previous.sections if previous else []
    edits = lyric_tags.sections_from_tags(tags, lyrics, sources, old, analysis.duration)
    if not edits:
        return None
    try:
        sections = section_edits.validate(edits, analysis.duration, len(old))
    except ValueError:
        return None
    write_atomic(d / "analysis.json", analysis.model_copy(update={"sections": sections}).model_dump_json())
    return edits
