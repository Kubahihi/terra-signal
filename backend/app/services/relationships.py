"""Exact calendar matching and descriptive relationships, without IID significance."""

from datetime import date
import math

import numpy as np

from ..relationship_schemas import RelationshipPair, RelationshipRequest, RelationshipResponse


MINIMUM_YEARS = 5
MINIMUM_MONTHLY_PAIRS = 10
MINIMUM_COVERAGE = 0.8


def _month_number(value: date) -> int:
    return value.year * 12 + value.month - 1


def _month_date(number: int) -> date:
    return date(number // 12, number % 12 + 1, 1)


def analyze_relationship(request: RelationshipRequest) -> RelationshipResponse:
    """Center each matched month cohort; optionally remove a joint linear time effect.

    The seasonal reference is the common paired sample, rather than a fixed climate
    normal unavailable to short satellite records. Month-centering elapsed time as
    well as values implements OLS with month fixed effects (Frisch-Waugh-Lovell).
    It avoids reintroducing seasonality when removing a trend from anomalies.
    """
    first = request.start * 12
    stop = (request.end + 1) * 12
    expected_dates = [number for number in range(first, stop - request.lag_months)
                      if request.month is None or number % 12 + 1 == request.month]
    x_values = {_month_number(item.date): item.value for item in request.x.observations}
    y_values = {_month_number(item.date): item.value for item in request.y.observations}
    matched = [(number, float(x_values[number]), float(y_values[number + request.lag_months]))
               for number in expected_dates
               if x_values.get(number) is not None and y_values.get(number + request.lag_months) is not None]
    count = len(matched)
    expected = len(expected_dates)
    years = len({number // 12 for number, _, _ in matched})
    coverage = count / expected if expected else 0.0
    warnings = [
        "This is a descriptive Pearson correlation, not a test of statistical significance, a forecast or evidence of causation.",
        "Confidence intervals and p-values are withheld: serial dependence, the selected time window and searching multiple lags or locations are not covered by an independent-observation Pearson test.",
        "The calendar-month reference is calculated separately from the matched observations in this analysis. It is not the fixed 1991–2020 climate reference and changes when the interval, lag or available observations change.",
        "Both dates must be inside the requested interval. Missing months are excluded, never filled with zero, and the lag follows calendar months rather than row positions.",
    ]
    if count < expected:
        warnings.append(f"{expected - count} of {expected} expected calendar pairs are unavailable; the displayed coverage refers to the requested interval.")
    if any(not first <= number < stop for number in (*x_values.keys(), *y_values.keys())):
        warnings.append("Observations outside the requested interval were excluded before pairing.")
    if request.lag_months:
        warnings.append(f"X is paired with Y {request.lag_months} calendar month(s) later; a lagged association does not establish a causal response.")

    pairs: list[RelationshipPair] = []
    pearson = None
    if matched:
        times = np.array([(number - first) / 12 for number, _, _ in matched], dtype=float)
        x_raw = np.array([x for _, x, _ in matched], dtype=float)
        y_raw = np.array([y for _, _, y in matched], dtype=float)
        x = x_raw.copy()
        y = y_raw.copy()
        centered_time = times.copy()
        month_counts = []
        month_numbers = np.array([number % 12 for number, _, _ in matched])
        for month in np.unique(month_numbers):
            mask = month_numbers == month
            month_counts.append(int(mask.sum()))
            x[mask] -= x_raw[mask].mean()
            y[mask] -= y_raw[mask].mean()
            centered_time[mask] -= times[mask].mean()
        if request.detrend:
            denominator = float(centered_time @ centered_time)
            if denominator > 0:
                x -= float(centered_time @ x) / denominator * centered_time
                y -= float(centered_time @ y) / denominator * centered_time

        pairs = [RelationshipPair(x_date=_month_date(number), y_date=_month_date(number + request.lag_months),
                                  x_raw=float(a), y_raw=float(b), x=float(c), y=float(d))
                 for (number, _, _), a, b, c, d in zip(matched, x_raw, y_raw, x, y)]
        minimum_pairs = MINIMUM_MONTHLY_PAIRS if request.month is None else MINIMUM_YEARS
        eligible = count >= minimum_pairs and years >= MINIMUM_YEARS and coverage >= MINIMUM_COVERAGE
        if count < minimum_pairs or years < MINIMUM_YEARS:
            warnings.append(f"At least {minimum_pairs} matched pairs across {MINIMUM_YEARS} distinct years are required to report a descriptive correlation.")
        if coverage < MINIMUM_COVERAGE:
            warnings.append("At least 80% of expected calendar pairs are required to report a descriptive correlation; choose an interval with common data coverage.")
        if min(month_counts) < 3:
            eligible = False
            warnings.append("Each included calendar-month reference requires at least three matched observations from different years.")
        centered_x = x - x.mean()
        centered_y = y - y.mean()
        norm_x = float(np.linalg.norm(centered_x))
        norm_y = float(np.linalg.norm(centered_y))
        tolerance_x = 100 * np.finfo(float).eps * max(1.0, float(np.linalg.norm(x_raw)))
        tolerance_y = 100 * np.finfo(float).eps * max(1.0, float(np.linalg.norm(y_raw)))
        if norm_x <= tolerance_x or norm_y <= tolerance_y:
            eligible = False
            warnings.append("A series has no usable variation after the selected seasonal and trend adjustments. Its correlation is undefined, rather than zero.")
        if eligible:
            # Normalize before the inner product to keep the coefficient bounded.
            coefficient = float((centered_x / norm_x) @ (centered_y / norm_y))
            if math.isfinite(coefficient):
                pearson = max(-1.0, min(1.0, coefficient))
    else:
        warnings.append("No valid monthly observations could be paired for this interval, calendar selection and lag.")

    return RelationshipResponse(
        latitude=request.latitude, longitude=request.longitude, start=request.start, end=request.end,
        lag_months=request.lag_months, month=request.month, detrended=request.detrend,
        x_name=request.x.name, y_name=request.y.name, x_unit=request.x.unit, y_unit=request.y.unit,
        pairs=pairs, pearson_r=pearson, n_pairs=count, n_years=years,
        expected_pairs=expected, coverage=coverage,
        reference_start=min((number // 12 for number, _, _ in matched), default=None),
        reference_end=max(((number + request.lag_months) // 12 for number, _, _ in matched), default=None),
        method="Descriptive Pearson correlation of paired calendar-month anomalies" + (
            "; OLS linear elapsed-time trend removed jointly with month fixed effects" if request.detrend else "; linear time trend retained"),
        seasonality="Separate calendar-month means from the common paired sample within the selected interval",
        warnings=warnings,
    )
