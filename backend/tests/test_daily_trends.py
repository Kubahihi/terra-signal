import calendar
import copy
import unittest
from datetime import date, timedelta
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from scipy.stats import t

from backend.app.main import app
from backend.app.schemas import DailyTrendRequest
from backend.app.services.daily_trends import analyze_daily_trends


def fixture(n=45):
    """Artificial integer annual indices, independent of provider/network tests."""
    rows = []
    for i in range(n):
        year = 1981 + i
        expected = 366 if calendar.isleap(year) else 365
        noise = (0, 3, -2, 1, -1)[i % 5]
        def count(value):
            return dict(value=value, observed_count=value, available_days=expected)
        dry = 15 + i // 5 + noise
        rows.append(dict(year=year, expected_days=expected,
                         hot_days=count(20 + i + noise), frost_days=count(140 - i + noise),
                         warm_nights=count(5 + i // 10 + i % 3),
                         longest_dry_spell=dict(**count(dry), start_date=date(year, 1, 1),
                                               end_date=date(year, 1, 1) + timedelta(days=dry - 1), touches_year_boundary=True)))
    return dict(latitude=50.0755, longitude=14.4378, start=1981, end=1980 + n, years=rows)


def run(data):
    return analyze_daily_trends(DailyTrendRequest.model_validate(data))


class DailyTrendTests(unittest.TestCase):
    def test_known_directions_include_decreases_and_increases_without_presuming_the_question(self):
        result = run(fixture())
        for name, sign in [('hot_days', 1), ('frost_days', -1), ('warm_nights', 1), ('longest_dry_spell', 1)]:
            with self.subTest(name=name):
                metric = result.metrics[name]
                self.assertEqual(metric.complete_years, 45)
                self.assertGreater(sign * metric.analysis.slope_per_decade, 0)
                self.assertTrue(metric.analysis.significant)
                self.assertLess(metric.analysis.p_value_holm, 0.05)
        data = fixture()
        for row in data['years']:
            row['hot_days'], row['frost_days'] = row['frost_days'], row['hot_days']
        self.assertLess(run(data).metrics['hot_days'].analysis.slope_per_decade, 0)

    def test_slope_hac_interval_and_two_sided_p_match_independent_scalar_calculation(self):
        data = fixture()
        x = np.arange(45, dtype=float)
        x -= x.mean()
        y = np.array([row['hot_days']['value'] for row in data['years']], dtype=float)
        slope = (x @ y) / (x @ x)
        residual = y - y.mean() - slope * x
        score = x * residual
        # Newey-West/Bartlett lag 1: 2 * 1/2 on adjacent score products.
        variance = (score @ score + score[1:] @ score[:-1]) / (x @ x) ** 2 * 45 / 43
        se = np.sqrt(variance)
        expected_p = 2 * t.sf(abs(slope / se), 43)
        width = t.ppf(0.975, 43) * se
        analysis = run(data).metrics['hot_days'].analysis
        self.assertAlmostEqual(analysis.slope_per_decade, slope * 10, places=10)
        self.assertAlmostEqual(analysis.ci95_per_decade[0], (slope - width) * 10, places=10)
        self.assertAlmostEqual(analysis.ci95_per_decade[1], (slope + width) * 10, places=10)
        self.assertAlmostEqual(analysis.p_value / expected_p, 1, places=8)
        self.assertEqual(analysis.sample_size, 45)  # years, not 16,436 daily pseudo-replicates

    def test_variation_without_a_trend_is_not_labelled_no_change_or_significant(self):
        data = fixture(40)
        for i, row in enumerate(data['years']):
            row['hot_days']['value'] = row['hot_days']['observed_count'] = 20 + (-1, 1, 1, -1)[i % 4]
        analysis = run(data).metrics['hot_days'].analysis
        self.assertAlmostEqual(analysis.slope_per_decade, 0)
        self.assertGreater(analysis.p_value_holm, 0.05)
        self.assertFalse(analysis.significant)

    def test_short_period_and_poor_coverage_withhold_the_fit(self):
        self.assertIsNone(run(fixture(19)).metrics['hot_days'].analysis)
        data = fixture()
        data['years'] = data['years'][10:]
        metric = run(data).metrics['hot_days']
        self.assertIsNone(metric.analysis)
        self.assertTrue(any('80%' in item for item in metric.warnings))
        data['years'] = []
        self.assertEqual(run(data).metrics['hot_days'].complete_years, 0)

    def test_twenty_complete_years_are_eligible(self):
        analysis = run(fixture(20)).metrics['hot_days'].analysis
        self.assertEqual(analysis.sample_size, 20)
        self.assertIsNotNone(analysis.p_value_holm)

    def test_partial_metric_excludes_its_lower_bound_but_preserves_other_metrics(self):
        data = fixture()
        data['years'][20]['hot_days'].update(value=None, observed_count=40, available_days=364)
        result = run(data)
        hot = result.metrics['hot_days']
        self.assertEqual(hot.complete_years, 44)
        self.assertIsNotNone(hot.analysis)
        self.assertIsNone(hot.analysis.ci95_per_decade)
        self.assertIsNone(hot.analysis.p_value_holm)
        self.assertIsNone(hot.analysis.significant)
        self.assertTrue(any('internal years' in item for item in hot.warnings))
        self.assertIsNotNone(result.metrics['frost_days'].analysis.p_value_holm)

    def test_missing_edge_years_keep_actual_year_spacing_and_report_fit_span(self):
        data = fixture()
        data['years'] = data['years'][8:]
        metric = run(data).metrics['hot_days']
        self.assertEqual((metric.first_year, metric.last_year), (1989, 2025))
        self.assertEqual(metric.analysis.reference_year, 1989)
        self.assertEqual(metric.analysis.sample_size, 37)
        self.assertIsNotNone(metric.analysis.p_value_holm)
        self.assertTrue(any('excluded' in item for item in metric.warnings))

    def test_constant_zero_and_nonzero_records_never_get_a_fabricated_p_value(self):
        for value in (0, 11):
            data = fixture()
            for row in data['years']:
                row['warm_nights']['value'] = row['warm_nights']['observed_count'] = value
            analysis = run(data).metrics['warm_nights'].analysis
            self.assertEqual(analysis.slope_per_decade, 0)
            self.assertEqual(analysis.intercept, value)
            self.assertIsNone(analysis.p_value)
            self.assertIsNone(analysis.p_value_holm)
            self.assertIsNone(analysis.significant)

    def test_sparse_and_exact_line_records_keep_descriptive_slope_without_inference(self):
        data = fixture()
        for i, row in enumerate(data['years']):
            row['warm_nights']['value'] = row['warm_nights']['observed_count'] = int(i in (20, 30, 38, 44))
        metric = run(data).metrics['warm_nights']
        self.assertEqual(metric.nonzero_years, 4)
        self.assertGreater(metric.analysis.slope_per_decade, 0)
        self.assertIsNone(metric.analysis.p_value_holm)
        for i, row in enumerate(data['years']):
            row['warm_nights']['value'] = row['warm_nights']['observed_count'] = i + 1
        metric = run(data).metrics['warm_nights']
        self.assertAlmostEqual(metric.analysis.slope_per_decade, 10)
        self.assertIsNone(metric.analysis.p_value)

    def test_holm_adjustment_uses_all_four_tests_and_has_monotone_adjusted_p(self):
        from backend.app.services.daily_trends import _analyze
        request = DailyTrendRequest.model_validate(fixture())
        metrics = [_analyze(request, name) for name in ('hot_days', 'frost_days', 'warm_nights', 'longest_dry_spell')]
        for metric, p in zip(metrics, [0.001, 0.02, 0.03, 0.2]):
            metric.analysis.p_value = p
        with patch('backend.app.services.daily_trends._analyze', side_effect=metrics):
            result = analyze_daily_trends(request)
        adjusted = [item.analysis.p_value_holm for item in result.metrics.values()]
        np.testing.assert_allclose(adjusted, [0.004, 0.06, 0.06, 0.2])
        self.assertEqual([item.analysis.significant for item in result.metrics.values()], [True, False, False, False])
        metrics[0].analysis.p_value = 0.02
        for metric in metrics[1:]:
            metric.analysis = None
        with patch('backend.app.services.daily_trends._analyze', side_effect=metrics):
            result = analyze_daily_trends(request)
        self.assertAlmostEqual(result.metrics['hot_days'].analysis.p_value_holm, 0.08)
        self.assertIsNone(result.metrics['warm_nights'].analysis)


class DailyTrendRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_analyzes_full_selected_period_without_an_upstream_request(self):
        body = DailyTrendRequest.model_validate(fixture()).model_dump(mode='json')
        with patch('backend.app.services.nasa_daily._download', side_effect=AssertionError('No refetch')):
            response = self.client.post('/api/daily/trends', json=body)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result['family_size'], 4)
        self.assertEqual(result['metrics']['hot_days']['analysis']['sample_size'], 45)
        self.assertEqual(result['longitude'], body['longitude'])

    def test_rejects_inconsistent_annual_inputs_and_invalid_intervals(self):
        body = DailyTrendRequest.model_validate(fixture()).model_dump(mode='json')
        variants = []
        for field, value in [('latitude', 91), ('longitude', -181), ('start', 1980), ('start', 2025), ('end', 9999)]:
            changed = copy.deepcopy(body)
            changed[field] = value
            variants.append(changed)
        duplicate = copy.deepcopy(body)
        duplicate['years'].append(duplicate['years'][0])
        variants.append(duplicate)
        for field, value in [('year', 1980), ('expected_days', 366)]:
            changed = copy.deepcopy(body)
            changed['years'][0][field] = value
            variants.append(changed)
        for changes in [dict(value=400), dict(value=-1), dict(available_days=364), dict(observed_count=21), dict(value=2.5)]:
            changed = copy.deepcopy(body)
            changed['years'][0]['hot_days'].update(changes)
            variants.append(changed)
        for changed in variants:
            with self.subTest(changed=changed['start']):
                self.assertEqual(self.client.post('/api/daily/trends', json=changed).status_code, 422)

    def test_post_is_available_to_configured_frontend_origin(self):
        response = self.client.options('/api/daily/trends', headers={
            'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn('POST', response.headers['access-control-allow-methods'])


if __name__ == '__main__':
    unittest.main()
