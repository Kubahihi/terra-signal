"""Numeric NASA Terra MOD13Q1 from original COG assets via Planetary Computer.

The public data API returns original integer NDVI, reliability and validity masks.
This provider averages a 9 by 9 native MODIS window after quality masking.
Original catalog JSON and numeric NPY bytes are cached with their provenance.
"""
import asyncio
import base64
import io
import hashlib
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import numpy as np

from ..config import NASA_CACHE_DIR, NASA_CACHE_TTL_SECONDS
from ..vegetation_schemas import VegetationObservation, VegetationQuery, VegetationResponse, VegetationSource
from .nasa_ndvi import composite_dates
from .nasa_power import ProviderError, SavedPayload, _read_cache, _write_cache

COLLECTION = 'modis-13Q1-061'
CATALOG = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
POINT = 'https://planetarycomputer.microsoft.com/api/data/v1/item/point'
NDVI = '250m_16_days_NDVI'
QUALITY = '250m_16_days_pixel_reliability'
SPHERE_RADIUS = 6371007.181
ITEM = re.compile(r'^MOD13Q1\.A(\d{4})(\d{3})\.h\d{2}v\d{2}\.061\.\d+$')
_slots = asyncio.Semaphore(4)


def catalog_url(query):
    return str(httpx.URL(CATALOG, params={'collections': COLLECTION,
        'bbox': f'{query.longitude},{query.latitude},{query.longitude},{query.latitude}',
        'datetime': f'{query.start}-01-01T00:00:00Z/{query.end}-12-31T23:59:59Z', 'limit': 1000}))


def point_url(query, item):
    return str(httpx.URL(f'{POINT}/{query.longitude},{query.latitude}', params=[
        ('collection', COLLECTION), ('item', item['id']), ('assets', NDVI), ('assets', QUALITY)]))


NATIVE_CRS = '+proj=sinu +R=6371007.181 +units=m +no_defs'

def crop_url(query, item):
    pixel, left, top = pixel_geometry(item, query)
    bounds = (left - 4 * pixel, top - 5 * pixel, left + 5 * pixel, top + 4 * pixel)
    url = 'https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/' + ','.join(str(v) for v in bounds) + '/9x9.npy'
    return str(httpx.URL(url, params=[('collection', COLLECTION), ('item', item['id']),
        ('assets', NDVI), ('assets', QUALITY), ('coord_crs', NATIVE_CRS), ('dst_crs', NATIVE_CRS),
        ('unscale', 'false'), ('resampling', 'nearest'), ('reproject', 'nearest'), ('return_mask', 'true')]))

def crop_value(saved, query, item):
    try:
        if saved.source_url != crop_url(query, item) or not isinstance(saved.payload, dict) or saved.payload.get('format') != 'npy':
            raise ValueError('Numeric window belongs to another request')
        content = base64.b64decode(saved.payload['content_base64'], validate=True)
        if len(content) > 32768 or hashlib.sha256(content).hexdigest() != saved.payload['sha256']:
            raise ValueError('Numeric response bytes changed')
        array = np.load(io.BytesIO(content), allow_pickle=False)
        if not isinstance(array, np.ndarray):
            array.close()
            raise ValueError('Expected one NPY array')
        if array.shape != (3, 9, 9) or array.dtype.kind not in 'iu' or not np.all(np.isin(array[2], [0, 255])):
            raise ValueError('Unsupported native numeric window or mask')
        ndvi, quality, mask = array
        good = (mask == 255) & (quality == 0) & (ndvi >= -2000) & (ndvi <= 10000)
        return float(ndvi[good].mean() * 0.0001) if np.count_nonzero(good) >= 41 else None
    except (ValueError, KeyError, TypeError, OSError) as exc:
        raise ProviderError('The native numeric MODIS window or quality mask is invalid.', 502) from exc


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def pixel_geometry(item, query):
    """Validate a single stable native sinusoidal cell containing this coordinate."""
    try:
        props = item['properties']
        transform = props['proj:transform']
        shape = props['proj:shape']
        wkt = props['proj:wkt2']
        if 'sinusoidal' not in wkt.lower() or '6371007.181' not in wkt:
            raise ValueError('Unexpected projection')
        if len(transform) != 6 or not all(_finite(v) for v in transform) or len(shape) != 2 or not all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in shape):
            raise ValueError('Invalid native transform')
        a, b, c, d, e, f = transform
        if not 200 <= a <= 300 or not math.isclose(e, -a, abs_tol=1e-8) or abs(b) > 1e-10 or abs(d) > 1e-10:
            raise ValueError('Unsupported native grid')
        phi = math.radians(query.latitude)
        native_x = SPHERE_RADIUS * math.radians(query.longitude) * math.cos(phi)
        native_y = SPHERE_RADIUS * phi
        col = math.floor((native_x - c) / a)
        row = math.floor((native_y - f) / e)
        if not 0 <= row < shape[0] or not 0 <= col < shape[1]:
            return None
        assets = item['assets']
        for name in (NDVI, QUALITY):
            asset = assets[name]
            href = urlparse(asset['href'])
            if href.scheme != 'https' or href.hostname != 'modiseuwest.blob.core.windows.net' or '/modis-061-cogs/MOD13Q1/' not in href.path:
                raise ValueError('Unexpected MODIS source asset')
            band = asset['raster:bands'][0]
            if name == NDVI and (band.get('scale') != 0.0001 or band.get('data_type') != 'int16'):
                raise ValueError('Unexpected NDVI scale')
            if name == QUALITY and band.get('data_type') != 'int8':
                raise ValueError('Unexpected reliability type')
        # Physical cell edges stay stable across processing dates; round only this
        # metadata identity, never the requested point or observed value.
        return (round(a, 6), round(c + col * a, 5), round(f + row * e, 5))
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise ProviderError('MODIS catalog has unsupported pixel geometry, scaling or assets.', 502) from exc


def catalog_items(saved, query):
    try:
        url = urlparse(saved.source_url)
        params = parse_qs(url.query)
        if url.scheme != 'https' or url.hostname != 'planetarycomputer.microsoft.com' or url.path != '/api/stac/v1/search' or params.get('bbox') != [f'{query.longitude},{query.latitude},{query.longitude},{query.latitude}'] or params.get('collections') != [COLLECTION] or params.get('datetime') != [f'{query.start}-01-01T00:00:00Z/{query.end}-12-31T23:59:59Z']:
            raise ValueError('Catalog belongs to another request')
        payload = saved.payload
        if any(link.get('rel') == 'next' for link in payload.get('links', [])):
            raise ValueError('Catalog pagination requires a narrower interval')
        indexed = {}
        expected = set(composite_dates(query.start, query.end))
        for item in payload['features']:
            match = ITEM.fullmatch(item.get('id', ''))
            if not match:
                continue  # The collection also contains Aqua/MYD; never mix it.
            day = date(int(match[1]), 1, 1) + timedelta(days=int(match[2]) - 1)
            if day not in expected:
                continue
            # Some older items have no platform/datetime fields. The product ID
            # and nominal start date are authoritative and independently checked.
            if item.get('collection') != COLLECTION or item['properties'].get('start_datetime', '')[:10] != day.isoformat():
                raise ValueError('MODIS nominal date or collection mismatch')
            geometry = pixel_geometry(item, query)
            if geometry is None:
                continue
            previous = indexed.get(day)
            if previous and previous[1] != geometry:
                raise ValueError('Multiple native cells overlap this point')
            if not previous or item['id'] > previous[0]['id']:
                indexed[day] = (item, geometry)  # Latest processing timestamp.
        if not indexed:
            raise ValueError('No Terra MOD13Q1 scenes cover this point and period')
        if len({geometry for _, geometry in indexed.values()}) != 1:
            raise ValueError('Native MODIS pixel changed within this record')
        return indexed
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise ProviderError('The MODIS catalog does not provide a consistent Terra pixel for this request.', 502) from exc


def point_value(saved, query, item):
    try:
        if saved.source_url != point_url(query, item):
            raise ValueError('Point response belongs to another scene or location')
        payload = saved.payload
        coords = payload['coordinates']
        if len(coords) != 2 or not all(_finite(v) for v in coords) or not math.isclose(coords[0], query.longitude, abs_tol=1e-8) or not math.isclose(coords[1], query.latitude, abs_tol=1e-8):
            raise ValueError('Point coordinates mismatch')
        names, values = payload['band_names'], payload['values']
        if len(names) != 2 or len(values) != 2 or set(names) != {NDVI + '_b1', QUALITY + '_b1'}:
            raise ValueError('Point bands mismatch')
        sample = dict(zip(names, values))
        raw, quality = sample[NDVI + '_b1'], sample[QUALITY + '_b1']
        if not _finite(raw) or not float(raw).is_integer() or not -2000 <= raw <= 10000 or not _finite(quality) or quality != 0:
            return None
        return raw * 0.0001
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise ProviderError('The numeric MODIS point or quality response is invalid.', 502) from exc


async def _download(client, url):
    async with asyncio.timeout(30):
        async with _slots:
            response = await client.get(url)
            response.raise_for_status()
            if '/bbox/' in url:
                content = response.content
                if len(content) > 32768:
                    raise ProviderError('Unexpectedly large MODIS window response.')
                payload = {'format': 'npy', 'content_base64': base64.b64encode(content).decode('ascii'), 'sha256': hashlib.sha256(content).hexdigest()}
            else:
                payload = response.json()
            return SavedPayload(payload, str(response.url), datetime.now(timezone.utc).isoformat(), 'live')


async def cached_json(client, url, validate, refresh):
    path = NASA_CACHE_DIR / 'vegetation-pc-v1' / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    cached = _read_cache(path)
    checked = None
    if cached:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached.retrieved_at)).total_seconds()
            if age < 0:
                raise ValueError('Future retrieval date')
            checked = validate(cached)
            if age < NASA_CACHE_TTL_SECONDS and not refresh:
                return checked, cached, False
        except (ValueError, TypeError, ProviderError):
            cached = None
    try:
        live = await _download(client, url)
        result = validate(live)
        _write_cache(path, live)
        return result, live, False
    except (httpx.HTTPError, TimeoutError, ValueError, ProviderError) as exc:
        if cached:
            return checked, cached, True
        raise ProviderError('The numeric MODIS service did not return usable data and no matching saved record is available. Retry later or import an original filtered NDVI CSV.', 503) from exc


async def fetch_vegetation(query: VegetationQuery, refresh=False):
    if query.start > query.end or query.end - query.start > 4 or query.end >= datetime.now(timezone.utc).year:
        raise ProviderError('Request one to five complete MODIS years from 2001.', 422)
    async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5), follow_redirects=True,
            headers={'Accept': 'application/json', 'User-Agent': 'TerraSignal/0.1 NASA Space Apps'}) as client:
        indexed, catalog, stale = await cached_json(client, catalog_url(query), lambda saved: catalog_items(saved, query), refresh)
        ordered = sorted(indexed.items())
        async def sample(entry):
            day, (item, _) = entry
            value, saved, fallback = await cached_json(client, crop_url(query, item), lambda saved: crop_value(saved, query, item), refresh)
            return day, value, saved, fallback
        pending = [asyncio.create_task(sample(entry)) for entry in ordered]
        try:
            samples = await asyncio.gather(*pending)
        except BaseException:
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            raise
    records = {day: value for day, value, _, _ in samples}
    expected = composite_dates(query.start, query.end)
    series = []
    for year in range(query.start, query.end + 1):
        for month in range(1, 13):
            dates = [day for day in expected if day.year == year and day.month == month]
            good = [records.get(day) for day in dates if records.get(day) is not None]
            series.append(VegetationObservation(date=date(year, month, 1), value=sum(good) / len(good) if len(good) == len(dates) else None,
                available_composites=len(good), expected_composites=len(dates)))
    sources = [VegetationSource(source_url=saved.source_url, retrieved_at=saved.retrieved_at, data_origin=saved.origin)
               for saved in [catalog] + [saved for _, _, saved, _ in samples]]
    missing = sum(row.value is None for row in series)
    pixel_size = next(iter(indexed.values()))[1][0]
    warnings = [
        'NASA Terra MOD13Q1 collection 061, sampled numerically from original NDVI and pixel_reliability COG assets through Microsoft Planetary Computer. No rendered map colors are used.',
        'A 9 by 9 native MODIS pixel window around the containing pixel is quality-filtered; at least 41 of 81 pixels must be good for a composite. The MODIS pixel and NASA POWER weather cell cover different areas.',
        'Only pixel_reliability=0 and valid raw integer NDVI -2000..10000 are retained; NDVI scale is 0.0001. Clouds, snow, marginal values and fill remain missing.',
        'Monthly values equally average all scheduled 16-day composites starting in that month. A missing scene or one failed quality sample withholds the month. These are not daily calendar-month means.',
        f'{missing} of {len(series)} months lack complete good-quality composite coverage; gaps are not zeros.',
    ]
    if stale or any(fallback for _, _, _, fallback in samples):
        warnings.append('At least one original cached response is used after a source outage; its original retrieval date is retained.')
    return VegetationResponse(latitude=query.latitude, longitude=query.longitude, start=query.start, end=query.end,
        series=series, spatial_support=f'9 × 9 native MODIS sinusoidal pixels around the containing pixel, {pixel_size:.6f} m each (about {pixel_size * 9 / 1000:.3f} × {pixel_size * 9 / 1000:.3f} km); quality-filtered area mean.',
        pixel_size_m=pixel_size, nrows=9, ncols=9, collections=['061'], source='NASA Terra MODIS MOD13Q1 / Planetary Computer',
        source_url=f'https://planetarycomputer.microsoft.com/api/stac/v1/collections/{COLLECTION}', sources=sources,
        retrieved_at=min(source.retrieved_at for source in sources), data_origin='live' if any(source.data_origin == 'live' for source in sources) else 'cache', warnings=warnings)
