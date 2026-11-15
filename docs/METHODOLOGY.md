# MVP methodology and review checklist

## Data

NASA POWER Monthly and Annual API, AG community, MERRA-2-based meteorology.
The implemented point parameters are T2M (temperature at 2 m, C) and PRECTOTCORR
(corrected precipitation, mm/day). Units come from each response's metadata.
Monthly precipitation is a mean daily rate; it is not a monthly total.
The provider must report `C` for T2M and `mm/day` for PRECTOTCORR. Unsupported
units are rejected before analysis or caching. Negative precipitation rates are
invalid and remain gaps; a genuine zero remains an observation.

Only calendar months 01-12 are observations. Annual summary keys ending in 13
are excluded. Missing values, fill values, non-finite values, and absent months
remain null. The graph preserves gaps. The requested coordinates represent a
model grid cell, not a station measurement or a whole administrative region.

Live responses are cached for 24 hours. If NASA fails, a matching original cache
or checksummed preset snapshot is used, with its actual retrieval timestamp and
origin exposed in the UI. No synthetic fallback is used. Snapshot request URLs,
dates and SHA-256 checksums are in `backend/data/snapshots/index.json`.

Reference: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/

## Chart aggregation

The default annual view calculates a day-weighted mean of the 12 monthly values,
using the actual number of days in each month, including leap years. A year with
any missing month is omitted and shown as a gap. Annual precipitation retains
mm/day as its unit; it is not converted into an annual total. Hover and keyboard
inspection show the actual displayed mean or monthly value. Switching chart views
does not change the trend model, which always uses the original monthly record.

## Model

For available monthly values, estimate:

`value = intercept + slope * elapsed_years + calendar_month_effect + residual`

Elapsed time uses the actual calendar-month index; gaps never compress the time
axis. Eleven month indicators plus an intercept control for fixed seasonality.
OLS estimates the slope. Statsmodels HAC covariance uses 12 monthly lags, a small
sample correction, and t-based inference. The confidence interval and reported
rate are both expressed per decade (multiply the annual slope/bounds by 10).

This is exploratory linear trend detection, not a forecast or causal attribution.
HAC is an asymptotic robustness method; it does not remove every possible source
of dependence or model misspecification. The lag choice is a documented starting
point that still needs sensitivity checks.

MVP quality thresholds: at least 60 available observations over five years, all
12 calendar months represented, and at least 80% coverage across the full
requested monthly window, including missing edge months. These are product
heuristics, not universal scientific sufficiency rules. Missing edge months
are disclosed with the actual first and last months used in the fit.
If internal months are missing, show the slope but withhold the HAC interval and
p-value because its lag spacing would no longer represent contiguous months.
Constant series have slope zero and no significance claim. Records explained
exactly by the seasonal model (maximum absolute residual at most 1e-10) retain
their descriptive slope but withhold inference: numerical residuals do not
constitute measured variability. Nonfinite or zero-variance uncertainty is also
withheld. This is consistent with the exact-line guard in daily-index analysis.

A p-value below 0.05 is interpreted only under this model. A nonsignificant result
does not demonstrate an absence of change. Searching many regions/periods for
small p-values can introduce selection and multiple-comparison problems.

The interface labels p < 0.05 as significant only when the model also provides an
uncertainty interval. Missing inference is labelled unavailable. Coverage is the
number of nonmissing observations divided by the full requested number of months.
Rates and confidence bounds are displayed per decade; the annual rate is also
shown. CSV exports preserve unrounded rates, interval bounds, p-value, sample
size, units, provenance, period and warnings alongside the original monthly data.

The result panel and monthly CSV also show **fitted change**: the annual slope
times elapsed calendar months / 12 between the first and last available
observations. The selected window is never substituted for missing edge data.
The 95% slope bounds are scaled by the same positive elapsed time. This measures
the linear trend component with the seasonal cycle held fixed, not the observed
endpoint difference or a forecast. For precipitation its unit remains mm/day;
it is a change in mean daily rate, never accumulated rainfall. A zero estimate
stays zero, and unavailable uncertainty remains unavailable.

## Local questions: reference, seasons and totals

The calendar investigation uses separate arithmetic means of January values,
February values, etc., for 1991–2020. The application conservatively requires all
30 observations per reference month. This is an app completeness rule, not a
claim of formal WMO normal certification. Changing the display or trend interval
never changes this reference. Data are requested over the union of the analysis
interval and the reference, including the preceding December when available.

For a selected month/season/year, temperature and reference are both weighted
by that target year's actual days per month. The departure is their difference
in °C. A January is compared with January normals, never all-month means. Missing
observations or reference months yield null departures. A departure is a
difference, not an event probability or an extreme-event attribution.

Precipitation totals are sums of `monthly mean daily rate × actual days in that
month`, in mm. Leap February uses 29 days. Complete annual totals are therefore
not `monthly mean × 12`. A zero precipitation value remains a real zero; any
missing/negative month invalidates the affected total instead of yielding a
partial sum. The original monthly chart retains its mm/day units.

Calendar periods are `year`, DJF, MAM, JJA, SON and individual months. DJF is
December of the previous year plus January–February of the labelled year.
Thus DJF 1981 is a gap, since this application's archive starts in January 1981.
Calendar-month labels avoid assigning northern seasons to southern locations.

Each period's trend fits its complete yearly aggregates on actual year labels,
using OLS, one annual HAC lag, a small-sample correction and t-based inference.
At least ten complete years and 80% completeness across the requested window are
app thresholds. An internal gap withholds HAC confidence and p-value because row
lags would no longer be calendar-year lags. Constant records yield a zero slope
without a significance claim. Exact lines (maximum absolute residual at most
1e-10) also retain only descriptive rates, matching the monthly and daily
safeguards. This does not replace the all-month seasonal model.
The year slider highlights an observation without refitting the trend.

Daily hot/frost-day counts, warm-night proxies and consecutive dry-day lengths
are calculated in the separate daily layer described below. They are not inferred
from these monthly aggregates. Soil-wetness and NDVI relationships are described
separately below. Formal comparisons of multiple period-specific slopes remain
future work.

References: [NASA POWER monthly data](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/),
[NASA POWER grid resolution](https://power.larc.nasa.gov/docs/services/).

## Daily weather indices

Daily NASA POWER `T2M_MAX`, `T2M_MIN` (C) and `PRECTOTCORR` (mm/day) are retrieved
with explicit Local Solar Time (LST), independently of the monthly provider.
Only complete calendar years are requested. LST is not a city's civil timezone
or daylight-saving-time convention. Daily minima above 20 C are used as a proxy
for warm nights, not as nighttime-only hourly minima.

The four annual metrics are strictly `Tmax > 30 C`, `Tmin < 0 C`, `Tmin > 20 C`,
and the longest continuous sequence of dates with `precipitation < 1 mm/day`.
Equality at the threshold does not qualify. The dry index is calculated within
each calendar year, so a continuous sequence crossing December/January is split.
Runs touching year boundaries are flagged; on ties, earliest dates are shown.
This is the app's documented definition, not an unqualified implementation of
all formal CDD/ETCCDI conventions.

All 365/366 relevant observations are required to publish an exact annual value.
The check is per metric: a missing maximum can withhold hot-day counts without
invalidating an otherwise complete precipitation index. Missing/invalid daily
values remain null; negative rainfall and Tmax < Tmin pairs are excluded.
Observed threshold counts and uninterrupted runs in incomplete years are lower
bounds, never scaled to a full year. Missing rain interrupts a dry run rather
than bridging it or treating it as a wet or dry observation. A genuine zero is
distinct from an unknown value or an unavailable response.

The browser requests cached, aligned five-year batches with no more than two
in flight per point, shows progress and supports cancellation/retry. The server further
limits concurrent upstream requests, spaces starts and retries a transient
failure once. Fresh daily cache lasts 24 hours; stale daily data can be used on
outage with original retrieval metadata and a warning. No monthly snapshot can
stand in for a daily record. Unavailable batches are shown as gaps, with no
inferred counts. The initial default page does not automatically download daily
data for every map interaction.

The daily chart shows annual index values and an optional fitted linear trend.
Annual indices, normalized daily values and a separate trend table can be exported, retaining
thresholds, day basis, source URLs, retrieval dates and coverage. Raw day flags
remain blank when their required observation is missing.

Reference: [NASA POWER Daily API and time standards](https://power.larc.nasa.gov/docs/services/api/temporal/daily/).

### Trends in daily indices

The unit of analysis is one complete annual count or within-year maximum dry-run
length, not an individual day. Each of the four indices is fitted separately as
`index = intercept + slope * (year - first_complete_year)`. The slope is reported
in days per decade. The backend analyzes the same merged annual records shown
in the browser; no new NASA download is needed. Highlighting another year or
switching metrics does not change the fitted period or the four-test family.

For this daily layer we require at least 20 complete annual values and 80% of
the selected years. These are application safeguards, not a universal guarantee
of calibrated inference. Null indices and their observed lower bounds never
enter the fit. Missing edge years are disclosed and the actual fitted span is
reported. Internal missing years do not get compressed into adjacent annual
observations: the slope uses their real years, while intervals and p-values
are withheld. Missingness can still bias the descriptive slope.

Uncertainty uses OLS with Bartlett Newey-West HAC at one annual lag, covariance
correction n/(n-2), a Student-t reference with n-2 degrees of freedom, and a
two-sided slope-against-zero test. The 95% slope interval is individual. Counts
and annual maximum run lengths are discrete, bounded and sometimes skewed or
zero-heavy, so this linear model is an approximation, not a count likelihood,
forecast or causal model. A single HAC lag cannot cover arbitrary longer-term
dependence. Rare records (fewer than five nonzero years), constant indices and
numerically exact lines retain descriptive rates but withhold inference. Zero-heavy
records with enough nonzero years carry an additional approximation warning.

All four prespecified indices at the same point and period form one family.
Holm step-down adjustment is applied to their raw p-values. Unavailable tests
keep their family slot using an internal p=1, but their published p-values,
intervals and decisions remain null. Significance badges use adjusted p < 0.05
and take their direction from the estimated slope, even if it contradicts the
question. An unresolved result does not establish an absence of change.
Individual 95% intervals are explicitly not simultaneous Holm intervals, so
they can exclude zero while the adjusted significance badge remains unresolved.
This correction does not cover searches across other locations, periods or the
monthly investigation views. Models and lag sensitivity still need scientific review.

The fitted line is limited to the first/last complete year, with any portions
outside the physical chart bounds clipped. It is not extrapolated into a future
forecast. The dry-spell definition remains clipped to each calendar year and
warm-night counts retain their daily-minimum proxy interpretation.

Implementation references: [statsmodels HAC inference](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLSResults.get_robustcov_results.html),
[statsmodels Holm adjustment](https://www.statsmodels.org/stable/generated/statsmodels.stats.multitest.multipletests.html).

### Period sensitivity of annual daily indices

The optional period panel uses the full loaded interval and predefined starts in
1991 and 2001 that fall strictly inside that record (or at its end). All windows
share an end year and use only exact annual indices from the supplied dataset.
This is a descriptive sensitivity check, without choosing windows in response
to p-values or extrapolating a missing early/late record. The 20-year/80% guards,
independent per-index completeness, missing-year spacing, and constant/sparse
inference rules apply separately to every window.

One Holm family contains all four indices across all included windows. Missing
tests retain their slots with internal p=1 and publish null inference. For the
default 1981–2025 record the family has 12 tests; a shorter source interval may
support fewer predefined windows. This is a separate correction from the main
chart's four tests at one point. Intervals remain individual 95% intervals, not
simultaneous intervals. Overlapping windows are dependent; Holm does not require
independent tests, but the underlying HAC p-values remain approximate.

Different estimated rates or significance labels across windows do not by
themselves test a change in slope. No between-period contrast, breakpoint search,
causal claim or adjustment over other map points is made. Reusing loaded annual
indices avoids another NASA request. Exports preserve the entire period/index
family, missing inference, actual fitted spans and original source provenance.

## Spatial comparison and guided investigations

The compact interface has four primary destinations: Map, Explore, Connections
and Data. Explore keeps Place, Calendar, Days and Compare as secondary
views, preserving their shared state and existing deep links. Map is one
workbench with a collapsible A/B comparison; place shortcuts, uncertainty,
coverage and sources are disclosed on demand rather than repeated beside the
map. Short functional controls replace repeated headline/tagline blocks.
This reorganization does not change an index definition or statistical family.

The opening Map visualizes the fixed 193-point, four-index 1981–2025
archive in `frontend/public/data/trend-atlas-1981-2025.json`. It contains 8,685
complete annual rows and 34,740 exact index values. The reproducible builder
`scripts/build_trend_atlas.py` retains the original ten reference points and
adds 183 coordinates fixed before acquisition and examination of this scan.
The latest expansion adds 150 points to the previous 43-point archive across
all seven continents, including Arctic and Antarctic samples. Previously
acquired annual counts and source provenance are retained; scan-wide Holm
correction is recomputed over all 193 candidates. Completed points are reused
on subsequent builds; incomplete acquisition does not replace the map archive.
The original guided-reference file remains unchanged. **Year**, **Vs usual**
and **Trend** are separate views. New links
default to Vs usual; explicit legacy Year/Trend links keep their view. Moving
the year never refits or relabels a 45-year trend. Counts require complete annual
coverage, retain true zeros, and leave unavailable years as gaps.

For point p, index m and year y, Vs usual is:

`departure(p, m, y) = annual_count(p, m, y) - mean(annual_count(p, m, 1991:2020))`

All 30 reference years must have exact complete annual values. A single missing
reference year withholds the whole reference and every departure using it;
there is no averaging over 29 years. Each year has equal weight. Leap-year
counts are retained as annual counts, without daily-rate conversion, day
weighting or normalization to 365 days. A missing selected-year count also
withholds its departure. This reference is separate from Calendar's monthly
temperature normals and from the matched-cohort references in Connections.

In Vs usual, map markers, A/B chart values and A-minus-B use the same departures.
Thus the difference compares deviations from each place's own reference, not
their raw annual count difference. Year uses raw exact counts throughout;
Trend uses full-record rates, with the accompanying chart labelled as annual
counts. Annual counts, departures and their arithmetic differences are
descriptive; no significance or uncertainty claim is inferred from their color.

For each index/view, the marker scale is shared across all 193 points and stays
fixed across all animation years. Circle area above a small selectable center
is proportional to magnitude. A blue–neutral–red scale encodes signed trend
rates or departures; raw counts use a sequential light-to-red scale. Point
colors and gradient legend use the same scalar interpolation and fixed domain.
A dashed outline marks unresolved/unavailable trend inference only. Missing
values retain a separate neutral treatment. The A/B chart uses common vertical
limits for both points, with symmetric positive/negative limits for departures
and calendar-year spacing that preserves gaps. The atlas does not interpolate
between these sampled cells or claim administrative-region averages or global
coverage for the weather trends. Obsolete `atlasLayer` query parameters are
removed; there is no vegetation imagery layer on Map.

Atlas significance uses `p_holm_scan` and `significant_across_scan` from the fixed
772-test scan (193 candidates × four indices), rather than the nested per-point
four-test result. Individual 95%
intervals are not simultaneous, so an interval can exclude zero while the
772-test adjusted result remains unresolved. A constant observed series retains
a zero rate with unavailable inference. Comparing two displayed rates or annual
counts does not test a difference between their trends.

The browser parser checks annual coverage, independently recomputes each OLS
line, and checks the full Holm family before displaying the archive. The
independent `backend/tests/test_expanded_atlas.py` audit additionally recomputes
HAC(1) slope variance with centered calendar years, Bartlett weights, n/(n−2)
correction and Student-t reference, verifying all 772 metric fits and their
available intervals and raw p-values. Its optional local test recounts the 183 additional points from the exact
original NASA response bytes named by SHA-256. This is skipped when the ignored
cache is unavailable. The separate legacy audit checks all ten original points'
annual records and fits, plus an optional original-cache daily recount for
Prague, Medicine Hat, Brno and Athens. Source retrieval dates and analysis
creation time remain distinct.

The expanded schema retains correction slots for all fixed candidates even
when a point is unavailable; unavailable tests occupy p=1 internally and remain
null in published inference. The parser supports the original ten-point,
40-test schema only as a fallback when the expanded file is absent (HTTP 404),
not when expanded data are corrupt or a service fails. An expanded scan uses
its own full family; the original guided-reference findings retain theirs.

The one-click finding cards are references to the saved 2026-11-14 analysis of
ten predefined points over 1981–2025. Their displayed rates retain the original
complete annual observations and Holm adjustment across all 40 point/index
tests, available in `frontend/public/data/daily-example-analysis-1981-2025.json`.
The main card opens Brno/Athens hot-day counts. Other cards open Brno or Berlin
frost counts and Athens or Sydney warm-night proxies. Each action resets both
coordinates, the requested period, daily metric, highlighted year 2025 and
comparison visibility, including when the same card is selected again.

The cards are explicitly saved findings, while opening one fetches the selected
daily record and recalculates its trends. The live charts retain four-test Holm
correction per point, with their actual retrieval metadata and data-quality
requirements. This distinction prevents treating the ten-location exploratory
screen as the live chart's multiplicity family or as a test between locations.

Daily comparison selects A and B by clicking or dragging labelled markers on the
same map. Both points use the same requested interval, thresholds, day basis,
metric and highlighted year. The two daily charts share vertical limits computed
from both observed annual series and fitted lines. Each model retains its own
coverage and complete-year span; no missing year is filled to align the records.
The annual A-minus-B table requires two exact values. Lower bounds, unavailable
years and inference fields stay distinguishable in the combined CSV, with both
source chains. The monthly comparison retains independently labelled scales.
All individual daily significance tests retain four-test Holm correction per
point. There is no adjustment across eight tests or searches over map points,
and no formal paired or spatial model of the difference between the slopes.

Both points are evaluated with the same selected variable, period and model.
Each is a separate model grid-cell record, not an administrative-area average.
Monthly chart scales are independent and labelled; daily comparison charts share
their vertical limits. Testing each slope against
zero does not test whether the two slopes differ; no between-location significance
claim is made. A significant slope at one point and a nonsignificant slope at
another does not itself establish a significant difference between them.

The three guided investigations use a fixed 1981–2025 period: daily frost
counts near Prague, daily dry runs near Medicine Hat, and a remembered year's
monthly temperature departure. The preset points have checksummed original
monthly snapshots for monthly context. The first two guides load actual daily
data and do not use those monthly snapshots as a daily fallback. They pose
questions rather than promise a particular outcome.
Users can also inspect winter means/seasonal totals, compare two locations and change the analysis
period, while avoiding selection of a window merely to obtain a small p-value.

The challenge's additional portals are external exploration resources. NASA
POWER supplies the weather and soil-wetness pipelines. The Relationships
workspace separately supports numeric MOD13Q1 through Microsoft Planetary Computer
and explicitly labelled user-provided filtered CSV imports. Other resource links
remain external tools. Their use terms and access requirements must be checked
independently. POWER meteorology provenance:
https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/

Reference: https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLSResults.get_robustcov_results.html

## Terka's next independent checks

1. Reproduce at least one temperature slope from the same monthly data.
2. Compare results across preselected periods; do not select a window just for significance.
3. Inspect residuals, serial correlation and sensitivity to 6/12/24 HAC lags.
4. Check units and the distinction between precipitation rates and totals.
5. Check that UI conclusions agree with the estimated rate and its uncertainty.
6. Document remaining limitations before the competition submission.

Automated checks cover a known trend with strong seasonal variation, seasonality
without a trend, constant data, short records, missing dates, metadata units,
annual-summary exclusion, snapshot matching/checksums, and an upstream outage.

## Compound hot and dry days

The Relationships workspace derives a daily coincidence indicator from the
existing NASA POWER daily records: Tmax strictly greater than 30 C **and**
precipitation strictly less than 1 mm/day on the same LST date. Exactly 30 C
or 1 mm/day does not satisfy that threshold. This describes a hot day with
little precipitation; it is not a soil-moisture measurement, a drought-duration
index, a crop-impact estimate or a causal attribution.

An exact annual count requires valid paired Tmax and precipitation on every
365/366 calendar date, including leap day. With incomplete paired coverage,
`value` remains null and the observed count is a lower bound, without scaling
or extrapolation. A zero count is distinguished from an absent response or
unknown paired observations. Conflicting duplicate dates are unusable and
cannot increase coverage. Annual and raw-daily CSVs retain thresholds, LST,
paired coverage, missing values and original daily source chains.

Compound counts are descriptive. This additional index is not inserted into
the existing four-index Holm family and receives no significance badge or
independent compound-index trend test.

## Monthly relationships and time lags

Relationships match X with Y zero, one or two **calendar months** later. A
selected calendar month refers to X: June with lag one pairs June X with July Y
across years. Both dates must be inside the requested interval. Missing dates
remain gaps; matching never uses row offsets that could shift later observations
into an earlier missing month. Precipitation rates are converted to totals using
actual calendar-month lengths before analysis.

The seasonal reference uses only common matched observations, with a separate
mean for each X calendar-month cohort and its corresponding Y cohort. This is
an analysis-dependent reference, not the fixed 1991–2020 temperature normal.
Changing the period, lag or missingness can change it. The actual paired-cohort
years, requested window, expected calendar pairs and matched coverage are
reported and exported.

Without detrending, Pearson's coefficient is calculated from those month-centered
values. With detrending, the linear time effect is removed jointly with month
fixed effects. Equivalently, for each paired calendar-month cohort, center X, Y
and actual elapsed calendar-month time, then regress centered X and centered Y
on that centered time and correlate their residuals. A fixed lag adds a constant
to Y's time coordinate and does not change the within-cohort centered time.
This preserves real spacing across gaps and does not reintroduce a residual
seasonal cycle by regressing monthly anomalies on uncentered calendar time.

A descriptive `r` is published only with at least five distinct X years, ten
all-month pairs or five same-month annual pairs, 80% of possible calendar pairs
in the requested interval, and at least three matched observations in every
included calendar-month cohort. Constant or numerically negligible adjusted
variation makes correlation undefined and leaves `r` null, not zero. These
minimums are application safeguards, not guarantees of reliability or
representativeness; missingness can bias the relationship.

No correlation p-value or confidence interval is published. Monthly climate
records are serially dependent, and independent-observation Pearson inference
would not account for this dependence or searches over months, lags, regions
and time windows. A coefficient near zero does not rule out nonlinear or
season-dependent relationships. A nonzero coefficient does not demonstrate
causation. Scatter points, raw and adjusted values and complete source metadata
remain available so the selected relationship can be inspected and reproduced.

References: [NOAA correlation interpretation and caveats](https://www.psl.noaa.gov/data/atmoswrit/corr/caveats/),
[SciPy Pearson definition and independent-observation inference assumptions](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html).

## Root-zone soil wetness and model dependence

`GWETROOT` is the NASA POWER model root-zone **soil-wetness fraction** on its
original dimensionless 0–1 scale. It is not volumetric water content in m3/m3
and is not an in-situ field measurement. Unsupported units are rejected;
fill, nonfinite, malformed and out-of-range values remain missing. Monthly
calendar gaps are preserved and annual month-13 summaries are excluded.

The monthly record describes a coarse reanalysis grid cell around the point.
Weather and soil wetness share land-atmosphere model inputs. Their correlation
is therefore useful as an exploratory description of modeled behavior, not
independent observational validation or proof that one variable caused the
other. A warm/rainless day and low modeled root-zone wetness are separate
quantities and are not substituted for each other.

Reference: [NASA POWER hydrology definitions and source distinctions](https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/).

## MODIS vegetation aggregation and imported provenance

The live provider uses Terra MOD13Q1 collection 061 nominal 250 m, 16-day NDVI
composites from original COG assets through the public Microsoft Planetary
Computer catalog and numeric data API, beginning with complete years from 2001.
Aqua/MYD scenes are excluded. NDVI describes vegetation greenness; it is not
crop yield or a direct measurement of plant health, species diversity or drought
damage. Rendered color imagery is never converted to observations.

Each numeric NPY crop covers a 9 × 9 native sinusoidal-pixel window centered on
the pixel containing the selected point, approximately 231.656 m per pixel and
2.085 km per side. The provider validates the projection, transform, stable cell,
asset paths, band data types and NDVI scale, then requests the same native grid
with nearest sampling and no unscaling. The returned mask and numeric shape
must match this request; original response bytes and their SHA-256 are retained.
This is a defined area mean, not the footprint of an ORNL subset or a single
point sample.

Matching NDVI and pixel-reliability bands must belong to one collection and
grid. Only masked-valid pixels with reliability flag zero (good) and integer
NDVI from -2000 through 10000 are accepted; NDVI is scaled once by 0.0001.
At least 41 of 81 pixels must pass to form an equal-pixel-weight composite mean.
Marginal-quality, cloudy, snow/ice, fill and malformed pixels are excluded.

Monthly NDVI is the equal-weight mean of **all scheduled** 16-day composite
means whose nominal start dates lie in that calendar month. Every scheduled
composite must be received and pass the pixel-coverage requirement; otherwise
the month is missing. This composite-start proxy is not a true, day-weighted
calendar-month average and does not split a composite at a month boundary.
Collection or grid changes are rejected rather than silently combined.

The local MODIS subset and the much larger POWER weather grid do not measure
identical areas. Their relationship is an exploratory comparison around a
point. Different spatial supports, land cover, cloud/snow-dependent missingness,
temporal compositing and selected reference periods can affect the coefficient.
These limits remain explicit even when both source chains are NASA products.

The original ORNL service returned 503/timeouts during integration verification,
so it is no longer the primary download provider. The numeric Planetary Computer
path was verified live for Berlin for all requested years 2001–2025. This
verifies retrieval and source provenance, not complete good-quality monthly
coverage. Strict cloud/snow/quality filtering can leave many months missing;
a loaded series does not necessarily meet the 80% coverage rule for displaying
r. The interface reports usable months and offers an all-month view without
weakening quality or correlation requirements.

The browser requests one complete calendar year at a time; the API accepts one
to five. Each request searches the catalog and retrieves a numeric crop for each
available nominal scene. Up to four source requests run concurrently under a
shared semaphore. Each upstream HTTP call has a 30-second deadline including
waiting for this semaphore, a 20-second network read timeout and five-second
connect timeout. These bounds do not apply to an entire application batch or
the full download. Failed groups cancel unfinished sibling requests.

Validated catalog JSON and original numeric NPY bytes are cached independently
for 24 hours under `vegetation-pc-v1`. A failed live request may use only a valid
matching saved response with its original retrieval metadata; a failed later
request does not discard earlier cached responses. Future retrieval timestamps,
wrong request identities, corrupt bytes or unsupported geometry cannot be
published as saved observations. No synthetic or weather-derived NDVI is used.

The browser reports initial contact, elapsed seconds, completed years and the
later rainfall-pairing stage. Progress counts application years, not individual
source calls or composites. Cancellation stops the active browser request and
allows retry. Selecting NDVI mode alone does not change the period. Explicit
Load NDVI can change a pre-2001 start to 2001 when the end is 2001 or later;
an earlier end requires a period change. CSV imports keep their requested period
and undergo quality and missing-month checks without this API clamp.

The browser also accepts documented ORNL filtered/scaled pixel CSV files,
including the land-cover-mask variant. Imports retain their declared rectangle,
collection and pixel size, separately from the live provider's fixed 9 × 9 area.

For imports, already-scaled numeric pixels in -0.2..1 are retained and `F` is
treated as a rejected pixel. The same 50% composite and complete-month schedule
rules apply. Product, band, collection, subset geometry/location, acquisition and
processing metadata and pixel values are validated. However, these checks cannot
independently authenticate file origin or the provider's previous filtering.
Imported records remain labelled `import`, with filename, import time and a
SHA-256 of the original file bytes; a hash identifies the file, not a trusted
NASA provenance chain. Unknown original retrieval times remain unknown. The
original CSV is kept in browser memory for reprocessing when the selected
period changes at the same point; provenance is retained in exports.

References: [Planetary Computer MODIS collection](https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-13Q1-061),
[NASA MODIS vegetation product](https://modis.gsfc.nasa.gov/data/dataprod/mod13.php),
[MOD13Q1 file specification and quality flags](https://ladsweb.modaps.eosdis.nasa.gov/filespec/MODIS/61/MOD13Q1),
[ORNL MODIS subset web service](https://modis.ornl.gov/data/modis_webservice.html),
[ORNL filtered export documentation](https://modis.ornl.gov/documentation.html).
