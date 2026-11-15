# API contract

Backend models: `backend/app/schemas.py`. Browser types: `frontend/src/types/api.ts`.
Update both when changing this contract. The backend normalizes provider data
and computes the existing trend and relationship responses. The offline-capable
Memory workspace computes its separately documented descriptive event ranks in
the browser from these normalized observations; it adds no HTTP analysis endpoint.

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

## `POST /api/daily/periods`

Accepts the same validated `DailyTrendRequest` as `/api/daily/trends` and performs
no provider requests. The deterministic windows are the full supplied interval
plus starts in 1991 and 2001 strictly after the supplied start and no later than
its end. No window extends beyond the supplied record; starts are deduplicated
and every window shares the supplied end. Each window reuses only annual records
inside its bounds and the same yearly OLS/HAC(1), completeness and rarity guards.

The response echoes the input location/range and has `periods`, `family_size`,
`alpha` (0.05), and `warnings`. Each period has the `DailyTrendsResponse` shape,
including its own bounds, coverage and all four metric results. Here, nested
`analysis.p_value_holm` and `significant` refer to the whole period/index family,
not a per-period family of four. The family size is four times the number of
windows: normally 12 for a 1981–2025 record, 8 for 1991–2025, or 4 when only the
full selected interval fits. The correction starts from raw two-sided p-values;
null tests keep an internal p=1 slot but publish null tests/decisions.

The UI requests this calculation only when **Compare fitted periods** opens.
Changing year/metric does not retest a selected window or alter the correction
family. Closing the panel or replacing the underlying dataset cancels obsolete
requests; responses must match the location and all predefined windows before
display/export. The period CSV includes every index/window, individual intervals,
raw and family-adjusted p-values, coverage, fitted spans, warnings and all sources.
The original main-chart tests retain their separate four-index correction.
Different slopes or labels across overlapping windows are not a formal test of
differences between slopes; other locations/windows are outside this family.

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

## `POST /api/relationships`

Computes a descriptive relationship from caller-supplied monthly observations;
it does not download data or independently authenticate the supplied provenance.
The Relationships workspace combines matching weather, soil or vegetation
records before calling this endpoint.

| Request field | Contract |
| --- | --- |
| `latitude`, `longitude` | Finite coordinates within normal geographic bounds |
| `start`, `end` | Ordered complete calendar years, from 1981 through the last complete year |
| `x`, `y` | Objects with nonempty `name`, `unit` and `observations` |
| `observations` | At most 6,000 `{date, value}` objects per series; unique first-of-month dates; finite numeric values or null |
| `lag_months` | 0, 1 or 2; Y follows X by this many calendar months; default 0 |
| `month` | X calendar month 1–12, or null for all months; default null |
| `detrend` | Boolean; default true; remove linear elapsed-time trends jointly with calendar-month effects |

Values are bounded to absolute magnitude 1e12 for numerical safety. Duplicate
dates, non-month-start dates, booleans in numeric observations, nonfinite values,
unknown fields, invalid intervals and excessive arrays return 422. Rows outside
the requested interval are excluded with a warning. A missing month is never
replaced with zero or shifted to the next available row.

For example, `month: 6, lag_months: 1` compares June X with July Y in each
available year. Both dates must be inside the selected interval; a December
lag that would enter a later, unrequested year is not an expected pair.

The response echoes point, period, lag and month; `detrended` records the selected
adjustment. It contains `x_name`, `y_name`, `x_unit`, `y_unit`, `method`,
`seasonality`, `warnings`, and:

| Response field | Meaning |
| --- | --- |
| `pairs` | Sorted `{x_date, y_date, x_raw, y_raw, x, y}`; raw values and seasonal/trend-adjusted values remain separate |
| `n_pairs`, `n_years` | Matched pairs and distinct X calendar years |
| `expected_pairs`, `coverage` | Possible calendar pairs within the requested window and matched fraction from 0 to 1 |
| `reference_start`, `reference_end` | Actual paired-cohort span, from the first X year through the last Y year; null without pairs |
| `pearson_r` | Descriptive coefficient from -1 to 1, or null when requirements are unmet or adjusted variation is unusable |
| `p_value`, `ci95` | Always null; no independent-observation significance test or interval is reported |

Reporting `r` requires five distinct years, at least ten all-month pairs or five
same-month annual pairs, 80% of expected pairs, and at least three observations
in every included calendar-month cohort. Constant or numerically negligible
adjusted variation produces null, not a fabricated zero correlation.

The browser checks returned point, period, settings, names, units, original
values and complete calendar pairing against the selected dataset before
display/export. CSV exports retain both source chains, spatial supports,
retrieval dates/origins, raw and adjusted values, missing-pair rows, settings,
coverage and the descriptive-inference limitation. Monthly precipitation totals
are obtained from `PRECTOTCORR` mm/day multiplied by actual calendar-month length,
including leap days, before the relationship is calculated.

## `GET /api/soil`

Query fields are `lat`, `lon`, `start`, `end`, and optional `refresh`. Coordinates
must be valid; years must be ordered, complete and from 1981 onward. Defaults
cover 1981 through the last complete year. Unlike daily and vegetation requests,
one monthly soil request can cover the full selected interval.

The response contains `latitude`, `longitude`, `start`, `end`,
`parameter: "GWETROOT"`, `unit: "1"`, ordered monthly `series` objects
(`date`, `value`), `source`, `source_url`, `retrieved_at`, `data_origin`
(`live` or `cache`) and `warnings`. It represents model root-zone soil wetness
on a dimensionless 0–1 scale, not volumetric moisture in m3/m3. The service
accepts only NASA metadata unit `1`; fill, malformed, nonfinite and out-of-range
observations become null. Annual month-13 summaries are excluded and missing
calendar months remain gaps.

The upstream request uses NASA POWER monthly `GWETROOT`, community `AG`.
Original responses use a separate `soil` cache namespace with a 24-hour fresh
period. `refresh=true` bypasses fresh reuse. Downloads have bounded timeouts,
at most two concurrent slots and one retry for transient HTTP/network errors.
A failed refresh can reuse a valid older original response, preserving its
retrieval time and adding an explicit warning. No monthly-weather snapshot or
simulated fallback substitutes for soil data. Without usable live or saved
soil data the route returns 503; invalid query inputs return 422.

Reference: [NASA POWER hydrology and soil-wetness definitions](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/).

## `GET /api/vegetation`

Query fields are `lat`, `lon`, `start`, `end`, and optional `refresh`. A request
covers one to five ordered, complete calendar years from 2001 through the last
complete year; invalid queries return 422. The browser combines sequential
one-year requests for a longer selection and verifies one consistent footprint
and collection. Earlier selected months have no observations in this API path.

The provider finds Terra `MOD13Q1` collection 061 scenes in the public Microsoft
Planetary Computer catalog and samples their original NDVI/pixel-reliability
COG assets as native numeric NPY crops. Aqua scenes are excluded. Each crop is
9 × 9 native sinusoidal pixels centered on the pixel containing the requested
point (approximately 231.656 m per pixel, 2.085 km per side). Source projection,
cell identity, asset types/scaling and requested extent are validated; nearest
sampling and native projection preserve the original pixel grid. Rendered map
colors are never used as observations.

Original catalog JSON and numeric NPY bytes, including a SHA-256, are cached for
24 hours under `vegetation-pc-v1`. A failed refresh may reuse only a valid
matching saved response with its original retrieval metadata. Up to four
requests run concurrently. Each source request has a 30-second deadline
including queueing, a 20-second read timeout and five-second connect timeout;
these are not a deadline for the whole calendar-year/application batch. Failed
groups cancel unfinished siblings while retaining validated cache entries.
No Earthdata credentials are required by this public path.

The response includes point/period, `product: "MOD13Q1"`, `unit: "NDVI"`,
`series` objects (`date`, `value`, `available_composites`, `expected_composites`),
`spatial_support`, `pixel_size_m`, `nrows`, `ncols`, `collections`, `source`,
`source_url`, `sources`, `retrieved_at`, `data_origin` and `warnings`.
Every entry in `sources` retains its original request URL, retrieval time and
live/cache origin. The summary retrieval time is the oldest source time;
summary origin `live` means at least one batch is live, not that every batch
was newly retrieved. Different grids or collections cannot be silently merged.

Only paired NDVI/quality bands from the same collection are accepted. Raw integer
NDVI in -2000..10000 is scaled once by 0.0001. A pixel must have
`pixel_reliability=0` and a valid mask; at least 41 of 81 crop pixels must pass.
Monthly values
are equal-weight means of every scheduled 16-day composite whose nominal start
date lies in that month. If any scheduled composite is absent or fails the
area-quality threshold, the month stays null. This is a composite-start monthly
proxy, not a day-weighted calendar-month NDVI product.

The numeric Planetary Computer path was verified live for Berlin over
2001–2025. Quality failures remain null, and a successful download need not
provide sufficient coverage to report a correlation. The route returns 503 if
neither live data nor a valid matching cache is available. ORNL subset requests
previously failed with 503/timeouts and are no longer the primary provider.

An alternative browser import accepts the original ORNL
`filtered_scaled_250m_16_days_NDVI.csv`, with the supported `_landcovermask`
suffix. It validates product/band, collection, acquisition/processing dates,
subset coordinates, declared pixel rectangle, scaled values and quality gaps.
The file remains user-provided: its SHA-256 identifies the imported bytes but
cannot authenticate NASA origin or earlier quality filtering. Import time and
filename are retained; an unknown original retrieval date is not invented.
These records keep `data_origin: import` in browser provenance, distinct from
the API's live/cache origins. The original import stays in browser memory for
reprocessing the same point over another period.

References: [Planetary Computer MODIS collection](https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-13Q1-061),
[ORNL MODIS web service](https://modis.ornl.gov/data/modis_webservice.html),
[MOD13Q1 specification and quality fields](https://ladsweb.modaps.eosdis.nasa.gov/filespec/MODIS/61/MOD13Q1),
[ORNL export documentation](https://modis.ornl.gov/documentation.html).
