import type { DailyDataset, DailyMetricTrend, DailyPeriodsResponse } from '../types/api'
import { dailyMetrics } from './dailyData.ts'

export function dailyPeriodStarts(start: number, end: number) {
  return [start, ...[1991, 2001].filter(year => year > start && year <= end)]
}

export function matchesDailyPeriods(data: DailyDataset, result: DailyPeriodsResponse) {
  const starts = dailyPeriodStarts(data.start, data.end)
  return data.lat === result.latitude && data.lon === result.longitude && data.start === result.start && data.end === result.end
    && result.alpha === 0.05 && Array.isArray(result.periods) && result.periods.length === starts.length && result.family_size === starts.length * 4
    && result.periods.every((period, i) => period.latitude === data.lat && period.longitude === data.lon
      && period.start === starts[i] && period.end === data.end && period.family_size === result.family_size && period.alpha === 0.05)
}

export function periodEvidence(result: DailyMetricTrend) {
  const analysis = result.analysis
  if (!analysis) return { state: 'unavailable', label: 'Trend not estimated' }
  if (analysis.p_value_holm === null || analysis.ci95_per_decade === null) return { state: 'unavailable', label: 'Significance unavailable' }
  if (analysis.p_value_holm < 0.05) return { state: 'significant', label: `Significant ${analysis.slope_per_decade > 0 ? 'increase' : 'decrease'}` }
  return { state: 'inconclusive', label: 'Trend not statistically resolved' }
}

export function dailyPeriodsCsv(data: DailyDataset, result: DailyPeriodsResponse) {
  if (!matchesDailyPeriods(data, result)) throw new Error('Period analysis does not match the selected record or predefined windows.')
  const metadata = [
    ['provider', 'NASA POWER Daily API; TerraSignal annual index period sensitivity'],
    ['latitude', data.lat], ['longitude', data.lon], ['source_start', data.start], ['source_end', data.end],
    ['time_standard', 'LST'], ['units', 'slope and individual 95% intervals: days/decade'],
    ['method', 'Yearly OLS + HAC(1 annual lag), finite-sample covariance correction, two-sided Student-t n-2'],
    ['periods', result.periods.map(period => `${period.start}-${period.end}`).join(' | ')],
    ['family_size', result.family_size], ['correction', 'Holm across all period/index tests at this point'],
    ['confidence_intervals', 'individual 95%; not simultaneous or adjusted'],
    ['quality', 'at least 20 complete years and 80% coverage; internal gaps, constant/exact-line and fewer than five nonzero years withhold inference'],
    ['thresholds', 'Tmax > 30 C; Tmin < 0 C; Tmin > 20 C (warm-night proxy); dry P < 1 mm/day clipped to calendar year'],
    ['unavailable_batches', data.failures.map(item => `${item.start}-${item.end}: ${item.message}`).join(' | ') || 'none'],
    ...data.sources.flatMap((source, i) => [
      [`source_${i + 1}_years`, `${source.start}-${source.end}`], [`source_${i + 1}_url`, source.source_url],
      [`source_${i + 1}_retrieved_at`, source.retrieved_at], [`source_${i + 1}_origin`, source.data_origin],
    ]),
    ['warnings', [...result.warnings, ...data.warnings].join(' | ')],
  ].map(([key, value]) => `# ${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
  const cell = (value: unknown) => value == null ? '' : `"${String(value).replace(/"/g, '""')}"`
  return [...metadata, 'period_start,period_end,metric,complete_years,expected_years,first_complete_year,last_complete_year,slope_per_decade,ci95_low_individual,ci95_high_individual,p_two_sided,p_holm_all_periods,significant_holm_5pct,warnings',
    ...result.periods.flatMap(period => dailyMetrics.map(({ id }) => {
      const metric = period.metrics[id]
      const analysis = metric.analysis
      return [period.start, period.end, id, metric.complete_years, metric.expected_years, metric.first_year, metric.last_year,
        analysis?.slope_per_decade, analysis?.ci95_per_decade?.[0], analysis?.ci95_per_decade?.[1], analysis?.p_value,
        analysis?.p_value_holm, analysis?.significant == null ? null : Number(analysis.significant), metric.warnings.join(' | '),
      ].map(cell).join(',')
    })),
  ].join('\r\n')
}
