import copy
from datetime import date, datetime, timezone
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np
from pydantic import ValidationError

from backend.app.relationship_schemas import RelationshipRequest
from backend.app.routes.relationships import router
from backend.app.services.relationships import analyze_relationship


def fixture(start=2000, end=2009, *, month=None, lag=0, detrend=False):
    dates = [date(year, m, 1) for year in range(start, end + 1) for m in range(1, 13)]
    noise = (0, 2, -1, 3, -2, 1, -3)
    return dict(
        latitude=50.0755, longitude=14.4378, start=start, end=end,
        lag_months=lag, month=month, detrend=detrend,
        x=dict(name="Temperature", unit="C", observations=[
            dict(date=d, value=d.month * 3.0 + (d.year - start) * 0.2 + noise[(d.year - start) % 7]) for d in dates]),
        y=dict(name="Precipitation", unit="mm", observations=[
            dict(date=d, value=d.month * 5.0 - (d.year - start) * 0.4 - noise[(d.year - start) % 7] * 2) for d in dates]),
    )


def run(data):
    return analyze_relationship(RelationshipRequest.model_validate(data))


class RelationshipAnalysisTests(unittest.TestCase):
    def test_same_month_negative_relationship_has_five_or_more_annual_pairs(self):
        result = run(fixture(month=6))
        self.assertAlmostEqual(result.pearson_r, -1)
        self.assertEqual((result.n_pairs, result.n_years, result.expected_pairs), (10, 10, 10))
        self.assertEqual(result.coverage, 1)
        self.assertIsNone(result.p_value)
        self.assertIsNone(result.ci95)
        self.assertTrue(all(pair.x_date.month == pair.y_date.month == 6 for pair in result.pairs))

    def test_lag_uses_calendar_dates_and_never_shifts_a_missing_month(self):
        data = fixture(month=6, lag=1)
        data['y']['observations'] = [item for item in data['y']['observations'] if item['date'] != date(2003, 7, 1)]
        result = run(data)
        self.assertEqual((result.n_pairs, result.expected_pairs), (9, 10))
        self.assertAlmostEqual(result.coverage, 0.9)
        self.assertNotIn(date(2003, 6, 1), [pair.x_date for pair in result.pairs])
        self.assertTrue(all(pair.x_date.month == 6 and pair.y_date.month == 7 and pair.x_date.year == pair.y_date.year
                            for pair in result.pairs))
        self.assertIsNotNone(result.pearson_r)

    def test_year_boundary_lag_keeps_both_dates_inside_the_requested_window(self):
        result = run(fixture(month=12, lag=2))
        self.assertEqual((result.n_pairs, result.expected_pairs), (9, 9))
        self.assertEqual((result.pairs[0].x_date, result.pairs[0].y_date), (date(2000, 12, 1), date(2001, 2, 1)))
        self.assertEqual((result.pairs[-1].x_date, result.pairs[-1].y_date), (date(2008, 12, 1), date(2009, 2, 1)))

    def test_monthly_anomalies_remove_a_shared_seasonal_cycle(self):
        data = fixture()
        for item in data['x']['observations']:
            item['value'] = float(item['date'].month)
        for item in data['y']['observations']:
            item['value'] = float(item['date'].month * 7)
        result = run(data)
        self.assertIsNone(result.pearson_r)
        self.assertTrue(all(pair.x == pair.y == 0 for pair in result.pairs))
        self.assertTrue(any('undefined' in note for note in result.warnings))

    def test_joint_detrending_does_not_reintroduce_calendar_seasonality(self):
        data = fixture()
        for item in data['x']['observations']:
            item['value'] = item['date'].month * 3.0 + 2 * (item['date'].year - 2000)
        for item in data['y']['observations']:
            item['value'] = item['date'].month * 4.0 + 5 * (item['date'].year - 2000)
        self.assertAlmostEqual(run(data).pearson_r, 1)
        data['detrend'] = True
        result = run(data)
        self.assertIsNone(result.pearson_r)
        self.assertLess(max(abs(pair.x) for pair in result.pairs), 1e-10)
        self.assertLess(max(abs(pair.y) for pair in result.pairs), 1e-10)

    def test_detrending_matches_joint_dummy_regression_with_elapsed_gapped_time(self):
        data = fixture(detrend=True)
        # Internal gaps are kept on their actual calendar time axis.
        missing = {date(2004, 3, 1), date(2004, 4, 1), date(2006, 8, 1)}
        data['x']['observations'] = [item for item in data['x']['observations'] if item['date'] not in missing]
        result = run(data)
        design = np.array([[float(pair.x_date.month == month) for month in range(1, 13)] +
                           [(pair.x_date.year - 2000) + (pair.x_date.month - 1) / 12]
                           for pair in result.pairs])
        for name in ('x', 'y'):
            raw = np.array([getattr(pair, f'{name}_raw') for pair in result.pairs])
            coefficients = np.linalg.lstsq(design, raw, rcond=None)[0]
            residual = raw - design @ coefficients
            np.testing.assert_allclose([getattr(pair, name) for pair in result.pairs], residual, atol=1e-10)

    def test_true_zero_is_paired_while_missing_values_are_excluded(self):
        data = fixture(month=6)
        next(item for item in data['x']['observations'] if item['date'] == date(2000, 6, 1))['value'] = 0
        next(item for item in data['x']['observations'] if item['date'] == date(2001, 6, 1))['value'] = None
        result = run(data)
        self.assertEqual(result.pairs[0].x_raw, 0)
        self.assertEqual(result.n_pairs, 9)
        self.assertNotIn(date(2001, 6, 1), [pair.x_date for pair in result.pairs])

    def test_sorting_does_not_depend_on_received_row_order(self):
        original = fixture(lag=1, detrend=True)
        reversed_data = copy.deepcopy(original)
        reversed_data['x']['observations'].reverse()
        reversed_data['y']['observations'].reverse()
        self.assertEqual(run(original), run(reversed_data))

    def test_short_records_and_low_coverage_withhold_correlation(self):
        result = run(fixture(2000, 2003))
        self.assertIsNone(result.pearson_r)
        self.assertEqual(result.n_years, 4)
        data = fixture(month=6)
        missing = {date(year, 6, 1) for year in (2000, 2001, 2002)}
        data['x']['observations'] = [item for item in data['x']['observations'] if item['date'] not in missing]
        result = run(data)
        self.assertEqual(result.n_years, 7)
        self.assertEqual(result.coverage, 0.7)
        self.assertIsNone(result.pearson_r)
        self.assertTrue(any('80%' in note for note in result.warnings))

    def test_exactly_eighty_percent_coverage_is_eligible(self):
        data = fixture(month=6)
        data['x']['observations'] = [item for item in data['x']['observations'] if item['date'].year >= 2002]
        result = run(data)
        self.assertEqual(result.coverage, 0.8)
        self.assertIsNotNone(result.pearson_r)

    def test_disjoint_ranges_have_no_pairs_or_manufactured_reference(self):
        data = fixture()
        data['x']['observations'] = [item for item in data['x']['observations'] if item['date'].year <= 2003]
        data['y']['observations'] = [item for item in data['y']['observations'] if item['date'].year >= 2005]
        result = run(data)
        self.assertEqual(result.pairs, [])
        self.assertEqual((result.n_pairs, result.coverage), (0, 0))
        self.assertIsNone(result.pearson_r)
        self.assertIsNone(result.reference_start)
        self.assertIsNone(result.reference_end)

    def test_observations_outside_requested_window_cannot_enter_the_pairs(self):
        data = fixture()
        data['x']['observations'].append(dict(date=date(1990, 1, 1), value=12))
        data['y']['observations'].append(dict(date=date(1990, 1, 1), value=50))
        result = run(data)
        self.assertEqual(result.n_pairs, 120)
        self.assertTrue(all(pair.x_date.year >= 2000 and pair.y_date.year <= 2009 for pair in result.pairs))
        self.assertTrue(any('outside' in note for note in result.warnings))


class RelationshipValidationTests(unittest.TestCase):
    def test_duplicate_non_month_start_nonfinite_and_boolean_observations_are_rejected(self):
        for change in ('duplicate', 'date', 'nan', 'inf', 'boolean', 'string'):
            with self.subTest(change=change):
                data = fixture()
                if change == 'duplicate':
                    data['x']['observations'].append(data['x']['observations'][0])
                elif change == 'date':
                    data['x']['observations'][0]['date'] = date(2000, 1, 2)
                else:
                    data['x']['observations'][0]['value'] = {'nan': float('nan'), 'inf': float('inf'), 'boolean': True, 'string': '12'}[change]
                with self.assertRaises(ValidationError):
                    RelationshipRequest.model_validate(data)

    def test_invalid_intervals_lags_coordinates_and_excessive_series_are_rejected(self):
        examples = [dict(latitude=91), dict(longitude=-181), dict(start=1980), dict(start=2010, end=2000),
                    dict(end=datetime.now(timezone.utc).year), dict(lag_months=3), dict(lag_months=True),
                    dict(month=0), dict(month=13), dict(month=True)]
        for changes in examples:
            with self.subTest(changes=changes):
                data = fixture()
                data.update(changes)
                with self.assertRaises(ValidationError):
                    RelationshipRequest.model_validate(data)
        data = fixture()
        data['x']['observations'] = [dict(date=date(2000, 1, 1), value=1)] * 6001
        with self.assertRaises(ValidationError):
            RelationshipRequest.model_validate(data)

    def test_post_contract_roundtrips_json_dates_and_preserves_null_inference(self):
        app = FastAPI()
        app.include_router(router)
        # This router test is independent of application registration owned by App.
        body = RelationshipRequest.model_validate(fixture(month=6, lag=1)).model_dump(mode='json')
        response = TestClient(app).post('/api/relationships', json=body)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result['n_pairs'], 10)
        self.assertEqual(result['pairs'][0]['x_date'], '2000-06-01')
        self.assertEqual(result['pairs'][0]['y_date'], '2000-07-01')
        self.assertIsNone(result['p_value'])
        self.assertIsNone(result['ci95'])
        body['lag_months'] = 12
        self.assertEqual(TestClient(app).post('/api/relationships', json=body).status_code, 422)
