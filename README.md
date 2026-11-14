# TerraSignal

Explore NASA Earth data, detect trends, and understand uncertainty.

NASA Space Apps Challenge 2026 — **Be An Earth System Trend Detective!**

## Current state

React + TypeScript frontend, FastAPI backend, validated API contract, local proxy,
development tasks, and a container definition for a single-host deployment.
The first MVP loads real NASA POWER temperature and precipitation series, plots
monthly observations, and estimates a seasonal linear trend with HAC uncertainty.
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

In VS Code: **Terminal > Run Task > Dev: all**. Alternatively use two terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --reload-dir backend --host 127.0.0.1 --port 8000
```

```powershell
npm.cmd --prefix frontend run dev
```

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
