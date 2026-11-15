"""Quality-filtered NASA MODIS NDVI from the public ORNL DAAC REST service.

References: https://modis.ornl.gov/data/modis_webservice.html and
https://ladsweb.modaps.eosdis.nasa.gov/filespec/MODIS/61/MOD13Q1
No Earthdata credential is sent to this public subset service. Original JSON
responses are cached before aggregation; satellite values are never simulated.
"""

import asyncio
import hashlib
import json
import math
from datetime import date, datetime, timedelta, timezone

import httpx

from ..config import NASA_CACHE_DIR, NASA_CACHE_TTL_SECONDS
from ..vegetation_schemas import VegetationObservation, VegetationQuery, VegetationResponse, VegetationSource
from .nasa_power import ProviderError, SavedPayload, _read_cache, _write_cache

MODIS_URL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset"
MODIS_DOCS = "https://modis.ornl.gov/data/modis_webservice.html"
NDVI_BAND = "250m_16_days_NDVI"
QUALITY_BAND = "250m_16_days_pixel_reliability"
REQUEST_DEADLINE_SECONDS = 20
READ_TIMEOUT_SECONDS = 15
_slots = asyncio.Semaphore(2)


def composite_dates(start: int, end: int) -> list[date]:
    """Terra MOD13Q1 begins at day 1 every year and advances in 16-day steps."""
    return [date(year, 1, 1) + timedelta(days=offset)
            for year in range(start, end + 1) for offset in range(0, 365, 16)]


def modis_date(day: date) -> str:
    return day.strftime("A%Y%j")


def batches(query: VegetationQuery) -> list[list[date]]:
    # Year-aligned cache keys are reusable across overlapping display windows.
    result = []
    for year in range(query.start, query.end + 1):
        dates = composite_dates(year, year)
        result.extend(dates[offset:offset + 10] for offset in range(0, len(dates), 10))
    return result


def parameters(query: VegetationQuery, dates: list[date]) -> dict:
    return {"latitude": query.latitude, "longitude": query.longitude,
            "startDate": modis_date(dates[0]), "endDate": modis_date(dates[-1]),
            "kmAboveBelow": 1, "kmLeftRight": 1}


def cache_path(query: VegetationQuery, dates: list[date]):
    key = hashlib.sha256(json.dumps(parameters(query, dates), sort_keys=True).encode()).hexdigest()
    return NASA_CACHE_DIR / "vegetation" / (key + ".json")


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def normalize_subset(query: VegetationQuery, dates: list[date], saved: SavedPayload):
    """Return one equally weighted area mean for each scheduled composite."""
    payload = saved.payload
    try:
        if isinstance(payload["latitude"], bool) or isinstance(payload["longitude"], bool) or not math.isclose(float(payload["latitude"]), query.latitude, abs_tol=1e-6, rel_tol=0) or not math.isclose(float(payload["longitude"]), query.longitude, abs_tol=1e-6, rel_tol=0):
            raise ValueError("The MODIS subset belongs to another location")
        nrows, ncols = payload["nrows"], payload["ncols"]
        if isinstance(nrows, bool) or isinstance(ncols, bool) or not isinstance(nrows, int) or not isinstance(ncols, int) or nrows <= 0 or ncols <= 0 or nrows * ncols > 100000:
            raise ValueError("Invalid MODIS grid")
        cellsize = float(payload["cellsize"])
        if not math.isfinite(cellsize) or not 200 <= cellsize <= 300:
            raise ValueError("Invalid MODIS pixel size")
        entries = payload["subset"]
        if not isinstance(entries, list):
            raise ValueError("Invalid MODIS subset")
        expected = {modis_date(day): day for day in dates}
        indexed = {}
        for item in entries:
            if item.get("band") not in (NDVI_BAND, QUALITY_BAND) or item.get("modis_date") not in expected:
                continue
            key = (item["modis_date"], item["band"])
            if key in indexed or not isinstance(item.get("data"), list) or len(item["data"]) != nrows * ncols:
                raise ValueError("Duplicate or malformed MODIS band")
            indexed[key] = item
        result, collections = {}, set()
        matched = 0
        for stamp, day in expected.items():
            ndvi, quality = indexed.get((stamp, NDVI_BAND)), indexed.get((stamp, QUALITY_BAND))
            result[day] = None
            if ndvi is None or quality is None:
                continue
            if not ndvi.get("version") or ndvi["version"] != quality.get("version"):
                raise ValueError("NDVI and quality belong to different collections")
            collections.add(str(ndvi["version"]))
            matched += 1
            good = []
            for raw, qa in zip(ndvi["data"], quality["data"]):
                value, flag = _number(raw), _number(qa)
                if value is not None and value.is_integer() and flag == 0 and -2000 <= value <= 10000:
                    good.append(value * 0.0001)
            if len(good) >= math.ceil(nrows * ncols / 2):
                result[day] = sum(good) / len(good)
        if not matched:
            raise ValueError("No matching NDVI and quality observations")
        return result, (nrows, ncols, cellsize), collections
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise ProviderError("NASA ORNL returned an unsupported MODIS NDVI subset or quality record.") from exc


async def _download(query: VegetationQuery, dates: list[date]) -> SavedPayload:
    # ORNL allows at most ten composite dates in one global subset request.
    # Include semaphore queueing in the deadline. Cancel/retry from the browser
    # must not leave another request waiting indefinitely behind a stalled call.
    async with asyncio.timeout(REQUEST_DEADLINE_SECONDS):
        async with _slots:
            async with httpx.AsyncClient(timeout=httpx.Timeout(READ_TIMEOUT_SECONDS, connect=5), follow_redirects=True,
                                         headers={"Accept": "application/json", "User-Agent": "TerraSignal/0.1 NASA Space Apps"}) as client:
                response = await client.get(MODIS_URL, params=parameters(query, dates))
                response.raise_for_status()
                return SavedPayload(response.json(), str(response.url), datetime.now(timezone.utc).isoformat(), "live")


def _unavailable_message(cause: Exception) -> str:
    if isinstance(cause, TimeoutError):
        reason = f"The satellite request exceeded its {REQUEST_DEADLINE_SECONDS}-second time limit."
    elif isinstance(cause, httpx.TimeoutException):
        reason = "NASA ORNL did not respond before the network timeout."
    elif isinstance(cause, httpx.HTTPStatusError):
        status = cause.response.status_code
        if status == 429:
            reason = "NASA ORNL is busy or rate-limiting requests (HTTP 429)."
        elif status >= 500:
            reason = f"NASA ORNL is temporarily unavailable (HTTP {status})."
        else:
            reason = f"NASA ORNL rejected this MODIS request (HTTP {status})."
    elif isinstance(cause, httpx.HTTPError):
        reason = "NASA ORNL could not be reached."
    elif isinstance(cause, ProviderError):
        reason = "NASA ORNL returned an unusable MODIS data or quality record."
    else:
        reason = "NASA ORNL returned an unreadable response."
    return reason + " No matching saved NDVI is available for this point and period. Try again later or import an original ORNL filtered NDVI CSV."


async def _fetch_batch(query: VegetationQuery, dates: list[date], refresh: bool):
    path = cache_path(query, dates)
    cached = _read_cache(path)
    if cached:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached.retrieved_at)).total_seconds()
            if age < 0:
                cached = None
        except (ValueError, TypeError):
            cached = None
    if cached and not refresh:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached.retrieved_at)).total_seconds()
            normalized = normalize_subset(query, dates, cached)
            if 0 <= age < NASA_CACHE_TTL_SECONDS:
                return normalized, cached, False
        except (ValueError, TypeError, ProviderError):
            pass
    try:
        saved = await _download(query, dates)
        normalized = normalize_subset(query, dates, saved)
        _write_cache(path, saved)
        return normalized, saved, False
    except (httpx.HTTPError, TimeoutError, ValueError, ProviderError) as cause:
        if cached:
            try:
                return normalize_subset(query, dates, cached), cached, True
            except ProviderError:
                pass
        raise ProviderError(_unavailable_message(cause), 503) from None


async def fetch_vegetation(query: VegetationQuery, refresh: bool = False) -> VegetationResponse:
    if query.start > query.end or query.end - query.start > 4 or query.end >= datetime.now(timezone.utc).year:
        raise ProviderError("Request one to five complete MODIS calendar years from 2001.", 422)
    chunks = batches(query)
    # Fail promptly on a service-wide outage instead of queuing the entire period.
    collected = [await _fetch_batch(query, chunks[0], refresh)]
    # Only two requests are outstanding at once, including across API callers.
    for offset in range(1, len(chunks), 2):
        pending = [asyncio.create_task(_fetch_batch(query, dates, refresh)) for dates in chunks[offset:offset + 2]]
        try:
            collected.extend(await asyncio.gather(*pending))
        except BaseException:
            # Do not leave a sibling downloading after its record has failed or
            # been cancelled; a subsequent retry can reuse completed cache files.
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            raise
    values, grids, collections, sources = {}, set(), set(), []
    stale = False
    for (records, grid, versions), saved, fallback in collected:
        values.update(records)
        grids.add(grid)
        collections.update(versions)
        stale |= fallback
        sources.append(VegetationSource(source_url=saved.source_url, retrieved_at=saved.retrieved_at, data_origin=saved.origin))
    if len(grids) != 1 or len(collections) != 1:
        raise ProviderError("MODIS grid geometry or collection changed within the selected record; these observations cannot be silently merged.")
    nrows, ncols, cellsize = next(iter(grids))
    series = []
    for year in range(query.start, query.end + 1):
        for month in range(1, 13):
            expected = [day for day in values if day.year == year and day.month == month]
            available = [values[day] for day in expected if values[day] is not None]
            series.append(VegetationObservation(date=date(year, month, 1),
                value=sum(available) / len(available) if available and len(available) == len(expected) else None,
                available_composites=len(available), expected_composites=len(expected)))
    warnings = [
        "NDVI measures vegetation greenness, not crop yield, species diversity or a direct measurement of plant health.",
        "Each composite uses only NDVI pixels with MOD13Q1 pixel_reliability=0 (good), raw NDVI -2000..10000 and scale 0.0001. Marginal, cloudy, snow/ice and fill pixels are excluded. At least half the subset pixels must pass quality checks.",
        "Monthly values are equal-weight means of all 16-day composites whose nominal start date lies in that month, not true calendar-month mean daily NDVI. A month remains missing unless every scheduled composite passes the area quality threshold.",
        "The MODIS subset covers a much smaller footprint than the NASA POWER weather grid. A point lookup is a local comparison of different spatial supports, not a matched-area causal experiment.",
    ]
    missing = sum(point.value is None for point in series)
    if missing:
        warnings.append(f"{missing} of {len(series)} months fail complete-composite quality coverage and remain gaps.")
    if stale:
        warnings.insert(0, "NASA ORNL could not be refreshed. At least one saved original satellite response is used; check each retrieval date.")
    return VegetationResponse(latitude=query.latitude, longitude=query.longitude, start=query.start, end=query.end,
        series=series, spatial_support=f"{nrows} × {ncols} MODIS sinusoidal pixels, {cellsize:.3f} m each; approximately {nrows * cellsize / 1000:.2f} × {ncols * cellsize / 1000:.2f} km subset centered near the requested point.",
        pixel_size_m=cellsize, nrows=nrows, ncols=ncols, collections=sorted(collections),
        source="NASA Terra MODIS MOD13Q1 / ORNL DAAC TESViS", source_url=MODIS_DOCS, sources=sources,
        retrieved_at=min(source.retrieved_at for source in sources),
        data_origin="live" if any(source.data_origin == "live" for source in sources) else "cache", warnings=warnings)
