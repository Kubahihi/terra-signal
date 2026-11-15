import type { Observation } from './api'
import type { Location } from '../lib/locations'

export type MemoryRole = 'rain' | 'soil' | 'vegetation'
export type MemorySource = {
  role: MemoryRole
  source: string
  source_url: string
  retrieved_at: string | null
  data_origin: 'live' | 'cache' | 'snapshot' | 'import'
  spatial_support: string
  product?: string
  collection?: string
}
export type MemoryDataset = {
  schemaVersion: 1
  location: Location
  start: number
  end: number
  rain: Observation[]
  soil: Observation[]
  vegetation: Observation[]
  sources: MemorySource[]
  warnings: string[]
  savedAt?: string
  vegetationQuality?: { date: string; available_composites: number; expected_composites: number }[]
}
export type MemoryMonth = {
  date: string
  rain: number | null
  soil: number | null
  vegetation: number | null
  rain3: number | null
  rainRank: number | null
  soilRank: number | null
  vegetationRank: number | null
  rainReferenceYears: number
  soilReferenceYears: number
  vegetationReferenceYears: number
}
export type MemoryRecovery = {
  status: 'recovered' | 'not-observed' | 'gap' | 'not-depressed' | 'unavailable'
  minimumDate: string | null
  minimumRank: number | null
  recoveryDate: string | null
  monthsAfterRain: number | null
  observedMonths: number
  expectedMonths: number
}
export type MemoryEvent = {
  id: string
  start: string
  end: string
  anchor: string
  duration: number
  severity: number
  rainRecovery: string | null
  rainRecoveryStatus: 'confirmed' | 'gap' | 'not-observed' | 'censored'
  followupEnd: string
  followupReason: 'limit' | 'record-end' | 'next-episode'
  soil: MemoryRecovery
  vegetation: MemoryRecovery
  classification: 'lingering' | 'quick' | 'counterexample' | 'incomplete'
}
export type MemoryAnalysis = {
  months: MemoryMonth[]
  events: MemoryEvent[]
  referenceStart: number
  referenceEnd: number
  minReferenceYears: number
  dryThreshold: number
  recoveryThreshold: number
  recoveryMonths: number
  followupMonths: number
  warnings: string[]
}
