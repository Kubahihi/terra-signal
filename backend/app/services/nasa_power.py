"""Real NASA POWER data with a local cache and attributed original snapshots."""

import hashlib
import json
import math
import os
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx

from ..config import NASA_CACHE_DIR, NASA_CACHE_TTL_SECONDS, NASA_POWER_URL, NASA_SNAPSHOT_DIR
from ..schemas import Observation, SeriesQuery, SeriesResponse


class ProviderError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class SavedPayload:
    payload: dict[str, Any]
    source_url: str
    retrieved_at: str
    origin: Literal["live", "cache", "snapshot"]


def _parameters(query: SeriesQuery) -> dict[str, str | int | float]:
    return {
        "parameters": query.variable.value, "community": "AG",
        "latitude": query.latitude, "longitude": query.longitude,
        "start": query.start, "end": query.end, "format": "JSON",
    }


def _cache_path(query: SeriesQuery) -> Path:
    key = json.dumps(_parameters(query), sort_keys=True).encode()
    return NASA_CACHE_DIR / (hashlib.sha256(key).hexdigest() + ".json")


def _read_cache(path: Path) -> SavedPayload | None:
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        return SavedPayload(saved["payload"], saved["source_url"], saved["retrieved_at"], "cache")
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_cache(path: Path, saved: SavedPayload) -> None:
    """Cache writes are atomic and optional; an unwritable cache is not a data error."""
    temporary: str | None = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = handle.name
            json.dump({"payload": saved.payload, "source_url": saved.source_url,
                       "retrieved_at": saved.retrieved_at}, handle)
        os.replace(temporary, path)
        temporary = None
    except OSError:
        pass
    finally:
        if temporary:
            try:
                Path(temporary).unlink(missing_ok=True)
            except OSError:
                pass


def _snapshot(query: SeriesQuery) -> SavedPayload | None:
    """Only exact preset coordinates and covered periods may use an original snapshot."""
    try:
        entries = json.loads((NASA_SNAPSHOT_DIR / "index.json").read_text(encoding="utf-8"))
        for entry in entries:
            if not (
                math.isclose(query.latitude, entry["latitude"], abs_tol=1e-7, rel_tol=0)
                and math.isclose(query.longitude, entry["longitude"], abs_tol=1e-7, rel_tol=0)
                and query.start >= entry["start"] and query.end <= entry["end"]
            ):
                continue
            path = (NASA_SNAPSHOT_DIR / entry["file"]).resolve()
            if not path.is_relative_to(NASA_SNAPSHOT_DIR.resolve()):
                continue
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                continue
            return SavedPayload(json.loads(raw), entry["source_url"], entry["retrieved_at"], "snapshot")
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def normalize_payload(query: SeriesQuery, saved: SavedPayload) -> SeriesResponse:
    """Preserve missing months and discard the provider's month-13 annual summaries."""
    payload = saved.payload
    try:
        values = payload["properties"]["parameter"][query.variable.value]
        unit = payload["parameters"][query.variable.value]["units"]
        if not isinstance(values, dict) or not isinstance(unit, str) or not unit:
            raise TypeError("Invalid variable metadata")
        header = payload.get("header", {})
        fill = float(header.get("fill_value", -999))
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise ProviderError("NASA returned an incomplete or unsupported data response.") from exc

    expected_unit = {"T2M": "C", "PRECTOTCORR": "mm/day"}[query.variable.value]
    if unit != expected_unit:
        raise ProviderError(f"NASA returned unsupported units for {query.variable.value}; expected {expected_unit}.")

    series: list[Observation] = []
    negative_precipitation = 0
    for year in range(query.start, query.end + 1):
        for month in range(1, 13):
            raw = values.get(f"{year:04d}{month:02d}")
            try:
                value = float(raw) if raw is not None and not isinstance(raw, bool) else None
                if value is not None and (not math.isfinite(value) or value == fill):
                    value = None
                if value is not None and query.variable.value == "PRECTOTCORR" and value < 0:
                    value = None
                    negative_precipitation += 1
            except (TypeError, ValueError):
                value = None
            series.append(Observation(date=date(year, month, 1), value=value))

    available = sum(point.value is not None for point in series)
    if not available:
        raise ProviderError("NASA returned no available observations for this selection.", 404)
    warnings = ["These values describe a reanalysis model grid cell, not a weather station."]
    missing = len(series) - available
    if missing:
        warnings.append(f"{missing} of {len(series)} requested months are missing; gaps are preserved.")
    if negative_precipitation:
        warnings.append(f"{negative_precipitation} negative precipitation rates were excluded as invalid observations.")
    if query.variable.value == "PRECTOTCORR":
        warnings.append("Precipitation is a monthly mean daily rate (mm/day), not a monthly total.")
    sources = ", ".join(str(source) for source in header.get("sources", []))
    version = header.get("api", {}).get("version", "")
    source = "NASA POWER" + (f" / {sources}" if sources else "")
    if version:
        source += f" ({version})"
    return SeriesResponse(
        source=source, variable=query.variable, unit=unit,
        latitude=query.latitude, longitude=query.longitude,
        start=query.start, end=query.end, series=series, warnings=warnings,
        source_url=saved.source_url, retrieved_at=saved.retrieved_at, data_origin=saved.origin,
    )


async def fetch_monthly_series(query: SeriesQuery, refresh: bool = False) -> SeriesResponse:
    path = _cache_path(query)
    cached = _read_cache(path)
    if cached and not refresh:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached.retrieved_at)).total_seconds()
            if 0 <= age < NASA_CACHE_TTL_SECONDS:
                return normalize_payload(query, cached)
        except (ValueError, TypeError, ProviderError):
            pass
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(25, connect=5), follow_redirects=True,
            headers={"User-Agent": "TerraSignal/0.1 (NASA Space Apps)"},
        ) as client:
            response = await client.get(NASA_POWER_URL, params=_parameters(query))
            response.raise_for_status()
        saved = SavedPayload(response.json(), str(response.url), datetime.now(timezone.utc).isoformat(), "live")
        normalized = normalize_payload(query, saved)
        _write_cache(path, saved)
        return normalized
    except (httpx.HTTPError, ValueError, ProviderError):
        for fallback in (cached, _snapshot(query)):
            if fallback is None:
                continue
            try:
                result = normalize_payload(query, fallback)
                result.warnings.insert(0, "NASA could not be reached. Showing a saved original NASA response; check its retrieval date.")
                return result
            except ProviderError:
                continue
        raise ProviderError(
            "NASA is temporarily unavailable and no saved data covers this selection. Try again shortly.", 503
        ) from None
