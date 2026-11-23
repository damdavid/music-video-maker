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
Action = Literal["idle", "walk", "run", "sit", "wave", "look_up", "reach", "dance", "jump", "slump", "point", "lean", "cross_arms", "cheer"]
# A small picture that pops up beside the lead when its word is sung.
Symbol = Literal["heart", "star", "rose", "key", "door", "moon", "bird", "clock"]
# Empty in a scene means "pick from the action" (the renderer's default).
Expression = Literal["neutral", "happy", "sad", "surprised", "calm", "determined"]
Prop = Literal["lamp", "bench", "tree", "house", "suitcase", "campfire", "fence", "signpost"]
# Things a character carries; the guitar is played with both hands, the rest are held in one.
Held = Literal["umbrella", "suitcase", "microphone", "flowers", "lantern", "book", "guitar", "phone", "flag", "balloon", "cup", "sword", "shield"]
Placement = Literal["left", "center", "right"]
ObjectSize = Literal["small", "medium", "large"]
Hair = Literal["none", "short", "long", "bun", "hat", "hood"]
Gender = Literal["male", "female"]
Outfit = Literal["tee", "coat", "dress", "hoodie", "jacket", "suit", "overalls", "robe", "armor"]
Hat = Literal["cowboy", "beanie", "cap", "top_hat", "beret", "sun_hat", "helmet"]
Accessory = Literal["glasses", "sunglasses", "scarf", "headphones", "backpack"]
# A colour treatment for a section's whole picture; "none" leaves it as drawn.
Grade = Literal["none", "warm", "cool", "faded", "noir", "vivid", "dream"]
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
    # Scenes are cut into wide/medium/close shots on the downbeats; off keeps each scene to one slowly pushing shot.
    auto_cuts: bool = True
    # remotion = the flat 2D renderer with a live preview here; blender = realistic 3D, rendered only on export and much slower.
    renderer: Literal["remotion", "blender"] = "remotion"
    # The song title and artist shown at the start: through the intro until the first lyric appears (up to 8 s), or a 4 s card without lyrics.
    title_card: bool = True
    # How lyric lines fade in and out, and hand over to the next: hard (quick), normal, or gentle (slow, with the old line rising away).
    lyric_fade: Literal["hard", "normal", "gentle"] = "gentle"
    # Background figures the renderer adds on its own in intense sections (scenes can still set their own number).
    crowds: bool = True
    # Where each section change's transition comes from: chosen from how the music changes there, or from the style plan.
    transitions: Literal["music", "plan"] = "music"
    # Averages each frame over a few moments within the shutter (Remotion only); smoother motion, but renders several times slower.
    motion_blur: Literal["off", "light", "strong"] = "off"


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
    # True once the user has edited `sections`; a new analysis would replace their edits.
    sections_edited: bool = False


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
    grade: Grade = "none"


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
    # Sets the body the renderers draw. None for characters made before this was a choice; renderers then guess from hair and outfit.
    gender: Gender | None = None
    hair: Hair = "short"
    outfit: Outfit = "tee"
    # Worn over the hair; None for no hat (the older hair style "hat" is a plain brimmed hat).
    hat: Hat | None = None
    accessories: list[Accessory] = Field(default_factory=list, max_length=2)
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


ContactKind = Literal["hug", "hold_hands", "high_five", "arm_around"]


class Contact(BaseModel):
    """Two characters touching: the renderer stands the pair together and poses both so their hands meet."""

    partner: str = Field(description="Another character's id in the scene")
    kind: ContactKind


class Wear(BaseModel):
    """What a character wears in one scene instead of their usual look; a field left out keeps the cast's own."""

    outfit: Outfit | None = None
    # "none" takes the cast's hat off.
    hat: Hat | Literal["none"] | None = None
    # An empty list takes the cast's accessories off.
    accessories: list[Accessory] | None = None

    @field_validator("accessories")
    @classmethod
    def _at_most_two(cls, v: list[Accessory] | None) -> list[Accessory] | None:
        # Trimmed rather than rejected: a third accessory from Claude must not fail the whole storyboard.
        return None if v is None else list(dict.fromkeys(v))[:2]


class SceneCharacter(BaseModel):
    character_id: str
    action: Action = "idle"
    expression: Expression | None = None
    placement: Placement = "center"
    facing: Literal["left", "right"] = "right"
    holding: Held | None = None
    # Who this character looks at: another character's id in the scene (and turns to face), or "camera".
    looks_at: str | None = None
    wear: Wear | None = None
    # Set on one of the pair; the partner needs nothing.
    contact: Contact | None = None


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
    # Background figures. None lets the renderer decide from the section's energy and the action (0 means none, on purpose).
    crowd: int | None = Field(default=None, ge=0, le=8, description="Background figures")
    props: list[Prop] = Field(default_factory=list, max_length=4)
    objects: list[SceneObject] = Field(default_factory=list, max_length=3)
    # Concrete things from the creator's direction that must be clearly visible in the backdrop (a river, a lighthouse).
    include: list[str] = Field(default_factory=list, max_length=6)


class Scene(SceneDraft):
    # The creator's direction this scene was planned from, and the one its backdrop was drawn from; the editor flags a scene
    # whose section direction has changed since.
    direction_used: str = Field(default="", max_length=2000)
    art_direction: str = Field(default="", max_length=2000)
    # Overrides the storyboard's default for this scene only.
    illustration: Illustration | None = None
    # Free-form backdrop in a 16:9 drawing with the ground line at y=693 (see svgsafe); replaces sky, scenery and props.
    background_svg: str | None = Field(default=None, max_length=SVG_MAX_CHARS)

    @field_validator("background_svg")
    @classmethod
    def _clean_svg(cls, v: str | None) -> str | None:
        return None if v is None else sanitize_svg(v, "background").svg


class LineMood(BaseModel):
    """How the lead looks from this moment on, until the next mood: set per lyric line, keyed by time so it survives line edits."""

    at: float = Field(ge=0)
    expression: Expression


class LineCue(BaseModel):
    """Something that happens at a lyric line, keyed by time like a mood: a symbol pops up beside the lead, and/or they take something in hand."""

    at: float = Field(ge=0)
    symbol: Symbol | None = None
    holding: Held | None = None


class SceneRedo(BaseModel):
    """A redone scene, and any objects Claude defined for the creator's direction (their art is drawn with Draw art)."""

    scene: Scene
    new_objects: list[CustomObject] = Field(default_factory=list)


class Storyboard(BaseModel):
    illustration: Illustration = "library"
    cast: list[Character] = Field(default_factory=list, max_length=6)
    objects: list[CustomObject] = Field(default_factory=list, max_length=8)
    scenes: list[Scene] = Field(default_factory=list)
    moods: list[LineMood] = Field(default_factory=list)
    cues: list[LineCue] = Field(default_factory=list)

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


class SectionEdit(BaseModel):
    """One section of the edited song timeline. Sections must tile the song: the first starts at 0, each starts where the last ends."""

    start: float
    end: float
    label: str = Field(min_length=1, max_length=60)
    # The section (index in the current list) whose style entry, scene and description this one starts from; None for blank.
    from_index: int | None = None


class SectionsApplied(BaseModel):
    """The state that follows from a section edit, since the style plan, storyboard and descriptions are re-indexed with it."""

    sections: list[Section]
    section_descriptions: list[str]
    plan: StylePlan | None = None
    storyboard: Storyboard | None = None


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
