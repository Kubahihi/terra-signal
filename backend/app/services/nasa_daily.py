"""NASA POWER daily records, fetched in bounded batches and cached separately."""

import asyncio
import hashlib
import json
import math
import time
from datetime import date, datetime, timedelta, timezone

import httpx

from ..config import NASA_CACHE_DIR, NASA_CACHE_TTL_SECONDS, NASA_DAILY_URL
from ..schemas import DailyQuery, DailyRecord, DailyResponse
from .daily_indices import THRESHOLDS, aggregate_year
from .nasa_power import ProviderError, SavedPayload, _read_cache, _write_cache

PARAMETERS = ("T2M_MAX", "T2M_MIN", "PRECTOTCORR")
_slots = asyncio.Semaphore(2)
_start_lock = asyncio.Lock()
_next_start = 0.0


def parameters(query: DailyQuery) -> dict:
    return {
        "parameters": ",".join(PARAMETERS), "community": "AG",
        "latitude": query.latitude, "longitude": query.longitude,
        "start": f"{query.start}0101", "end": f"{query.end}1231",
        "format": "JSON", "time-standard": "LST",
    }


def cache_path(query: DailyQuery):
    key = hashlib.sha256(json.dumps(parameters(query), sort_keys=True).encode()).hexdigest()
    return NASA_CACHE_DIR / "daily" / (key + ".json")


def normalize_daily(query: DailyQuery, saved: SavedPayload) -> DailyResponse:
    try:
        payload = saved.payload
        header = payload.get("header", {})
        if str(header.get("time_standard", "LST")).upper() != "LST":
            raise ValueError("Unexpected time standard")
        fill = float(header.get("fill_value", -999))
        values = payload["properties"]["parameter"]
        metadata = payload["parameters"]
        if not isinstance(values, dict):
            raise TypeError("Invalid parameter data")
        for name in PARAMETERS:
            if metadata[name]["units"] != ("mm/day" if name == "PRECTOTCORR" else "C"):
                raise ValueError("Unsupported units")
            if not isinstance(values.get(name, {}), dict):
                raise TypeError("Invalid daily data")
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise ProviderError("NASA returned an unsupported daily response, units or time standard.") from exc

    def value(name: str, key: str) -> float | None:
        raw = values.get(name, {}).get(key)
        try:
            number = float(raw) if raw is not None and not isinstance(raw, bool) else None
        except (ValueError, TypeError):
            return None
        if number is None or not math.isfinite(number) or number == fill:
            return None
        return None if name == "PRECTOTCORR" and number < 0 else number

    daily = []
    inconsistent = 0
    day, stop = date(query.start, 1, 1), date(query.end + 1, 1, 1)
    while day < stop:
        key = day.strftime("%Y%m%d")
        maximum, minimum, rain = (value(name, key) for name in PARAMETERS)
        if maximum is not None and minimum is not None and maximum < minimum:
            maximum = minimum = None
            inconsistent += 1
        daily.append(DailyRecord(date=day, tmax=maximum, tmin=minimum, precipitation=rain))
        day += timedelta(days=1)
    if not any(p.tmax is not None or p.tmin is not None or p.precipitation is not None for p in daily):
        raise ProviderError("NASA returned no usable daily observations for this interval.", 404)
    years = [aggregate_year(daily, year) for year in range(query.start, query.end + 1)]
    warnings = [
        "Daily values represent a NASA POWER model grid cell, not a weather station or an individual street.",
        "Days use NASA Local Solar Time (LST), not local civil time or daylight saving time.",
        "Warm nights use daily minimum temperature above 20 C as a proxy, not nighttime-only hourly minima.",
        "Dry spells are clipped to each calendar year. A run touching January 1 or December 31 may extend into an adjacent year; the earliest run is shown on ties.",
    ]
    if any(metric.value is None for year in years for metric in
           (year.hot_days, year.frost_days, year.warm_nights, year.longest_dry_spell)):
        warnings.append("Some annual indices are incomplete. Observed counts and runs are lower bounds, not scaled or extrapolated annual estimates. Missing precipitation interrupts a dry run.")
    if inconsistent:
        warnings.append(f"{inconsistent} days with maximum temperature below minimum temperature were excluded from temperature counts.")
    sources = ", ".join(str(item) for item in header.get("sources", []))
    return DailyResponse(
        latitude=query.latitude, longitude=query.longitude, start=query.start, end=query.end,
        thresholds=THRESHOLDS, daily=daily, years=years,
        source="NASA POWER daily" + (f" / {sources}" if sources else ""),
        source_url=saved.source_url, retrieved_at=saved.retrieved_at,
        data_origin=saved.origin, warnings=warnings,
    )


async def _download(query: DailyQuery) -> SavedPayload:
    global _next_start
    async with _slots:
        for attempt in range(2):
            async with _start_lock:
                await asyncio.sleep(max(0, _next_start - time.monotonic()))
                _next_start = time.monotonic() + 0.35
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), follow_redirects=True,
                                             headers={"User-Agent": "TerraSignal/0.1 (NASA Space Apps)"}) as client:
                    response = await client.get(NASA_DAILY_URL, params=parameters(query))
                    response.raise_for_status()
                return SavedPayload(response.json(), str(response.url), datetime.now(timezone.utc).isoformat(), "live")
            except httpx.HTTPStatusError as exc:
                if attempt or exc.response.status_code not in (429, 500, 502, 503, 504):
                    raise
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt:
                    raise
            await asyncio.sleep(1)
    raise ProviderError("NASA daily download could not be completed.", 503)


async def fetch_daily(query: DailyQuery, refresh: bool = False) -> DailyResponse:
    if query.start > query.end or query.end - query.start > 4:
        raise ProviderError("Daily requests must cover one to five whole years.", 422)
    path = cache_path(query)
    cached = _read_cache(path)
    if cached and not refresh:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached.retrieved_at)).total_seconds()
            if 0 <= age < NASA_CACHE_TTL_SECONDS:
                return normalize_daily(query, cached)
        except (ValueError, TypeError, ProviderError):
            pass
    try:
        saved = await _download(query)
        result = normalize_daily(query, saved)
        _write_cache(path, saved)
        return result
    except (httpx.HTTPError, ValueError, ProviderError):
        if cached:
            try:
                result = normalize_daily(query, cached)
                result.warnings.insert(0, "NASA daily data could not be refreshed. Showing a saved original daily response; check its retrieval date.")
                return result
            except ProviderError:
                pass
        raise ProviderError("NASA daily data are unavailable and no valid saved daily response covers this interval. Monthly data cannot substitute for daily observations.", 503) from None
