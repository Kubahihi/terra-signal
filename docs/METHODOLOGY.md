# MVP methodology and review checklist

## Data

NASA POWER Monthly and Annual API, AG community, MERRA-2-based meteorology.
The implemented point parameters are T2M (temperature at 2 m, C) and PRECTOTCORR
(corrected precipitation, mm/day). Units come from each response's metadata.
Monthly precipitation is a mean daily rate; it is not a monthly total.

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
12 calendar months represented, and at least 80% coverage within the observed
span. These are product heuristics, not universal scientific sufficiency rules.
If internal months are missing, show the slope but withhold the HAC interval and
p-value because its lag spacing would no longer represent contiguous months.
Constant series have slope zero and no significance claim.

A p-value below 0.05 is interpreted only under this model. A nonsignificant result
does not demonstrate an absence of change. Searching many regions/periods for
small p-values can introduce selection and multiple-comparison problems.

The interface labels p < 0.05 as significant only when the model also provides an
uncertainty interval. Missing inference is labelled unavailable. Coverage is the
number of nonmissing observations divided by the full requested number of months.
Rates and confidence bounds are displayed per decade; the annual rate is also
shown. CSV exports preserve unrounded rates, interval bounds, p-value, sample
size, units, provenance, period and warnings alongside the original monthly data.

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
without a significance claim. This does not replace the all-month seasonal model.
The year slider highlights an observation without refitting the trend.

Daily hot/frost-day counts, warm-night proxies and consecutive dry-day lengths
are calculated in the separate daily layer described below. They are not inferred
from these monthly aggregates. Soil-moisture/NDVI integrations and formal
comparisons of multiple period-specific slopes remain future work.

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

## Spatial comparison and guided investigations

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
The two chart scales are independent and labelled. Testing each slope against
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

The challenge's additional portals are external exploration resources. Only NASA
POWER is connected to the time-series pipeline. Their use terms and access
requirements must be checked independently. POWER meteorology provenance:
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
