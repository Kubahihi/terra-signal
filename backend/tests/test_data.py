import json
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from backend.app.config import NASA_SNAPSHOT_DIR
from backend.app.schemas import SeriesQuery, Variable
from backend.app.services import nasa_power


def query(variable=Variable.TEMPERATURE, start=1981, end=2025):
    return SeriesQuery(latitude=50.0755, longitude=14.4378, variable=variable, start=start, end=end)


class NormalizationTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((NASA_SNAPSHOT_DIR / 'prague.json').read_text(encoding='utf-8'))

    def normalize(self, payload, request=None):
        return nasa_power.normalize_payload(request or query(), nasa_power.SavedPayload(
            payload, 'https://power.larc.nasa.gov/', datetime.now(timezone.utc).isoformat(), 'snapshot'
        ))

    def test_original_snapshot_month_13_is_not_a_month(self):
        result = self.normalize(self.payload)
        self.assertEqual(len(result.series), 540)
        self.assertEqual(result.series[0].value, -4.87)
        self.assertEqual(result.series[-1].date.isoformat(), '2025-12-01')
        self.assertEqual(result.unit, 'C')

    def test_missing_and_nonfinite_values_stay_gaps(self):
        values = self.payload['properties']['parameter']['T2M']
        values['198101'] = -999
        values['198102'] = 'NaN'
        del values['198103']
        result = self.normalize(self.payload)
        self.assertEqual([point.value for point in result.series[:3]], [None, None, None])
        self.assertEqual(len(result.series), 540)
        self.assertTrue(any('3 of 540' in warning for warning in result.warnings))

    def test_precipitation_preserves_daily_rate_units(self):
        result = self.normalize(self.payload, query(Variable.PRECIPITATION, 2000, 2001))
        self.assertEqual(len(result.series), 24)
        self.assertEqual(result.unit, 'mm/day')

    def test_negative_precipitation_is_a_gap_and_real_zero_is_preserved(self):
        values = self.payload['properties']['parameter']['PRECTOTCORR']
        values['200001'] = -0.1
        values['200002'] = 0
        result = self.normalize(self.payload, query(Variable.PRECIPITATION, 2000, 2001))
        self.assertIsNone(result.series[0].value)
        self.assertEqual(result.series[1].value, 0)
        self.assertTrue(any('negative precipitation' in warning for warning in result.warnings))

    def test_unknown_units_are_rejected_instead_of_analysed_as_celsius_or_daily_rain(self):
        for variable, unit in ((Variable.TEMPERATURE, 'K'), (Variable.PRECIPITATION, 'mm')):
            self.payload['parameters'][variable.value]['units'] = unit
            with self.subTest(variable=variable), self.assertRaises(nasa_power.ProviderError):
                self.normalize(self.payload, query(variable))

    def test_snapshot_provenance_is_verified_and_coordinates_match(self):
        saved = nasa_power._snapshot(query(start=2000, end=2010))
        self.assertIsNotNone(saved)
        self.assertEqual(saved.origin, 'snapshot')
        elsewhere = query().model_copy(update={'latitude': 51.0})
        self.assertIsNone(nasa_power._snapshot(elsewhere))


class OutageTests(unittest.IsolatedAsyncioTestCase):
    async def test_outage_returns_labeled_real_snapshot(self):
        with patch.object(nasa_power, '_read_cache', return_value=None), patch.object(nasa_power.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value.get = AsyncMock(side_effect=httpx.ConnectError('offline'))
            result = await nasa_power.fetch_monthly_series(query())
        self.assertEqual(result.data_origin, 'snapshot')
        self.assertEqual(len(result.series), 540)
        self.assertTrue(any('saved original' in warning for warning in result.warnings))
