from typing import Annotated, Literal, get_args

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.svgsafe import MAX_CHARS as SVG_MAX_CHARS
from app.svgsafe import sanitize_svg

FPS = 30

# The renderer's vocabulary; the Style Plan can only pick from these.
VisualPreset = Literal["gradientFlow", "particleField", "spectrumRings", "geometricGrid", "tunnel", "waveformRibbon", "ripples", "halftoneBloom", "orbits"]
Look = Literal["clean", "riso"]
CameraMotion = Literal["none", "slowZoom", "drift", "shake", "pulse", "handheld"]
LyricAnimation = Literal["karaoke", "pop", "typewriter", "kinetic", "inkStamp", "dotDissolve", "handwrite"]
Transition = Literal["crossfade", "flash", "zoomThrough", "iris", "dive", "push", "whip", "wipe", "punch"]
Typography = Literal["bold", "elegant", "handwritten", "mono", "condensed"]
Effort = Literal["low", "medium", "high", "xhigh", "max"]
VisualMode = Literal["abstract", "scenes", "both"]
Illustration = Literal["library", "freeform"]
Setting = Literal["road", "city", "field", "room", "shore", "forest", "void"]
TimeOfDay = Literal["dawn", "day", "dusk", "night"]
Weather = Literal["clear", "rain", "snow", "fog"]
Action = Literal["idle", "walk", "run", "sit", "wave", "look_up", "reach", "dance", "jump", "slump"]
# Empty in a scene means "pick from the action" (the renderer's default).
Expression = Literal["neutral", "happy", "sad", "surprised", "calm", "determined"]
Prop = Literal["lamp", "bench", "tree", "house", "suitcase"]
Placement = Literal["left", "center", "right"]
ObjectSize = Literal["small", "medium", "large"]
Hair = Literal["none", "short", "long", "bun", "hat", "hood"]
Outfit = Literal["tee", "coat", "dress", "hoodie"]
HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]

VISUAL_PRESETS = get_args(VisualPreset)


class Meta(BaseModel):
    title: str = ""
    artist: str = ""
    meaning: str = ""
    genre: str = ""
    mood_tags: list[str] = Field(default_factory=list)
    energy: Literal["low", "medium", "high"] = "medium"
    influences: str = ""


class Settings(BaseModel):
    lyric_video: bool = True
    aspect: Literal["16:9", "9:16", "1:1"] = "16:9"
    resolution: Literal["720p", "1080p"] = "1080p"
    fps: int = FPS
    # Opus 5.5 effort for style-plan generation; its own default is medium, which is light for creative design.
    style_effort: Effort = "high"
    # abstract = audio-reactive graphics only; scenes = storyboard illustrations; both = scenes over the abstract visuals.
    visual_mode: VisualMode = "abstract"


class Project(BaseModel):
    id: str
    lyrics_text: str = ""
    meta: Meta = Field(default_factory=Meta)
    settings: Settings = Field(default_factory=Settings)
    # What the user wants to see in each song section; aligned by index with analysis.sections.
    section_descriptions: list[str] = Field(default_factory=list)


class Section(BaseModel):
    start: float
    end: float
    label: str


class AnalysisData(BaseModel):
    duration: float
    bpm: float
    key: str
    beats: list[float]
    downbeats: list[float]
    onsets: list[float]
    sections: list[Section]
    # Per-frame series at `fps`, normalized to 0-1.
    fps: int = FPS
    rms: list[float]
    low: list[float]
    mid: list[float]
    high: list[float]
    spectral_centroid: list[float]
    onset_strength: list[float]
    chroma: list[list[float]]


class Word(BaseModel):
    start: float
    end: float
    text: str
    low_confidence: bool = False


class Line(BaseModel):
    start: float
    end: float
    text: str
    words: list[Word] = Field(default_factory=list)


class Lyrics(BaseModel):
    lines: list[Line]


class StyleGlobal(BaseModel):
    palette: list[HexColor]
    font_family: str
    typography_style: Typography
    background_preset: VisualPreset
    grain: float = Field(default=0.0, ge=0, le=1)
    vignette: float = Field(default=0.0, ge=0, le=1)
    # riso = print finish over the whole frame (static paper grain, misregistered inks, dot screen, specks).
    look: Look = "clean"

    # A validator rather than min_length: in the schema that becomes a tuple type the web editor's palette edits don't fit.
    @field_validator("palette")
    @classmethod
    def _two_colors(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("the palette needs at least two colors; the renderer interpolates between them")
        return v


class StyleSection(BaseModel):
    section_ref: int
    visual_preset: VisualPreset
    preset_params: dict[str, float | str] = Field(default_factory=dict)
    intensity: float = Field(ge=0, le=1)
    palette_shift: float = Field(default=0.0, ge=-1, le=1)
    # Replaces the global palette for this section only; None means "use the global one".
    palette_override: list[HexColor] | None = Field(default=None, min_length=2, max_length=8)
    camera_motion: CameraMotion = "none"
    lyric_animation: LyricAnimation = "pop"
    transition_in: Transition = "crossfade"


class StylePlan(BaseModel):
    global_: StyleGlobal = Field(alias="global")
    sections: list[StyleSection]
    emphasis_words: list[str] = Field(default_factory=list)
    # Shown in the UI only; the renderer ignores it.
    rationale: str = ""


class CharacterColors(BaseModel):
    body: HexColor
    hair: HexColor
    top: HexColor
    bottom: HexColor
    accent: HexColor


class CharacterDraft(BaseModel):
    """The planned part of a character (Claude's storyboard call fills it via storyboard.LooseCharacter); art is drawn separately."""

    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_]+$")
    name: str = ""
    description: str = Field(default="", description="Who they are; shown in the editor and given to Claude for continuity")
    hair: Hair = "short"
    outfit: Outfit = "tee"
    build: float = Field(default=1.0, ge=0.85, le=1.15, description="Height scale")
    colors: CharacterColors


class CustomObjectDraft(BaseModel):
    """A user-defined prop; Claude draws it in a separate call."""

    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_]+$")
    name: str = ""
    description: str = Field(default="", description="What it looks like; given to Claude when drawing it")
    size: ObjectSize = "medium"


class CustomObject(CustomObjectDraft):
    # A 1:1 drawing that rests on its bottom edge (see svgsafe).
    svg: str | None = Field(default=None, max_length=SVG_MAX_CHARS)

    @field_validator("svg")
    @classmethod
    def _clean_svg(cls, v: str | None) -> str | None:
        return None if v is None else sanitize_svg(v, "object").svg


class SceneObject(BaseModel):
    object_id: str
    placement: Placement = "right"


class SceneCharacter(BaseModel):
    character_id: str
    action: Action = "idle"
    expression: Expression | None = None
    placement: Placement = "center"
    facing: Literal["left", "right"] = "right"


class Character(CharacterDraft):
    # Free-form art: a standing figure facing right in a 1:2 drawing, optionally with animatable parts (see svgsafe).
    svg: str | None = Field(default=None, max_length=SVG_MAX_CHARS)

    @field_validator("svg")
    @classmethod
    def _clean_svg(cls, v: str | None) -> str | None:
        return None if v is None else sanitize_svg(v, "figure").svg


class SceneDraft(BaseModel):
    section_ref: int
    description: str = Field(default="", description="One-line storyboard note")
    setting: Setting
    time_of_day: TimeOfDay = "night"
    weather: Weather = "clear"
    characters: list[SceneCharacter] = Field(default_factory=list, max_length=3)
    crowd: int = Field(default=0, ge=0, le=8, description="Faceless background silhouettes")
    props: list[Prop] = Field(default_factory=list, max_length=4)
    objects: list[SceneObject] = Field(default_factory=list, max_length=3)


class Scene(SceneDraft):
    # Overrides the storyboard's default for this scene only.
    illustration: Illustration | None = None
    # Free-form backdrop in a 16:9 drawing with the ground line at y=693 (see svgsafe); replaces sky, scenery and props.
    background_svg: str | None = Field(default=None, max_length=SVG_MAX_CHARS)

    @field_validator("background_svg")
    @classmethod
    def _clean_svg(cls, v: str | None) -> str | None:
        return None if v is None else sanitize_svg(v, "background").svg


class Storyboard(BaseModel):
    illustration: Illustration = "library"
    cast: list[Character] = Field(default_factory=list, max_length=6)
    objects: list[CustomObject] = Field(default_factory=list, max_length=8)
    scenes: list[Scene] = Field(default_factory=list)

    def effective_illustration(self, scene: "Scene") -> Illustration:
        return scene.illustration or self.illustration

    def validate_refs(self, n_sections: int) -> list[str]:
        """Problems that would make the renderer draw nothing sensible; empty when consistent."""
        ids = {c.id for c in self.cast}
        object_ids = {o.id for o in self.objects}
        problems = []
        if len(ids) != len(self.cast):
            problems.append("duplicate character ids in cast")
        if len(object_ids) != len(self.objects):
            problems.append("duplicate object ids")
        seen: set[int] = set()
        for sc in self.scenes:
            if not 0 <= sc.section_ref < n_sections:
                problems.append(f"scene refers to missing section {sc.section_ref}")
            if sc.section_ref in seen:
                problems.append(f"more than one scene for section {sc.section_ref}")
            seen.add(sc.section_ref)
            problems += [f"section {sc.section_ref}: unknown object '{o.object_id}'" for o in sc.objects if o.object_id not in object_ids]
            problems += [f"section {sc.section_ref}: unknown character '{c.character_id}'" for c in sc.characters if c.character_id not in ids]
        return problems


class ProjectSummary(BaseModel):
    id: str
    title: str
    artist: str
    modified: float = Field(description="Unix seconds of the last change to project.json")
    has_analysis: bool
    has_lyrics: bool
    has_plan: bool
    has_video: bool
    path: str = ""
    missing: bool = False


class ProcessStatus(BaseModel):
    state: Literal["queued", "running", "done", "error"]
    stage: str
    progress: float = Field(ge=0, le=1)
    error: str | None = None


class RenderStatus(BaseModel):
    state: Literal["queued", "bundling", "rendering", "encoding", "done", "error"]
    progress: float = Field(ge=0, le=1)
    clip: bool = False
    error: str | None = None
    width: int | None = None
    height: int | None = None
    fps: int | None = None
