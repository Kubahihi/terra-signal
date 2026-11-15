"""Build a fixed, reproducible 193-point daily NASA POWER atlas.

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
    ("karlovy-vary", "Karlovy Vary, Czechia", 50.2319, 12.8710),
    ("usti-nad-labem", "Usti nad Labem, Czechia", 50.6607, 14.0323),
    ("pardubice", "Pardubice, Czechia", 50.0343, 15.7812),
    ("munich", "Munich, Germany", 48.1351, 11.5820),
    ("hamburg", "Hamburg, Germany", 53.5511, 9.9937),
    ("krakow", "Krakow, Poland", 50.0647, 19.9450),
    ("gdansk", "Gdansk, Poland", 54.3520, 18.6466),
    ("kosice", "Kosice, Slovakia", 48.7164, 21.2611),
    ("dublin", "Dublin, Ireland", 53.3498, -6.2603),
    ("brussels", "Brussels, Belgium", 50.8503, 4.3517),
    ("barcelona", "Barcelona, Spain", 41.3851, 2.1734),
    ("milan", "Milan, Italy", 45.4642, 9.1900),
    ("sofia", "Sofia, Bulgaria", 42.6977, 23.3219),
    ("zagreb", "Zagreb, Croatia", 45.8150, 15.9819),
    ("tallinn", "Tallinn, Estonia", 59.4370, 24.7536),
    ("riga", "Riga, Latvia", 56.9496, 24.1052),
    ("vilnius", "Vilnius, Lithuania", 54.6872, 25.2797),
    ("istanbul", "Istanbul, Turkey", 41.0082, 28.9784),
    ("ankara", "Ankara, Turkey", 39.9334, 32.8597),
    ("tbilisi", "Tbilisi, Georgia", 41.7151, 44.8271),
    ("sarajevo", "Sarajevo, Bosnia and Herzegovina", 43.8563, 18.4131),
    ("los-angeles", "Los Angeles, USA", 34.0522, -118.2437),
    ("chicago", "Chicago, USA", 41.8781, -87.6298),
    ("vancouver", "Vancouver, Canada", 49.2827, -123.1207),
    ("mexico-city", "Mexico City, Mexico", 19.4326, -99.1332),
    ("buenos-aires", "Buenos Aires, Argentina", -34.6037, -58.3816),
    ("lima", "Lima, Peru", -12.0464, -77.0428),
    ("bogota", "Bogota, Colombia", 4.7110, -74.0721),
    ("cairo", "Cairo, Egypt", 30.0444, 31.2357),
    ("lagos", "Lagos, Nigeria", 6.5244, 3.3792),
    ("addis-ababa", "Addis Ababa, Ethiopia", 8.9806, 38.7578),
    ("beijing", "Beijing, China", 39.9042, 116.4074),
    ("seoul", "Seoul, South Korea", 37.5665, 126.9780),
    ("jakarta", "Jakarta, Indonesia", -6.2088, 106.8456),
    ("bangkok", "Bangkok, Thailand", 13.7563, 100.5018),
    ("perth", "Perth, Australia", -31.9505, 115.8605),
    ("wellington", "Wellington, New Zealand", -41.2865, 174.7762),
    # Americas: Arctic and temperate cities, Central America and South America.
    ("anchorage", "Anchorage, USA", 61.2181, -149.9003),
    ("seattle", "Seattle, USA", 47.6062, -122.3321),
    ("san-francisco", "San Francisco, USA", 37.7749, -122.4194),
    ("denver", "Denver, USA", 39.7392, -104.9903),
    ("dallas", "Dallas, USA", 32.7767, -96.7970),
    ("houston", "Houston, USA", 29.7604, -95.3698),
    ("miami", "Miami, USA", 25.7617, -80.1918),
    ("atlanta", "Atlanta, USA", 33.7490, -84.3880),
    ("boston", "Boston, USA", 42.3601, -71.0589),
    ("montreal", "Montreal, Canada", 45.5017, -73.5673),
    ("ottawa", "Ottawa, Canada", 45.4215, -75.6972),
    ("winnipeg", "Winnipeg, Canada", 49.8951, -97.1384),
    ("yellowknife", "Yellowknife, Canada", 62.4540, -114.3718),
    ("nuuk", "Nuuk, Greenland", 64.1835, -51.7216),
    ("guadalajara", "Guadalajara, Mexico", 20.6597, -103.3496),
    ("monterrey", "Monterrey, Mexico", 25.6866, -100.3161),
    ("havana", "Havana, Cuba", 23.1136, -82.3666),
    ("kingston", "Kingston, Jamaica", 17.9712, -76.7936),
    ("san-jose-cr", "San Jose, Costa Rica", 9.9281, -84.0907),
    ("panama-city", "Panama City, Panama", 8.9824, -79.5199),
    ("guatemala-city", "Guatemala City, Guatemala", 14.6349, -90.5069),
    ("san-juan", "San Juan, Puerto Rico", 18.4655, -66.1057),
    ("caracas", "Caracas, Venezuela", 10.4806, -66.9036),
    ("quito", "Quito, Ecuador", -0.1807, -78.4678),
    ("manaus", "Manaus, Brazil", -3.1190, -60.0217),
    ("rio-de-janeiro", "Rio de Janeiro, Brazil", -22.9068, -43.1729),
    ("brasilia", "Brasilia, Brazil", -15.7939, -47.8828),
    ("santiago", "Santiago, Chile", -33.4489, -70.6693),
    ("montevideo", "Montevideo, Uruguay", -34.9011, -56.1645),
    ("ushuaia", "Ushuaia, Argentina", -54.8019, -68.3030),
    # Africa: northern, western, central, eastern and southern regions.
    ("rabat", "Rabat, Morocco", 34.0209, -6.8416),
    ("casablanca", "Casablanca, Morocco", 33.5731, -7.5898),
    ("algiers", "Algiers, Algeria", 36.7538, 3.0588),
    ("tunis", "Tunis, Tunisia", 36.8065, 10.1815),
    ("tripoli", "Tripoli, Libya", 32.8872, 13.1913),
    ("alexandria", "Alexandria, Egypt", 31.2001, 29.9187),
    ("dakar", "Dakar, Senegal", 14.7167, -17.4677),
    ("accra", "Accra, Ghana", 5.6037, -0.1870),
    ("abidjan", "Abidjan, Cote d'Ivoire", 5.3600, -4.0083),
    ("bamako", "Bamako, Mali", 12.6392, -8.0029),
    ("niamey", "Niamey, Niger", 13.5116, 2.1254),
    ("ndjamena", "N'Djamena, Chad", 12.1348, 15.0557),
    ("khartoum", "Khartoum, Sudan", 15.5007, 32.5599),
    ("abuja", "Abuja, Nigeria", 9.0765, 7.3986),
    ("douala", "Douala, Cameroon", 4.0511, 9.7679),
    ("kinshasa", "Kinshasa, DR Congo", -4.4419, 15.2663),
    ("luanda", "Luanda, Angola", -8.8390, 13.2894),
    ("kampala", "Kampala, Uganda", 0.3476, 32.5825),
    ("kigali", "Kigali, Rwanda", -1.9441, 30.0619),
    ("dar-es-salaam", "Dar es Salaam, Tanzania", -6.7924, 39.2083),
    ("lusaka", "Lusaka, Zambia", -15.3875, 28.3228),
    ("harare", "Harare, Zimbabwe", -17.8252, 31.0335),
    ("maputo", "Maputo, Mozambique", -25.9692, 32.5732),
    ("johannesburg", "Johannesburg, South Africa", -26.2041, 28.0473),
    ("antananarivo", "Antananarivo, Madagascar", -18.8792, 47.5079),
    # Asia and eastern Europe: inland, tropical, monsoon and high-latitude cells.
    ("riyadh", "Riyadh, Saudi Arabia", 24.7136, 46.6753),
    ("jeddah", "Jeddah, Saudi Arabia", 21.4858, 39.1925),
    ("dubai", "Dubai, United Arab Emirates", 25.2048, 55.2708),
    ("doha", "Doha, Qatar", 25.2854, 51.5310),
    ("muscat", "Muscat, Oman", 23.5880, 58.3829),
    ("amman", "Amman, Jordan", 31.9539, 35.9106),
    ("beirut", "Beirut, Lebanon", 33.8938, 35.5018),
    ("baghdad", "Baghdad, Iraq", 33.3152, 44.3661),
    ("tehran", "Tehran, Iran", 35.6892, 51.3890),
    ("isfahan", "Isfahan, Iran", 32.6546, 51.6680),
    ("baku", "Baku, Azerbaijan", 40.4093, 49.8671),
    ("moscow", "Moscow, Russia", 55.7558, 37.6173),
    ("tashkent", "Tashkent, Uzbekistan", 41.2995, 69.2401),
    ("almaty", "Almaty, Kazakhstan", 43.2220, 76.8512),
    ("astana", "Astana, Kazakhstan", 51.1694, 71.4491),
    ("saint-petersburg", "Saint Petersburg, Russia", 59.9311, 30.3609),
    ("dushanbe", "Dushanbe, Tajikistan", 38.5598, 68.7870),
    ("ashgabat", "Ashgabat, Turkmenistan", 37.9601, 58.3261),
    ("kabul", "Kabul, Afghanistan", 34.5553, 69.2075),
    ("karachi", "Karachi, Pakistan", 24.8607, 67.0011),
    ("lahore", "Lahore, Pakistan", 31.5204, 74.3587),
    ("mumbai", "Mumbai, India", 19.0760, 72.8777),
    ("kolkata", "Kolkata, India", 22.5726, 88.3639),
    ("chennai", "Chennai, India", 13.0827, 80.2707),
    ("bengaluru", "Bengaluru, India", 12.9716, 77.5946),
    ("dhaka", "Dhaka, Bangladesh", 23.8103, 90.4125),
    ("kathmandu", "Kathmandu, Nepal", 27.7172, 85.3240),
    ("colombo", "Colombo, Sri Lanka", 6.9271, 79.8612),
    ("yangon", "Yangon, Myanmar", 16.8409, 96.1735),
    ("hanoi", "Hanoi, Vietnam", 21.0278, 105.8342),
    ("ho-chi-minh-city", "Ho Chi Minh City, Vietnam", 10.8231, 106.6297),
    ("phnom-penh", "Phnom Penh, Cambodia", 11.5564, 104.9282),
    ("vientiane", "Vientiane, Laos", 17.9757, 102.6331),
    ("kuala-lumpur", "Kuala Lumpur, Malaysia", 3.1390, 101.6869),
    ("manila", "Manila, Philippines", 14.5995, 120.9842),
    ("cebu", "Cebu, Philippines", 10.3157, 123.8854),
    ("shanghai", "Shanghai, China", 31.2304, 121.4737),
    ("hong-kong", "Hong Kong, China", 22.3193, 114.1694),
    ("chengdu", "Chengdu, China", 30.5728, 104.0668),
    ("urumqi", "Urumqi, China", 43.8256, 87.6168),
    ("taipei", "Taipei, Taiwan", 25.0330, 121.5654),
    ("ulaanbaatar", "Ulaanbaatar, Mongolia", 47.8864, 106.9057),
    ("sapporo", "Sapporo, Japan", 43.0618, 141.3545),
    ("vladivostok", "Vladivostok, Russia", 43.1155, 131.8855),
    ("yakutsk", "Yakutsk, Russia", 62.0355, 129.6755),
    # Oceania, Pacific islands and Antarctic research stations.
    ("melbourne", "Melbourne, Australia", -37.8136, 144.9631),
    ("brisbane", "Brisbane, Australia", -27.4698, 153.0251),
    ("adelaide", "Adelaide, Australia", -34.9285, 138.6007),
    ("darwin", "Darwin, Australia", -12.4634, 130.8456),
    ("casey-station", "Casey Station, Antarctica", -66.2821, 110.5275),
    ("alice-springs", "Alice Springs, Australia", -23.6980, 133.8807),
    ("auckland", "Auckland, New Zealand", -36.8485, 174.7633),
    ("christchurch", "Christchurch, New Zealand", -43.5321, 172.6362),
    ("port-moresby", "Port Moresby, Papua New Guinea", -9.4438, 147.1803),
    ("suva", "Suva, Fiji", -18.1248, 178.4501),
    ("apia", "Apia, Samoa", -13.8507, -171.7514),
    ("mcmurdo-station", "McMurdo Station, Antarctica", -77.8419, 166.6863),
    ("honolulu", "Honolulu, USA", 21.3099, -157.8581),
)


def now():
    return datetime.now(timezone.utc).isoformat()


def serialize(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def complete_record(record, location):
    years = record.get("years", [])
    return (record.get("location") == location and not record.get("failures")
            and [row["year"] for row in years] == list(range(START, END + 1))
            and len(record.get("sources", [])) == 9
            and all(row[metric]["value"] is not None for row in years for metric in METRICS))


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
            "candidate_source": f"scripts/build_trend_atlas.py; original ten reference points plus {len(candidates) - 10} fixed additional coordinates, fixed before acquisition and examination",
            "candidates": candidates, "family_size": len(candidates) * len(METRICS),
            "correction": f"Holm across {len(candidates)} fixed points x 4 indices; unavailable tests retain internal p=1 slots",
            "method": "Yearly OLS + HAC(1 annual lag), individual 95% intervals; strict unchanged daily thresholds",
            "results": results}


async def acquire(location, semaphore, stopped, limit):
    path = CHECKPOINT / f'{location["id"]}.json'
    if path.exists():
        saved = json.loads(path.read_text(encoding="utf-8"))
        if complete_record(saved, location):
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
                print(f'BATCH {location["id"]}: {start}-{end} ({report.data_origin})', flush=True)
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
    assert len({point["id"] for point in candidates}) == len(candidates)
    assert len({(point["lat"], point["lon"]) for point in candidates}) == len(candidates)
    started = now()
    print(f'FIXED {len(candidates)} candidates; {4 * len(candidates)} Holm slots; {START}-{END}.', flush=True)
    records = {row["location"]["id"]: copy.deepcopy(row) for row in reference["results"]}
    # Retain previously acquired annual records and their original provenance.
    # Scan-wide inference is recomputed below for the complete expanded family.
    if OUTPUT.exists():
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if previous.get("schema_version") == 2 and (previous.get("start"), previous.get("end")) == (START, END):
            existing = {row["location"]["id"]: row for row in previous["results"]}
            for place in candidates:
                record = existing.get(place["id"], {})
                if place["id"] not in records and complete_record(record, place):
                    records[place["id"]] = record
    semaphore, stopped = asyncio.Semaphore(args.workers), asyncio.Event()
    new = [place for place in candidates if place["id"] not in records]
    print(f'REUSE {len(records)} complete points; acquire {len(new)} new points.', flush=True)
    # A bounded real upstream probe prevents silently waiting through hundreds of failed calls.
    if new:
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
    failed = [point["location"]["id"] for point in archive["results"] if point["failures"]]
    exact = sum(len(point["years"]) == 45 and all(row[name]["value"] is not None for row in point["years"] for name in METRICS) for point in archive["results"])
    if failed or exact != len(candidates):
        print(f'INCOMPLETE: {exact}/{len(candidates)} complete points; previous archive retained. Checkpoints saved for retry.', flush=True)
        if failed:
            print(f'UNAVAILABLE: {", ".join(failed)}', flush=True)
        return 1
    serialize(OUTPUT, archive)
    print(f'ARCHIVE {OUTPUT}; {len(candidates)} candidates, {exact} complete points; {OUTPUT.stat().st_size} bytes', flush=True)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--timeout", type=float, default=75, help="Per-batch total bound including provider queue/retry.")
    options = parser.parse_args()
    raise SystemExit(asyncio.run(main(options)))
