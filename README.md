# TerraSignal

Explore NASA Earth data, detect trends, and understand uncertainty.

NASA Space Apps Challenge 2026 — **Be An Earth System Trend Detective!**

## Overview

TerraSignal is an interactive explorer for historical temperature, rainfall,
soil wetness and vegetation records. It combines a React + TypeScript frontend
with a FastAPI backend. Observations, source requests, retrieval dates, coverage
and analysis settings remain available in the interface and CSV/JSON exports.
The analyses are exploratory descriptions of historical records.

| Workspace | Purpose |
| --- | --- |
| **Map** | Explore saved 1981–2025 annual weather indices at 193 sampled grid cells, compare two places and animate years. |
| **Explore** | Retrieve records for arbitrary coordinates; inspect monthly, calendar and daily views and compare places. |
| **Connections** | Examine coincident hot/dry days and descriptive relationships between rainfall, temperature, soil wetness and vegetation. |
| **Memory** | Reconstruct dry episodes and inspect low responses, counterexamples and return timing in soil and vegetation records. |
| **Data** | Inspect variable definitions, sources, statistical explanations and external resources. |

The opening map uses a local archive with 8,685 complete annual rows and 34,740
index values, so browsing places or years needs no new NASA download. Explore
supports live retrieval. Guided examples provide reproducible starting points;
source and coverage notes remain attached to each record.

## Data sources

| Source | Records used |
| --- | --- |
| NASA POWER / MERRA-2 | Monthly `T2M`, `PRECTOTCORR` and `GWETROOT`; daily `T2M_MAX`, `T2M_MIN` and `PRECTOTCORR`. |
| NASA Terra MODIS | MOD13Q1 Collection 6.1 NDVI and pixel reliability, retrieved numerically through Microsoft Planetary Computer. |
| OpenStreetMap | Attributed basemap tiles displayed with Leaflet; separate from environmental observations. |

Public NASA POWER calls need no API key. Validated live responses are cached
for 24 hours. On an outage, only a matching saved response is used, with its
original retrieval date and origin disclosed. Checksummed original monthly
snapshots cover Prague and Medicine Hat for 1981–2025. Missing observations
remain gaps; no synthetic environmental fallback is used.

Full definitions, source references and assumptions are in
[Methodology](docs/METHODOLOGY.md). Data-use terms and credits are in
[Third-party notices](THIRD_PARTY_NOTICES.md).

## Methodology

### Monthly trends and calendar summaries

The monthly trend model fits a linear elapsed-time term plus fixed
calendar-month effects by ordinary least squares. Actual calendar spacing is
preserved across gaps. Uncertainty uses HAC covariance with 12 monthly lags,
a small-sample correction and t-based inference; rates and confidence bounds
are reported per decade.

The model requires at least 60 observations over five years, all twelve
calendar months represented and at least 80% coverage within the observed
span. Internal missing months withhold HAC intervals and p-values. Constant
records receive no significance claim. These thresholds are application
safeguards, not guarantees of scientific sufficiency.

Annual chart means are weighted by actual month lengths and require all twelve
months. Calendar temperature departures use a fixed 1991–2020 reference, with
all 30 observations required for each reference month. Rainfall totals multiply
monthly mean daily rates by the actual number of days, including leap days;
the original monthly series retains its mm/day unit. NASA annual-summary
month 13 is excluded. Missing observations or reference values remain null.

### Daily indices, map views and comparisons

Daily records use Local Solar Time and are retrieved separately from the monthly series.
The four annual indices are hot days (`Tmax > 30 °C`), frost days (`Tmin < 0 °C`),
a warm-night proxy (`Tmin > 20 °C`) and the longest run with rainfall
`< 1 mm/day`. Equality at a threshold does not qualify. Dry runs are clipped
to each calendar year. Exact values require every relevant day; incomplete
years retain labelled observed lower bounds without extrapolation.

Annual-index trends use actual year labels, OLS and HAC uncertainty with one
annual lag. They require at least 20 complete years and 80% coverage. Internal
gaps, constant or exact-line records and fewer than five nonzero years
withhold inference. Individual 95% intervals and multiplicity-adjusted
significance decisions are reported separately.

The map offers **Year** (annual counts), **Vs usual** (departure from that
place's 1991–2020 mean) and **Trend** (full-record fitted rate). Vs usual
requires all 30 exact annual reference values with equal weight per year.
Year and Vs usual are descriptive and have no significance labels. Trend
uses a fixed Holm family of 772 tests across 193 points and four indices.
Guided references use a separate 40-test family at ten points; live daily
trends use four tests per selected point and period. Period-sensitivity views
adjust across all four indices and all displayed fitted periods.

A/B comparisons retain separate source chains, coverage and uncertainty.
A minus B requires two exact values. Individual zero-trend tests and different
fitted slopes do not establish a statistically tested difference between
places or periods.

### Relationships and vegetation quality

Compound hot/dry counts require `Tmax > 30 °C` and rainfall `< 1 mm/day` on the
same day. They are descriptive and are separate from the four-index trend
family. Soil wetness (`GWETROOT`) is a dimensionless model fraction, not
volumetric water content. Weather and soil share MERRA-2 model inputs.

Monthly relationships pair observations in the same month or with Y one/two
calendar months after X. The analysis uses common matched calendar-month
cohorts and can remove a linear time effect jointly with month effects.
Pearson r is descriptive; no independent-observation p-value, significance
badge or causal claim is made.

MODIS NDVI is aggregated over a 9 × 9 native-pixel area, about 2.085 km per
side. At least 41 of 81 pixels must have good reliability and valid NDVI.
Every scheduled 16-day composite in a month must pass before its monthly
proxy is available. This composite-start aggregation is not a true
day-weighted calendar-month mean. Clouds, snow and quality gaps remain
missing, and the footprint differs from the larger weather grid. Optional
ORNL CSV imports retain their file hash and user-supplied provenance.

### Landscape memory

Memory compares complete three-month rainfall totals, soil wetness and NDVI
with the same calendar month in other years, excluding the target year. At
least ten valid reference years are required. These descriptive ranks are
separate from the fixed 1991–2020 calendar reference.

Dry episodes require two consecutive rainfall-window ranks at or below 0.20.
Rainfall return requires two consecutive months above 0.20. After an observed
soil/greenness low, proxy return requires two consecutive monthly ranks at
least 0.50. Follow-up ends after twelve months, at the record boundary or
before the next episode. Missing observations can withhold precise delays.

For the claim that every dry episode includes both low soil wetness and low
greenness, the response window covers the episode and its next three months.
A counterexample requires one complete eligible response record entirely
above rank 0.20; missing values never count as counterexamples. Cutoff checks
at 0.15/0.20/0.25 are descriptive sensitivity checks. The saved Prague case
covers 2001–2025 with 123 accepted NDVI months out of 300, two counterexamples,
seven episodes with lows in both records and five unresolved episodes.

### Interpretation and reproducibility

Model grid cells are not stations, administrative regions or an interpolated
global surface. Linear fits, selected periods, spatial footprints and
nonrandom missingness limit interpretation. A nonsignificant result does not
prove no change. Correlation and return timing do not establish causation;
NDVI greenness and its return do not establish ecosystem recovery or crop
yield. The app provides historical exploration, not forecasts or attribution.

Saved analyses preserve requests, retrieval dates, units, quality checks and
method versions. Reproduction tools include
[`scripts/build_trend_atlas.py`](scripts/build_trend_atlas.py) and
[`scripts/build_memory_example.py`](scripts/build_memory_example.py).
[`backend/tests/test_expanded_atlas.py`](backend/tests/test_expanded_atlas.py)
independently recalculates atlas fits, uncertainty and the 772-test correction.
Recounting the additional daily points also requires the original local NASA
cache. Automated checks validate specified behavior, not every scientific
interpretation. See [Methodology](docs/METHODOLOGY.md) for full rules and limits.

## Install and run

Python 3.12 and Node.js 22.12+ are required. From the repository root on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
npm.cmd --prefix frontend ci
npm.cmd run dev
```

Skip environment creation if `.venv` already exists. The launcher starts the
backend, waits for readiness and starts the frontend. Press **Ctrl+C** to stop.
For macOS/Linux, use `.venv/bin/python` and `npm` in place of the Windows forms.

- App: http://127.0.0.1:5173
- Backend status: http://127.0.0.1:8000/health
- API documentation: http://127.0.0.1:8000/docs

Local defaults need no `.env`. Configuration examples are in `.env.example`
and `frontend/.env.example`; export backend overrides in the shell or use the
VS Code debug configuration. Vite reads `frontend/.env`. Keep credentials out
of Git and browser-visible `VITE_` variables. [API documentation](docs/API.md)
provides endpoint contracts and deployment configuration.

## Validate and build

```powershell
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test
.\.venv\Scripts\python.exe -m compileall -q backend
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

The multi-stage `Dockerfile` builds the frontend and serves it through FastAPI
on one host. It honors `PORT` (default 8080). For separate frontend/backend
hosting, configure `VITE_API_BASE_URL` and exact backend `CORS_ORIGINS` as
described in [API documentation](docs/API.md).

## License

Copyright 2026 TerraSignal contributors.

TerraSignal's original source code is licensed under the
[Apache License, Version 2.0](LICENSE). Third-party libraries, NASA observations
and map data remain subject to their respective licenses and terms; this
license does not relicense those materials.

See [third-party notices and data credits](THIRD_PARTY_NOTICES.md) for sources
and applicable terms. The frontend also distributes the original browser-library
license texts in [third-party-licenses.txt](frontend/public/third-party-licenses.txt).
