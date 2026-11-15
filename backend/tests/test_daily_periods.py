import unittest
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.schemas import DailyTrendRequest
from backend.app.services.daily_periods import analyze_daily_periods
from backend.app.services.daily_trends import analyze_daily_trends
from backend.tests.test_daily_trends import fixture


def run(body):
    return analyze_daily_periods(DailyTrendRequest.model_validate(body))


class DailyPeriodTests(unittest.TestCase):
    def test_fixed_windows_share_end_year_and_keep_full_family_size(self):
        result = run(fixture())
        self.assertEqual([(p.start, p.end) for p in result.periods], [(1981, 2025), (1991, 2025), (2001, 2025)])
        self.assertEqual(result.family_size, 12)
        self.assertTrue(all(p.family_size == 12 for p in result.periods))
        self.assertEqual([p.metrics['hot_days'].complete_years for p in result.periods], [45, 35, 25])

    def test_each_rate_and_raw_p_uses_its_actual_subset_before_global_adjustment(self):
        body = fixture()
        for i, row in enumerate(body['years']):
            value = 20 + max(0, row['year'] - 2000) * 2 + (0, 2, -1)[i % 3]
            row['hot_days']['value'] = row['hot_days']['observed_count'] = value
        result = run(body)
        for period in result.periods:
            subset = {**body, 'start': period.start, 'years': [r for r in body['years'] if r['year'] >= period.start]}
            direct = analyze_daily_trends(DailyTrendRequest.model_validate(subset))
            x = np.array([row['year'] for row in subset['years']], dtype=float)
            y = np.array([row['hot_days']['value'] for row in subset['years']])
            x -= x.mean()
            self.assertAlmostEqual(period.metrics['hot_days'].analysis.slope_per_decade, 10 * (x @ y) / (x @ x))
            self.assertAlmostEqual(period.metrics['hot_days'].analysis.p_value, direct.metrics['hot_days'].analysis.p_value)
        self.assertGreater(result.periods[-1].metrics['hot_days'].analysis.slope_per_decade, result.periods[0].metrics['hot_days'].analysis.slope_per_decade)
        metrics = [m for p in result.periods for m in p.metrics.values()]
        ordered = sorted(metrics, key=lambda m: m.analysis.p_value if m.analysis and m.analysis.p_value is not None else 1)
        previous = 0
        for i, metric in enumerate(ordered):
            p = metric.analysis.p_value if metric.analysis and metric.analysis.p_value is not None else 1
            expected = min(1, max(previous, (12 - i) * p))
            if metric.analysis and metric.analysis.p_value is not None:
                self.assertAlmostEqual(metric.analysis.p_value_holm, expected)
                self.assertEqual(metric.analysis.significant, expected < 0.05)
            previous = expected

    def test_missing_internal_year_withholds_only_windows_that_include_the_gap(self):
        body = fixture()
        body['years'] = [row for row in body['years'] if row['year'] != 2000]
        result = run(body)
        for period in result.periods[:2]:
            self.assertIsNone(period.metrics['hot_days'].analysis.p_value_holm)
            self.assertIsNone(period.metrics['hot_days'].analysis.ci95_per_decade)
        self.assertIsNotNone(result.periods[2].metrics['hot_days'].analysis.p_value_holm)
        self.assertEqual(result.family_size, 12)

    def test_short_recent_period_is_not_filled_with_old_values_or_given_a_test(self):
        body = fixture(25)  # 1981–2005; the last window contains only five years
        result = run(body)
        recent = result.periods[-1].metrics['hot_days']
        self.assertEqual(recent.complete_years, 5)
        self.assertIsNone(recent.analysis)
        self.assertEqual(result.family_size, 12)

    def test_constant_series_keep_zero_rate_and_null_inference_in_every_window(self):
        body = fixture()
        for row in body['years']:
            row['warm_nights']['value'] = row['warm_nights']['observed_count'] = 0
        for period in run(body).periods:
            analysis = period.metrics['warm_nights'].analysis
            self.assertEqual(analysis.slope_per_decade, 0)
            self.assertIsNone(analysis.p_value_holm)
            self.assertIsNone(analysis.significant)

    def test_windows_never_extend_beyond_loaded_record_and_are_deduplicated(self):
        body = fixture()
        body['start'] = 1991
        body['years'] = [row for row in body['years'] if row['year'] >= 1991]
        result = run(body)
        self.assertEqual([p.start for p in result.periods], [1991, 2001])
        self.assertEqual(result.family_size, 8)
        body['start'] = 2010
        body['years'] = [row for row in body['years'] if row['year'] >= 2010]
        result = run(body)
        self.assertEqual([p.start for p in result.periods], [2010])
        self.assertEqual(result.family_size, 4)
        self.assertTrue(any('Only the full' in warning for warning in result.warnings))

    def test_empty_and_incomplete_metrics_remain_unknown_separately(self):
        body = fixture()
        for row in body['years']:
            row['hot_days'].update(value=None, observed_count=1, available_days=10)
        result = run(body)
        for period in result.periods:
            self.assertIsNone(period.metrics['hot_days'].analysis)
            self.assertIsNotNone(period.metrics['frost_days'].analysis.p_value_holm)
        body['years'] = []
        for period in run(body).periods:
            self.assertTrue(all(metric.analysis is None for metric in period.metrics.values()))

    def test_route_uses_loaded_annual_indices_without_nasa_requests(self):
        body = DailyTrendRequest.model_validate(fixture()).model_dump(mode='json')
        with patch('backend.app.services.nasa_daily._download', side_effect=AssertionError('No extra NASA fetch')):
            response = TestClient(app).post('/api/daily/periods', json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['family_size'], 12)
        self.assertEqual(response.json()['periods'][2]['start'], 2001)
        body['years'].append(body['years'][0])
        self.assertEqual(TestClient(app).post('/api/daily/periods', json=body).status_code, 422)


if __name__ == '__main__':
    unittest.main()
