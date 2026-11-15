"""Build a real, reproducible Landscape Memory example from original NASA caches.

Run from the repository root using .venv/Scripts/python scripts/build_memory_example.py.
The default is cache-only: missing responses fail instead of inventing observations.
--download permits the existing validated providers to fill missing response caches.
"""

import argparse
import asyncio
import calendar
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import NASA_CACHE_DIR
from backend.app.schemas import SeriesQuery, Variable
from backend.app.soil_schemas import SoilQuery
from backend.app.vegetation_schemas import VegetationQuery
from backend.app.services.nasa_power import _read_cache, normalize_payload, fetch_monthly_series
from backend.app.services.nasa_soil import normalize_soil, fetch_soil
from backend.app.services.nasa_ndvi import composite_dates
from backend.app.services.planetary_ndvi import catalog_url, catalog_items, crop_url, crop_value, fetch_vegetation


def cached(url):
    path = NASA_CACHE_DIR / 'vegetation-pc-v1' / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    saved = _read_cache(path)
    if saved is None or saved.source_url != url:
        raise RuntimeError(f'Missing exact original response: {url}')
    stamp = datetime.fromisoformat(saved.retrieved_at.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
        raise RuntimeError('Invalid original retrieval date')
    return saved


def monthly_cache(query, parameter, folder):
    """A larger original monthly request may cover the explicitly selected subset."""
    candidates = []
    for path in folder.glob('*.json'):
        saved = _read_cache(path)
        if saved is None:
            continue
        parsed = urlparse(saved.source_url)
        q = parse_qs(parsed.query)
        try:
            if parsed.hostname != 'power.larc.nasa.gov' or parsed.path != '/api/temporal/monthly/point':
                continue
            if parameter != q['parameters'][0] or float(q['latitude'][0]) != query.latitude or float(q['longitude'][0]) != query.longitude:
                continue
            if int(q['start'][0]) > query.start or int(q['end'][0]) < query.end:
                continue
            stamp = datetime.fromisoformat(saved.retrieved_at.replace('Z', '+00:00'))
            if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
                continue
            candidates.append(saved)
        except (ValueError, KeyError):
            continue
    if not candidates:
        raise RuntimeError(f'No original cached {parameter} response covers this place and period')
    return max(candidates, key=lambda item: item.retrieved_at)


def source(role, saved, label, footprint, **extra):
    return dict(role=role, source=label, source_url=saved.source_url,
                retrieved_at=saved.retrieved_at, data_origin='snapshot', spatial_support=footprint, **extra)


async def build(args):
    print(f'Checking original weather and soil caches for {args.name}...', flush=True)
    rain_query = SeriesQuery(latitude=args.lat, longitude=args.lon, start=args.start, end=args.end, variable=Variable.PRECIPITATION)
    soil_query = SoilQuery(latitude=args.lat, longitude=args.lon, start=args.start, end=args.end)
    if args.download:
        await fetch_monthly_series(rain_query)
        await fetch_soil(soil_query)
    rain_saved = monthly_cache(rain_query, 'PRECTOTCORR', NASA_CACHE_DIR)
    soil_saved = monthly_cache(soil_query, 'GWETROOT', NASA_CACHE_DIR / 'soil')
    rain = normalize_payload(rain_query, rain_saved)
    soil = normalize_soil(soil_query, soil_saved)
    footprint = 'NASA POWER / MERRA-2 weather grid cell, approximately 0.5° × 0.625°'
    sources = [source('rain', rain_saved, rain.source, footprint), source('soil', soil_saved, soil.source, footprint)]
    vegetation = []
    qa = []
    for year in range(args.start, args.end + 1):
        print(f'Validating original MODIS catalog and numeric crops: {year}', flush=True)
        query = VegetationQuery(latitude=args.lat, longitude=args.lon, start=year, end=year)
        if args.download:
            await fetch_vegetation(query)
        catalog = cached(catalog_url(query))
        indexed = catalog_items(catalog, query)
        pixel = next(iter(indexed.values()))[1][0]
        support = f'9 × 9 native MODIS sinusoidal pixels around the containing pixel, {pixel:.6f} m each (about {pixel * 9 / 1000:.3f} × {pixel * 9 / 1000:.3f} km); quality-filtered area mean.'
        extra = dict(product='MOD13Q1', collection='061')
        sources.append(source('vegetation', catalog, 'NASA Terra MODIS MOD13Q1 / Planetary Computer', support, **extra))
        records = {}
        for day, (item, _) in sorted(indexed.items()):
            crop = cached(crop_url(query, item))
            records[day] = crop_value(crop, query, item)
            sources.append(source('vegetation', crop, 'NASA Terra MODIS MOD13Q1 / Planetary Computer', support, **extra))
        for month in range(1, 13):
            scheduled = [day for day in composite_dates(year, year) if day.month == month]
            good = [records.get(day) for day in scheduled if records.get(day) is not None]
            value = sum(good) / len(good) if len(good) == len(scheduled) else None
            vegetation.append(dict(date=date(year, month, 1).isoformat(), value=value))
            qa.append(dict(date=date(year, month, 1).isoformat(), available_composites=len(good), expected_composites=len(scheduled)))
    good = sum(row['value'] is not None for row in vegetation)
    result = dict(schemaVersion=1, location=dict(name=args.name, lat=args.lat, lon=args.lon),
                  start=args.start, end=args.end,
                  rain=[dict(date=row.date.isoformat(), value=row.value * calendar.monthrange(row.date.year, row.date.month)[1] if row.value is not None else None) for row in rain.series],
                  soil=[row.model_dump(mode='json') for row in soil.series], vegetation=vegetation,
                  sources=sources, savedAt=datetime.now(timezone.utc).isoformat(),
                  warnings=[*rain.warnings, *soil.warnings,
                            'Precipitation rates were converted to monthly totals using actual month lengths, including leap years.',
                            'NASA Terra MOD13Q1 collection 061 NDVI: original integer crops, scale 0.0001; only pixel_reliability=0, at least 41 of 81 pixels per composite, and every scheduled composite must pass for a month.',
                            f'{len(vegetation) - good} of {len(vegetation)} NDVI months lack complete good-quality composites. Missing values remain gaps.',
                            'NDVI is an indicator of vegetation greenness, not a direct measurement of ecosystem health, crop yield or recovery.',
                            'Weather and soil share the MERRA-2 modelling system; MODIS covers a smaller footprint. Their sequence is descriptive, not a causal attribution.',
                            'This saved example is rebuilt from original cached provider responses with original source URLs and retrieval dates.'],
                  vegetationQuality=qa,
                  build=dict(script='scripts/build_memory_example.py', cache_only=not args.download,
                             units=dict(rain='mm per calendar month', soil='dimensionless GWETROOT fraction', vegetation='scaled NDVI'),
                             source_count=len(sources)))
    # Keep the previous usable archive if any required input or normalization fails.
    path = ROOT / 'frontend/public/data/landscape-memory-example.json'
    temporary = path.with_suffix('.pending.json')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    os.replace(temporary, path)
    counts = {month: sum(row['value'] is not None for row in vegetation if int(row['date'][5:7]) == month) for month in range(1, 13)}
    print(json.dumps(dict(location=result['location'], months=len(vegetation), ndvi_available=good, ndvi_by_month=counts, sources=len(sources), output=str(path)), ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lat', type=float, default=50.0755)
    parser.add_argument('--lon', type=float, default=14.4378)
    parser.add_argument('--name', default='Prague, Czechia')
    parser.add_argument('--start', type=int, default=2001)
    parser.add_argument('--end', type=int, default=2025)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    if args.start < 2001 or args.end < args.start or args.end >= datetime.now(timezone.utc).year or not -90 <= args.lat <= 90 or not -180 <= args.lon <= 180:
        parser.error('Choose a valid location and complete MODIS calendar years from 2001.')
    asyncio.run(build(args))
