import type { SeriesResponse, TrendAnalysis } from '../types/api'

export function formatRate(value: number) {
  if (value === 0) return '0.000'
  return value.toLocaleString('en-US', {
    minimumSignificantDigits: 3, maximumSignificantDigits: 3, signDisplay: 'exceptZero',
  })
}

export function evidenceFor(analysis: TrendAnalysis | null | undefined, model = 'seasonal linear model') {
  if (!analysis) return {
    state: 'unavailable', label: 'Trend not estimated',
    conclusion: 'A sufficiently long and complete record is needed. Check the data notes for the reason this record cannot support the model.',
  }
  if (analysis.p_value === null || analysis.ci95_per_decade === null) return {
    state: 'unavailable', label: 'Significance unavailable',
    conclusion: 'The fitted rate is shown, but this record does not support a significance claim. Check the data notes before interpreting the estimate.',
  }
  if (analysis.p_value < 0.05) return {
    state: 'significant', label: 'Significant at the 5% level',
    conclusion: `Under this ${model}, there is evidence of a ${analysis.slope_per_decade > 0 ? 'rising' : 'falling'} trend over the selected period. This does not identify its cause or establish its practical importance.`,
  }
  return {
    state: 'inconclusive', label: 'Trend not statistically resolved',
    conclusion: 'This model does not distinguish the trend from zero at the 5% level. That does not prove there is no change; the period, variability and data coverage matter.',
  }
}

export function coverageFor(result: SeriesResponse) {
  const available = result.series.filter(point => point.value !== null && Number.isFinite(point.value)).length
  const expected = (result.end - result.start + 1) * 12
  return { available, expected, percent: Math.round(available / expected * 100) }
}

export function originLabel(origin: SeriesResponse['data_origin']) {
  return origin === 'live' ? 'Live NASA response' : origin === 'cache' ? 'Cached NASA response' : 'Saved NASA snapshot'
}
