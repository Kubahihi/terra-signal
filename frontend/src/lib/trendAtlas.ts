import type { DailyMetric, DailyYear } from '../types/api'
import type { Location } from './locations'

export const atlasSourceHref = '/data/trend-atlas-1981-2025.json'
const legacyAtlasSourceHref = '/data/daily-example-analysis-1981-2025.json'
export const atlasMetrics = ['hot_days', 'frost_days', 'warm_nights', 'longest_dry_spell'] as const satisfies readonly DailyMetric[]
export type AtlasEvidence = 'increase' | 'decrease' | 'unresolved' | 'unavailable'
export type AtlasMetric = {
  slope: number | null
  ci95: [number, number] | null
  pHolm: number | null
  evidence: AtlasEvidence
  completeYears: number
  firstYear: number | null
  lastYear: number | null
  warnings: string[]
  fit: { referenceYear: number; intercept: number; slopePerYear: number } | null
}
export type AtlasSource = { start: number; end: number; source_url: string; retrieved_at: string; data_origin: 'live' | 'cache' }
export type AtlasPoint = {
  location: Location & { id: string }
  years: DailyYear[]
  sources: AtlasSource[]
  metrics: Record<DailyMetric, AtlasMetric>
}
export type TrendAtlasData = {
  start: number; end: number; familySize: number; correction: string; method: string
  candidateCount: number; availablePointCount: number
  retrievedAt: string; generatedAt: string; sourceHref: string; points: AtlasPoint[]
}
export type AtlasScale = { maximum: number; signed: boolean; unit: string }

function invalid(field: string): never { throw new Error(`Invalid atlas archive: ${field}.`) }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  return value as Record<string, unknown>
}
function list(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) invalid(field); return value }
function text(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) invalid(field); return value }
function number(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(field); return value }
function integer(value: unknown, field: string, low: number, high: number): number {
  const result = number(value, field)
  if (!Number.isInteger(result) || result < low || result > high) invalid(field)
  return result
}
function nullableNumber(value: unknown, field: string): number | null { return value === null ? null : number(value, field) }
function probability(value: unknown, field: string): number | null {
  const result = nullableNumber(value, field)
  if (result !== null && (result < 0 || result > 1)) invalid(field)
  return result
}
function strings(value: unknown, field: string): string[] { return list(value, field).map(item => text(item, field)) }
function dateTime(value: unknown, field: string): string {
  const result = text(value, field)
  if (!Number.isFinite(Date.parse(result))) invalid(field)
  return result
}
function near(a: number, b: number) { return Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b)) }
function probabilityNear(a: number, b: number) { return Math.abs(a - b) <= 1e-10 * Math.max(Number.MIN_VALUE, Math.abs(a), Math.abs(b)) }
function location(value: unknown): Location & { id: string } {
  const row = object(value, 'location')
  const lat = number(row.lat, 'latitude'), lon = number(row.lon, 'longitude')
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) invalid('coordinates')
  return { id: text(row.id, 'location id'), name: text(row.name, 'location name'), lat, lon }
}
function annual(value: unknown, start: number, end: number): DailyYear {
  const row = object(value, 'annual record')
  const year = integer(row.year, 'annual year', start, end)
  const expected = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365
  if (row.expected_days !== expected) invalid('calendar-year day count')
  const counts = Object.fromEntries(atlasMetrics.map(metric => {
    const count = object(row[metric], `${year} ${metric}`)
    const available = integer(count.available_days, 'available days', 0, expected)
    const observed = integer(count.observed_count, 'observed count', 0, available)
    const exact = count.value === null ? null : integer(count.value, 'exact annual value', 0, expected)
    if (exact !== null && (available !== expected || exact !== observed)) invalid('exact annual value requires complete coverage')
    if (metric !== 'longest_dry_spell') return [metric, { value: exact, observed_count: observed, available_days: available }]
    const startDate = count.start_date === null ? null : text(count.start_date, 'dry-spell start')
    const endDate = count.end_date === null ? null : text(count.end_date, 'dry-spell end')
    if (typeof count.touches_year_boundary !== 'boolean') invalid('dry-spell boundary flag')
    return [metric, { value: exact, observed_count: observed, available_days: available, start_date: startDate, end_date: endDate, touches_year_boundary: count.touches_year_boundary }]
  })) as Pick<DailyYear, DailyMetric>
  return { year, expected_days: expected, ...counts }
}

/** The fixed scan family contains every candidate × index, including unavailable tests. */
export function parseTrendAtlas(input: unknown): TrendAtlasData {
  const root = object(input, 'root')
  // This versioned file must not silently supply full-record rates under another period label.
  if (root.start !== 1981 || root.end !== 2025) invalid('archive period must be 1981–2025')
  const start = root.start, end = root.end, expectedYears = end - start + 1
  const candidates = list(root.candidates, 'candidates').map(location)
  const expanded = root.schema_version === 2
  if (root.schema_version !== undefined && !expanded) invalid('unsupported archive schema')
  if (candidates.length < 2 || candidates.length > 2000 || new Set(candidates.map(item => item.id)).size !== candidates.length) invalid('distinct candidate points')
  const familySize = candidates.length * atlasMetrics.length
  if (root.family_size !== familySize) invalid('correction family must contain every candidate and all four indices')
  // Legacy saved example findings have their original ten-point correction scope.
  if (!expanded && candidates.length !== 10) invalid('legacy archive requires its original ten candidates')
  const rawProbabilities: number[] = [], adjustedProbabilities: (number | null)[] = []
  const points = list(root.results, 'results').map(value => {
    const row = object(value, 'point result'), place = location(row.location)
    const candidate = candidates.find(item => item.id === place.id)
    if (!candidate || candidate.lat !== place.lat || candidate.lon !== place.lon || candidate.name !== place.name) invalid('result does not match fixed candidate')
    const years = list(row.years, 'annual records').map(value => annual(value, start, end)).sort((a, b) => a.year - b.year)
    if (new Set(years.map(item => item.year)).size !== years.length) invalid('duplicate annual year')
    const trends = object(row.trends, 'trends')
    if (trends.start !== start || trends.end !== end || trends.latitude !== place.lat || trends.longitude !== place.lon) invalid('trend place or period mismatch')
    const rawMetrics = object(trends.metrics, 'trend metrics')
    if (Object.keys(rawMetrics).sort().join(',') !== [...atlasMetrics].sort().join(',')) invalid('exactly four prespecified daily indices')
    const metrics = Object.fromEntries(atlasMetrics.map(metric => {
      const result = object(rawMetrics[metric], `trend ${metric}`)
      const complete = years.filter(year => year[metric].value !== null)
      const completeYears = integer(result.complete_years, 'complete years', 0, expectedYears)
      const firstYear = complete[0]?.year ?? null, lastYear = complete.at(-1)?.year ?? null
      if (completeYears !== complete.length || result.expected_years !== expectedYears || result.first_year !== firstYear || result.last_year !== lastYear) invalid('trend coverage does not match annual values')
      if (result.nonzero_years !== complete.filter(row => row[metric].value !== 0).length) invalid('nonzero-year count')
      const pHolm = probability(expanded ? result.p_holm_scan : result.p_holm_40, 'scan-adjusted probability')
      const warnings = strings(result.warnings, 'trend warnings')
      let slope: number | null = null, ci95: [number, number] | null = null, fit: AtlasMetric['fit'] = null, rawP: number | null = null
      if (result.analysis !== null) {
        const analysis = object(result.analysis, 'trend analysis')
        slope = number(analysis.slope_per_decade, 'slope per decade')
        const slopePerYear = number(analysis.slope_per_year, 'slope per year')
        if (!near(slope, 10 * slopePerYear) || analysis.sample_size !== completeYears) invalid('trend slope units or sample size')
        const referenceYear = integer(analysis.reference_year, 'trend reference year', start, end)
        if (referenceYear !== firstYear) invalid('trend reference year')
        fit = { referenceYear, intercept: number(analysis.intercept, 'trend intercept'), slopePerYear }
        if (completeYears < 20 || completeYears / expectedYears < 0.8) invalid('trend needs twenty complete years and eighty percent coverage')
        // Recompute the OLS line independently from the exact annual values.
        const meanYear = complete.reduce((sum, row) => sum + row.year, 0) / completeYears
        const meanValue = complete.reduce((sum, row) => sum + row[metric].value!, 0) / completeYears
        const numerator = complete.reduce((sum, row) => sum + (row.year - meanYear) * (row[metric].value! - meanValue), 0)
        const denominator = complete.reduce((sum, row) => sum + (row.year - meanYear) ** 2, 0)
        const expectedSlope = numerator / denominator
        if (!near(slopePerYear, expectedSlope) || !near(fit.intercept, meanValue + expectedSlope * (referenceYear - meanYear))) invalid('OLS line does not match exact annual values')
        rawP = probability(analysis.p_value, 'raw probability')
        if (analysis.ci95_per_decade !== null) {
          const bounds = list(analysis.ci95_per_decade, 'individual 95% interval').map(value => number(value, 'interval bound'))
          if (bounds.length !== 2 || bounds[0] > slope || bounds[1] < slope) invalid('individual 95% interval bounds')
          ci95 = [bounds[0], bounds[1]]
        }
      }
      if ((rawP === null) !== (pHolm === null) || (rawP === null) !== (ci95 === null)) invalid('inference availability mismatch')
      if (pHolm !== null && (slope === null || pHolm < rawP! - 1e-12)) invalid('adjusted probability below raw probability')
      const significant = pHolm === null ? null : pHolm < 0.05
      if (result.significant_across_scan !== significant || significant && slope === 0) invalid('scan significance flag')
      rawProbabilities.push(rawP ?? 1)
      adjustedProbabilities.push(pHolm)
      const evidence: AtlasEvidence = pHolm === null ? 'unavailable' : pHolm >= 0.05 ? 'unresolved' : slope! > 0 ? 'increase' : 'decrease'
      return [metric, { slope, ci95, pHolm, evidence, completeYears, firstYear, lastYear, warnings, fit }]
    })) as Record<DailyMetric, AtlasMetric>
    const sources = list(row.sources, 'sources').map((value): AtlasSource => {
      const source = object(value, 'source')
      const url = text(source.source_url, 'source URL')
      let parsed: URL
      try { parsed = new URL(url) } catch { invalid('source URL') }
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'power.larc.nasa.gov') invalid('NASA POWER source URL')
      if (source.data_origin !== 'live' && source.data_origin !== 'cache') invalid('source origin')
      const sourceStart = integer(source.start, 'source start', start, end), sourceEnd = integer(source.end, 'source end', start, end)
      if (sourceStart > sourceEnd || parsed.pathname !== '/api/temporal/daily/point' || parsed.searchParams.get('time-standard') !== 'LST'
        || parsed.searchParams.get('latitude') === null || parsed.searchParams.get('longitude') === null
        || Number(parsed.searchParams.get('latitude')) !== place.lat || Number(parsed.searchParams.get('longitude')) !== place.lon
        || parsed.searchParams.get('start') !== `${sourceStart}0101` || parsed.searchParams.get('end') !== `${sourceEnd}1231`
        || [...(parsed.searchParams.get('parameters') ?? '').split(',')].sort().join(',') !== 'PRECTOTCORR,T2M_MAX,T2M_MIN') invalid('source place, period or daily variables')
      return { start: sourceStart, end: sourceEnd, source_url: url, retrieved_at: dateTime(source.retrieved_at, 'source retrieval date'), data_origin: source.data_origin }
    })
    const coveredYears = sources.flatMap(source => Array.from({ length: source.end - source.start + 1 }, (_, index) => source.start + index))
    if (new Set(coveredYears).size !== coveredYears.length) invalid('overlapping source periods')
    if (years.some(row => atlasMetrics.some(metric => row[metric].available_days > 0) && !coveredYears.includes(row.year))) invalid('annual data requires original NASA source provenance for its year')
    return { location: place, years, metrics, sources } satisfies AtlasPoint
  })
  if (points.length !== candidates.length || new Set(points.map(point => point.location.id)).size !== candidates.length) invalid('missing or duplicate candidate result')
  // Independently verify the archived global Holm correction, preserving unavailable slots at p=1.
  const ordered = rawProbabilities.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p)
  let previous = 0
  ordered.forEach(({ p, index }, rank) => {
    previous = Math.min(1, Math.max(previous, p * (familySize - rank)))
    const archived = adjustedProbabilities[index]
    if (archived !== null && !probabilityNear(archived, previous)) invalid('global Holm correction does not match the full scan family')
  })
  const retrievalDates = points.flatMap(point => point.sources.map(source => source.retrieved_at))
  if (!retrievalDates.length) invalid('NASA source provenance missing')
  const retrievedAt = retrievalDates.reduce((latest, date) => Date.parse(date) > Date.parse(latest) ? date : latest)
  return { start, end, familySize, candidateCount: candidates.length,
    availablePointCount: points.filter(point => point.years.some(row => atlasMetrics.some(metric => row[metric].value !== null))).length,
    correction: text(root.correction, 'correction'), method: text(root.method, 'method'), retrievedAt,
    generatedAt: dateTime(root.finished_at, 'archive completion date'), sourceHref: expanded ? atlasSourceHref : legacyAtlasSourceHref, points }
}

export async function loadTrendAtlas(signal?: AbortSignal): Promise<TrendAtlasData> {
  let response = await fetch(atlasSourceHref, { signal })
  // An older checkout/deployment can still serve the original saved examples.
  // Never conceal a corrupt expanded archive or a service failure with old data.
  if (response.status === 404) response = await fetch(legacyAtlasSourceHref, { signal })
  if (!response.ok) throw new Error('The saved NASA trend atlas could not be loaded.')
  return parseTrendAtlas(await response.json())
}

export function atlasAnnualValue(point: AtlasPoint, metric: DailyMetric, year: number): number | null {
  const row = point.years.find(row => row.year === year)
  return row && row[metric].available_days === row.expected_days ? row[metric].value : null
}

/** One domain for all points, and all animation years. Changing a year never rescales the marks. */
export function atlasScale(data: TrendAtlasData, metric: DailyMetric, mode: 'trend' | 'year'): AtlasScale {
  const values = mode === 'trend' ? data.points.map(point => point.metrics[metric].slope)
    : data.points.flatMap(point => point.years.map(row => atlasAnnualValue(point, metric, row.year)))
  return { maximum: Math.max(1, ...values.filter((value): value is number => value !== null).map(Math.abs)), signed: mode === 'trend', unit: mode === 'trend' ? 'days / decade' : 'days' }
}

/** Circle area, not radius, is proportional to magnitude above a small selectable center. */
export function atlasMarker(value: number | null, scale: AtlasScale): { color: string; radius: number } {
  if (value === null || !Number.isFinite(value)) return { color: '#b6bfc4', radius: 5 }
  const fraction = Math.min(1, Math.abs(value) / Math.max(1, scale.maximum))
  const radius = Math.sqrt(25 + fraction * (196 - 25))
  const color = !scale.signed ? '#3c607a' : value < 0 ? '#527e99' : value === 0 ? '#7f8b91' : '#b66b4e'
  return { color, radius }
}
