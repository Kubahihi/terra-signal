import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.schemas import DailyQuery
from backend.app.services import nasa_daily
from backend.app.services.nasa_power import ProviderError, SavedPayload


def query(start=2024, end=2024):
    return DailyQuery(latitude=50.0755, longitude=14.4378, start=start, end=end)


def fixture(start=2024, end=2024):
    # Artificial values are used only in tests; defaults lie exactly at thresholds.
    values = {name: {} for name in nasa_daily.PARAMETERS}
    day, stop = date(start, 1, 1), date(end + 1, 1, 1)
    while day < stop:
        key = day.strftime('%Y%m%d')
        for name, value in zip(nasa_daily.PARAMETERS, (30, 0, 1)):
            values[name][key] = value
        day += timedelta(days=1)
    return {'header': {'fill_value': -999, 'time_standard': 'LST', 'sources': ['Test fixture']},
            'properties': {'parameter': values},
            'parameters': {name: {'units': 'mm/day' if name == 'PRECTOTCORR' else 'C'} for name in nasa_daily.PARAMETERS}}


def saved(payload=None, age=0, origin='cache'):
    return SavedPayload(payload if payload is not None else fixture(), 'https://power.larc.nasa.gov/api/temporal/daily/point?test=fixture',
                        (datetime.now(timezone.utc) - timedelta(days=age)).isoformat(), origin)


def normalize(payload, start=2024, end=2024):
    return nasa_daily.normalize_daily(query(start, end), saved(payload))


class DailyIndexTests(unittest.TestCase):
    def test_thresholds_are_strict_and_true_zero_is_not_missing(self):
        result = normalize(fixture())
        row = result.years[0]
        self.assertEqual(row.expected_days, 366)
        for metric in (row.hot_days, row.frost_days, row.warm_nights, row.longest_dry_spell):
            self.assertEqual(metric.value, 0)
            self.assertEqual(metric.available_days, 366)
        self.assertIsNone(row.longest_dry_spell.start_date)
        self.assertFalse(row.longest_dry_spell.touches_year_boundary)

    def test_hot_frost_and_warm_counts_use_the_correct_daily_extreme(self):
        payload = fixture()
        values = payload['properties']['parameter']
        values['T2M_MAX']['20240101'] = 30.01
        values['T2M_MIN']['20240102'] = -0.01
        values['T2M_MIN']['20240103'] = 20
        values['T2M_MIN']['20240104'] = 20.01
        row = normalize(payload).years[0]
        self.assertEqual((row.hot_days.value, row.frost_days.value, row.warm_nights.value), (1, 1, 1))

    def test_leap_day_is_an_observation_and_can_meet_all_relevant_thresholds(self):
        payload = fixture()
        for name, value in zip(nasa_daily.PARAMETERS, (31, 21, 0)):
            payload['properties']['parameter'][name]['20240229'] = value
        result = normalize(payload)
        self.assertEqual(len(result.daily), 366)
        row = result.years[0]
        self.assertEqual((row.hot_days.value, row.warm_nights.value, row.longest_dry_spell.value), (1, 1, 1))
        self.assertEqual(row.longest_dry_spell.start_date, date(2024, 2, 29))

    def test_missing_maximum_withholds_only_the_relevant_annual_count(self):
        payload = fixture()
        values = payload['properties']['parameter']['T2M_MAX']
        values['20240101'] = 35
        del values['20240102']
        row = normalize(payload).years[0]
        self.assertIsNone(row.hot_days.value)
        self.assertEqual((row.hot_days.observed_count, row.hot_days.available_days), (1, 365))
        self.assertEqual(row.frost_days.value, 0)
        self.assertEqual(row.longest_dry_spell.value, 0)

    def test_fill_nonfinite_boolean_and_invalid_numbers_remain_missing(self):
        payload = fixture()
        values = payload['properties']['parameter']['T2M_MAX']
        for key, value in zip(('20240101', '20240102', '20240103', '20240104'), (-999, 'NaN', True, 'bad')):
            values[key] = value
        result = normalize(payload)
        self.assertTrue(all(row.tmax is None for row in result.daily[:4]))
        self.assertEqual(result.years[0].hot_days.available_days, 362)
        self.assertIsNone(result.years[0].hot_days.value)

    def test_missing_rain_does_not_join_two_dry_runs_or_become_an_exact_maximum(self):
        payload = fixture()
        rain = payload['properties']['parameter']['PRECTOTCORR']
        for day in range(1, 11):
            rain[f'202401{day:02d}'] = 0
        rain['20240105'] = -999
        spell = normalize(payload).years[0].longest_dry_spell
        self.assertIsNone(spell.value)
        self.assertEqual(spell.observed_count, 5)
        self.assertEqual((spell.start_date, spell.end_date), (date(2024, 1, 6), date(2024, 1, 10)))

    def test_runs_are_clipped_at_year_boundaries(self):
        payload = fixture(2023, 2024)
        rain = payload['properties']['parameter']['PRECTOTCORR']
        for day in range(28, 32):
            rain[f'202312{day}'] = 0
        for day in range(1, 7):
            rain[f'202401{day:02d}'] = 0
        rows = normalize(payload, 2023, 2024).years
        self.assertEqual((rows[0].longest_dry_spell.value, rows[1].longest_dry_spell.value), (4, 6))
        self.assertTrue(all(row.longest_dry_spell.touches_year_boundary for row in rows))

    def test_equal_runs_show_the_earliest_dates(self):
        payload = fixture()
        rain = payload['properties']['parameter']['PRECTOTCORR']
        for month in (3, 4):
            for day in (1, 2, 3):
                rain[f'2024{month:02d}{day:02d}'] = 0.99
        spell = normalize(payload).years[0].longest_dry_spell
        self.assertEqual(spell.value, 3)
        self.assertEqual(spell.start_date, date(2024, 3, 1))
        self.assertFalse(spell.touches_year_boundary)

    def test_an_entirely_dry_leap_year_has_366_days(self):
        payload = fixture()
        for key in payload['properties']['parameter']['PRECTOTCORR']:
            payload['properties']['parameter']['PRECTOTCORR'][key] = 0
        spell = normalize(payload).years[0].longest_dry_spell
        self.assertEqual(spell.value, 366)
        self.assertEqual(spell.end_date, date(2024, 12, 31))

    def test_negative_rain_and_inconsistent_temperature_bounds_are_excluded(self):
        payload = fixture()
        values = payload['properties']['parameter']
        values['PRECTOTCORR']['20240101'] = -0.1
        values['T2M_MAX']['20240102'] = -1
        values['T2M_MIN']['20240102'] = 5
        result = normalize(payload)
        self.assertIsNone(result.daily[0].precipitation)
        self.assertIsNone(result.daily[1].tmax)
        self.assertIsNone(result.daily[1].tmin)
        self.assertIsNone(result.years[0].longest_dry_spell.value)
        self.assertEqual(result.years[0].longest_dry_spell.observed_count, 0)

    def test_unknown_units_and_a_different_day_basis_are_rejected(self):
        payload = fixture()
        payload['parameters']['PRECTOTCORR']['units'] = 'mm/hour'
        with self.assertRaises(ProviderError):
            normalize(payload)
        payload = fixture()
        payload['header']['time_standard'] = 'UTC'
        with self.assertRaises(ProviderError):
            normalize(payload)

    def test_empty_parameter_has_no_annual_count_and_all_empty_data_is_an_error(self):
        payload = fixture()
        payload['properties']['parameter']['T2M_MAX'] = {}
        row = normalize(payload).years[0]
        self.assertIsNone(row.hot_days.value)
        self.assertEqual(row.hot_days.available_days, 0)
        self.assertEqual(row.frost_days.value, 0)
        payload['properties']['parameter'] = {}
        with self.assertRaises(ProviderError):
            normalize(payload)


class DailyCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_daily_cache_avoids_a_network_request(self):
        with patch.object(nasa_daily, '_read_cache', return_value=saved()), patch.object(nasa_daily, '_download', new_callable=AsyncMock) as download:
            result = await nasa_daily.fetch_daily(query())
        download.assert_not_awaited()
        self.assertEqual(result.data_origin, 'cache')

    async def test_outage_preserves_stale_daily_provenance(self):
        old = saved(age=2)
        with patch.object(nasa_daily, '_read_cache', return_value=old), patch.object(nasa_daily, '_download', side_effect=httpx.ConnectError('offline')):
            result = await nasa_daily.fetch_daily(query())
        self.assertEqual(result.retrieved_at, old.retrieved_at)
        self.assertEqual(result.data_origin, 'cache')
        self.assertTrue(any('saved original daily' in warning for warning in result.warnings))

    async def test_no_daily_fallback_never_uses_monthly_snapshots(self):
        with patch.object(nasa_daily, '_read_cache', return_value=None), patch.object(nasa_daily, '_download', side_effect=httpx.ConnectError('offline')):
            with self.assertRaises(ProviderError) as error:
                await nasa_daily.fetch_daily(query())
        self.assertEqual(error.exception.status_code, 503)

    async def test_bad_live_data_cannot_overwrite_a_valid_saved_response(self):
        bad = fixture()
        bad['header']['time_standard'] = 'UTC'
        with patch.object(nasa_daily, '_read_cache', return_value=saved(age=2)), patch.object(nasa_daily, '_download', return_value=saved(bad, origin='live')), patch.object(nasa_daily, '_write_cache') as write:
            result = await nasa_daily.fetch_daily(query(), refresh=True)
        write.assert_not_called()
        self.assertEqual(result.data_origin, 'cache')

    async def test_a_transient_upstream_error_gets_one_bounded_retry(self):
        request = httpx.Request('GET', 'https://power.larc.nasa.gov/api/temporal/daily/point')
        responses = [httpx.Response(429, request=request), httpx.Response(200, request=request, json=fixture())]
        with patch.object(nasa_daily.httpx, 'AsyncClient') as factory, patch.object(nasa_daily.asyncio, 'sleep', new_callable=AsyncMock):
            factory.return_value.__aenter__.return_value.get = AsyncMock(side_effect=responses)
            result = await nasa_daily._download(query())
            self.assertEqual(factory.return_value.__aenter__.return_value.get.await_count, 2)
        self.assertEqual(result.origin, 'live')


class DailyRouteTests(unittest.TestCase):
    def test_daily_route_returns_raw_days_and_four_annual_indices(self):
        result = normalize(fixture())
        with patch('backend.app.routes.daily.fetch_daily', new_callable=AsyncMock, return_value=result) as fetch:
            response = TestClient(app).get('/api/daily?lat=50.0755&lon=14.4378&start=2024&end=2024')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['daily']), 366)
        self.assertEqual(response.json()['years'][0]['hot_days']['value'], 0)
        self.assertEqual(fetch.call_args.args[0].start, 2024)

    def test_invalid_locations_periods_and_unbounded_batches_are_rejected(self):
        client = TestClient(app)
        for query in ('lat=91&lon=0', 'lat=0&lon=0&start=2025&end=2020', 'lat=0&lon=0&start=1981&end=2025'):
            self.assertEqual(client.get('/api/daily?' + query).status_code, 422)
