"""Calendar-month normals, complete seasonal aggregates and yearly trend models."""

import calendar
import math
from datetime import date

import numpy as np
import statsmodels.api as sm

from ..schemas import (
    CalendarPeriod, CalendarPoint, CalendarResponse, CalendarTrend,
    MonthlyNormal, SeriesResponse, Variable,
)
from .nasa_power import ProviderError

BASELINE_START = 1991
BASELINE_END = 2020

PERIODS = [
    ("year", "Whole year", list(range(1, 13))),
    ("djf", "Dec–Feb (DJF)", [12, 1, 2]),
    ("mam", "Mar–May (MAM)", [3, 4, 5]),
    ("jja", "Jun–Aug (JJA)", [6, 7, 8]),
    ("son", "Sep–Nov (SON)", [9, 10, 11]),
    *[(f"m{month:02d}", calendar.month_name[month], [month]) for month in range(1, 13)],
]


def analyze_yearly(points: list[CalendarPoint]) -> tuple[CalendarTrend | None, list[str]]:
    """One value per calendar/season-ending year; never compress missing years."""
    complete = [point for point in points if point.value is not None]
    if len(complete) < 10:
        return None, ["This exploratory trend requires at least 10 complete years or seasons."]
    if len(complete) / len(points) < 0.8:
        return None, ["Fewer than 80% of the requested years are complete; the trend is withheld."]
    years = np.array([point.year for point in complete])
    values = np.array([point.value for point in complete], dtype=float)
    method = "Yearly OLS + HAC(1 annual lag)"
    if float(np.ptp(values)) <= 1e-12:
        return CalendarTrend(
            method=method, slope_per_year=0, slope_per_decade=0,
            sample_size=len(values), hac_lags=1,
        ), ["The aggregated series is constant; a significance test is not defined."]
    fitted = sm.OLS(values, np.column_stack([np.ones(len(values)), years - years[0]])).fit(
        cov_type="HAC", cov_kwds={"maxlags": 1, "use_correction": True}, use_t=True,
    )
    slope = float(fitted.params[1])
    if not math.isfinite(slope):
        return None, ["The aggregated trend could not be estimated reliably."]
    bounds = fitted.conf_int(alpha=0.05)[1] * 10
    ci = (float(bounds[0]), float(bounds[1])) if np.all(np.isfinite(bounds)) else None
    p = float(fitted.pvalues[1])
    p = p if math.isfinite(p) else None
    warnings = [
        "The trend uses complete yearly aggregates, OLS and HAC uncertainty with one annual lag. "
        "This exploratory model is not the all-month seasonal model shown above."
    ]
    if np.max(np.diff(years)) > 1:
        ci = p = None
        warnings.append("Missing internal years interrupt annual HAC spacing; the interval and p-value are withheld.")
    return CalendarTrend(
        method=method, slope_per_year=slope, slope_per_decade=slope * 10,
        ci95_per_decade=ci, p_value=p, sample_size=len(values), hac_lags=1,
    ), warnings


def build_calendar(source: SeriesResponse, start: int, end: int) -> CalendarResponse:
    temperature = source.variable == Variable.TEMPERATURE
    if (temperature and source.unit != "C") or (not temperature and source.unit != "mm/day"):
        raise ProviderError("The provider's units are unsupported for calendar aggregation.")
    values = {
        point.date: point.value for point in source.series
        if point.value is not None and math.isfinite(point.value)
        and (temperature or point.value >= 0)
    }
    normals: list[MonthlyNormal] = []
    if temperature:
        for month in range(1, 13):
            samples = [values[date(year, month, 1)] for year in range(BASELINE_START, BASELINE_END + 1)
                       if date(year, month, 1) in values]
            normals.append(MonthlyNormal(
                month=month, available_years=len(samples),
                value=sum(samples) / 30 if len(samples) == 30 else None,
            ))
    normal_by_month = {normal.month: normal.value for normal in normals}
    periods: list[CalendarPeriod] = []
    for identifier, label, months in PERIODS:
        points: list[CalendarPoint] = []
        for year in range(start, end + 1):
            dates = [date(year - (identifier == "djf" and month == 12), month, 1) for month in months]
            weights = [calendar.monthrange(day.year, day.month)[1] for day in dates]
            available = sum(day in values for day in dates)
            value = None
            if available == len(months):
                weighted = sum(values[day] * days for day, days in zip(dates, weights))
                value = weighted / sum(weights) if temperature else weighted
            normal = None
            if temperature and all(normal_by_month[month] is not None for month in months):
                # Use each target year's day counts, including its leap February.
                normal = sum(normal_by_month[day.month] * days for day, days in zip(dates, weights)) / sum(weights)
            points.append(CalendarPoint(
                year=year, value=value, baseline_value=normal,
                anomaly=value - normal if value is not None and normal is not None else None,
                available_months=available, expected_months=len(months),
            ))
        analysis, warnings = analyze_yearly(points)
        incomplete = sum(point.value is None for point in points)
        if incomplete:
            warnings.insert(0, f"{incomplete} requested years or seasons are incomplete and remain gaps; partial totals are not used.")
        if identifier == "djf":
            warnings.insert(0, "DJF is December of the previous year plus January and February of the labelled year.")
        periods.append(CalendarPeriod(
            id=identifier, label=label, months=months, crosses_year=identifier == "djf",
            points=points, analysis=analysis, warnings=warnings,
        ))
    warnings = list(source.warnings)
    if temperature:
        warnings.append("Reference values are separate calendar-month means for 1991–2020. This app requires all 30 values for each reference month; incomplete references yield no anomaly.")
        if any(normal.value is None for normal in normals):
            warnings.append("Part of the 1991–2020 reference is incomplete. Affected anomalies are unavailable; the reference is never replaced by the selected period.")
    else:
        warnings.append("Calendar totals in mm are derived from NASA monthly mean daily rates multiplied by the actual number of days in each month, including leap days.")
        if any(point.value is not None and point.value < 0 for point in source.series):
            warnings.append("Negative precipitation rates were excluded as invalid observations.")
    warnings.append("These monthly records cannot count hot days, frost days, warm nights or consecutive dry days. Those metrics require daily data.")
    return CalendarResponse(
        variable=source.variable, latitude=source.latitude, longitude=source.longitude,
        start=start, end=end, unit="C" if temperature else "mm", original_unit=source.unit,
        baseline_start=BASELINE_START if temperature else None,
        baseline_end=BASELINE_END if temperature else None, normals=normals, periods=periods,
        source=source.source, source_url=source.source_url, retrieved_at=source.retrieved_at,
        data_origin=source.data_origin, warnings=warnings,
    )
