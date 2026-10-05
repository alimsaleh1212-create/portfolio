"""Pydantic models for the content files. They also shape the API responses."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

PLACEHOLDER_MARKER = "PLACEHOLDER:"

StageKey = Literal["trailhead", "long-approach", "steep-switch", "ridge", "high-camp"]
"""The fixed Stage keys, in Climb order. Visits are recorded against them."""

STAGE_KEYS: tuple[StageKey, ...] = (
    "trailhead",
    "long-approach",
    "steep-switch",
    "ridge",
    "high-camp",
)

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]


class ContentModel(BaseModel):
    """Base for content models: unknown fields are errors, not silently dropped."""

    model_config = ConfigDict(extra="forbid")


class Links(ContentModel):
    """Ali's public contact links."""

    email: Text
    linkedin: Text
    github: Text


class SkillCategory(ContentModel):
    """One skills category and its items."""

    category: Text
    items: list[Text]


class Experience(ContentModel):
    """One role in Ali's experience."""

    role: Text
    organization: Text
    location: Text | None = None
    period: Text
    highlights: list[Text]


class Education(ContentModel):
    """One degree or programme."""

    title: Text
    institution: Text
    location: Text
    year: Text


class Certification(ContentModel):
    """One certification."""

    title: Text
    issuer: Text


class Profile(ContentModel):
    """The contents of `profile.yaml`; also the body of `GET /profile`."""

    name: Text
    headline: Text
    location: Text
    summary: Text
    links: Links
    skills: list[SkillCategory]
    experience: list[Experience]
    education: list[Education]
    certifications: list[Certification]


class StageContent(ContentModel):
    """One Stage as written in `stages.yaml`."""

    key: StageKey
    name: Text
    period: Text | None
    body: Text
    challenge: Text


class StagesFile(ContentModel):
    """The contents of `stages.yaml`: Stages in Climb order."""

    stages: list[StageContent]


class Metric(ContentModel):
    """One figure from the CV, split into the number and what it measures."""

    value: Text
    """The figure as the CV words it, such as `92%` or `above 90%`."""
    label: Text
    """What the figure measures, such as `classification accuracy`."""


class Project(ContentModel):
    """One Project; also an item of the Project endpoints' responses."""

    slug: Slug
    name: Text
    tagline: Text
    description: Text
    stack: list[Text]
    metrics: list[Metric]


class ProjectsFile(ContentModel):
    """The contents of `projects.yaml`: Projects in display order."""

    projects: list[Project]
