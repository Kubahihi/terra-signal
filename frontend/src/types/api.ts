// Public contract: backend/app/schemas.py and docs/API.md.
export type Variable = 'T2M' | 'PRECTOTCORR'
export type Observation = { date: string; value: number | null }
export type HealthResponse = { status: string; service: string; version: string }
export type SeriesQuery = {
  lat: number
  lon: number
  variable: Variable
  start: number
  end: number
}
export type TrendAnalysis = {
  method: string
  slope_per_year: number
  slope_per_decade: number
  ci95_per_decade: [number, number] | null
  p_value: number | null
  sample_size: number
  hac_lags: number
}
export type SeriesResponse = {
  source: string
  variable: Variable
  unit: string
  latitude: number
  longitude: number
  start: number
  end: number
  series: Observation[]
  warnings: string[]
  analysis: TrendAnalysis | null
  source_url: string
  retrieved_at: string
  data_origin: 'live' | 'cache' | 'snapshot'
}

export type CalendarPeriodId = 'year' | 'djf' | 'mam' | 'jja' | 'son'
  | 'm01' | 'm02' | 'm03' | 'm04' | 'm05' | 'm06' | 'm07' | 'm08' | 'm09' | 'm10' | 'm11' | 'm12'
export type CalendarView = 'values' | 'anomaly'
export type CalendarSelection = { period: CalendarPeriodId; view: CalendarView }
export type CalendarPoint = {
  year: number
  value: number | null
  baseline_value: number | null
  anomaly: number | null
  available_months: number
  expected_months: number
}
export type CalendarPeriod = {
  id: CalendarPeriodId
  label: string
  months: number[]
  crosses_year: boolean
  points: CalendarPoint[]
  analysis: (TrendAnalysis & { lag_unit: 'years' }) | null
  warnings: string[]
}
export type CalendarResponse = {
  variable: Variable
  latitude: number
  longitude: number
  start: number
  end: number
  unit: string
  original_unit: string
  baseline_start: number | null
  baseline_end: number | null
  normals: { month: number; value: number | null; available_years: number; expected_years: number }[]
  periods: CalendarPeriod[]
  source: string
  source_url: string
  retrieved_at: string
  data_origin: SeriesResponse['data_origin']
  warnings: string[]
}

export type DailyMetric = 'hot_days' | 'frost_days' | 'warm_nights' | 'longest_dry_spell'
export type DailyRecord = { date: string; tmax: number | null; tmin: number | null; precipitation: number | null }
export type AnnualDailyCount = { value: number | null; observed_count: number; available_days: number }
export type AnnualDrySpell = AnnualDailyCount & { start_date: string | null; end_date: string | null; touches_year_boundary: boolean }
export type DailyYear = {
  year: number
  expected_days: number
  hot_days: AnnualDailyCount
  frost_days: AnnualDailyCount
  warm_nights: AnnualDailyCount
  longest_dry_spell: AnnualDrySpell
}
export type DailySource = {
  start: number
  end: number
  source: string
  source_url: string
  retrieved_at: string
  data_origin: 'live' | 'cache'
}
export type DailyResponse = DailySource & {
  latitude: number
  longitude: number
  time_standard: 'LST'
  thresholds: Record<DailyMetric, string>
  daily: DailyRecord[]
  years: DailyYear[]
  warnings: string[]
}
export type DailyRange = { start: number; end: number }
export type DailyQuery = DailyRange & { lat: number; lon: number }
export type DailySelection = { metric: DailyMetric; autoLoad: boolean; year?: number }
export type DailyDataset = DailyQuery & {
  daily: DailyRecord[]
  years: DailyYear[]
  sources: DailySource[]
  warnings: string[]
  failures: (DailyRange & { message: string })[]
}

export type DailyTrendAnalysis = TrendAnalysis & {
  lag_unit: 'years'
  reference_year: number
  intercept: number
  p_value_holm: number | null
  significant: boolean | null
}
export type DailyMetricTrend = {
  complete_years: number
  expected_years: number
  nonzero_years: number
  first_year: number | null
  last_year: number | null
  analysis: DailyTrendAnalysis | null
  warnings: string[]
}
export type DailyTrendsResponse = {
  latitude: number
  longitude: number
  start: number
  end: number
  method: string
  correction: string
  family_size: number
  alpha: number
  minimum_years: number
  metrics: Record<DailyMetric, DailyMetricTrend>
  warnings: string[]
}

export type DailyPeriodsResponse = {
  latitude: number
  longitude: number
  start: number
  end: number
  family_size: number
  alpha: number
  periods: DailyTrendsResponse[]
  warnings: string[]
}
