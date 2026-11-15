# TerraSignal

Explore NASA Earth data, detect trends, and understand uncertainty.

NASA Space Apps Challenge 2026 — **Be An Earth System Trend Detective!**

## Challenge acceptance audit — 2026-11-15

Checked against the [official challenge](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/)
(Details and Resources) and the [author's video](https://www.youtube.com/watch?v=Cd9Q48LhNbo).
The implemented weather workflow covers the required scope within its stated
NASA POWER grid-cell resolution:

| Requirement | Where it is implemented and verified |
| --- | --- |
| Select Earth science variables | Explore offers NASA POWER T2M temperature and PRECTOTCORR precipitation, with definitions and validated units. NASA model outputs are eligible; every listed mission need not be integrated. |
| Select a region and acquire its data | Place accepts map clicks or coordinates worldwide. Each selection represents the surrounding approximately 0.5° × 0.625° weather model cell. NASA requests, retrieval dates and saved-response origins are retained. `test_data.py` checks normalization and original snapshot provenance. |
| Select a sufficiently long period | Explore accepts complete years from 1981 to the last complete year. Short or poorly covered records remain visible without unsupported trend claims. Coverage includes missing edge months. |
| Generate and visualize a time series | Monthly observations and complete day-weighted annual means preserve calendar spacing and gaps. CSV retains observations and provenance. |
| Report how much the variable changes | The point analysis reports rate per year/decade, its 95% interval and fitted change over the actual observed span, also exported to CSV. A rainfall-rate change remains mm/day. |
| Test statistical significance | Seasonal OLS uses a two-sided t reference with HAC(12) uncertainty; Calendar uses yearly OLS/HAC(1). A p-value below 0.05 is interpreted under that model. Missing, insufficient, constant and exact-fit records cannot manufacture inference. `test_analysis.py` and `test_calendar.py` cover known trends and failure cases. |

The video also discusses trends within a season. Explore → Calendar implements
all four calendar seasons and individual months, including previous-December
DJF, with separate trend fits. Guided examples, spatial comparisons, daily
extremes, variable definitions and all 13 official resource links provide the
suggested extensions. Map annual values/departures are distinguished from
long-term trend inference; its 772-test family has an independent numerical audit.

The AOD/wildfire example, AI-assisted discovery, polygon averages, a global
mean, nonlinear models and additional missions are not mandatory. Point results
must not be described as city/country averages; the app does not implement area
averaging. Different local trend estimates do not constitute a statistical test
of their difference. Unresolved trends remain valid investigation results.

Validation: 141 backend tests completed (140 passed; one optional recount needs
all original, ignored NASA response bytes), 83 frontend tests passed, and
TypeScript checking and the Vite production build passed. Browser checks of the
production build covered temperature, precipitation, seasonal and cross-year DJF
records, short/invalid intervals, two-place monthly comparison, the 193-cell map
and a real CSV download with fitted-change metadata. The backend checks used
the bundled Python 3.12 with the existing environment's packages because this
machine's `.venv` launcher points to an unavailable base interpreter.

Scientific model review and a public deployment/demo are separate delivery
steps listed in `docs/TEAM.md`; passing automated checks is not proof that all
model assumptions hold. The audit adds no new data integration or deployment.

## Current state

React + TypeScript frontend, FastAPI backend, validated API contract, local proxy,
development tasks, and a container definition for a single-host deployment.
The first MVP loads real NASA POWER temperature and precipitation series, plots
monthly observations, and estimates a seasonal linear trend with HAC uncertainty.
Daily maxima, minima and precipitation now provide annual hot/frost-day counts,
warm-night proxies and longest within-calendar-year dry runs.
Prague and Medicine Hat include attributed original NASA snapshots for outages.
The interface reports source, retrieval date, data origin, units, and limitations.
The statistics are exploratory and still need the team's scientific review.

The opening **Map** displays the saved 1981–2025 NASA analysis at 193 sampled
grid cells. The latest expansion adds 150 places worldwide, including Arctic,
tropical, inland, Pacific and Antarctic points. Its three views are **Year** (exact annual counts), **Vs usual**
(the selected year's count minus that place's 1991–2020 mean) and **Trend**
(the full-record fitted rate). New map links default to Vs usual; existing
links that explicitly select Year or Trend retain that view.

Vs usual requires all 30 exact annual reference values, with equal weight for
each year, including leap years. One missing reference year withholds the
departure. Map markers, the comparison chart and A minus B all show the same
quantity for the chosen view. Color and size scales stay fixed across places
and animation years. Annual counts and departures are descriptive and receive
no significance label; Trend keeps its fixed 772-test Holm family and separately
labelled individual 95% intervals. The points describe surrounding model cells,
not administrative regions or an interpolated global trend surface.

The map, year slider and animation use the same local archive, so changing
places or years needs no new NASA download. A/B comparison, place shortcuts,
uncertainty, coverage and source notes are available on demand. The interface
uses short functional labels rather than repeated page headlines and taglines.
There is no decorative vegetation overlay on Map.

The opening map uses the separate `trend-atlas-1981-2025.json` archive: 8,685
complete annual rows and 34,740 index values. The reproducible builder is
`scripts/build_trend_atlas.py`. An independent audit in
`backend/tests/test_expanded_atlas.py` checks every fitted line, HAC interval,
raw p-value and the full 772-test correction without calling the production
regression function. When the ignored original NASA cache is available, it also
recounts the 183 additional points from the exact response bytes identified by SHA-256.
The builder reuses completed archived points, checkpoints new downloads, and
replaces the map archive only after every candidate has complete annual counts.
The original ten-point guided-reference archive and its independent 40-test
audit remain unchanged.

The collapsed **Guided examples** section in Explore → Place contains the
one-click findings and three guided investigations. Its cards open Brno × Athens hot-day comparisons, frost-day
declines near Brno/Berlin, and warm-night increases near Athens/Sydney. Each click
sets both points, 1981–2025, the relevant daily metric and highlighted year 2025,
opens comparison and loads the records. Reopening a card restores these settings
after manual exploration. The displayed reference rates are from the saved
2026-11-14 analysis with Holm correction across 40 tests at ten preset points.
The complete analysis and NASA source URLs can be downloaded under the cards;
live chart badges retain their four-test correction per point.

The header has four primary destinations: **Map**, **Explore**, **Connections**
and **Data**. Explore retains Place, Calendar, Days and Compare as secondary
views, including arbitrary-coordinate exploration and live retrieval. Location
and period remain shared across those views. Switching destinations preserves
loaded records, chart selections and map zoom; the Explore destination returns
to its most recently used view. Existing deep links and browser Back/Forward
continue to open the corresponding view. Map links also retain A/B, index,
year and view. Obsolete `atlasLayer` query parameters are removed.

The Explore → Place map supports selecting any point by click, dragging the marker,
or entering coordinates. Scroll the wheel or double-click to zoom, drag to pan,
or expand the map and press Escape to return. Selecting a point, variable, or valid period updates the
analysis automatically; obsolete browser requests are cancelled. The interactive
chart offers monthly observations and day-weighted annual means (complete years
only); both views retain the original monthly trend analysis. Hover or use arrow
keys to inspect values. Download CSV exports include NASA source and retrieval
metadata. The map uses Leaflet and attributed OpenStreetMap tiles; NASA remains
the source of the environmental observations.

Three guided investigations explore daily frost counts near Prague, daily dry
runs near Medicine Hat, and a remembered year's temperature departure.
The calendar workspace has a year slider, twelve month selectors and four
cross-year-aware seasonal views. Temperature departures use a fixed 1991–2020
reference independently of the selected analysis window. Precipitation totals
use actual calendar-month lengths, including leap days. Missing months remain
gaps. Daily indices are computed from a separate daily NASA POWER connection.

**Explore → Days** loads the selected period explicitly, or when starting a daily
guided question. Progress, cancellation and retry are available for cached
five-year batches. Select one of four index cards and move its year slider to
inspect counts, coverage and dry-run dates. Exact annual indices require all
relevant days; incomplete years retain labelled observed lower bounds. Dry runs
are clipped to each calendar year, and warm nights use daily Tmin > 20 C as a
proxy. Annual-index and raw daily CSV downloads retain provenance and thresholds.
The four annual indices also have descriptive linear trends in days per decade,
individual 95% confidence intervals and two-sided HAC(1 annual lag) p-values.
Significance badges use Holm correction across the four indices at the selected
point and period. At least 20 complete years and 80% coverage are required;
internal gaps, constant or exact-line records, and fewer than five nonzero years
withhold inference. Trend cards, a fitted line and a separate trend CSV retain
the distinction between an unresolved trend and an absence of change.

**Compare fitted periods** in Days and each daily comparison point
checks how the selected index depends on the fitted window. The full loaded
interval and available starts in 1991/2001 share an end year. Each shows its rate,
individual interval, actual coverage and significance corrected across all four
indices and all displayed periods. It uses loaded annual values without another
NASA download, opens on request, and exports every period/index with provenance.
Short, incomplete and sparse records retain the daily model's safeguards;
different slopes alone are not a test of a difference between periods.

Click **Compare two places** on the map, select **Point A** or **Point B**, then
click anywhere to move that point. Both labelled markers can also be dragged.
**Explore → Compare** opens two records with a synchronized year/metric,
the same requested period, and a shared vertical scale. Counts, trend rates,
individual intervals, adjusted p-values and coverage remain separate per point.
The annual table reports A minus B only for two exact values; the comparison CSV
retains both source chains, lower bounds and missing values. Nearby points can
share a NASA grid cell. Example city points are optional shortcuts; arbitrary
map clicks need no preset. Only Prague and Medicine Hat have monthly snapshots.

The monthly comparison uses the same A/B pair, variable and period, with its
existing independent chart scales. At either resolution, individual zero-trend
tests do not constitute a test of the difference between the two places.

Variable definitions, p-value/interval explanations and the challenge's NASA,
NOAA, KNMI and Canadian resources are available in **Data**. NASA POWER
is the connected provider; the other resources open external tools and are not
presented as implemented data integrations. The NASA non-endorsement and
third-party data-use notice is included.

## Connections between variables

**Connections** investigates overlapping hot and dry days, temperature versus
rainfall, rainfall versus root-zone soil wetness, and rainfall versus vegetation.
The compound index counts days with Tmax > 30 C and precipitation < 1 mm/day;
exact annual counts require both observations on every calendar day. Partial
records retain observed lower bounds and never become complete annual values.

Soil wetness uses real NASA POWER `GWETROOT` data on the MERRA-2 grid, with original
responses cached separately. This dimensionless model wetness fraction is not
volumetric water content. Weather and soil come from the same modelling system.

Relationships can pair the same month or Y one/two calendar months after X.
Choose a single month across years or all monthly departures, and optionally
remove linear trends jointly with month effects. Pearson r is descriptive:
no independent-observation p-value, significance badge or causal claim is made.
Matched/raw CSV exports retain both source chains, conversion rules, settings,
coverage, adjusted values and missing observations.

MODIS MOD13Q1 collection 061 NDVI is loaded numerically through the public
Microsoft Planetary Computer API, using original NDVI and pixel-reliability COG
assets. Each observation is a quality-filtered 9 × 9 native-pixel area around
the selected point, about 2.085 km on each side. At least 41 of 81 pixels must
have reliability flag zero and valid NDVI; every scheduled composite in a month
must pass before that month's proxy is available. Clouds and missing scenes
remain gaps. The smaller footprint is labelled separately from the weather grid.
A complete 2001–2025 request at Berlin was verified against the live service;
this verifies retrieval, not complete quality coverage or an eligible correlation.
ORNL's failing subset service is no longer the primary download path.

Choosing the NDVI mode does not change the selected period. Clicking **Load
NDVI** can move a pre-2001 start to 2001; CSV imports retain their validated
requested period. The browser downloads one year at a time and reports elapsed
seconds and completed years. Each year requires a catalog request and the
available nominal 16-day scenes. Up to four source requests run concurrently,
with a 30-second per-request deadline including queueing, a 20-second read
timeout and five-second connection timeout. This is not a whole-download
deadline. Validated catalog JSON and original numeric NPY bytes are cached for
24 hours; a source outage may reuse matching saved data with their original
retrieval dates. Retry retains completed source responses.

An original ORNL `filtered_scaled_250m_16_days_NDVI.csv` export can also be imported
locally. The parser checks product, collection, scaled values, coordinates and
quality gaps; it retains the file SHA-256 and labels the origin as user supplied,
not independently authenticated. The original text stays in browser memory to
support period changes. ORNL export tools may require an Earthdata Login.

## Project layout

| Path | Purpose |
| --- | --- |
| `frontend/src/` | App, visual components, API client, and browser types |
| `backend/app/routes/` | Validated HTTP endpoints |
| `backend/app/services/` | NASA data, caching, normalization, seasonal trend analysis |
| `backend/data/snapshots/` | Original NASA responses, request URLs, dates and checksums |
| `backend/tests/` | Data normalization, outage fallback and known-trend checks |
| `backend/app/schemas.py` | Shared response contract on the backend |
| `docs/API.md` | API fields and NASA implementation checklist |
| `docs/TEAM.md` | Ownership, milestones, and remaining connections |
| `.vscode/` | Project interpreter, development tasks, and backend debugger |

## Install (Windows PowerShell, repository root)

Python 3.12 and Node.js 22.12+ are required. Each teammate creates their own `.venv`;
the environment and `node_modules` are excluded from Git.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
npm.cmd --prefix frontend ci
```

If `.venv` already exists, skip the first command. The explicit interpreter path
also works without changing PowerShell's execution policy or activating a shell.
`backend/requirements.txt` lists direct dependencies; `requirements.lock.txt` and
`frontend/package-lock.json` pin the verified installation for the whole team.

## Run

In VS Code, open a new terminal in the repository root and run:

```cmd
npm run dev
```

This starts the backend first, waits until it is ready, then starts the frontend.
Press **Ctrl+C** to stop both servers. Node.js must be installed and available on
the terminal's PATH. If PowerShell blocks npm scripts, use `npm.cmd run dev`.
On Windows, a lightweight watcher restarts the backend process tree after changes
to `backend/app/`, forwarding its logs without sending console interrupts to npm
or Vite. Backend test-file edits do not restart the application.

To run the servers separately, use **Terminal > Run Task > Dev: all**, or two terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --reload-dir backend --host 127.0.0.1 --port 8000
```

```cmd
npm run dev:frontend
```

The frontend can also be started with `npm run dev` from `frontend/`.

- App: http://127.0.0.1:5173
- Backend status: http://127.0.0.1:8000/health
- API documentation: http://127.0.0.1:8000/docs

For macOS/Linux, use `.venv/bin/python` and `npm` instead of the Windows commands.

## Configuration

Local defaults work without an `.env` file. `.env.example` documents backend
configuration; `frontend/.env.example` documents browser configuration. To load
backend overrides from a root `.env`, export them in the shell or use VS Code's
backend debug configuration. Frontend Vite loads its own `frontend/.env` file.
Never put credentials in `VITE_` variables or commit `.env` files.

## Validate and build

```powershell
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test
.\.venv\Scripts\python.exe -m compileall -q backend
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

## Deployment without a custom domain

The included multi-stage `Dockerfile` builds the frontend and serves it through
FastAPI on one host. A hosting provider's generated HTTPS address is sufficient;
the unsuccessful domain claim does not block the demo. The app honors `PORT`
(default 8080). The Docker image still needs to be built and tested before hosting.

If deploying frontend and backend separately, configure `VITE_API_BASE_URL` and
the backend's exact `CORS_ORIGINS` as described in `docs/API.md`.

## Next step

Follow `docs/TEAM.md`. Jakub improves the interface, Matej owns backend reliability
and extensions, and Terka independently reviews the model and interpretation.

## Data and analysis

No API key is needed for the implemented public NASA POWER calls. Live responses
are cached locally for 24 hours; the interface can explicitly refresh them.
On an outage, only a matching saved response is used and clearly labeled.
The bundled snapshots cover both preset points, both variables, and 1981-2025.
Annual summaries (NASA month 13) are excluded. Missing monthly observations remain
null. Precipitation is a mean daily rate in mm/day, not a monthly rainfall total.
See `docs/METHODOLOGY.md` for statistical assumptions and verification limits.
