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
