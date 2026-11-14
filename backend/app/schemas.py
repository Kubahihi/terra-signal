"""Public API contract. Keep frontend/src/types/api.ts in sync."""

from datetime import date
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Variable(StrEnum):
    TEMPERATURE = "T2M"
    PRECIPITATION = "PRECTOTCORR"


class SeriesQuery(BaseModel):
    latitude: float
    longitude: float
    variable: Variable
    start: int
    end: int


class Observation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    date: date
    value: float | None


class TrendAnalysis(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    method: str
    slope_per_year: float
    slope_per_decade: float
    ci95_per_decade: tuple[float, float] | None = None
    p_value: float | None = Field(default=None, ge=0, le=1)


class SeriesResponse(BaseModel):
    source: str
    variable: Variable
    unit: str
    latitude: float
    longitude: float
    start: int
    end: int
    series: list[Observation]
    warnings: list[str] = Field(default_factory=list)
    analysis: TrendAnalysis | None = None
