import type { DailyDataset, DailyMetric, DailyTrendsResponse } from '../types/api'
import type { Location } from './locations'
import { dailyMetrics } from './dailyData.ts'
import { dailyFit, matchesDailyTrends } from './dailyTrends.ts'

export function sameLocation(a: Location, b: Location) { return a.lat === b.lat && a.lon === b.lon }

export function sharedDailyMaximum(metric: DailyMetric, records: { data: DailyDataset | null; trends: DailyTrendsResponse | null }[]) {
  let high = 0
  for (const { data, trends } of records) {
    for (const year of data?.years ?? []) high = Math.max(high, year[metric].value ?? 0)
    const fit = data && trends && matchesDailyTrends(data, trends) ? dailyFit(trends.metrics[metric]) : undefined
    if (fit) high = Math.max(high, fit.startValue, fit.endValue)
  }
  return Math.max(1, Math.ceil(high * 1.12))
}

export function dailyComparisonRows(a: DailyDataset | null, b: DailyDataset | null, year: number) {
  return dailyMetrics.map(metric => {
    const first = a?.years.find(row => row.year === year)
    const second = b?.years.find(row => row.year === year)
    const left = first?.[metric.id] ?? null
    const right = second?.[metric.id] ?? null
    return { ...metric, left, right, expectedA: first?.expected_days ?? null, expectedB: second?.expected_days ?? null,
      difference: left?.value != null && right?.value != null ? left.value - right.value : null }
  })
}

export function dailyComparisonCsv(a: { location: Location; data: DailyDataset; trends: DailyTrendsResponse | null }, b: { location: Location; data: DailyDataset; trends: DailyTrendsResponse | null }) {
  if (sameLocation(a.location, b.location)) throw new Error('Choose two different comparison points.')
  if (a.data.start !== b.data.start || a.data.end !== b.data.end) throw new Error('Comparison periods do not match.')
  for (const point of [a, b]) {
    if (point.location.lat !== point.data.lat || point.location.lon !== point.data.lon || point.trends && !matchesDailyTrends(point.data, point.trends)) {
      throw new Error('Comparison records do not match the labelled place and period.')
    }
  }
  const metadata = [
    ['provider', 'NASA POWER Daily API'], ['start_year', a.data.start], ['end_year', a.data.end], ['time_standard', 'LST'],
    ['units', 'annual values/differences: days; slopes and individual 95% intervals: days per decade'],
    ['thresholds', 'Tmax > 30 C; Tmin < 0 C; Tmin > 20 C (warm-night proxy); dry P < 1 mm/day, clipped to calendar year'],
    ['comparison', 'same requested period; exact annual values only; missing values stay blank; observed lower bounds are excluded from differences and trends'],
    ['inference', 'two-sided OLS HAC(1 annual lag); Holm correction separately across four indices per point; no between-location significance test; individual 95% intervals are not simultaneous'],
    ['trend_requirements', 'at least 20 complete years and 80% coverage; internal gaps, constant/exact-line or fewer than five nonzero years withhold inference; slopes fitted over each point actual complete-year span'],
    ...[a, b].flatMap((point, index) => {
      const prefix = index === 0 ? 'a' : 'b'
      return [
        [`${prefix}_location`, point.location.name], [`${prefix}_latitude`, point.data.lat], [`${prefix}_longitude`, point.data.lon],
        [`${prefix}_trend_status`, point.trends ? 'available; missing inference fields remain blank' : 'unavailable'],
        [`${prefix}_unavailable_batches`, point.data.failures.map(item => `${item.start}-${item.end}: ${item.message}`).join(' | ') || 'none'],
        [`${prefix}_warnings`, [...point.data.warnings, ...(point.trends?.warnings ?? [])].join(' | ')],
        ...point.data.sources.flatMap((source, i) => [
          [`${prefix}_source_${i + 1}_years`, `${source.start}-${source.end}`], [`${prefix}_source_${i + 1}_url`, source.source_url],
          [`${prefix}_source_${i + 1}_retrieved_at`, source.retrieved_at], [`${prefix}_source_${i + 1}_origin`, source.data_origin],
        ]),
      ]
    }),
  ].map(([key, value]) => `# ${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
  const headings = ['year', 'metric', 'a_value', 'a_observed', 'a_available_days', 'a_expected_days', 'b_value', 'b_observed', 'b_available_days', 'b_expected_days', 'difference_a_minus_b',
    ...['a', 'b'].flatMap(prefix => ['slope_per_decade', 'ci95_low_individual', 'ci95_high_individual', 'p_two_sided', 'p_holm', 'significant_holm_5pct', 'complete_years', 'first_complete_year', 'last_complete_year', 'trend_warnings'].map(name => `${prefix}_${name}`)),
  ]
  const field = (value: unknown) => value == null ? '' : `"${String(value).replace(/"/g, '""')}"`
  const rows = []
  for (let year = a.data.start; year <= a.data.end; year++) {
    for (const row of dailyComparisonRows(a.data, b.data, year)) {
      const values = [year, row.id, row.left?.value, row.left?.observed_count, row.left?.available_days, row.expectedA,
        row.right?.value, row.right?.observed_count, row.right?.available_days, row.expectedB, row.difference,
        ...[a, b].flatMap(point => {
          const result = point.trends?.metrics[row.id]
          const fit = result?.analysis
          return [fit?.slope_per_decade, fit?.ci95_per_decade?.[0], fit?.ci95_per_decade?.[1], fit?.p_value, fit?.p_value_holm,
            fit?.significant == null ? null : Number(fit.significant), result?.complete_years, result?.first_year, result?.last_year, result?.warnings.join(' | ')]
        }),
      ]
      rows.push(values.map(field).join(','))
    }
  }
  return [...metadata, headings.join(','), ...rows].join('\r\n')
}
