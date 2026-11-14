import type { SeriesResponse } from '../types/api'

export function seriesCsv(result: SeriesResponse) {
  const metadata = [
    ['source', result.source], ['source_url', result.source_url], ['retrieved_at', result.retrieved_at],
    ['data_origin', result.data_origin], ['latitude', result.latitude], ['longitude', result.longitude],
    ['variable', result.variable], ['unit', result.unit], ['trend_method', result.analysis?.method ?? 'unavailable'],
    ['start_year', result.start], ['end_year', result.end],
    ['slope_per_year', result.analysis?.slope_per_year ?? 'unavailable'],
    ['slope_per_decade', result.analysis?.slope_per_decade ?? 'unavailable'],
    ['ci95_per_decade_low', result.analysis?.ci95_per_decade?.[0] ?? 'unavailable'],
    ['ci95_per_decade_high', result.analysis?.ci95_per_decade?.[1] ?? 'unavailable'],
    ['p_value', result.analysis?.p_value ?? 'unavailable'],
    ['sample_size', result.analysis?.sample_size ?? 'unavailable'],
    ['warnings', result.warnings.join(' | ')],
  ].map(([key, value]) => `# ${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
  return [...metadata, 'date,value', ...result.series.map(point => `${point.date},${point.value ?? ''}`)].join('\r\n')
}
