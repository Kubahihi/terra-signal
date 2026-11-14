import math
import unittest
from datetime import date

import numpy as np

from backend.app.schemas import Observation
from backend.app.services.analysis import analyze_trend


def observations(slope=0.3, count=240, noise=True):
    rng = np.random.default_rng(42)
    return [Observation(
        date=date(2000 + index // 12, index % 12 + 1, 1),
        value=10 + slope * index / 12 + 8 * math.sin(index % 12 * math.tau / 12)
        + (float(rng.normal(0, 0.15)) if noise else 0),
    ) for index in range(count)]


class TrendTests(unittest.TestCase):
    def test_known_slope_survives_strong_seasonal_cycle(self):
        analysis, _ = analyze_trend(observations())
        self.assertIsNotNone(analysis)
        self.assertAlmostEqual(analysis.slope_per_year, 0.3, delta=0.01)
        self.assertAlmostEqual(analysis.slope_per_decade, 3, delta=0.1)
        self.assertLess(analysis.ci95_per_decade[0], 3)
        self.assertGreater(analysis.ci95_per_decade[1], 3)
        self.assertLess(analysis.p_value, 0.05)

    def test_seasonality_alone_does_not_become_a_long_term_trend(self):
        analysis, _ = analyze_trend(observations(slope=0, noise=False))
        self.assertAlmostEqual(analysis.slope_per_year, 0, places=9)

    def test_constant_data_has_no_fabricated_significance(self):
        series = observations()
        for point in series:
            point.value = 7
        analysis, _ = analyze_trend(series)
        self.assertEqual(analysis.slope_per_year, 0)
        self.assertIsNone(analysis.p_value)

    def test_short_period_is_not_given_a_significance_claim(self):
        analysis, warnings = analyze_trend(observations(count=24))
        self.assertIsNone(analysis)
        self.assertTrue(warnings)

    def test_gap_preserves_time_axis_and_withholds_hac_significance(self):
        series = observations(noise=False)
        series[80].value = None
        analysis, warnings = analyze_trend(series)
        self.assertAlmostEqual(analysis.slope_per_year, 0.3, places=8)
        self.assertIsNone(analysis.p_value)
        self.assertIsNone(analysis.ci95_per_decade)
        self.assertTrue(any('missing months' in warning for warning in warnings))
