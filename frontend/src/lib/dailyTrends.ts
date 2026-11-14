import type { DailyDataset, DailyMetric, DailyMetricTrend, DailyTrendsResponse } from '../types/api'
import { dailyMetrics } from './dailyData.ts'

export function dailyEvidence(metric: DailyMetric, result?: DailyMetricTrend) {
  const analysis = result?.analysis
  const title = dailyMetrics.find(item => item.id === metric)!.title
  if (!analysis) return { state: 'unavailable', label: 'Trend not estimated', conclusion: result?.warnings[0] ?? 'Load daily records to estimate the trend.' }
  if (analysis.p_value_holm === null || analysis.ci95_per_decade === null) {
    return { state: 'unavailable', label: 'Significance unavailable', conclusion: 'The fitted rate describes the available annual values. This record does not support a significance claim; see the method notes for the reason.' }
  }
  if (analysis.p_value_holm < 0.05) {
    const direction = analysis.slope_per_decade > 0 ? 'increase' : 'decrease'
    return { state: 'significant', label: `Significant ${direction}`,
      conclusion: metric === 'longest_dry_spell'
        ? `Under this model, the longest dry spell within a calendar year became ${direction === 'increase' ? 'longer' : 'shorter'} over this period, after correcting for four tests.`
        : `Under this model, ${title.toLowerCase()} became ${direction === 'increase' ? 'more' : 'less'} frequent over this period, after correcting for four tests.` }
  }
  return { state: 'inconclusive', label: 'Trend not statistically resolved',
    conclusion: 'This model does not resolve an increase or decrease at the 5% level after correcting for four tests. This does not establish that there is no change.' }
}

export function formatDailyP(value: number | null | undefined) {
  return value == null ? 'unavailable' : value < 0.001 ? '< 0.001' : `= ${value.toPrecision(3)}`
}

export function dailyFit(result?: DailyMetricTrend) {
  const analysis = result?.analysis
  if (!analysis || result.first_year == null || result.last_year == null) return undefined
  return { startYear: result.first_year, endYear: result.last_year,
    startValue: analysis.intercept + analysis.slope_per_year * (result.first_year - analysis.reference_year),
    endValue: analysis.intercept + analysis.slope_per_year * (result.last_year - analysis.reference_year) }
}

export function matchesDailyTrends(data: DailyDataset, result: DailyTrendsResponse) {
  return data.lat === result.latitude && data.lon === result.longitude && data.start === result.start && data.end === result.end
}

export function dailyTrendsCsv(data: DailyDataset, trends: DailyTrendsResponse) {
  if (!matchesDailyTrends(data, trends)) throw new Error('Trends do not match the selected daily dataset.')
  const field = (value: unknown) => value == null ? '' : `"${String(value).replace(/"/g, '""')}"`
  const metadata = [
    ['provider', 'NASA POWER Daily API; trends calculated by TerraSignal from complete annual indices'],
    ['latitude', data.lat], ['longitude', data.lon], ['start_year', data.start], ['end_year', data.end],
    ['method', trends.method], ['time_standard', 'LST'], ['unit', 'days per decade'],
    ['inference', 'two-sided slope test; Bartlett HAC(1 year), finite-sample correction; Student-t n-2'],
    ['correction', trends.correction], ['family_size', trends.family_size], ['alpha', trends.alpha],
    ['confidence_intervals', 'individual 95%; not adjusted or simultaneous'],
    ['eligibility', 'at least 20 complete years and 80% coverage; no internal gaps for inference; at least five nonzero years; constant or exact-line records have no test'],
    ['thresholds', 'Tmax > 30 C; Tmin < 0 C; Tmin > 20 C (warm-night proxy); dry precipitation < 1 mm/day, clipped to calendar year'],
    ['unavailable_batches', data.failures.map(item => `${item.start}-${item.end}: ${item.message}`).join(' | ') || 'none'],
    ...data.sources.flatMap((source, i) => [
      [`source_${i + 1}_years`, `${source.start}-${source.end}`], [`source_${i + 1}_url`, source.source_url],
      [`source_${i + 1}_retrieved_at`, source.retrieved_at], [`source_${i + 1}_origin`, source.data_origin],
    ]),
    ['warnings', [...trends.warnings, ...data.warnings].join(' | ')],
  ].map(([key, value]) => `# ${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
  return [...metadata,
    'metric,unit,requested_start,requested_end,complete_years,expected_years,nonzero_years,first_complete_year,last_complete_year,slope_per_decade,ci95_low_individual,ci95_high_individual,p_two_sided,p_holm_four_tests,significant_holm_5pct,reference_year,intercept,hac_lags_years,warnings',
    ...dailyMetrics.map(({ id }) => {
      const result = trends.metrics[id]
      const analysis = result.analysis
      return [id, 'days/decade', data.start, data.end, result.complete_years, result.expected_years, result.nonzero_years,
        result.first_year, result.last_year, analysis?.slope_per_decade, analysis?.ci95_per_decade?.[0], analysis?.ci95_per_decade?.[1],
        analysis?.p_value, analysis?.p_value_holm, analysis?.significant == null ? null : Number(analysis.significant),
        analysis?.reference_year, analysis?.intercept, analysis?.hac_lags, result.warnings.join(' | '),
      ].map(field).join(',')
    }),
  ].join('\r\n')
}
