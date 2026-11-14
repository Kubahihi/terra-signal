import type { CalendarPeriod, CalendarPoint, CalendarResponse, CalendarView } from '../types/api'

export const calendarMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function calendarValue(point: CalendarPoint, view: CalendarView) {
  return view === 'anomaly' ? point.anomaly : point.value
}

export function calendarAmount(value: number | null | undefined, signed = false) {
  if (value == null) return '—'
  const rounded = Math.round(value * 100) / 100
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto',
  })
}

export function calendarCsv(result: CalendarResponse, period: CalendarPeriod) {
  const analysis = period.analysis
  const metadata = [
    ['source', result.source], ['source_url', result.source_url], ['retrieved_at', result.retrieved_at],
    ['data_origin', result.data_origin], ['latitude', result.latitude], ['longitude', result.longitude],
    ['variable', result.variable], ['unit', result.unit], ['original_unit', result.original_unit],
    ['calendar_period', period.label], ['months', period.months.join(',')],
    ['year_convention', period.crosses_year ? 'December of previous year; January and February of labelled year' : 'calendar year'],
    ['aggregation', result.variable === 'T2M' ? 'day-weighted mean of complete months' : 'sum of monthly mm/day times actual days in month'],
    ['baseline', result.baseline_start === null ? 'not applicable' : `${result.baseline_start}-${result.baseline_end}; separate calendar-month normals; all 30 years required`],
    ['start_year', result.start], ['end_year', result.end],
    ['trend_method', analysis?.method ?? 'unavailable'], ['trend_lag_unit', analysis?.lag_unit ?? 'unavailable'],
    ['slope_per_year', analysis?.slope_per_year ?? 'unavailable'], ['slope_per_decade', analysis?.slope_per_decade ?? 'unavailable'],
    ['ci95_per_decade_low', analysis?.ci95_per_decade?.[0] ?? 'unavailable'],
    ['ci95_per_decade_high', analysis?.ci95_per_decade?.[1] ?? 'unavailable'],
    ['p_value', analysis?.p_value ?? 'unavailable'], ['sample_size', analysis?.sample_size ?? 'unavailable'],
    ['warnings', [...result.warnings, ...period.warnings].join(' | ')],
  ].map(([key, value]) => `# ${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
  return [...metadata, 'year,value,baseline_value,anomaly,available_months,expected_months',
    ...period.points.map(p => [p.year, p.value ?? '', p.baseline_value ?? '', p.anomaly ?? '', p.available_months, p.expected_months].join(',')),
  ].join('\r\n')
}
