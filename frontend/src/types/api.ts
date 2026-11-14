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
}
