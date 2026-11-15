"""Original NASA POWER monthly GWETROOT, with separate validated raw caching."""

import asyncio
import hashlib
import json
import math
from datetime import date, datetime, timezone

import httpx

from ..config import NASA_CACHE_DIR, NASA_CACHE_TTL_SECONDS, NASA_POWER_URL
from ..schemas import Observation
from ..soil_schemas import SoilQuery, SoilResponse
from .nasa_power import ProviderError, SavedPayload, _read_cache, _write_cache


PARAMETER = "GWETROOT"
_slots = asyncio.Semaphore(2)


def parameters(query: SoilQuery) -> dict:
    return {
        "parameters": PARAMETER, "community": "AG",
        "latitude": query.latitude, "longitude": query.longitude,
        "start": query.start, "end": query.end, "format": "JSON",
    }


def cache_path(query: SoilQuery):
    key = hashlib.sha256(json.dumps(parameters(query), sort_keys=True).encode()).hexdigest()
    return NASA_CACHE_DIR / "soil" / (key + ".json")


def normalize_soil(query: SoilQuery, saved: SavedPayload) -> SoilResponse:
    try:
        if saved.origin not in ("live", "cache"):
            raise ValueError("Unsupported soil-data origin")
        if not isinstance(saved.source_url, str) or not saved.source_url.strip():
            raise ValueError("Missing original NASA source URL")
        payload = saved.payload
        values = payload["properties"]["parameter"][PARAMETER]
        unit = payload["parameters"][PARAMETER]["units"]
        if not isinstance(values, dict) or unit != "1":
            raise ValueError("Unsupported root-zone soil-wetness values or units")
        header = payload.get("header", {})
        fill_raw = header.get("fill_value", -999)
        if isinstance(fill_raw, bool):
            raise ValueError("Unsupported missing-value marker")
        fill = float(fill_raw)
        if not math.isfinite(fill):
            raise ValueError("Unsupported missing-value marker")
        retrieved = datetime.fromisoformat(saved.retrieved_at.replace("Z", "+00:00"))
        if retrieved.tzinfo is None:
            raise ValueError("Retrieval date has no time zone")
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise ProviderError("NASA returned an unsupported root-zone soil-wetness response, units or provenance.") from exc

    series = []
    out_of_range = 0
    for year in range(query.start, query.end + 1):
        for month in range(1, 13):
            raw = values.get(f"{year:04d}{month:02d}")
            try:
                value = float(raw) if raw is not None and not isinstance(raw, bool) else None
            except (TypeError, ValueError):
                value = None
            if value is not None and (not math.isfinite(value) or value == fill):
                value = None
            if value is not None and not 0 <= value <= 1:
                value = None
                out_of_range += 1
            series.append(Observation(date=date(year, month, 1), value=value))

    available = sum(point.value is not None for point in series)
    if not available:
        raise ProviderError("NASA returned no usable root-zone soil-wetness observations for this interval.", 404)
    warnings = [
        "GWETROOT is a model-derived root-zone soil-wetness fraction from 0 to 1, not volumetric soil moisture in m3/m3 and not a direct field measurement.",
        "These monthly means describe the surrounding NASA POWER reanalysis grid cell, not an individual field, farm or street.",
        "Modeled soil wetness and meteorology share model inputs. A correlation between them is not independent validation or evidence of causation.",
        "The parameter is kept on its original dimensionless scale; missing months are not filled, rescaled or extrapolated.",
    ]
    if available < len(series):
        warnings.append(f"{len(series) - available} of {len(series)} requested months are missing; gaps are preserved.")
    if out_of_range:
        warnings.append(f"{out_of_range} values outside the supported 0 to 1 soil-wetness range were excluded.")
    sources = header.get("sources", [])
    source_label = ", ".join(str(item) for item in sources) if isinstance(sources, list) else ""
    return SoilResponse(
        latitude=query.latitude, longitude=query.longitude, start=query.start, end=query.end,
        series=series, source="NASA POWER monthly" + (f" / {source_label}" if source_label else ""),
        source_url=saved.source_url, retrieved_at=saved.retrieved_at,
        data_origin=saved.origin, warnings=warnings,
    )


async def _download(query: SoilQuery) -> SavedPayload:
    async with _slots:
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(25, connect=5), follow_redirects=True,
                    headers={"User-Agent": "TerraSignal/0.1 (NASA Space Apps)"},
                ) as client:
                    response = await client.get(NASA_POWER_URL, params=parameters(query))
                    response.raise_for_status()
                return SavedPayload(response.json(), str(response.url), datetime.now(timezone.utc).isoformat(), "live")
            except httpx.HTTPStatusError as exc:
                if attempt or exc.response.status_code not in (429, 500, 502, 503, 504):
                    raise
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt:
                    raise
            await asyncio.sleep(1)
    raise ProviderError("NASA soil-wetness download could not be completed.", 503)


async def fetch_soil(query: SoilQuery, refresh: bool = False) -> SoilResponse:
    path = cache_path(query)
    cached = _read_cache(path)
    if cached and not refresh:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached.retrieved_at)).total_seconds()
            if 0 <= age < NASA_CACHE_TTL_SECONDS:
                return normalize_soil(query, cached)
        except (TypeError, ValueError, ProviderError):
            pass
    try:
        saved = await _download(query)
        result = normalize_soil(query, saved)
        _write_cache(path, saved)
        return result
    except (httpx.HTTPError, ValueError, ProviderError):
        if cached:
            try:
                result = normalize_soil(query, cached)
                result.warnings.insert(0, "NASA soil wetness could not be refreshed. Showing a saved original soil-wetness response; check its retrieval date.")
                return result
            except ProviderError:
                pass
        raise ProviderError("NASA root-zone soil wetness is unavailable and no valid saved soil-wetness response covers this interval.", 503) from None
