"""Edits to the song's section list; each section's style entry, scene and description move with it."""

from app.models import Section, SectionEdit, Storyboard, StyleSection, StylePlan

# Shorter than the analyzer's 2 s on purpose: a hand-placed cut is deliberate. The timeline needs room for its transition.
MIN_SECTION_S = 1.0
MAX_SECTIONS = 40
TOLERANCE = 1e-3


def prune_to(n: int, plan: StylePlan | None, board: Storyboard | None, descriptions: list[str]) -> tuple[StylePlan | None, Storyboard | None, list[str]]:
    """Drops what is keyed to a section that no longer exists (after a re-analysis found fewer sections)."""
    if plan:
        plan = plan.model_copy(update={"sections": [s for s in plan.sections if s.section_ref < n]})
    if board:
        board = board.model_copy(update={"scenes": [s for s in board.scenes if s.section_ref < n]})
    return plan, board, descriptions[:n]


def validate(edits: list[SectionEdit], duration: float, n_old: int) -> list[Section]:
    """The edits as sections, snapped exactly onto each other; ValueError says what is wrong."""
    if not edits:
        raise ValueError("a song needs at least one section")
    if len(edits) > MAX_SECTIONS:
        raise ValueError(f"at most {MAX_SECTIONS} sections")
    out: list[Section] = []
    cursor = 0.0
    for i, e in enumerate(edits):
        if abs(e.start - cursor) > TOLERANCE:
            raise ValueError("the first section must start at 0" if i == 0 else f"section {i + 1} must start where section {i} ends ({cursor:.2f}s)")
        last = i == len(edits) - 1
        end = duration if last else e.end
        if last and abs(e.end - duration) > TOLERANCE:
            raise ValueError(f"the last section must end at the end of the song ({duration:.2f}s)")
        if len(edits) > 1 and end - cursor < MIN_SECTION_S:
            raise ValueError(f"section {i + 1} is shorter than {MIN_SECTION_S:g}s")
        if e.from_index is not None and not 0 <= e.from_index < n_old:
            raise ValueError(f"section {i + 1} starts from a section that doesn't exist")
        out.append(Section(start=cursor, end=end, label=e.label.strip() or f"section_{i + 1}"))
        cursor = end
    return out


def remap_plan(plan: StylePlan, edits: list[SectionEdit]) -> StylePlan:
    by_ref = {s.section_ref: s for s in plan.sections}
    sections = []
    for k, e in enumerate(edits):
        src = by_ref.get(e.from_index) if e.from_index is not None else None
        sections.append(
            src.model_copy(deep=True, update={"section_ref": k})
            if src
            else StyleSection(section_ref=k, visual_preset=plan.global_.background_preset, intensity=0.5)
        )
    return plan.model_copy(update={"sections": sections})


def remap_storyboard(board: Storyboard, edits: list[SectionEdit]) -> Storyboard:
    by_ref = {s.section_ref: s for s in board.scenes}
    scenes = [
        by_ref[e.from_index].model_copy(deep=True, update={"section_ref": k})
        for k, e in enumerate(edits)
        if e.from_index is not None and e.from_index in by_ref
    ]
    return board.model_copy(update={"scenes": scenes})


def remap_descriptions(descriptions: list[str], edits: list[SectionEdit]) -> list[str]:
    return [descriptions[e.from_index] if e.from_index is not None and e.from_index < len(descriptions) else "" for e in edits]
