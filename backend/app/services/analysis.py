"""Exploratory seasonal linear trend with HAC uncertainty, not causal attribution."""

import math

import numpy as np
import statsmodels.api as sm

from ..schemas import Observation, TrendAnalysis


def analyze_trend(series: list[Observation]) -> tuple[TrendAnalysis | None, list[str]]:
    observations = sorted(
        (point for point in series if point.value is not None), key=lambda point: point.date
    )
    if not observations:
        return None, ["No trend was estimated because observations are unavailable."]
    month_index = np.array([point.date.year * 12 + point.date.month - 1 for point in observations])
    span = (month_index[-1] - month_index[0] + 1) / 12
    # Product quality thresholds, not universal definitions of statistical adequacy.
    if len(observations) < 60 or span < 5:
        return None, ["For this exploratory model, use at least 60 observations spanning five years."]
    if len(observations) / (span * 12) < 0.8:
        return None, ["More than 20% of the observed time span is missing; trend estimation is withheld."]
    values = np.array([point.value for point in observations], dtype=float)
    time_years = (month_index - month_index[0]) / 12
    months = np.array([point.date.month for point in observations])
    levels = sorted(set(months.tolist()))
    if len(levels) != 12:
        return None, ["All calendar months are needed to estimate this seasonal model."]
    design = np.column_stack(
        [np.ones(len(values)), time_years] + [(months == month).astype(float) for month in levels[1:]]
    )
    lag = min(12, len(values) - 1)
    method = "Seasonal OLS + HAC(12)"
    if float(np.ptp(values)) <= 1e-12:
        return TrendAnalysis(
            method=method, slope_per_year=0, slope_per_decade=0,
            ci95_per_decade=None, p_value=None, sample_size=len(values), hac_lags=lag,
        ), ["The series is constant; a significance test is not defined."]
    fitted = sm.OLS(values, design).fit(
        cov_type="HAC", cov_kwds={"maxlags": lag, "use_correction": True}, use_t=True
    )
    slope = float(fitted.params[1])
    interval = fitted.conf_int(alpha=0.05)[1] * 10
    p_value = float(fitted.pvalues[1])
    warnings = [
        "Exploratory linear model with calendar-month effects and HAC uncertainty (12 monthly lags). Results depend on the chosen period and model; they do not establish a cause."
    ]
    if not math.isfinite(slope):
        return None, ["The trend could not be estimated reliably for this selection."]
    ci = (float(interval[0]), float(interval[1])) if np.all(np.isfinite(interval)) else None
    p = p_value if math.isfinite(p_value) else None
    if np.max(np.diff(month_index)) > 1:
        ci = None
        p = None
        warnings.append("The slope uses available observations, but significance is withheld because missing months interrupt the monthly HAC spacing.")
    return TrendAnalysis(
        method=method, slope_per_year=slope, slope_per_decade=slope * 10,
        ci95_per_decade=ci, p_value=p, sample_size=len(values), hac_lags=lag,
    ), warnings
