"""Prespecified nested periods, with one multiplicity family across all indices."""

from statsmodels.stats.multitest import multipletests

from ..schemas import DailyPeriodsResponse, DailyTrendRequest, DailyTrendsResponse
from .daily_indices import THRESHOLDS
from .daily_trends import _analyze


def analyze_daily_periods(request: DailyTrendRequest) -> DailyPeriodsResponse:
    starts = [request.start, *(year for year in (1991, 2001) if request.start < year <= request.end)]
    family_size = len(starts) * len(THRESHOLDS)
    correction = f"Holm across {family_size} index/period tests at one point"
    warnings = [
        "The full selected interval and available starts in 1991 and 2001 are fixed before testing; all periods have the same end year. No additional NASA download is performed.",
        f"Adjusted p-values cover all {family_size} tests: four indices across {len(starts)} {'period' if len(starts) == 1 else 'periods'}. Unavailable tests retain their slot but publish null inference. The main chart uses a separate four-index family.",
        "The 95% intervals are individual, not simultaneous. Different fitted slopes or significance labels alone do not establish that slopes differ between periods. Overlapping periods are not independent samples.",
        "The same approximate yearly OLS/HAC(1) model and completeness guards apply in each period. Looking across other locations or trying other periods is outside this correction; a fitted trend does not establish a cause.",
    ]
    if len(starts) == 1:
        warnings.append("Only the full selected interval fits the predefined starts. Load an earlier start year to compare more periods.")
    periods = []
    for start in starts:
        subset = DailyTrendRequest(
            latitude=request.latitude, longitude=request.longitude, start=start, end=request.end,
            years=[row for row in request.years if start <= row.year <= request.end],
        )
        periods.append(DailyTrendsResponse(
            latitude=request.latitude, longitude=request.longitude, start=start, end=request.end,
            metrics={metric: _analyze(subset, metric) for metric in THRESHOLDS},
            family_size=family_size, correction=correction, warnings=warnings,
        ))
    metrics = [metric for period in periods for metric in period.metrics.values()]
    raw = [metric.analysis.p_value if metric.analysis and metric.analysis.p_value is not None else 1 for metric in metrics]
    adjusted = multipletests(raw, alpha=0.05, method="holm")[1]
    for metric, p in zip(metrics, adjusted):
        if metric.analysis and metric.analysis.p_value is not None:
            metric.analysis.p_value_holm = float(p)
            metric.analysis.significant = bool(p < 0.05)
    return DailyPeriodsResponse(
        latitude=request.latitude, longitude=request.longitude, start=request.start, end=request.end,
        family_size=family_size, periods=periods, warnings=warnings,
    )
