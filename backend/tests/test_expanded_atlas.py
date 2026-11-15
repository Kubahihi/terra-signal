"""Audit the expanded atlas independently from production aggregation and fitting.

Published values, rates and inference are recomputed from the archived annual
records. A local optional check recounts newly added points from the exact
original response bytes named by their SHA-256; ignored cache is not CI input.
"""

import calendar
import hashlib
import json
import math
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
from scipy.stats import t

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "frontend/public/data/trend-atlas-1981-2025.json"
LEGACY = ROOT / "frontend/public/data/daily-example-analysis-1981-2025.json"
METRICS = ("hot_days", "frost_days", "warm_nights", "longest_dry_spell")


class ExpandedAtlasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not ARCHIVE.exists():
            raise unittest.SkipTest("Expanded atlas has not been generated in this checkout.")
        cls.scan = json.loads(ARCHIVE.read_text(encoding="utf-8"))
        cls.legacy = json.loads(LEGACY.read_text(encoding="utf-8"))

    def test_fixed_candidates_complete_record_and_full_family(self):
        scan = self.scan
        self.assertEqual(scan["schema_version"], 2)
        self.assertEqual((scan["start"], scan["end"]), (1981, 2025))
        candidates = {point["id"]: point for point in scan["candidates"]}
        self.assertGreater(len(candidates), 10)
        self.assertEqual(len(candidates), len(scan["candidates"]))
        self.assertEqual(len({(p["lat"], p["lon"]) for p in candidates.values()}), len(candidates))
        self.assertEqual(scan["family_size"], len(candidates) * len(METRICS))
        self.assertEqual(len(scan["results"]), len(candidates))
        self.assertEqual({p["location"]["id"] for p in scan["results"]}, set(candidates))
        self.assertLessEqual(datetime.fromisoformat(scan["started_at"]), datetime.fromisoformat(scan["finished_at"]))
        for point in scan["results"]:
            with self.subTest(point=point["location"]["id"]):
                self.assertEqual(point["location"], candidates[point["location"]["id"]])
                self.assertEqual(point["failures"], [])
                self.assertEqual(set(point["trends"]["metrics"]), set(METRICS))
                self.assertEqual([row["year"] for row in point["years"]], list(range(1981, 2026)))
                self.assertEqual((point["trends"]["latitude"], point["trends"]["longitude"]), (point["location"]["lat"], point["location"]["lon"]))
                self.assertEqual((point["trends"]["start"], point["trends"]["end"]), (1981, 2025))
                self.assertTrue(math.isfinite(point["location"]["lat"]) and abs(point["location"]["lat"]) <= 90)
                self.assertTrue(math.isfinite(point["location"]["lon"]) and abs(point["location"]["lon"]) <= 180)

    def test_original_sources_cover_each_year_at_the_labelled_point(self):
        for point in self.scan["results"]:
            spans = []
            with self.subTest(point=point["location"]["id"]):
                self.assertEqual(len(point["sources"]), 9)
                for source in point["sources"]:
                    url = urlparse(source["source_url"])
                    query = parse_qs(url.query)
                    self.assertEqual((url.scheme, url.netloc, url.path), ("https", "power.larc.nasa.gov", "/api/temporal/daily/point"))
                    self.assertEqual(query["time-standard"], ["LST"])
                    self.assertEqual(set(query["parameters"][0].split(",")), {"T2M_MAX", "T2M_MIN", "PRECTOTCORR"})
                    self.assertEqual(float(query["latitude"][0]), point["location"]["lat"])
                    self.assertEqual(float(query["longitude"][0]), point["location"]["lon"])
                    self.assertEqual(query["start"], [f'{source["start"]}0101'])
                    self.assertEqual(query["end"], [f'{source["end"]}1231'])
                    self.assertIn(source["data_origin"], ("live", "cache"))
                    self.assertIsNotNone(datetime.fromisoformat(source["retrieved_at"]).tzinfo)
                    spans.extend(range(source["start"], source["end"] + 1))
                self.assertEqual(sorted(spans), list(range(1981, 2026)))

    def test_exact_counts_leap_days_dry_dates_and_decade_means(self):
        checked = 0
        for point in self.scan["results"]:
            for row in point["years"]:
                with self.subTest(point=point["location"]["id"], year=row["year"]):
                    expected = 366 if calendar.isleap(row["year"]) else 365
                    self.assertEqual(row["expected_days"], expected)
                    for metric in METRICS:
                        count = row[metric]
                        self.assertIsInstance(count["value"], int)
                        self.assertNotIsInstance(count["value"], bool)
                        self.assertEqual(count["value"], count["observed_count"])
                        self.assertEqual(count["available_days"], expected)
                        self.assertTrue(0 <= count["value"] <= expected)
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
        self.assertEqual(checked, len(self.scan["candidates"]) * 45)

    def test_every_ols_rate_hac_interval_and_probability_without_production_fitter(self):
        checked = 0
        for point in self.scan["results"]:
            for metric in METRICS:
                with self.subTest(point=point["location"]["id"], metric=metric):
                    result = point["trends"]["metrics"][metric]
                    analysis = result["analysis"]
                    years = np.array([row["year"] for row in point["years"]], dtype=float)
                    values = np.array([row[metric]["value"] for row in point["years"]], dtype=float)
                    n = len(years)
                    x = years - years.mean()
                    denominator = x @ x
                    slope = x @ values / denominator
                    intercept = values.mean() - slope * (years.mean() - years[0])
                    self.assertEqual((result["complete_years"], result["expected_years"]), (45, 45))
                    self.assertEqual((result["first_year"], result["last_year"]), (1981, 2025))
                    self.assertEqual(result["nonzero_years"], int(np.count_nonzero(values)))
                    self.assertEqual((analysis["sample_size"], analysis["reference_year"], analysis["hac_lags"], analysis["lag_unit"]), (45, 1981, 1, "years"))
                    self.assertAlmostEqual(analysis["slope_per_year"], slope, places=12)
                    self.assertAlmostEqual(analysis["slope_per_decade"], slope * 10, places=12)
                    self.assertAlmostEqual(analysis["intercept"], intercept, places=12)
                    residuals = values - values.mean() - slope * x
                    inference_possible = np.ptp(values) != 0 and np.count_nonzero(values) >= 5 and np.max(np.abs(residuals)) > 1e-10
                    if not inference_possible:
                        self.assertIsNone(analysis["ci95_per_decade"])
                        self.assertIsNone(analysis["p_value"])
                        self.assertIsNone(result["p_holm_scan"])
                        self.assertIsNone(result["significant_across_scan"])
                    else:
                        scores = x * residuals
                        # Symmetric Bartlett lag-1 terms: 2 × 1/2 = 1.
                        variance = (scores @ scores + scores[1:] @ scores[:-1]) / denominator ** 2 * n / (n - 2)
                        standard_error = math.sqrt(variance)
                        half_width = t.ppf(0.975, n - 2) * standard_error
                        expected_interval = [(slope - half_width) * 10, (slope + half_width) * 10]
                        expected_probability = 2 * t.sf(abs(slope / standard_error), n - 2)
                        np.testing.assert_allclose(analysis["ci95_per_decade"], expected_interval, rtol=1e-10, atol=1e-12)
                        np.testing.assert_allclose(analysis["p_value"], expected_probability, rtol=1e-9, atol=1e-16)
                    checked += 1
        self.assertEqual(checked, self.scan["family_size"])

    def test_scan_correction_keeps_all_slots_and_legacy_reference_observations(self):
        results = [point["trends"]["metrics"][metric] for point in self.scan["results"] for metric in METRICS]
        ordered = sorted(results, key=lambda result: result["analysis"]["p_value"] if result["analysis"] and result["analysis"]["p_value"] is not None else 1)
        previous = 0.0
        differs_from_point_family = 0
        for rank, result in enumerate(ordered):
            probability = result["analysis"]["p_value"] if result["analysis"] else None
            corrected = min(1.0, max(previous, (self.scan["family_size"] - rank) * (probability if probability is not None else 1)))
            previous = corrected
            self.assertNotIn("p_holm_40", result)
            if probability is None:
                self.assertIsNone(result["p_holm_scan"])
                self.assertIsNone(result["significant_across_scan"])
            else:
                np.testing.assert_allclose(result["p_holm_scan"], corrected, rtol=1e-12, atol=0)
                self.assertEqual(result["significant_across_scan"], corrected < 0.05)
                differs_from_point_family += result["p_holm_scan"] != result["analysis"]["p_value_holm"]
        self.assertGreater(differs_from_point_family, 0)
        expanded = {point["location"]["id"]: point for point in self.scan["results"]}
        for old in self.legacy["results"]:
            current = expanded[old["location"]["id"]]
            self.assertEqual(current["location"], old["location"])
            self.assertEqual(current["years"], old["years"])
            self.assertEqual(current["sources"], old["sources"])
            for metric in METRICS:
                self.assertEqual(current["trends"]["metrics"][metric]["analysis"], old["trends"]["metrics"][metric]["analysis"])

    def test_optional_raw_recount_of_new_points_from_matching_original_response_hashes(self):
        old_ids = {point["location"]["id"] for point in self.legacy["results"]}
        new_points = [point for point in self.scan["results"] if point["location"]["id"] not in old_ids]
        sources = [source for point in new_points for source in point["sources"]]
        paths = {}
        for path in (ROOT / ".cache/nasa-power/daily").glob("*.json"):
            paths[hashlib.sha256(path.read_bytes()).hexdigest()] = path
        if any(source.get("cached_response_sha256") not in paths for source in sources):
            self.skipTest("Optional raw recount requires the exact ignored NASA response bytes named by all new-point source hashes.")
        checked_days = checked_values = 0
        for point in new_points:
            records = {}
            for source in point["sources"]:
                saved = json.loads(paths[source["cached_response_sha256"]].read_text(encoding="utf-8"))
                self.assertEqual(saved["source_url"], source["source_url"])
                self.assertEqual(saved["retrieved_at"], source["retrieved_at"])
                payload = saved["payload"]
                values = payload["properties"]["parameter"]
                fill = payload["header"]["fill_value"]
                self.assertEqual(payload["header"]["time_standard"], "LST")
                for name in ("T2M_MAX", "T2M_MIN", "PRECTOTCORR"):
                    self.assertEqual(payload["parameters"][name]["units"], "mm/day" if name == "PRECTOTCORR" else "C")
                for key in values["T2M_MAX"]:
                    def observed(name):
                        value = values[name].get(key)
                        if value is None or isinstance(value, bool) or not math.isfinite(value) or value == fill or name == "PRECTOTCORR" and value < 0:
                            return None
                        return value
                    maximum, minimum, rain = map(observed, ("T2M_MAX", "T2M_MIN", "PRECTOTCORR"))
                    if maximum is not None and minimum is not None and maximum < minimum:
                        maximum = minimum = None
                    records[key] = maximum, minimum, rain
            for row in point["years"]:
                counts, available, run = [0] * 4, [0] * 4, 0
                day, stop = date(row["year"], 1, 1), date(row["year"] + 1, 1, 1)
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
                        self.assertEqual(row[metric]["value"], counts[index])
                        self.assertEqual(row[metric]["observed_count"], counts[index])
                        self.assertEqual(row[metric]["available_days"], available[index])
                        checked_values += 1
        expected_days = sum(366 if calendar.isleap(year) else 365 for year in range(1981, 2026))
        self.assertEqual(checked_days, len(new_points) * expected_days)
        self.assertEqual(checked_values, len(new_points) * 45 * 4)


if __name__ == "__main__":
    unittest.main()
