"""Independent audit of the published atlas, without calling production fit code.

The scalar Newey-West calculation uses centered calendar years, Bartlett lag 1,
n/(n-2) covariance correction, and a Student-t reference. Raw-source verification
is an optional local check: ignored NASA cache files are not required in CI.
"""

import calendar
import json
import math
import unittest
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
from scipy.stats import t


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "frontend/public/data/daily-example-analysis-1981-2025.json"
METRICS = ("hot_days", "frost_days", "warm_nights", "longest_dry_spell")
RAW_CHECK_POINTS = ("prague", "medicine-hat", "brno", "athens")


class AtlasArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads(ARCHIVE.read_text(encoding="utf-8"))

    def test_fixed_candidates_period_and_original_source_chain(self):
        snapshot = self.snapshot
        self.assertEqual((snapshot["start"], snapshot["end"]), (1981, 2025))
        self.assertEqual(snapshot["family_size"], 40)
        candidates = {point["id"]: point for point in snapshot["candidates"]}
        self.assertEqual(len(candidates), 10)
        self.assertEqual(len(snapshot["results"]), 10)
        self.assertEqual({point["location"]["id"] for point in snapshot["results"]}, set(candidates))
        for point in snapshot["results"]:
            with self.subTest(point=point["location"]["id"]):
                self.assertEqual(point["location"], candidates[point["location"]["id"]])
                self.assertEqual(point["failures"], [])
                self.assertEqual(set(point["trends"]["metrics"]), set(METRICS))
                self.assertEqual(len(point["sources"]), 9)
                spans = []
                for source in point["sources"]:
                    url = urlparse(source["source_url"])
                    query = parse_qs(url.query)
                    self.assertEqual((url.scheme, url.netloc), ("https", "power.larc.nasa.gov"))
                    self.assertEqual(query["time-standard"], ["LST"])
                    self.assertEqual(set(query["parameters"][0].split(",")), {"T2M_MAX", "T2M_MIN", "PRECTOTCORR"})
                    self.assertEqual(float(query["latitude"][0]), point["location"]["lat"])
                    self.assertEqual(float(query["longitude"][0]), point["location"]["lon"])
                    self.assertEqual(query["start"], [f'{source["start"]}0101'])
                    self.assertEqual(query["end"], [f'{source["end"]}1231'])
                    self.assertTrue(source["retrieved_at"])
                    spans.extend(range(source["start"], source["end"] + 1))
                self.assertEqual(sorted(spans), list(range(1981, 2026)))

    def test_all_450_calendar_rows_coverage_counts_and_decade_means(self):
        checked = 0
        for point in self.snapshot["results"]:
            self.assertEqual([row["year"] for row in point["years"]], list(range(1981, 2026)))
            for row in point["years"]:
                with self.subTest(point=point["location"]["id"], year=row["year"]):
                    expected = 366 if calendar.isleap(row["year"]) else 365
                    self.assertEqual(row["expected_days"], expected)
                    for metric in METRICS:
                        count = row[metric]
                        self.assertIsInstance(count["value"], int)
                        self.assertEqual(count["value"], count["observed_count"])
                        self.assertEqual(count["available_days"], expected)
                        self.assertLessEqual(0, count["value"])
                        self.assertLessEqual(count["value"], expected)
                    dry = row["longest_dry_spell"]
                    if dry["value"]:
                        first, last = date.fromisoformat(dry["start_date"]), date.fromisoformat(dry["end_date"])
                        self.assertEqual((first.year, last.year), (row["year"], row["year"]))
                        self.assertEqual((last - first).days + 1, dry["value"])
                        self.assertEqual(dry["touches_year_boundary"], first == date(first.year, 1, 1) or last == date(last.year, 12, 31))
                    checked += 1
            for metric in METRICS:
                for label, first in (("1981-1990", 1981), ("2016-2025", 2016)):
                    values = [row[metric]["value"] for row in point["years"] if first <= row["year"] <= first + 9]
                    mean = point["means"][metric][label]
                    self.assertEqual(mean["complete_years"], 10)
                    self.assertAlmostEqual(mean["value"], sum(values) / 10, places=12)
        self.assertEqual(checked, 450)

    def test_all_40_slopes_intercepts_hac_intervals_and_p_values_independently(self):
        checked = 0
        for point in self.snapshot["results"]:
            for metric in METRICS:
                with self.subTest(point=point["location"]["id"], metric=metric):
                    result = point["trends"]["metrics"][metric]
                    analysis = result["analysis"]
                    years = np.array([row["year"] for row in point["years"]], dtype=float)
                    values = np.array([row[metric]["value"] for row in point["years"]], dtype=float)
                    centered_years = years - years.mean()
                    denominator = centered_years @ centered_years
                    slope = centered_years @ values / denominator
                    intercept = values.mean() - slope * (years.mean() - years[0])
                    self.assertEqual((result["complete_years"], result["expected_years"]), (45, 45))
                    self.assertEqual((result["first_year"], result["last_year"]), (1981, 2025))
                    self.assertEqual(result["nonzero_years"], int(np.count_nonzero(values)))
                    self.assertEqual((analysis["sample_size"], analysis["reference_year"], analysis["hac_lags"], analysis["lag_unit"]), (45, 1981, 1, "years"))
                    self.assertAlmostEqual(analysis["slope_per_year"], slope, places=12)
                    self.assertAlmostEqual(analysis["slope_per_decade"], slope * 10, places=12)
                    self.assertAlmostEqual(analysis["intercept"], intercept, places=12)
                    if np.ptp(values) == 0:
                        self.assertIsNone(analysis["ci95_per_decade"])
                        self.assertIsNone(analysis["p_value"])
                        self.assertIsNone(result["p_holm_40"])
                        self.assertIsNone(result["significant_across_scan"])
                    else:
                        residuals = values - values.mean() - slope * centered_years
                        scores = centered_years * residuals
                        # Bartlett lag 1 has weight 1/2; the symmetric terms give 1.
                        variance = (scores @ scores + scores[1:] @ scores[:-1]) / denominator ** 2 * 45 / 43
                        standard_error = math.sqrt(variance)
                        half_width = t.ppf(0.975, 43) * standard_error
                        interval = [(slope - half_width) * 10, (slope + half_width) * 10]
                        probability = 2 * t.sf(abs(slope / standard_error), 43)
                        np.testing.assert_allclose(analysis["ci95_per_decade"], interval, rtol=1e-10, atol=1e-12)
                        np.testing.assert_allclose(analysis["p_value"], probability, rtol=1e-9, atol=1e-14)
                    checked += 1
        self.assertEqual(checked, 40)

    def test_holm_40_includes_every_fixed_slot_and_uses_atlas_evidence_fields(self):
        tests = [result for point in self.snapshot["results"] for result in point["trends"]["metrics"].values()]
        ordered = sorted(tests, key=lambda result: result["analysis"]["p_value"] if result["analysis"]["p_value"] is not None else 1)
        previous = 0.0
        for rank, result in enumerate(ordered):
            probability = result["analysis"]["p_value"]
            corrected = min(1.0, max(previous, (40 - rank) * (probability if probability is not None else 1)))
            previous = corrected
            if probability is not None:
                self.assertAlmostEqual(result["p_holm_40"], corrected, places=14)
                self.assertEqual(result["significant_across_scan"], corrected < 0.05)
        # This real example catches using the point's four-test badge in the atlas.
        london = next(point for point in self.snapshot["results"] if point["location"]["id"] == "london")
        frost = london["trends"]["metrics"]["frost_days"]
        self.assertTrue(frost["analysis"]["significant"])
        self.assertFalse(frost["significant_across_scan"])
        self.assertLess(frost["analysis"]["ci95_per_decade"][1], 0)

    def test_optional_raw_daily_recount_for_four_locally_saved_points(self):
        cache = {}
        for path in (ROOT / ".cache/nasa-power/daily").glob("*.json"):
            saved = json.loads(path.read_text(encoding="utf-8"))
            cache[saved["source_url"]] = saved
        points = [point for point in self.snapshot["results"] if point["location"]["id"] in RAW_CHECK_POINTS]
        if any(source["source_url"] not in cache for point in points for source in point["sources"]):
            self.skipTest("Optional raw check needs all 36 ignored original NASA daily batches for Prague, Medicine Hat, Brno and Athens.")
        checked_days = checked_metrics = 0
        for point in points:
            records = {}
            for source in point["sources"]:
                payload = cache[source["source_url"]]["payload"]
                values = payload["properties"]["parameter"]
                fill = payload["header"]["fill_value"]
                self.assertEqual(payload["header"]["time_standard"], "LST")
                for name in ("T2M_MAX", "T2M_MIN", "PRECTOTCORR"):
                    self.assertEqual(payload["parameters"][name]["units"], "mm/day" if name == "PRECTOTCORR" else "C")
                for key in values["T2M_MAX"]:
                    def number(name):
                        value = values[name].get(key)
                        if value is None or isinstance(value, bool) or not math.isfinite(value) or value == fill or name == "PRECTOTCORR" and value < 0:
                            return None
                        return value
                    maximum, minimum, rain = map(number, ("T2M_MAX", "T2M_MIN", "PRECTOTCORR"))
                    if maximum is not None and minimum is not None and maximum < minimum:
                        maximum = minimum = None
                    records[key] = maximum, minimum, rain
            for row in point["years"]:
                day, stop = date(row["year"], 1, 1), date(row["year"] + 1, 1, 1)
                counts, available, run = [0] * 4, [0] * 4, 0
                while day < stop:
                    maximum, minimum, rain = records.get(day.strftime("%Y%m%d"), (None, None, None))
                    for index, value in enumerate((maximum, minimum, minimum, rain)):
                        available[index] += value is not None
                    counts[0] += maximum is not None and maximum > 30
                    counts[1] += minimum is not None and minimum < 0
                    counts[2] += minimum is not None and minimum > 20
                    run = run + 1 if rain is not None and rain < 1 else 0
                    counts[3] = max(counts[3], run)
                    day += timedelta(days=1)
                    checked_days += 1
                for index, metric in enumerate(METRICS):
                    with self.subTest(point=point["location"]["id"], year=row["year"], metric=metric):
                        self.assertEqual(row[metric]["observed_count"], counts[index])
                        self.assertEqual(row[metric]["available_days"], available[index])
                        self.assertEqual(row[metric]["value"], counts[index] if available[index] == row["expected_days"] else None)
                        checked_metrics += 1
        self.assertEqual((checked_days, checked_metrics), (65744, 720))


if __name__ == "__main__":
    unittest.main()
