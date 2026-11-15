"""Bounded, provider-independent contract for descriptive monthly relationships."""

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class RelationshipObservation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")

    date: date
    # Earth-system values are much smaller; a bound also prevents numerical overflow.
    value: float | None = Field(strict=True, ge=-1e12, le=1e12)

    @field_validator("date")
    @classmethod
    def require_month_start(cls, value: date) -> date:
        if value.day != 1:
            raise ValueError("Monthly observations must use the first day of their calendar month.")
        return value


class RelationshipSeries(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    unit: str = Field(min_length=1, max_length=50)
    observations: list[RelationshipObservation] = Field(max_length=6000)

    @model_validator(mode="after")
    def reject_duplicate_dates(self):
        dates = [item.date for item in self.observations]
        if len(set(dates)) != len(dates):
            raise ValueError("Each series must contain at most one observation per calendar month.")
        return self


class RelationshipRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")

    latitude: float = Field(ge=-90, le=90, strict=True)
    longitude: float = Field(ge=-180, le=180, strict=True)
    start: int = Field(ge=1981, strict=True)
    end: int = Field(ge=1981, strict=True)
    lag_months: Literal[0, 1, 2] = 0
    month: int | None = Field(default=None, ge=1, le=12, strict=True)
    detrend: bool = Field(default=True, strict=True)
    x: RelationshipSeries
    y: RelationshipSeries

    @field_validator("lag_months", mode="before")
    @classmethod
    def reject_boolean_lag(cls, value):
        if isinstance(value, bool):
            raise ValueError("Lag must be zero, one or two calendar months.")
        return value

    @model_validator(mode="after")
    def require_complete_year_interval(self):
        if self.start > self.end or self.end >= datetime.now(timezone.utc).year:
            raise ValueError("Choose an ordered interval of complete calendar years from 1981.")
        return self


class RelationshipPair(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    x_date: date
    y_date: date
    x_raw: float
    y_raw: float
    x: float
    y: float


class RelationshipResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    latitude: float
    longitude: float
    start: int
    end: int
    lag_months: int
    month: int | None
    detrended: bool
    x_name: str
    y_name: str
    x_unit: str
    y_unit: str
    pairs: list[RelationshipPair]
    pearson_r: float | None = Field(default=None, ge=-1, le=1)
    n_pairs: int
    n_years: int
    expected_pairs: int
    coverage: float = Field(ge=0, le=1)
    reference_start: int | None
    reference_end: int | None
    method: str
    seasonality: str
    p_value: None = None
    ci95: None = None
    warnings: list[str]
