"""Build a fixed, reproducible 43-point daily NASA POWER atlas.

The original ten-point reference file stays unchanged. Original provider JSON is
cached by the existing provider, and completed point records are checkpointed so
an interrupted build can resume without redownloading them. No spatial values
are interpolated and failed candidates retain their prespecified test slots.
"""

import argparse
import asyncio
import copy
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.schemas import DailyQuery, DailyTrendRequest
from backend.app.services.daily_trends import analyze_daily_trends
from backend.app.services.nasa_daily import cache_path, fetch_daily
from statsmodels.stats.multitest import multipletests


START, END = 1981, 2025
REFERENCE = ROOT / "frontend/public/data/daily-example-analysis-1981-2025.json"
OUTPUT = ROOT / "frontend/public/data/trend-atlas-1981-2025.json"
CHECKPOINT = ROOT / ".cache/atlas-build-1981-2025"
METRICS = ("hot_days", "frost_days", "warm_nights", "longest_dry_spell")

# Fixed before acquisition or examination of this expanded scan's results.
# These are sampled coordinates near cities, not administrative area averages.
ADDITIONAL_CANDIDATES = (
    ("pilsen", "Pilsen, Czechia", 49.7384, 13.3736),
    ("liberec", "Liberec, Czechia", 50.7671, 15.0562),
    ("olomouc", "Olomouc, Czechia", 49.5938, 17.2509),
    ("ceske-budejovice", "Ceske Budejovice, Czechia", 48.9747, 14.4743),
    ("jihlava", "Jihlava, Czechia", 49.3961, 15.5912),
    ("zlin", "Zlin, Czechia", 49.2244, 17.6628),
    ("hradec-kralove", "Hradec Kralove, Czechia", 50.2092, 15.8328),
    ("vienna", "Vienna, Austria", 48.2082, 16.3738),
    ("warsaw", "Warsaw, Poland", 52.2297, 21.0122),
    ("budapest", "Budapest, Hungary", 47.4979, 19.0402),
    ("bratislava", "Bratislava, Slovakia", 48.1486, 17.1077),
    ("paris", "Paris, France", 48.8566, 2.3522),
    ("madrid", "Madrid, Spain", 40.4168, -3.7038),
    ("rome", "Rome, Italy", 41.9028, 12.4964),
    ("stockholm", "Stockholm, Sweden", 59.3293, 18.0686),
    ("oslo", "Oslo, Norway", 59.9139, 10.7522),
    ("helsinki", "Helsinki, Finland", 60.1699, 24.9384),
    ("lisbon", "Lisbon, Portugal", 38.7223, -9.1393),
    ("zurich", "Zurich, Switzerland", 47.3769, 8.5417),
    ("amsterdam", "Amsterdam, Netherlands", 52.3676, 4.9041),
    ("bucharest", "Bucharest, Romania", 44.4268, 26.1025),
    ("belgrade", "Belgrade, Serbia", 44.7866, 20.4489),
    ("kyiv", "Kyiv, Ukraine", 50.4501, 30.5234),
    ("reykjavik", "Reykjavik, Iceland", 64.1466, -21.9426),
    ("copenhagen", "Copenhagen, Denmark", 55.6761, 12.5683),
    ("edmonton", "Edmonton, Canada", 53.5461, -113.4938),
    ("toronto", "Toronto, Canada", 43.6532, -79.3832),
    ("new-york", "New York, USA", 40.7128, -74.0060),
    ("sao-paulo", "Sao Paulo, Brazil", -23.5505, -46.6333),
    ("cape-town", "Cape Town, South Africa", -33.9249, 18.4241),
    ("tokyo", "Tokyo, Japan", 35.6762, 139.6503),
    ("delhi", "Delhi, India", 28.6139, 77.2090),
    ("singapore", "Singapore", 1.3521, 103.8198),
)


def now():
    return datetime.now(timezone.utc).isoformat()


def serialize(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def point_record(location, years, sources, failures):
    ordered = sorted(years, key=lambda row: row["year"])
    request = DailyTrendRequest(latitude=location["lat"], longitude=location["lon"], start=START, end=END, years=ordered)
    trends = analyze_daily_trends(request).model_dump(mode="json")
    means = {}
    for metric in METRICS:
        means[metric] = {}
        for first, last in ((1981, 1990), (2016, 2025)):
            values = [row[metric]["value"] for row in ordered if first <= row["year"] <= last and row[metric]["value"] is not None]
            means[metric][f"{first}-{last}"] = {"complete_years": len(values), "value": sum(values) / len(values) if values else None}
    return {"location": location, "sources": sources, "years": ordered, "failures": failures,
            "trends": trends, "means": means}


def build_archive(candidates, records, started):
    results = [copy.deepcopy(records[place["id"]]) for place in candidates]
    tests = [point["trends"]["metrics"][metric] for point in results for metric in METRICS]
    raw = [test["analysis"]["p_value"] if test["analysis"] and test["analysis"]["p_value"] is not None else 1.0 for test in tests]
    adjusted = multipletests(raw, alpha=0.05, method="holm")[1]
    for test, probability in zip(tests, adjusted):
        # The original per-point four-index family remains explicitly separate.
        test.pop("p_holm_40", None)
        available = test["analysis"] is not None and test["analysis"]["p_value"] is not None
        test["p_holm_scan"] = float(probability) if available else None
        test["significant_across_scan"] = bool(probability < 0.05) if available else None
    return {"schema_version": 2, "start": START, "end": END, "started_at": started, "finished_at": now(),
            "candidate_source": "scripts/build_trend_atlas.py; original ten reference points plus 33 fixed additional coordinates, fixed before acquisition and examination",
            "candidates": candidates, "family_size": len(candidates) * len(METRICS),
            "correction": f"Holm across {len(candidates)} fixed points x 4 indices; unavailable tests retain internal p=1 slots",
            "method": "Yearly OLS + HAC(1 annual lag), individual 95% intervals; strict unchanged daily thresholds",
            "results": results}


async def acquire(location, semaphore, stopped, limit):
    path = CHECKPOINT / f'{location["id"]}.json'
    if path.exists():
        saved = json.loads(path.read_text(encoding="utf-8"))
        if saved.get("location") == location and not saved.get("failures") and len(saved.get("years", [])) == 45:
            return saved
    years, sources, failures = [], [], []
    async with semaphore:
        for start in range(START, END + 1, 5):
            end = min(start + 4, END)
            if stopped.is_set():
                failures.append({"start": start, "end": END, "message": "Build stopped after an upstream failure; no observations fabricated."})
                break
            query = DailyQuery(latitude=location["lat"], longitude=location["lon"], start=start, end=end)
            try:
                async with asyncio.timeout(limit):
                    report = await fetch_daily(query)
                years.extend(row.model_dump(mode="json") for row in report.years)
                source = {"start": start, "end": end, "source_url": report.source_url,
                          "retrieved_at": report.retrieved_at, "data_origin": report.data_origin,
                          "warnings": report.warnings}
                original = cache_path(query)
                if original.exists():
                    source["cached_response_sha256"] = hashlib.sha256(original.read_bytes()).hexdigest()
                sources.append(source)
            except Exception as exc:
                failures.append({"start": start, "end": END, "message": f"{type(exc).__name__}: {exc}"})
                print(f'FAILED {location["id"]} {start}-{end}: {exc}', flush=True)
                stopped.set()
                break
    result = point_record(location, years, sources, failures)
    serialize(path, result)
    exact = sum(all(row[name]["value"] is not None for name in METRICS) for row in years)
    print(f'POINT {location["id"]}: {len(years)}/45 years, {exact} fully exact, {len(sources)} original source batches', flush=True)
    return result


async def main(args):
    reference = json.loads(REFERENCE.read_text(encoding="utf-8"))
    candidates = reference["candidates"] + [dict(id=key, name=name, lat=lat, lon=lon) for key, name, lat, lon in ADDITIONAL_CANDIDATES]
    assert len(candidates) == 43 and len({point["id"] for point in candidates}) == 43
    started = now()
    print(f'FIXED {len(candidates)} candidates; {4 * len(candidates)} Holm slots; {START}-{END}.', flush=True)
    records = {row["location"]["id"]: copy.deepcopy(row) for row in reference["results"]}
    semaphore, stopped = asyncio.Semaphore(args.workers), asyncio.Event()
    new = candidates[len(reference["candidates"]):]
    # A bounded real upstream probe prevents silently waiting through hundreds of failed calls.
    probe = new[0]
    print(f'PROBE {probe["id"]} {START}-{START + 4}', flush=True)
    query = DailyQuery(latitude=probe["lat"], longitude=probe["lon"], start=START, end=START + 4)
    try:
        async with asyncio.timeout(args.timeout):
            first = await fetch_daily(query)
        print(f'PROBE OK {first.data_origin}; {len(first.daily)} actual days; {first.retrieved_at}', flush=True)
    except Exception as exc:
        print(f'PROBE FAILED {type(exc).__name__}: {exc}', flush=True)
        return 2
    tasks = [asyncio.create_task(acquire(place, semaphore, stopped, args.timeout)) for place in new]
    for task in asyncio.as_completed(tasks):
        record = await task
        records[record["location"]["id"]] = record
    archive = build_archive(candidates, records, started)
    serialize(OUTPUT, archive)
    failed = [point["location"]["id"] for point in archive["results"] if point["failures"]]
    exact = sum(len(point["years"]) == 45 and all(row[name]["value"] is not None for row in point["years"] for name in METRICS) for point in archive["results"])
    print(f'ARCHIVE {OUTPUT}; {len(candidates)} candidates, {exact} complete points, {len(failed)} failed; {OUTPUT.stat().st_size} bytes', flush=True)
    if failed:
        print(f'UNAVAILABLE: {", ".join(failed)}', flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--timeout", type=float, default=75, help="Per-batch total bound including provider queue/retry.")
    options = parser.parse_args()
    raise SystemExit(asyncio.run(main(options)))
