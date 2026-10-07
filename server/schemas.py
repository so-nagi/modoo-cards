from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class DeckInput(Input):
    name: str = Field(min_length=1, max_length=200)


class DeckUpdate(Input):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=200000)
    descriptionFormat: Literal['html', 'markdown'] | None = None


class DeckFavoriteInput(Input):
    favorite: bool


class NoteFields(Input):
    fields: list[str] = Field(min_length=1, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=100)


class NoteInput(NoteFields):
    deckId: int
    modelId: int


class BatchInput(Input):
    deckId: int
    modelId: int
    rows: list[NoteFields] = Field(min_length=1, max_length=2000)
    requestId: str = Field(min_length=1, max_length=100)


class ModelInput(Input):
    name: str = Field(min_length=1, max_length=200)
    baseId: int


class TemplateInput(Input):
    name: str = Field(min_length=1, max_length=200)
    qfmt: str = Field(max_length=200000)
    afmt: str = Field(max_length=200000)


class ModelUpdate(Input):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    fields: list[str] | None = Field(default=None, min_length=1, max_length=100)
    templates: list[TemplateInput] | None = Field(default=None, min_length=1, max_length=50)
    css: str | None = Field(default=None, max_length=200000)


class ActionInput(Input):
    ids: list[int] = Field(min_length=1, max_length=10000)
    action: Literal['suspend', 'unsuspend', 'bury', 'unbury', 'flag', 'due', 'reset', 'delete', 'deck', 'tags']
    value: int | str | None = None


class AnswerInput(Input):
    cardId: int
    rating: int = Field(ge=1, le=4)
    token: str = Field(min_length=1, max_length=200)
    requestId: str = Field(min_length=1, max_length=100)
    elapsedMs: int = Field(default=0, ge=0, le=86400000)


class OptionsInput(Input):
    newPerDay: int = Field(default=20, ge=0, le=9999)
    reviewPerDay: int = Field(default=200, ge=0, le=9999)
    fsrs: bool = True
    desiredRetention: float = Field(default=.9, ge=.7, le=.99)
    learningSteps: str = Field(default='1m 10m', max_length=200)
    relearningSteps: str = Field(default='10m', max_length=200)


class SettingsInput(Input):
    skin: Literal['classic'] | None = None
    theme: Literal['light', 'neutral', 'dark'] | None = None
    accent: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    sounds: bool | None = None
    volume: float | None = Field(default=None, ge=0, le=1)
    heatmap: bool | None = None
    remainingTime: bool | None = None
    zen: bool | None = None
    cardFontSize: int | None = Field(default=None, ge=14, le=40)


class SchedulerPreferencesInput(Input):
    learnAheadMinutes: int = Field(strict=True, ge=0, le=60)


class ExportInput(Input):
    deckId: int | None = None
    includeScheduling: bool = True
    includeMedia: bool = True
    format: Literal['apkg', 'colpkg', 'csv'] = 'apkg'


class FilteredInput(Input):
    name: str = Field(min_length=1, max_length=200)
    search: str = Field(max_length=2000)
    limit: int = Field(default=100, ge=1, le=10000)
    reschedule: bool = True


class Mask(Input):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    groupId: UUID | None = None


class OcclusionInput(Input):
    deckId: int
    imageFilename: str = Field(min_length=1, max_length=255)
    masks: list[Mask] = Field(min_length=1, max_length=200)
    header: str = Field(default='', max_length=20000)
