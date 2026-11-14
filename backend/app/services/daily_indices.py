"""Complete-calendar-year indices from daily values, with observed lower bounds."""

from datetime import date, timedelta

from ..schemas import AnnualDailyCount, AnnualDrySpell, DailyRecord, DailyYear

THRESHOLDS = {
    "hot_days": "T2M_MAX > 30 C",
    "frost_days": "T2M_MIN < 0 C",
    "warm_nights": "T2M_MIN > 20 C (daily-minimum proxy)",
    "longest_dry_spell": "consecutive daily PRECTOTCORR < 1 mm/day, clipped to each calendar year",
}


def aggregate_year(records: list[DailyRecord], year: int) -> DailyYear:
    first, stop = date(year, 1, 1), date(year + 1, 1, 1)
    expected = (stop - first).days
    indexed = {record.date: record for record in records if record.date.year == year}
    hot = frost = warm = max_available = min_available = rain_available = 0
    run = best = 0
    run_start = best_start = best_end = None
    day = first
    while day < stop:
        record = indexed.get(day)
        if record is not None and record.tmax is not None:
            max_available += 1
            hot += record.tmax > 30
        if record is not None and record.tmin is not None:
            min_available += 1
            frost += record.tmin < 0
            warm += record.tmin > 20
        rain = record.precipitation if record is not None else None
        if rain is not None:
            rain_available += 1
        if rain is not None and rain < 1:
            if run == 0:
                run_start = day
            run += 1
            if run > best:  # On ties, preserve the earliest observed run.
                best, best_start, best_end = run, run_start, day
        else:
            # A missing day cannot be bridged, or assumed wet or dry.
            run, run_start = 0, None
        day += timedelta(days=1)

    def count(observed: int, available: int) -> AnnualDailyCount:
        return AnnualDailyCount(value=observed if available == expected else None,
                                observed_count=observed, available_days=available)

    return DailyYear(
        year=year, expected_days=expected,
        hot_days=count(hot, max_available), frost_days=count(frost, min_available),
        warm_nights=count(warm, min_available),
        longest_dry_spell=AnnualDrySpell(
            value=best if rain_available == expected else None,
            observed_count=best, available_days=rain_available,
            start_date=best_start, end_date=best_end,
            touches_year_boundary=best > 0 and (best_start == first or best_end == stop - timedelta(days=1)),
        ),
    )
