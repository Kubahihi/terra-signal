# API contract

Backend models: `backend/app/schemas.py`. Browser types: `frontend/src/types/api.ts`.
Update both when changing this contract. Frontend owns presentation; backend owns
data cleaning, units, aggregation, and statistical results.

## Available now

- `GET /health` and `GET /api/health`: service status, name, version.
- `GET /docs`: interactive OpenAPI documentation.
- `GET /api/series`: real monthly NASA data and exploratory trend analysis.
  Returns 503 if neither NASA nor matching saved data can satisfy the request.
- `GET /api/calendar`: fixed-reference temperature departures, calendar-month and
  seasonal aggregates, and yearly-aggregate trends. Uses the same query parameters
  and validation as `/api/series`, including `refresh`.
- `GET /api/daily`: daily maxima, minima and precipitation plus annual hot/frost
  counts, warm-night proxies and longest within-year dry spells. Requests are
  bounded to at most five whole years per batch.

Example request:

```text
/api/series?lat=50.0755&lon=14.4378&variable=T2M&start=1981&end=2025
```

`lat`: -90 to 90; `lon`: -180 to 180; `variable`: `T2M` or `PRECTOTCORR`;
`start` and `end`: 1981 through the previous complete year, `start <= end`.
These are project request limits; they do not guarantee that every NASA variable
has complete coverage throughout the requested interval.
Use `refresh=true` to bypass a fresh cache. A clearly labeled saved response may
still be returned if NASA is unavailable.

## Successful response

| Field | Meaning |
| --- | --- |
| `source` | Human-readable source, including dataset/version where available |
| `variable` | NASA parameter identifier |
| `unit` | Actual units from provider metadata |
| `latitude`, `longitude` | Requested point coordinates |
| `start`, `end` | Requested year range |
| `series` | Ordered monthly `{date: "YYYY-MM-01", value: number or null}` records |
| `warnings` | Human-readable data-quality and coverage limitations |
| `analysis` | Exploratory seasonal OLS/HAC result, or null if data are inadequate |
| `source_url` | Original public NASA request URL |
| `retrieved_at` | UTC retrieval timestamp of the actual response used |
| `data_origin` | `live`, `cache`, or `snapshot` |

`analysis` contains `method`, `slope_per_year`,
`slope_per_decade`, `ci95_per_decade` (two bounds or null), and `p_value` (or null).
It also reports `sample_size` and `hac_lags`.
The confidence interval refers to **the slope per decade**, not individual
observations or a forecast interval. Undefined statistics must be null, never NaN.

## Calendar investigations

`/api/calendar` returns the requested `start` and `end`, location, variable,
`original_unit`, output `unit` (`C` or `mm`), provenance fields, `warnings`,
`baseline_start`/`baseline_end`, `normals`, and `periods`. The temperature reference
is always 1991–2020; the provider request independently covers that interval and
the previous December, even for a single-year display. Precipitation fetches the
requested years plus the preceding December without a temperature reference.

`normals` contains one temperature reference per calendar month: `month`,
`value`, `available_years`, `expected_years` (30). This app requires all 30
nonmissing values in that month; otherwise the normal is null. Precipitation has
an empty normal list and null baseline dates.

Each of the 17 `periods` has an `id` (`year`, `djf`, `mam`, `jja`, `son`, or
`m01`–`m12`), `label`, `months`, `crosses_year`, `points`, `analysis`, and warnings.
Each point has `year`, `value`, `baseline_value`, `anomaly`, `available_months`,
and `expected_months`. A value requires all months. Temperature means and their
reference use the target year's actual day counts; precipitation sums each
monthly rate times the actual days in that month. Anomalies are temperature minus
the same-period reference. Incomplete current or reference values never become
zeros or a shorter baseline.

DJF labelled 2025 contains December 2024, January 2025 and February 2025.
DJF 1981 is incomplete because this app's monthly archive starts in January 1981.
Labels use calendar months, independent of hemisphere.

Calendar `analysis` has the trend fields described above plus `lag_unit: "years"`.
It fits one complete aggregate per year with OLS and one annual HAC lag, a small
sample correction and t-based inference. Minimum quality thresholds are ten
complete years and 80% of the requested years. Internal missing years withhold
the interval and p-value while preserving the elapsed-time slope. Constant values
have no significance claim. The model is distinct from the monthly seasonal
regression in `/api/series`.

## Daily records and annual indices

`/api/daily?lat=50.0755&lon=14.4378&start=2021&end=2025` requests three NASA POWER
Daily parameters together: `T2M_MAX`, `T2M_MIN` and `PRECTOTCORR`, using AG and
explicit `time-standard=LST`. `start` and `end` are whole years from 1981 through
the previous complete year; `start <= end` and a maximum of five years are
required. Both default to the previous complete year. `refresh=true` bypasses a
fresh daily cache, with a clearly labelled saved daily response as outage fallback.

The response has location/period, `time_standard`, `thresholds`, `daily`, `years`,
provenance fields and warnings. `daily` has one record per expected date:
`date`, `tmax`/`tmin` in C, `precipitation` in mm/day. Missing/invalid values are
null. Negative precipitation and inconsistent maximum/minimum pairs are excluded.
Unexpected units or a different day basis are rejected.

Each yearly record has `year`, `expected_days` (365/366), and four index objects:

| Field | Definition |
| --- | --- |
| `hot_days` | Count of daily Tmax strictly greater than 30 C |
| `frost_days` | Count of daily Tmin strictly less than 0 C |
| `warm_nights` | Count of daily Tmin strictly greater than 20 C; daily-minimum proxy |
| `longest_dry_spell` | Maximum consecutive dates with precipitation strictly less than 1 mm/day, clipped to this calendar year |

Every index contains `value`, `observed_count`, `available_days`. `value` is an
exact annual count/length only if all relevant daily observations are valid;
otherwise it is null. `observed_count` is the count, or longest known continuous
run, in available data and is a lower bound. A missing rain day interrupts a run.
Completeness is checked independently for Tmax, Tmin and precipitation.

Dry-spell objects also contain `start_date`, `end_date`, and
`touches_year_boundary`. On equal-length runs, the earliest is returned. A zero
run has null dates. A run reaching January 1 or December 31 can extend into an
adjacent year, but its reported length remains clipped. These are explicit app
definitions, not a claim of implementing every convention of a named climate index.

The browser queues aligned five-year requests (1981–1985, …), at most two per
point at once, and trims the received records to the selected display interval. Loads
start explicitly or from a daily guided investigation. Changing location/period
aborts the queue and requires a new load. Failed batches are listed and retryable;
their years remain gaps, distinct from actual zero-day counts.

Daily cache files are separate from monthly data. Source URLs, retrieval dates,
origins, thresholds and completeness rules are preserved in annual-index and raw
daily CSV exports. Daily responses have `live` or `cache` origin; monthly
snapshots are never used as substitutes.

## `POST /api/daily/trends`

Fits trends across the selected full period after the browser has merged its
daily batches. This calculation performs no NASA requests and does not refit
when the highlighted year or active metric changes. Its body has `latitude`,
`longitude`, `start`, `end`, and `years`: the annual objects returned by
`GET /api/daily`, trimmed to the selected interval. Missing responses may be
omitted and incomplete index values must remain null, not observed lower bounds.
It analyzes the caller-supplied annual values; the endpoint does not independently
authenticate their NASA provenance or rederive them from individual days.

Coordinates must be finite and within normal latitude/longitude bounds. Years
must form an ordered interval from 1981 through the last complete year. Annual
records must be unique and inside this interval. `expected_days` must match
365/366, `observed_count <= available_days <= expected_days`, and any nonnull
`value` must equal `observed_count` with full daily coverage. Invalid requests
return 422. There are at most 200 annual records per request.

The response echoes the point and period and contains `method`, `correction`,
`family_size` (always 4), `alpha` (0.05), `minimum_years` (20), `warnings`, and
`metrics`, keyed by the four daily index names. Each metric reports complete,
expected and nonzero year counts, the first/last complete year, `analysis`, and
metric-specific warnings.

`analysis` contains the common trend fields (`slope_per_year`, `slope_per_decade`,
`ci95_per_decade`, raw two-sided `p_value`, `sample_size`, `hac_lags`), plus
`lag_unit: years`, `reference_year`, `intercept`, `p_value_holm` and `significant`.
The fitted value is `intercept + slope_per_year * (year - reference_year)`.
Slopes and slope intervals use days per year/decade; the intercept uses days.
Fits are descriptive within the complete-year span, without extrapolation.

Each trend needs at least 20 exact annual values and 80% of requested years.
Incomplete indices and unavailable responses are excluded separately per metric.
Internal gaps preserve real year spacing for the slope but withhold intervals
and tests. A constant index has slope zero and null inference; exact-line records
or fewer than five nonzero years also have null inference. Missing edge years
are disclosed along with the actual fitted span. Other years are not imputed.

Inference uses OLS with Bartlett HAC(1 annual lag), finite-sample covariance
correction, and a Student-t reference with n-2 degrees of freedom. Holm correction
always keeps all four prespecified slots; unavailable tests occupy p=1 only
internally for the correction and keep null published p-values/decisions.
`significant` is true only for an available adjusted p strictly below 0.05,
false for an available unresolved test, and null when no test is available.
The displayed 95% intervals are individual, not simultaneous; a zero-excluding
interval may coexist with an unresolved Holm-corrected test. Changing location
or period defines another exploratory family not covered by this correction.

`Download trends` exports all four rates, individual intervals, raw/adjusted
p-values, three-state decisions, coverage, fitted spans, method and provenance.

The daily comparison uses the same endpoints for A and B independently, with
shared bounded browser cache (64 batches). Changing either coordinate or period
cancels obsolete daily/trend requests and hides results from another selection.
Hiding comparison cancels B's queue; partial failures retain successful batches
for retry. The daily charts share a scale including both series and fitted
values, with a shared year/metric selection. Comparisons use the same requested
interval; each fit still reports its actual complete-year span and coverage.

The comparison CSV has four rows per requested year, one per index. It includes
both exact/observed counts, valid/expected days, A-minus-B (only if both exact),
both trend rates, individual intervals, raw/Holm p-values, decisions, fitted
spans and warnings. Both coordinates and all source URLs/retrieval dates/origins
are retained. Absent values and inference stay blank, distinct from true zero.
Holm correction remains four tests per point; neither the arithmetic annual
difference nor different significance labels is a between-location trend test.

## NASA provider and next backend work

`fetch_monthly_series()` in `backend/app/services/nasa_power.py` now implements:

1. Request `NASA_POWER_URL` from config, with the requested point, parameter,
   start/end years, community, and JSON format. Use a bounded timeout.
2. Preserve the source metadata and retrieve units and missing-value marker.
3. Accept monthly keys ending in 01-12. Do not parse an annual aggregate as month 13.
4. Normalize missing/non-finite observations to null, preserve gaps, sort dates.
5. Report actual coverage and distinguish a model grid cell from a weather station.
6. Handle provider errors without returning fabricated data or exposing credentials.
7. Return source provenance and explicit cache/snapshot origin. The route then
   estimates an exploratory trend using `services/analysis.py`.

Matej: extend this entry point rather than creating a second provider. Next
priorities are cache/rate-limit behavior under load and any additional locations
or variables the team agrees to support. Coordinate statistical changes with Terka.

Reference: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/

## Local connection

The browser calls `/api/*`. Vite forwards these requests to `127.0.0.1:8000`.
For separate production hosts, set `VITE_API_BASE_URL` at frontend build time and
allow the exact frontend origin in backend `CORS_ORIGINS`.
