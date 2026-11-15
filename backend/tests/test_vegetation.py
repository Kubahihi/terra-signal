import copy
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes.vegetation import router
from backend.app.services import nasa_ndvi
from backend.app.services.nasa_power import ProviderError, SavedPayload
from backend.app.vegetation_schemas import VegetationQuery


def query(start=2024, end=2024):
    return VegetationQuery(latitude=48.85, longitude=16.85, start=start, end=end)


def fixture(dates, value=5000, qa=0):
    entries = []
    for day in dates:
        for band, data in ((nasa_ndvi.NDVI_BAND, [value] * 4), (nasa_ndvi.QUALITY_BAND, [qa] * 4)):
            entries.append({"band": band, "modis_date": nasa_ndvi.modis_date(day), "data": data, "version": "061"})
    return {"latitude": 48.85, "longitude": 16.85, "nrows": 2, "ncols": 2, "cellsize": "231.656358264", "subset": entries}


def saved(payload, age=0, origin="cache"):
    return SavedPayload(payload, "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?test=fixture",
                        (datetime.now(timezone.utc) - timedelta(days=age)).isoformat(), origin)


class VegetationNormalizationTests(unittest.TestCase):
    def test_all_batches_obey_ten_composite_limit_and_cover_leap_calendar(self):
        chunks = nasa_ndvi.batches(query(2023, 2024))
        self.assertEqual(len(chunks), 6)
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))
        dates = [day for chunk in chunks for day in chunk]
        self.assertEqual(len(dates), len(set(dates)))
        self.assertEqual(len(dates), 46)
        self.assertIn(date(2024, 12, 18), dates)
        self.assertEqual(nasa_ndvi.parameters(query(), chunks[3])["startDate"], "A2024001")

    def test_raw_scaling_retains_true_zero_and_filters_clouds_snow_and_marginal(self):
        days = nasa_ndvi.composite_dates(2024, 2024)[:5]
        payload = fixture(days)
        values = [0, 1, 2, 3, -1]
        for row in payload["subset"]:
            if row["band"] == nasa_ndvi.QUALITY_BAND:
                row["data"] = [values[days.index(datetime.strptime(row["modis_date"], "A%Y%j").date())]] * 4
            else:
                row["data"] = [0] * 4
        normalized, geometry, versions = nasa_ndvi.normalize_subset(query(), days, saved(payload))
        self.assertEqual(normalized[days[0]], 0)
        self.assertTrue(all(normalized[day] is None for day in days[1:]))
        self.assertEqual(geometry, (2, 2, 231.656358264))
        self.assertEqual(versions, {"061"})

    def test_quality_threshold_is_per_composite_and_invalid_raw_values_do_not_enter_mean(self):
        days = nasa_ndvi.composite_dates(2024, 2024)[:2]
        payload = fixture(days)
        payload["subset"][0]["data"] = [4000, 8000, -3000, float("nan")]
        payload["subset"][2]["data"] = [6000, True, "invalid", -3000]
        normalized, _, _ = nasa_ndvi.normalize_subset(query(), days, saved(payload))
        self.assertAlmostEqual(normalized[days[0]], 0.6)
        self.assertIsNone(normalized[days[1]])

    def test_missing_quality_does_not_become_good_or_join_another_composite(self):
        days = nasa_ndvi.composite_dates(2024, 2024)[:2]
        payload = fixture(days)
        payload["subset"] = [row for row in payload["subset"] if not (row["modis_date"] == "A2024001" and row["band"] == nasa_ndvi.QUALITY_BAND)]
        normalized, _, _ = nasa_ndvi.normalize_subset(query(), days, saved(payload))
        self.assertIsNone(normalized[days[0]])
        self.assertAlmostEqual(normalized[days[1]], 0.5)

    def test_another_point_malformed_arrays_duplicate_bands_and_mixed_collections_are_rejected(self):
        days = nasa_ndvi.composite_dates(2024, 2024)[:2]
        source = fixture(days)
        invalid = []
        payload = copy.deepcopy(source); payload["latitude"] = 49; invalid.append(payload)
        payload = copy.deepcopy(source); payload["subset"][0]["data"] = [5000]; invalid.append(payload)
        payload = copy.deepcopy(source); payload["subset"].append(copy.deepcopy(payload["subset"][0])); invalid.append(payload)
        payload = copy.deepcopy(source); payload["subset"][1]["version"] = "006"; invalid.append(payload)
        payload = copy.deepcopy(source); payload["nrows"] = -2; payload["ncols"] = -2; invalid.append(payload)
        payload = copy.deepcopy(source); payload["cellsize"] = 0.002; invalid.append(payload)
        for payload in invalid:
            with self.subTest(payload=payload):
                with self.assertRaises(ProviderError):
                    nasa_ndvi.normalize_subset(query(), days, saved(payload))


class VegetationCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_good_fresh_original_avoids_upstream_and_stale_outage_keeps_retrieval(self):
        days = nasa_ndvi.batches(query())[0]
        original = saved(fixture(days))
        with patch.object(nasa_ndvi, "_read_cache", return_value=original), patch.object(nasa_ndvi, "_download", new_callable=AsyncMock) as download:
            _, result, stale = await nasa_ndvi._fetch_batch(query(), days, False)
        download.assert_not_awaited()
        self.assertEqual(result.retrieved_at, original.retrieved_at)
        self.assertFalse(stale)
        old = saved(fixture(days), age=2)
        with patch.object(nasa_ndvi, "_read_cache", return_value=old), patch.object(nasa_ndvi, "_download", side_effect=httpx.ConnectError("offline")):
            _, result, stale = await nasa_ndvi._fetch_batch(query(), days, False)
        self.assertTrue(stale)
        self.assertEqual(result.retrieved_at, old.retrieved_at)

    async def test_bad_live_response_cannot_overwrite_good_cache(self):
        days = nasa_ndvi.batches(query())[0]
        old = saved(fixture(days), age=2)
        bad = fixture(days); bad["longitude"] = -100
        with patch.object(nasa_ndvi, "_read_cache", return_value=old), patch.object(nasa_ndvi, "_download", return_value=saved(bad, origin="live")), patch.object(nasa_ndvi, "_write_cache") as write:
            _, result, stale = await nasa_ndvi._fetch_batch(query(), days, True)
        write.assert_not_called()
        self.assertTrue(stale)
        self.assertEqual(result.origin, "cache")

    async def test_invalid_or_future_cache_dates_cannot_be_published_as_retrieval_metadata(self):
        days = nasa_ndvi.batches(query())[0]
        for stamp in ("invalid", (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()):
            original = saved(fixture(days))
            original.retrieved_at = stamp
            with patch.object(nasa_ndvi, "_read_cache", return_value=original), patch.object(nasa_ndvi, "_download", side_effect=httpx.ConnectError("offline")):
                with self.assertRaises(ProviderError):
                    await nasa_ndvi._fetch_batch(query(), days, False)

    async def test_full_month_requires_every_scheduled_composite_and_provenance_is_retained(self):
        async def batch(request, dates, refresh):
            payload = fixture(dates)
            # Only one of January's two composites passes the quality threshold.
            for row in payload["subset"]:
                if row["modis_date"] == "A2024017" and row["band"] == nasa_ndvi.QUALITY_BAND:
                    row["data"] = [3] * 4
            original = saved(payload)
            return nasa_ndvi.normalize_subset(request, dates, original), original, False
        with patch.object(nasa_ndvi, "_fetch_batch", side_effect=batch):
            result = await nasa_ndvi.fetch_vegetation(query())
        self.assertEqual(len(result.series), 12)
        self.assertIsNone(result.series[0].value)
        self.assertEqual((result.series[0].available_composites, result.series[0].expected_composites), (1, 2))
        self.assertAlmostEqual(result.series[1].value, 0.5)
        self.assertEqual(len(result.sources), 3)
        self.assertEqual(result.data_origin, "cache")
        self.assertEqual(result.retrieved_at, min(source.retrieved_at for source in result.sources))

    async def test_outage_without_cache_fails_before_queuing_every_batch(self):
        with patch.object(nasa_ndvi, "_read_cache", return_value=None), patch.object(nasa_ndvi, "_download", side_effect=httpx.ConnectError("offline")) as download:
            with self.assertRaises(ProviderError) as error:
                await nasa_ndvi.fetch_vegetation(query(2021, 2025))
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(download.call_count, 1)


class VegetationRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_unbounded_intervals_future_years_and_invalid_points_are_rejected(self):
        for params in ("lat=91&lon=0", "lat=0&lon=0&start=2000", "lat=0&lon=0&start=2020&end=2025", "lat=0&lon=0&start=2025&end=2024", "lat=0&lon=0&end=2099"):
            self.assertEqual(self.client.get("/api/vegetation?" + params).status_code, 422)

    def test_upstream_outage_is_explicit_503_without_substitute_observations(self):
        with patch("backend.app.routes.vegetation.fetch_vegetation", side_effect=ProviderError("Satellite data unavailable", 503)):
            response = self.client.get("/api/vegetation?lat=48.85&lon=16.85&start=2024&end=2024")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "Satellite data unavailable")
