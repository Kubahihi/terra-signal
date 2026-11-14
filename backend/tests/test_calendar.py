import calendar
import unittest
from datetime import date
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.schemas import CalendarPoint, Observation, SeriesResponse, Variable
from backend.app.services.calendar_analysis import analyze_yearly, build_calendar
from backend.app.services.nasa_power import ProviderError


def source(variable=Variable.TEMPERATURE, start=1981, end=2025, slope=0.2):
    return SeriesResponse(
        source="Test fixture", variable=variable, unit="C" if variable == Variable.TEMPERATURE else "mm/day",
        latitude=50.0755, longitude=14.4378, start=start, end=end,
        series=[Observation(date=date(year, month, 1), value=(month * 3 + slope * (year - 1991))
                            if variable == Variable.TEMPERATURE else 2)
                for year in range(start, end + 1) for month in range(1, 13)],
        source_url="https://example.test/nasa", retrieved_at="2026-11-14T00:00:00Z", data_origin="snapshot",
    )


def period(result, key):
    return next(item for item in result.periods if item.id == key)


class CalendarAggregationTests(unittest.TestCase):
    def test_january_and_july_have_their_own_fixed_30_year_normals(self):
        result = build_calendar(source(), 2025, 2025)
        january = period(result, "m01").points[0]
        july = period(result, "m07").points[0]
        self.assertAlmostEqual(july.baseline_value - january.baseline_value, 18)
        self.assertAlmostEqual(january.anomaly, (2025 - 2005.5) * 0.2)
        self.assertAlmostEqual(january.anomaly, july.anomaly)
        self.assertEqual(result.baseline_start, 1991)
        self.assertEqual(result.baseline_end, 2020)

    def test_changing_display_period_does_not_change_the_reference(self):
        data = source()
        full = period(build_calendar(data, 1981, 2025), "year").points[-1]
        short = period(build_calendar(data, 2025, 2025), "year").points[0]
        self.assertAlmostEqual(full.baseline_value, short.baseline_value)
        self.assertAlmostEqual(full.anomaly, short.anomaly)

    def test_incomplete_reference_is_not_silently_averaged_over_fewer_years(self):
        data = source()
        next(p for p in data.series if p.date == date(2000, 1, 1)).value = None
        result = build_calendar(data, 2025, 2025)
        self.assertEqual(result.normals[0].available_years, 29)
        self.assertIsNone(result.normals[0].value)
        self.assertIsNone(period(result, "m01").points[0].anomaly)
        self.assertIsNone(period(result, "year").points[0].anomaly)
        self.assertIsNotNone(period(result, "m07").points[0].anomaly)

    def test_djf_uses_previous_december_and_labels_the_ending_year(self):
        data = source(slope=0)
        values = {p.date: p for p in data.series}
        values[date(2023, 12, 1)].value = 1
        values[date(2024, 1, 1)].value = 2
        values[date(2024, 2, 1)].value = 3
        values[date(2024, 12, 1)].value = 100
        djf = period(build_calendar(data, 2024, 2024), "djf")
        self.assertTrue(djf.crosses_year)
        self.assertAlmostEqual(djf.points[0].value, (31 + 2 * 31 + 3 * 29) / 91)

    def test_precipitation_totals_include_leap_days_and_preserve_real_zero(self):
        data = source(Variable.PRECIPITATION)
        result = build_calendar(data, 2023, 2024)
        self.assertEqual(result.unit, "mm")
        self.assertEqual(period(result, "year").points[0].value, 2 * 365)
        self.assertEqual(period(result, "year").points[1].value, 2 * 366)
        self.assertEqual(period(result, "m02").points[1].value, 2 * 29)
        self.assertEqual(period(result, "djf").points[1].value, 2 * 91)
        for p in data.series:
            p.value = 0
        self.assertEqual(period(build_calendar(data, 2024, 2024), "year").points[0].value, 0)

    def test_missing_month_makes_a_total_unavailable_instead_of_partial(self):
        data = source(Variable.PRECIPITATION)
        next(p for p in data.series if p.date == date(2024, 7, 1)).value = None
        result = build_calendar(data, 2024, 2024)
        annual = period(result, "year").points[0]
        self.assertIsNone(annual.value)
        self.assertEqual(annual.available_months, 11)
        self.assertIsNone(period(result, "jja").points[0].value)
        self.assertIsNotNone(period(result, "mam").points[0].value)

    def test_missing_previous_december_leaves_first_djf_as_a_gap(self):
        djf = period(build_calendar(source(), 1981, 1982), "djf")
        self.assertIsNone(djf.points[0].value)
        self.assertEqual(djf.points[0].available_months, 2)
        self.assertIsNotNone(djf.points[1].value)

    def test_unknown_units_are_not_converted(self):
        data = source(Variable.PRECIPITATION).model_copy(update={"unit": "mm"})
        with self.assertRaises(ProviderError):
            build_calendar(data, 2000, 2025)

    def test_annual_temperature_uses_each_target_months_day_count(self):
        data = source(slope=0)
        annual = period(build_calendar(data, 2024, 2024), "year").points[0]
        expected = sum(month * 3 * calendar.monthrange(2024, month)[1] for month in range(1, 13)) / 366
        self.assertAlmostEqual(annual.value, expected)
        self.assertAlmostEqual(annual.anomaly, 0)


class CalendarTrendTests(unittest.TestCase):
    def test_known_month_and_summer_trends_recovered_in_year_units(self):
        result = build_calendar(source(slope=0.3), 1981, 2025)
        for key in ("m01", "jja"):
            analysis = period(result, key).analysis
            self.assertAlmostEqual(analysis.slope_per_decade, 3)
            self.assertEqual(analysis.lag_unit, "years")
            self.assertEqual(analysis.hac_lags, 1)
            self.assertLess(analysis.p_value, 0.05)

    def test_gaps_do_not_compress_elapsed_time_and_withhold_inference(self):
        points = [CalendarPoint(year=year, value=year - 2000, baseline_value=None, anomaly=None,
                                available_months=12, expected_months=12) for year in range(2000, 2020)]
        points[8].value = None
        analysis, warnings = analyze_yearly(points)
        self.assertAlmostEqual(analysis.slope_per_year, 1)
        self.assertIsNone(analysis.ci95_per_decade)
        self.assertIsNone(analysis.p_value)
        self.assertTrue(any("Missing internal years" in warning for warning in warnings))

    def test_short_period_has_values_but_no_trend_claim(self):
        result = period(build_calendar(source(), 2020, 2025), "year")
        self.assertTrue(all(p.value is not None for p in result.points))
        self.assertIsNone(result.analysis)

    def test_constant_monthly_aggregates_have_no_fabricated_significance(self):
        analysis = period(build_calendar(source(slope=0), 1981, 2025), "m01").analysis
        self.assertEqual(analysis.slope_per_decade, 0)
        self.assertIsNone(analysis.p_value)
        self.assertIsNone(analysis.ci95_per_decade)

    def test_sparse_years_do_not_support_a_trend_even_if_ten_remain(self):
        points = [CalendarPoint(year=year, value=(year - 2000) if year % 2 == 0 else None,
                                baseline_value=None, anomaly=None, available_months=12 if year % 2 == 0 else 0,
                                expected_months=12) for year in range(2000, 2020)]
        analysis, warnings = analyze_yearly(points)
        self.assertIsNone(analysis)
        self.assertTrue(any("80%" in warning for warning in warnings))


class CalendarRouteTests(unittest.TestCase):
    def test_short_view_fetches_the_full_reference_and_previous_december(self):
        with patch('backend.app.routes.calendar.fetch_monthly_series', new_callable=AsyncMock) as fetch:
            fetch.return_value = source()
            response = TestClient(app).get('/api/calendar?lat=50.0755&lon=14.4378&start=2025&end=2025')
        self.assertEqual(response.status_code, 200)
        query = fetch.call_args.args[0]
        self.assertEqual((query.start, query.end), (1991, 2025))
        self.assertEqual((response.json()['start'], response.json()['end']), (2025, 2025))
        self.assertIsNotNone(response.json()['periods'][0]['points'][0]['anomaly'])

    def test_old_view_still_fetches_reference_through_2020(self):
        with patch('backend.app.routes.calendar.fetch_monthly_series', new_callable=AsyncMock) as fetch:
            fetch.return_value = source()
            response = TestClient(app).get('/api/calendar?lat=0&lon=0&start=1985&end=1990')
        self.assertEqual(response.status_code, 200)
        self.assertEqual((fetch.call_args.args[0].start, fetch.call_args.args[0].end), (1984, 2020))

    def test_precipitation_does_not_fetch_an_unneeded_temperature_reference(self):
        with patch('backend.app.routes.calendar.fetch_monthly_series', new_callable=AsyncMock) as fetch:
            fetch.return_value = source(Variable.PRECIPITATION)
            response = TestClient(app).get('/api/calendar?lat=0&lon=0&variable=PRECTOTCORR&start=2010&end=2015')
        self.assertEqual(response.status_code, 200)
        self.assertEqual((fetch.call_args.args[0].start, fetch.call_args.args[0].end), (2009, 2015))

    def test_bad_coordinates_and_periods_are_rejected(self):
        client = TestClient(app)
        for query in ('lat=91&lon=0', 'lat=0&lon=0&start=2025&end=2000'):
            self.assertEqual(client.get('/api/calendar?' + query).status_code, 422)
