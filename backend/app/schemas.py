"""Public API contract. Keep frontend/src/types/api.ts in sync."""

import calendar
from datetime import date, datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    sample_size: int
    hac_lags: int


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
    source_url: str
    retrieved_at: str
    data_origin: Literal["live", "cache", "snapshot"]


class MonthlyNormal(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    month: int
    value: float | None
    available_years: int
    expected_years: int = 30


class CalendarPoint(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    year: int
    value: float | None
    baseline_value: float | None
    anomaly: float | None
    available_months: int
    expected_months: int


class CalendarTrend(TrendAnalysis):
    lag_unit: Literal["years"] = "years"


class CalendarPeriod(BaseModel):
    id: str
    label: str
    months: list[int]
    crosses_year: bool = False
    points: list[CalendarPoint]
    analysis: CalendarTrend | None
    warnings: list[str]


class CalendarResponse(BaseModel):
    variable: Variable
    latitude: float
    longitude: float
    start: int
    end: int
    unit: str
    original_unit: str
    baseline_start: int | None
    baseline_end: int | None
    normals: list[MonthlyNormal]
    periods: list[CalendarPeriod]
    source: str
    source_url: str
    retrieved_at: str
    data_origin: Literal["live", "cache", "snapshot"]
    warnings: list[str]


class DailyQuery(BaseModel):
    latitude: float
    longitude: float
    start: int
    end: int


class DailyRecord(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    date: date
    tmax: float | None
    tmin: float | None
    precipitation: float | None


class AnnualDailyCount(BaseModel):
    value: int | None = Field(ge=0)
    observed_count: int = Field(ge=0)
    available_days: int = Field(ge=0)


class AnnualDrySpell(AnnualDailyCount):
    start_date: date | None
    end_date: date | None
    touches_year_boundary: bool


class DailyYear(BaseModel):
    year: int
    expected_days: int
    hot_days: AnnualDailyCount
    frost_days: AnnualDailyCount
    warm_nights: AnnualDailyCount
    longest_dry_spell: AnnualDrySpell


class DailyResponse(BaseModel):
    latitude: float
    longitude: float
    start: int
    end: int
    time_standard: Literal["LST"] = "LST"
    thresholds: dict[str, str]
    daily: list[DailyRecord]
    years: list[DailyYear]
    source: str
    source_url: str
    retrieved_at: str
    data_origin: Literal["live", "cache"]
    warnings: list[str]


DailyMetric = Literal["hot_days", "frost_days", "warm_nights", "longest_dry_spell"]


class DailyTrendRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    start: int = Field(ge=1981)
    end: int = Field(ge=1981)
    years: list[DailyYear] = Field(max_length=200)

    @model_validator(mode="after")
    def validate_annual_records(self):
        if self.start > self.end or self.end >= datetime.now(timezone.utc).year:
            raise ValueError("Choose an ordered interval of complete calendar years from 1981.")
        seen = set()
        for row in self.years:
            if row.year in seen or not self.start <= row.year <= self.end:
                raise ValueError("Annual records must have unique years inside the requested interval.")
            seen.add(row.year)
            expected = 366 if calendar.isleap(row.year) else 365
            if row.expected_days != expected:
                raise ValueError("Expected days must match the calendar year, including leap days.")
            for metric in (row.hot_days, row.frost_days, row.warm_nights, row.longest_dry_spell):
                if not 0 <= metric.observed_count <= metric.available_days <= expected:
                    raise ValueError("Counts and availability must fit the calendar year.")
                if metric.value is not None and (metric.available_days != expected or metric.value != metric.observed_count):
                    raise ValueError("An exact annual value requires every relevant day and must equal its observed count.")
        return self


class DailyTrendAnalysis(TrendAnalysis):
    lag_unit: Literal["years"] = "years"
    reference_year: int
    intercept: float
    p_value_holm: float | None = Field(default=None, ge=0, le=1)
    significant: bool | None = None


class DailyMetricTrend(BaseModel):
    complete_years: int
    expected_years: int
    nonzero_years: int
    first_year: int | None
    last_year: int | None
    analysis: DailyTrendAnalysis | None
    warnings: list[str]


class DailyTrendsResponse(BaseModel):
    latitude: float
    longitude: float
    start: int
    end: int
    method: str = "Yearly OLS + HAC(1 annual lag)"
    correction: str = "Holm across four daily indices"
    family_size: int = 4
    alpha: float = 0.05
    minimum_years: int = 20
    metrics: dict[DailyMetric, DailyMetricTrend]
    warnings: list[str]


class DailyPeriodsResponse(BaseModel):
    latitude: float
    longitude: float
    start: int
    end: int
    family_size: int
    alpha: float = 0.05
    periods: list[DailyTrendsResponse]
    warnings: list[str]
