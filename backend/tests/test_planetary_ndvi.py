"""Contract/quality/cache checks for the numeric COG provider, without network."""
import asyncio
import base64
import hashlib
import io
import numpy as np
import copy
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx

from backend.app.services import planetary_ndvi as pc
from backend.app.services.nasa_power import ProviderError, SavedPayload
from backend.app.vegetation_schemas import VegetationQuery


def query(): return VegetationQuery(latitude=52.52, longitude=13.405, start=2024, end=2024)

def item(day=1, product='MOD13Q1', processing='2025001000000'):
    stamp = (datetime(2024, 1, 1) + timedelta(days=day - 1)).date()
    identity = f'{product}.A2024{day:03}.h18v03.061.{processing}'
    return {'id': identity, 'collection': pc.COLLECTION,
        'properties': {'start_datetime': stamp.isoformat() + 'T00:00:00Z',
          'proj:wkt2': 'Sinusoidal sphere 6371007.181', 'proj:shape': [4800, 4800],
          'proj:transform': [231.65635826395834, 0, 0, 0, -231.65635826395834, 6671703.118]},
        'assets': {name: {'href': f'https://modiseuwest.blob.core.windows.net/modis-061-cogs/MOD13Q1/18/03/{identity}_{name}.tif',
          'raster:bands': [{'scale': 0.0001, 'data_type': 'int16'} if name == pc.NDVI else {'data_type': 'int8'}]}
          for name in [pc.NDVI, pc.QUALITY]}}

def saved(payload, url, age=0):
    return SavedPayload(payload, url, (datetime.now(timezone.utc) - timedelta(days=age)).isoformat(), 'cache')

def catalog(items): return saved({'features': items, 'links': []}, pc.catalog_url(query()))

def point(raw=4000, quality=0, scene=None):
    scene = scene or item()
    return saved({'coordinates': [13.405, 52.52], 'values': [raw, quality],
        'band_names': [pc.NDVI + '_b1', pc.QUALITY + '_b1']}, pc.point_url(query(), scene))

def crop(raw=4000, quality=0, scene=None):
    array = np.stack([np.full((9, 9), raw, dtype=np.int16), np.full((9, 9), quality, dtype=np.int16), np.full((9, 9), 255, dtype=np.int16)])
    return crop_saved(array, scene)

def crop_saved(array, scene=None):
    stream = io.BytesIO(); np.save(stream, array, allow_pickle=False); content=stream.getvalue()
    return saved({'format':'npy', 'content_base64':base64.b64encode(content).decode('ascii'), 'sha256':hashlib.sha256(content).hexdigest()}, pc.crop_url(query(), scene or item()))


class NumericModisTests(unittest.TestCase):
    def test_numeric_native_window_masks_quality_before_averaging(self):
        self.assertEqual(pc.crop_value(crop(0), query(), item()), 0)
        self.assertAlmostEqual(pc.crop_value(crop(2973), query(), item()), 0.2973)
        array = np.stack([np.full((9,9),4000,dtype=np.int16),np.full((9,9),3,dtype=np.int16),np.full((9,9),255,dtype=np.int16)])
        array[1].flat[:40] = 0
        self.assertIsNone(pc.crop_value(crop_saved(array), query(), item()))
        array[1].flat[40] = 0
        self.assertEqual(pc.crop_value(crop_saved(array), query(), item()), 0.4)
        array[2].flat[40] = 0
        self.assertIsNone(pc.crop_value(crop_saved(array), query(), item()))

    def test_numeric_bytes_dimensions_and_request_must_match(self):
        original = crop(); original.payload['sha256'] = '0' * 64
        with self.assertRaises(ProviderError): pc.crop_value(original, query(), item())
        original = crop(); original.source_url = pc.crop_url(query(), item(17))
        with self.assertRaises(ProviderError): pc.crop_value(original, query(), item())
        for shape in [(2,9,9),(3,8,9)]:
            original = crop_saved(np.zeros(shape,dtype=np.int16))
            with self.assertRaises(ProviderError): pc.crop_value(original, query(), item())
        original = crop(); original.payload = []
        with self.assertRaises(ProviderError): pc.crop_value(original, query(), item())
        stream = io.BytesIO(); np.savez(stream, values=np.zeros((3,9,9), dtype=np.int16)); content = stream.getvalue()
        original = saved({'format':'npy', 'content_base64':base64.b64encode(content).decode('ascii'), 'sha256':hashlib.sha256(content).hexdigest()}, pc.crop_url(query(), item()))
        with self.assertRaises(ProviderError): pc.crop_value(original, query(), item())

    def test_scale_quality_true_zero_and_band_order(self):
        self.assertAlmostEqual(pc.point_value(point(2973), query(), item()), 0.2973)
        self.assertEqual(pc.point_value(point(0), query(), item()), 0)
        self.assertEqual(pc.point_value(point(-2000), query(), item()), -0.2)
        for raw, flag in [(5000, 1), (5000, 2), (5000, 3), (-3000, 0), (True, 0), (0.4, 0), (None, 0), (5000, None)]:
            self.assertIsNone(pc.point_value(point(raw, flag), query(), item()))
        response = point()
        response.payload['band_names'].reverse(); response.payload['values'].reverse()
        self.assertEqual(pc.point_value(response, query(), item()), 0.4)

    def test_other_point_scene_or_bands_cannot_be_relabelled(self):
        for mutate in [lambda x: x.payload.update(coordinates=[0, 0]),
                       lambda x: x.payload.update(band_names=[pc.NDVI + '_b1'] * 2),
                       lambda x: setattr(x, 'source_url', pc.point_url(query(), item(17)))]:
            response = point(); mutate(response)
            with self.assertRaises(ProviderError): pc.point_value(response, query(), item())

    def test_catalog_uses_terra_id_not_optional_platform_and_stable_native_pixel(self):
        indexed = pc.catalog_items(catalog([item(), item(17), item(9, 'MYD13Q1')]), query())
        self.assertEqual([day.day for day in indexed], [1, 17])
        self.assertEqual(len({geometry for _, geometry in indexed.values()}), 1)
        self.assertIsNone(pc.pixel_geometry(item(), VegetationQuery(latitude=0, longitude=0, start=2024, end=2024)))
        newer = item(processing='2026001000000')
        indexed = pc.catalog_items(catalog([item(), newer]), query())
        self.assertEqual(next(iter(indexed.values()))[0]['id'], newer['id'])

    def test_bad_scale_projection_request_and_pagination_are_rejected(self):
        bad = item(); bad['assets'][pc.NDVI]['raster:bands'][0]['scale'] = 0.01
        with self.assertRaises(ProviderError): pc.catalog_items(catalog([bad]), query())
        bad = item(); bad['properties']['proj:wkt2'] = 'Unknown projection'
        with self.assertRaises(ProviderError): pc.catalog_items(catalog([bad]), query())
        response = catalog([item()]); response.source_url = response.source_url.replace('52.52', '50.0')
        with self.assertRaises(ProviderError): pc.catalog_items(response, query())
        response = catalog([item()]); response.payload['links'] = [{'rel': 'next', 'href': 'https://example.test'}]
        with self.assertRaises(ProviderError): pc.catalog_items(response, query())


class NumericModisAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_scene_or_bad_quality_withholds_whole_month_and_sources_remain(self):
        scenes = [item((day - datetime(2024, 1, 1).date()).days + 1) for day in pc.composite_dates(2024, 2024)]
        scenes = [scene for scene in scenes if not scene['id'].startswith('MOD13Q1.A2024017.')]
        async def response(client, url, validate, refresh):
            if url.startswith(pc.CATALOG): original = catalog(scenes)
            else:
                scene = next(s for s in scenes if s['id'] == parse_qs(urlparse(url).query)['item'][0])
                original = crop(0 if 'A2024033.' in scene['id'] else 4000, 3 if 'A2024065.' in scene['id'] else 0, scene)
            return validate(original), original, False
        with patch.object(pc, 'cached_json', side_effect=response):
            result = await pc.fetch_vegetation(query())
        self.assertIsNone(result.series[0].value)  # Missing January17 scene.
        self.assertEqual((result.series[0].available_composites, result.series[0].expected_composites), (1, 2))
        self.assertAlmostEqual(result.series[1].value, 0.2)  # A true zero is averaged.
        self.assertIsNone(result.series[2].value)  # One cloud quality flag.
        self.assertEqual((result.nrows, result.ncols), (9, 9))
        self.assertIn('quality-filtered area mean', result.spatial_support)
        self.assertEqual(len(result.sources), len(scenes) + 1)
        self.assertTrue(all('planetarycomputer.microsoft.com' in source.source_url for source in result.sources))

    async def test_valid_saved_sample_survives_outage_and_bad_live_never_overwrites_it(self):
        old = point(); old.retrieved_at = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        bad = point(); bad.payload['coordinates'] = [0, 0]
        validator = lambda response: pc.point_value(response, query(), item())
        with patch.object(pc, '_read_cache', return_value=old), patch.object(pc, '_download', return_value=bad), patch.object(pc, '_write_cache') as write:
            value, original, stale = await pc.cached_json(None, old.source_url, validator, True)
        self.assertEqual(value, 0.4); self.assertTrue(stale)
        self.assertEqual(original.retrieved_at, old.retrieved_at); write.assert_not_called()

    async def test_future_cache_date_cannot_be_presented_as_original_retrieval(self):
        bad = point(); bad.retrieved_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        with patch.object(pc, '_read_cache', return_value=bad), patch.object(pc, '_download', side_effect=httpx.ConnectError('offline')):
            with self.assertRaises(ProviderError): await pc.cached_json(None, bad.source_url, lambda s: pc.point_value(s, query(), item()), False)

    async def test_failed_sample_cancels_siblings(self):
        cancelled = []
        async def response(client, url, validate, refresh):
            if url.startswith(pc.CATALOG):
                original = catalog([item(), item(17), item(33)])
                return validate(original), original, False
            if 'A2024001.' in url: raise ProviderError('source failed', 503)
            try: await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled.append(url); raise
        with patch.object(pc, 'cached_json', side_effect=response):
            with self.assertRaises(ProviderError): await pc.fetch_vegetation(query())
        self.assertTrue(cancelled)


if __name__ == '__main__': unittest.main()
