from datetime import date, datetime, timedelta, timezone
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx

from backend.app.routes.soil import router
from backend.app.services import nasa_soil
from backend.app.services.nasa_power import ProviderError, SavedPayload
from backend.app.soil_schemas import SoilQuery


def query(start=2020, end=2021):
    return SoilQuery(latitude=48.85, longitude=16.85, start=start, end=end)


def fixture(start=2020, end=2021):
    return dict(
        header=dict(fill_value=-999, sources=['MERRA2']),
        properties=dict(parameter=dict(GWETROOT={
            f'{year}{month:02d}': (month - 1) / 12 for year in range(start, end + 1) for month in range(1, 14)
        })),
        parameters=dict(GWETROOT=dict(units='1', longname='Root Zone Soil Wetness')),
    )


def saved(payload=None, age=0, origin='cache'):
    return SavedPayload(
        fixture() if payload is None else payload,
        'https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=GWETROOT&community=AG&latitude=48.85&longitude=16.85&start=2020&end=2021&format=JSON',
        (datetime.now(timezone.utc) - timedelta(days=age)).isoformat(), origin,
    )


class SoilNormalizationTests(unittest.TestCase):
    def test_ordered_calendar_excludes_annual_month_thirteen_and_preserves_zero(self):
        result = nasa_soil.normalize_soil(query(), saved())
        self.assertEqual(len(result.series), 24)
        self.assertEqual(result.series[0].date, date(2020, 1, 1))
        self.assertEqual(result.series[-1].date, date(2021, 12, 1))
        self.assertEqual(result.series[0].value, 0)
        self.assertEqual((result.parameter, result.unit, result.data_origin), ('GWETROOT', '1', 'cache'))
        self.assertIn('MERRA2', result.source)
        self.assertTrue(any('not volumetric' in note for note in result.warnings))

    def test_missing_invalid_fill_and_out_of_range_values_remain_gaps(self):
        payload = fixture()
        values = payload['properties']['parameter']['GWETROOT']
        replacements = [-999, 'NaN', float('inf'), True, -0.01, 1.01, 'bad', None]
        for month, value in enumerate(replacements, 1):
            values[f'2020{month:02d}'] = value
        del values['202009']
        result = nasa_soil.normalize_soil(query(), saved(payload))
        self.assertEqual([point.value for point in result.series[:9]], [None] * 9)
        self.assertEqual(result.series[9].value, 0.75)
        self.assertTrue(any('9 of 24' in note for note in result.warnings))
        self.assertTrue(any('2 values outside' in note for note in result.warnings))

    def test_unknown_units_empty_values_and_missing_metadata_are_rejected(self):
        for change in ('unit', 'values', 'parameter', 'metadata', 'fill'):
            with self.subTest(change=change):
                payload = fixture()
                if change == 'unit':
                    payload['parameters']['GWETROOT']['units'] = 'm3/m3'
                elif change == 'values':
                    payload['properties']['parameter']['GWETROOT'] = {}
                elif change == 'parameter':
                    del payload['properties']['parameter']['GWETROOT']
                elif change == 'metadata':
                    payload['parameters'] = {}
                else:
                    payload['header']['fill_value'] = float('nan')
                with self.assertRaises(ProviderError):
                    nasa_soil.normalize_soil(query(), saved(payload))

    def test_only_original_soil_data_with_valid_provenance_can_be_returned(self):
        for change in ('origin', 'retrieved_at', 'source_url'):
            with self.subTest(change=change):
                item = saved()
                if change == 'origin':
                    item.origin = 'snapshot'
                elif change == 'retrieved_at':
                    item.retrieved_at = '2020-01-01'
                else:
                    item.source_url = ''
                with self.assertRaises(ProviderError):
                    nasa_soil.normalize_soil(query(), item)

    def test_cache_namespace_depends_on_point_and_interval(self):
        initial = nasa_soil.cache_path(query())
        self.assertEqual(initial.parent.name, 'soil')
        elsewhere = query().model_copy(update={'latitude': 49.0})
        self.assertNotEqual(initial, nasa_soil.cache_path(elsewhere))
        self.assertNotEqual(initial, nasa_soil.cache_path(query(2020, 2020)))
        self.assertEqual(nasa_soil.parameters(query())['parameters'], 'GWETROOT')
        self.assertEqual(nasa_soil.parameters(query())['community'], 'AG')


class SoilCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_soil_cache_avoids_network(self):
        with patch.object(nasa_soil, '_read_cache', return_value=saved()), patch.object(nasa_soil, '_download', new_callable=AsyncMock) as download:
            result = await nasa_soil.fetch_soil(query())
        self.assertEqual(result.data_origin, 'cache')
        download.assert_not_awaited()

    async def test_refresh_bypasses_fresh_cache_and_saves_valid_original(self):
        live = saved(origin='live')
        with patch.object(nasa_soil, '_read_cache', return_value=saved()), patch.object(nasa_soil, '_download', new_callable=AsyncMock, return_value=live) as download, patch.object(nasa_soil, '_write_cache') as write:
            result = await nasa_soil.fetch_soil(query(), refresh=True)
        self.assertEqual(result.data_origin, 'live')
        download.assert_awaited_once()
        write.assert_called_once_with(nasa_soil.cache_path(query()), live)

    async def test_outage_preserves_original_stale_provenance(self):
        cached = saved(age=2)
        with patch.object(nasa_soil, '_read_cache', return_value=cached), patch.object(nasa_soil, '_download', side_effect=httpx.ConnectError('offline')):
            result = await nasa_soil.fetch_soil(query())
        self.assertEqual(result.data_origin, 'cache')
        self.assertEqual(result.retrieved_at, cached.retrieved_at)
        self.assertEqual(result.source_url, cached.source_url)
        self.assertTrue(any('saved original soil' in note for note in result.warnings))

    async def test_invalid_live_response_cannot_overwrite_valid_cache(self):
        bad = fixture()
        bad['parameters']['GWETROOT']['units'] = 'C'
        with patch.object(nasa_soil, '_read_cache', return_value=saved(age=2)), patch.object(nasa_soil, '_download', new_callable=AsyncMock, return_value=saved(bad, origin='live')), patch.object(nasa_soil, '_write_cache') as write:
            result = await nasa_soil.fetch_soil(query(), refresh=True)
        self.assertEqual(result.data_origin, 'cache')
        write.assert_not_called()

    async def test_no_cache_and_bad_cached_data_both_return_explicit_unavailability(self):
        bad = fixture()
        bad['parameters']['GWETROOT']['units'] = 'C'
        for cached in (None, saved(bad, age=2)):
            with self.subTest(cached=cached is not None):
                with patch.object(nasa_soil, '_read_cache', return_value=cached), patch.object(nasa_soil, '_download', side_effect=httpx.ConnectError('offline')):
                    with self.assertRaises(ProviderError) as error:
                        await nasa_soil.fetch_soil(query())
                self.assertEqual(error.exception.status_code, 503)

    async def test_transient_upstream_error_has_one_bounded_retry(self):
        request = httpx.Request('GET', 'https://power.larc.nasa.gov/api/temporal/monthly/point')
        responses = [httpx.Response(429, request=request), httpx.Response(200, request=request, json=fixture())]
        with patch.object(nasa_soil.httpx, 'AsyncClient') as factory, patch.object(nasa_soil.asyncio, 'sleep', new_callable=AsyncMock):
            get = factory.return_value.__aenter__.return_value.get = AsyncMock(side_effect=responses)
            result = await nasa_soil._download(query())
        self.assertEqual(get.await_count, 2)
        self.assertEqual(result.origin, 'live')
        self.assertEqual(result.payload['parameters']['GWETROOT']['units'], '1')

    async def test_permanent_upstream_error_is_not_retried(self):
        request = httpx.Request('GET', 'https://power.larc.nasa.gov/api/temporal/monthly/point')
        with patch.object(nasa_soil.httpx, 'AsyncClient') as factory, patch.object(nasa_soil.asyncio, 'sleep', new_callable=AsyncMock) as sleep:
            get = factory.return_value.__aenter__.return_value.get = AsyncMock(return_value=httpx.Response(400, request=request))
            with self.assertRaises(httpx.HTTPStatusError):
                await nasa_soil._download(query())
        self.assertEqual(get.await_count, 1)
        sleep.assert_not_awaited()


class SoilRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_route_returns_typed_fraction_series_and_passes_refresh(self):
        result = nasa_soil.normalize_soil(query(), saved())
        with patch('backend.app.routes.soil.fetch_soil', new_callable=AsyncMock, return_value=result) as fetch:
            response = self.client.get('/api/soil?lat=48.85&lon=16.85&start=2020&end=2021&refresh=true')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['parameter'], 'GWETROOT')
        self.assertEqual(response.json()['unit'], '1')
        self.assertEqual(len(response.json()['series']), 24)
        self.assertTrue(fetch.call_args.kwargs['refresh'])

    def test_route_rejects_invalid_coordinates_and_incomplete_or_reversed_years(self):
        year = datetime.now(timezone.utc).year
        for query_string in ('lat=91&lon=0', 'lat=0&lon=181', 'lat=0&lon=0&start=1980',
                             f'lat=0&lon=0&end={year}', 'lat=0&lon=0&start=2025&end=2020'):
            with self.subTest(query_string=query_string):
                self.assertEqual(self.client.get('/api/soil?' + query_string).status_code, 422)

    def test_provider_unavailability_retains_http_status_and_message(self):
        with patch('backend.app.routes.soil.fetch_soil', side_effect=ProviderError('soil unavailable', 503)):
            response = self.client.get('/api/soil?lat=48.85&lon=16.85&start=2020&end=2021')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail'], 'soil unavailable')
