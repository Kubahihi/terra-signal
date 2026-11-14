import { exampleLocations, type Location } from './locations.ts'
import type { DailyMetric } from '../types/api'

export const exampleAnalysis = {
  start: 1981, end: 2025, date: '2026-11-14', familySize: 40, candidateCount: 10,
  sourceHref: '/data/daily-example-analysis-1981-2025.json',
}

type ReferenceFinding = { locationId: string; metric: DailyMetric; slopePerDecade: number }
export const referenceFindings: ReferenceFinding[] = [
  { locationId: 'brno', metric: 'hot_days', slopePerDecade: 4.5401844532279325 },
  { locationId: 'athens', metric: 'hot_days', slopePerDecade: 7.424242424242433 },
  { locationId: 'brno', metric: 'frost_days', slopePerDecade: -7.5217391304347805 },
  { locationId: 'athens', metric: 'warm_nights', slopePerDecade: 10.230566534914365 },
  { locationId: 'berlin', metric: 'frost_days', slopePerDecade: -8.382081686429519 },
  { locationId: 'sydney', metric: 'warm_nights', slopePerDecade: 10.823451910408439 },
]

function place(id: string): Location {
  const result = exampleLocations.find(location => location.id === id)
  if (!result) throw new Error(`Unknown example point: ${id}`)
  return result
}

function finding(locationId: string, metric: DailyMetric): ReferenceFinding {
  const result = referenceFindings.find(item => item.locationId === locationId && item.metric === metric)
  if (!result) throw new Error(`Missing reference finding: ${locationId}/${metric}`)
  return result
}

export type DailyExample = {
  id: string; title: string; description: string; location: Location; comparison: Location
  metric: DailyMetric; findings: ReferenceFinding[]; featured?: boolean
}

export const dailyExamples: DailyExample[] = [
  { id: 'brno-athens-heat', title: 'Brno × Athens', description: 'Hot days in two climates.',
    location: place('brno'), comparison: place('athens'), metric: 'hot_days', featured: true,
    findings: [finding('brno', 'hot_days'), finding('athens', 'hot_days')] },
  { id: 'brno-frost', title: 'Fewer frost days near Brno', description: 'Compare Brno with Athens.',
    location: place('brno'), comparison: place('athens'), metric: 'frost_days', findings: [finding('brno', 'frost_days')] },
  { id: 'athens-warm-nights', title: 'Warmer nights near Athens', description: 'Compare Athens with Brno.',
    location: place('athens'), comparison: place('brno'), metric: 'warm_nights', findings: [finding('athens', 'warm_nights')] },
  { id: 'berlin-frost', title: 'Fewer frost days near Berlin', description: 'Compare Berlin with Brno.',
    location: place('berlin'), comparison: place('brno'), metric: 'frost_days', findings: [finding('berlin', 'frost_days')] },
  { id: 'sydney-warm-nights', title: 'Warmer nights near Sydney', description: 'Compare Sydney with Athens.',
    location: place('sydney'), comparison: place('athens'), metric: 'warm_nights', findings: [finding('sydney', 'warm_nights')] },
]

export function findingLocation(finding: ReferenceFinding) { return place(finding.locationId) }
