"""Descriptive annual index trends; two-sided HAC tests and a fixed Holm family."""

import math

import numpy as np
import statsmodels.api as sm
from statsmodels.stats.multitest import multipletests

from ..schemas import DailyMetricTrend, DailyTrendAnalysis, DailyTrendRequest, DailyTrendsResponse
from .daily_indices import THRESHOLDS

MINIMUM_YEARS = 20
METHOD = "Yearly OLS + HAC(1 annual lag)"


def _analyze(request: DailyTrendRequest, metric: str) -> DailyMetricTrend:
    rows = sorted((row for row in request.years if getattr(row, metric).value is not None), key=lambda row: row.year)
    years = np.array([row.year for row in rows], dtype=int)
    values = np.array([getattr(row, metric).value for row in rows], dtype=float)
    expected = request.end - request.start + 1
    result = DailyMetricTrend(
        complete_years=len(rows), expected_years=expected,
        nonzero_years=int(np.count_nonzero(values)), first_year=rows[0].year if rows else None,
        last_year=rows[-1].year if rows else None, analysis=None, warnings=[],
    )
    if len(rows) < MINIMUM_YEARS:
        result.warnings.append(f"At least {MINIMUM_YEARS} complete annual values are required; {len(rows)} are available.")
    if len(rows) / expected < 0.8:
        result.warnings.append("Fewer than 80% of requested years are complete; the trend is withheld.")
    if result.warnings:
        return result
    if len(rows) < expected:
        result.warnings.append("Some requested years are excluded. The fitted slope describes only the complete years shown; missing years may bias it.")
    if np.ptp(values) == 0:
        result.analysis = DailyTrendAnalysis(
            method=METHOD, slope_per_year=0, slope_per_decade=0, sample_size=len(rows),
            hac_lags=1, reference_year=int(years[0]), intercept=float(values[0]),
        )
        result.warnings.append("The annual index is constant, so its significance test and confidence interval are undefined. A constant observed record does not establish an absence of change.")
        return result
    design = np.column_stack([np.ones(len(rows)), years - years[0]])
    fitted = sm.OLS(values, design).fit(
        cov_type="HAC", cov_kwds={"maxlags": 1, "use_correction": True}, use_t=True,
    )
    intercept, slope = map(float, fitted.params)
    if not math.isfinite(slope) or not math.isfinite(intercept):
        result.warnings.append("The fitted trend is nonfinite and is withheld.")
        return result
    analysis = DailyTrendAnalysis(
        method=METHOD, slope_per_year=slope, slope_per_decade=10 * slope,
        sample_size=len(rows), hac_lags=1, reference_year=int(years[0]), intercept=intercept,
    )
    result.analysis = analysis
    if np.max(np.diff(years)) > 1:
        result.warnings.append("Missing internal years interrupt annual HAC spacing; confidence intervals and p-values are withheld. Missing years are not compressed into adjacent observations.")
        return result
    if result.nonzero_years < 5:
        result.warnings.append("Fewer than five complete years have a nonzero index. The fitted rate is descriptive; inference is withheld for this sparse record.")
        return result
    if np.max(np.abs(fitted.resid)) <= 1e-10:
        result.warnings.append("The annual values fit an exact line; residual variation cannot support a significance test. Only the fitted rate is reported.")
        return result
    bounds = fitted.conf_int(alpha=0.05)[1] * 10
    p = float(fitted.pvalues[1])
    if np.all(np.isfinite(bounds)) and math.isfinite(p) and 0 <= p <= 1 and fitted.bse[1] > 0:
        analysis.ci95_per_decade = (float(bounds[0]), float(bounds[1]))
        analysis.p_value = p
    else:
        result.warnings.append("Finite uncertainty could not be estimated; confidence intervals and p-values are withheld.")
    if result.nonzero_years < len(rows) / 2:
        result.warnings.append("Most complete years have a zero index. HAC linear-model uncertainty is approximate for rare events; inspect the annual values before drawing a conclusion.")
    return result


def analyze_daily_trends(request: DailyTrendRequest) -> DailyTrendsResponse:
    metrics = {metric: _analyze(request, metric) for metric in THRESHOLDS}
    # Unavailable tests occupy their prespecified slot with p=1 for correction only.
    # They retain null published p-values and never acquire a significance label.
    raw = [item.analysis.p_value if item.analysis and item.analysis.p_value is not None else 1.0 for item in metrics.values()]
    adjusted = multipletests(raw, alpha=0.05, method="holm")[1]
    for item, p in zip(metrics.values(), adjusted):
        if item.analysis and item.analysis.p_value is not None:
            item.analysis.p_value_holm = float(p)
            item.analysis.significant = bool(p < 0.05)
    return DailyTrendsResponse(
        latitude=request.latitude, longitude=request.longitude, start=request.start, end=request.end,
        metrics=metrics, warnings=[
            "One complete annual index is one observation. The model tests a two-sided linear slope against zero, using Bartlett HAC with one annual lag, finite-sample covariance correction and Student-t reference (n-2 degrees of freedom).",
            "Significance badges use Holm-adjusted p-values across all four prespecified indices at this place and period. The 95% slope intervals are individual, not simultaneous; they may exclude zero while the adjusted test is unresolved.",
            "This is an approximate, descriptive linear model for discrete annual indices, not an event-probability model, forecast or attribution of causes. One annual HAC lag does not cover every form of long-term dependence. Trying other locations or periods is not covered by this four-test correction.",
        ],
    )
