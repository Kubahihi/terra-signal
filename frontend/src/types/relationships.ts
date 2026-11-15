import type { Observation } from './api'

export type RelationshipMode = 'weather' | 'soil' | 'vegetation'
export type RelationshipSettings = { lag_months: 0 | 1 | 2; month: number | null; detrend: boolean }
export type RelationshipSeries = { name: string; unit: string; observations: Observation[] }
export type RelationshipRequest = RelationshipSettings & {
  latitude: number; longitude: number; start: number; end: number
  x: RelationshipSeries; y: RelationshipSeries
}
export type RelationshipPair = { x_date: string; y_date: string; x_raw: number; y_raw: number; x: number; y: number }
export type RelationshipResponse = {
  latitude: number; longitude: number; start: number; end: number
  lag_months: number; month: number | null; detrended: boolean
  x_name: string; y_name: string; x_unit: string; y_unit: string
  pairs: RelationshipPair[]; pearson_r: number | null; n_pairs: number; n_years: number
  expected_pairs: number; coverage: number; reference_start: number | null; reference_end: number | null
  method: string; seasonality: string; p_value: null; ci95: null; warnings: string[]
}
export type RelationshipSource = {
  role: 'x' | 'y'; source: string; source_url: string; retrieved_at: string | null
  data_origin: 'live' | 'cache' | 'snapshot' | 'import'; spatial_support: string
  product?: string; collection?: string
}
export type RelationshipDataset = Omit<RelationshipRequest, keyof RelationshipSettings> & {
  mode: RelationshipMode; sources: RelationshipSource[]; warnings: string[]
}
export type VegetationObservation = Observation & { available_composites: number; expected_composites: number }
export type VegetationData = {
  latitude: number; longitude: number; start: number; end: number; product: 'MOD13Q1'; unit: 'NDVI'
  series: VegetationObservation[]; source: string; source_url: string; spatial_support: string
  retrieved_at?: string; data_origin: 'live' | 'cache' | 'import'; filename?: string
  pixel_size_m?: number; nrows?: number; ncols?: number; collections?: string[]; collection?: string
  sources?: { source_url: string; retrieved_at: string; data_origin: 'live' | 'cache' }[]
  warnings: string[]
}
export type SoilResponse = {
  latitude: number; longitude: number; start: number; end: number; parameter: 'GWETROOT'; unit: '1'
  series: Observation[]; source: string; source_url: string; retrieved_at: string
  data_origin: 'live' | 'cache'; warnings: string[]
}
