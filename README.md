# TerraSignal

Explore NASA Earth data, detect trends, and understand uncertainty.

NASA Space Apps Challenge 2026 — **Be An Earth System Trend Detective!**

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

The light map workspace supports selecting any point by click, dragging the marker,
or entering coordinates. Selecting a point, variable, or valid period updates the
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

**Daily weather** loads the selected period explicitly, or when starting a daily
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

Click **Compare two places** on the map, select **Point A** or **Point B**, then
click anywhere to move that point. Both labelled markers can also be dragged.
**View daily comparison** opens two records with a synchronized year/metric,
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
NOAA, KNMI and Canadian resources are available in **Data & methods**. NASA POWER
is the connected provider; the other resources open external tools and are not
presented as implemented data integrations. The NASA non-endorsement and
third-party data-use notice is included.

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
