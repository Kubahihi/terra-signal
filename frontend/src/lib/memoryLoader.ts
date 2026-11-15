import type { Observation, SeriesResponse } from '../types/api'
import type { MemoryDataset, MemoryRole, MemorySource } from '../types/memory'
import type { SoilResponse, VegetationData } from '../types/relationships'
import { getSeries } from './api.ts'
import { getSoil, getVegetation, precipitationTotals } from './relationships.ts'

type Query = { lat: number; lon: number; start: number; end: number }
const weatherFootprint = 'NASA POWER / MERRA-2 weather grid cell, approximately 0.5° × 0.625°'
const roles: MemoryRole[] = ['rain', 'soil', 'vegetation']

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid memory data: ${label}.`)
  return value as Record<string, unknown>
}
function finite(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid memory data: ${label}.`)
  return value
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid memory data: ${label}.`)
  return value
}
function timestamp(value: unknown, label: string) {
  const stamp = text(value, label)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) || !Number.isFinite(Date.parse(stamp)) || Date.parse(stamp) > Date.now() + 60_000) throw new Error(`Invalid memory data: ${label}.`)
  return stamp
}
function checkQuery(query: Query) {
  if (!Number.isFinite(query.lat) || Math.abs(query.lat) > 90 || !Number.isFinite(query.lon) || Math.abs(query.lon) > 180 || !Number.isInteger(query.start) || !Number.isInteger(query.end) || query.start < 2001 || query.end < query.start || query.end >= new Date().getUTCFullYear()) throw new Error('Choose valid coordinates and complete calendar years from 2001.')
}
function observations(input: unknown, role: MemoryRole, start: number, end: number): Observation[] {
  if (!Array.isArray(input)) throw new Error(`Invalid memory data: ${role} observations.`)
  const found = new Map<string, number | null>()
  for (const entry of input) {
    const row = object(entry, `${role} month`)
    const date = text(row.date, `${role} date`)
    if (!/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(date) || Number(date.slice(0, 4)) < start || Number(date.slice(0, 4)) > end || found.has(date)) throw new Error(`Invalid memory data: duplicate or out-of-period ${role} month.`)
    const value = row.value === null ? null : finite(row.value, `${role} value`)
    if (value !== null && (role === 'rain' && value < 0 || role === 'soil' && (value < 0 || value > 1) || role === 'vegetation' && (value < -0.2 || value > 1))) throw new Error(`Invalid memory data: ${role} value outside its physical range.`)
    found.set(date, value)
  }
  const result: Observation[] = []
  for (let year = start; year <= end; year++) for (let month = 1; month <= 12; month++) {
    const date = `${year}-${String(month).padStart(2, '0')}-01`
    result.push({ date, value: found.get(date) ?? null })
  }
  return result
}
function source(input: unknown): MemorySource {
  const row = object(input, 'source')
  if (!roles.includes(row.role as MemoryRole)) throw new Error('Invalid memory data: source role.')
  if (!['live', 'cache', 'snapshot', 'import'].includes(row.data_origin as string)) throw new Error('Invalid memory data: source origin.')
  const url = text(row.source_url, 'source URL')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid memory data: original source URL must use HTTPS.')
  return {
    role: row.role as MemoryRole,
    source: text(row.source, 'source name'),
    source_url: url,
    retrieved_at: row.retrieved_at === null && row.data_origin === 'import' ? null : timestamp(row.retrieved_at, 'original retrieval date'),
    data_origin: row.data_origin as MemorySource['data_origin'],
    spatial_support: text(row.spatial_support, 'spatial footprint'),
    ...(row.product === undefined ? {} : { product: text(row.product, 'product') }),
    ...(row.collection === undefined ? {} : { collection: text(row.collection, 'collection') }),
  }
}

/** A stored example uses the same monthly/value/provenance contract as live requests. */
export function parseMemoryDataset(input: unknown): MemoryDataset {
  const root = object(input, 'root'), location = object(root.location, 'location')
  if (root.schemaVersion !== 1) throw new Error('Invalid memory data: unsupported schema version.')
  const query = { lat: finite(location.lat, 'latitude'), lon: finite(location.lon, 'longitude'), start: finite(root.start, 'start year'), end: finite(root.end, 'end year') }
  checkQuery(query)
  const name = text(location.name, 'location name')
  if (!Array.isArray(root.sources) || !Array.isArray(root.warnings) || root.warnings.some(value => typeof value !== 'string')) throw new Error('Invalid memory data: sources or warnings.')
  const sources = root.sources.map(source)
  const data: MemoryDataset = {
    schemaVersion: 1, location: { name, lat: query.lat, lon: query.lon, ...(typeof location.id === 'string' ? { id: location.id } : {}) },
    start: query.start, end: query.end,
    rain: observations(root.rain, 'rain', query.start, query.end),
    soil: observations(root.soil, 'soil', query.start, query.end),
    vegetation: observations(root.vegetation, 'vegetation', query.start, query.end),
    sources, warnings: [...root.warnings] as string[],
    ...(root.savedAt === undefined ? {} : { savedAt: timestamp(root.savedAt, 'archive generation date') }),
  }
  for (const role of roles) if (data[role].some(row => row.value !== null) && !sources.some(row => row.role === role)) throw new Error(`Invalid memory data: ${role} observations lack original provenance.`)
  for (const row of sources.filter(row => row.role !== 'vegetation')) {
    const url = new URL(row.source_url)
    if (row.data_origin === 'import') continue
    const start = Number(url.searchParams.get('start')), end = Number(url.searchParams.get('end'))
    if (url.hostname !== 'power.larc.nasa.gov' || url.pathname !== '/api/temporal/monthly/point' || Number(url.searchParams.get('latitude')) !== query.lat || Number(url.searchParams.get('longitude')) !== query.lon || !url.searchParams.has('latitude') || !url.searchParams.has('longitude') || !url.searchParams.has('start') || !url.searchParams.has('end') || !Number.isInteger(start) || !Number.isInteger(end) || start < 1981 || end >= new Date().getUTCFullYear() || start > query.start || end < query.end || url.searchParams.get('parameters') !== (row.role === 'rain' ? 'PRECTOTCORR' : 'GWETROOT')) throw new Error('Invalid memory data: original NASA request does not cover this place, parameter and period.')
  }
  if (root.vegetationQuality !== undefined) {
    if (!Array.isArray(root.vegetationQuality)) throw new Error('Invalid memory data: NDVI composite quality.')
    const seen = new Set<string>()
    const values = new Map(data.vegetation.map(row => [row.date, row.value]))
    data.vegetationQuality = root.vegetationQuality.map(input => {
      const row = object(input, 'NDVI composite quality')
      const date = text(row.date, 'NDVI quality date')
      const available = finite(row.available_composites, 'available NDVI composites')
      const expected = finite(row.expected_composites, 'expected NDVI composites')
      if (!values.has(date) || seen.has(date) || !Number.isInteger(available) || !Number.isInteger(expected) || available < 0 || expected < 1 || available > expected || values.get(date) !== null && available !== expected) throw new Error('Invalid memory data: NDVI quality does not match monthly observations.')
      seen.add(date)
      return { date, available_composites: available, expected_composites: expected }
    })
    if (data.vegetation.some(row => row.value !== null && !seen.has(row.date))) throw new Error('Invalid memory data: observed NDVI month lacks composite quality.')
  }
  return data
}

export async function loadMemoryExample(signal: AbortSignal): Promise<MemoryDataset> {
  const response = await fetch('/data/landscape-memory-example.json', { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('The saved landscape investigation is unavailable. Try loading the selected point instead.')
  return parseMemoryDataset(await response.json())
}

function match(query: Query, report: { latitude: number; longitude: number; start: number; end: number }) {
  if (query.lat !== report.latitude || query.lon !== report.longitude || query.start !== report.start || query.end !== report.end) throw new Error('Memory observations do not match the selected place and period.')
}
function powerSource(role: 'rain' | 'soil', report: SeriesResponse | SoilResponse): MemorySource {
  return { role, source: report.source, source_url: report.source_url, retrieved_at: report.retrieved_at, data_origin: report.data_origin, spatial_support: weatherFootprint }
}
function vegetationSources(report: VegetationData): MemorySource[] {
  if (report.product !== 'MOD13Q1' || report.unit !== 'NDVI' || report.collections?.length !== 1 || report.collections[0] !== '061') throw new Error('Memory vegetation requires NASA Terra MOD13Q1 collection 061 NDVI.')
  for (const point of report.series) {
    if (!Number.isInteger(point.available_composites) || !Number.isInteger(point.expected_composites) || point.expected_composites < 1 || point.available_composites < 0 || point.available_composites > point.expected_composites || point.value !== null && point.available_composites !== point.expected_composites) throw new Error('Memory NDVI requires every scheduled composite to pass quality filtering.')
  }
  if (!report.sources?.length) throw new Error('Memory NDVI is missing original catalog and numeric source metadata.')
  return report.sources.map(row => ({ role: 'vegetation', source: report.source, source_url: row.source_url, retrieved_at: row.retrieved_at, data_origin: row.data_origin, spatial_support: report.spatial_support, product: report.product, collection: '061' }))
}

/** Preserve useful observations when one optional provider fails; never invent its values. */
export async function loadMemory(query: Query, name: string, signal: AbortSignal, onProgress: (message: string, completed: number, total: number) => void): Promise<MemoryDataset> {
  checkQuery(query)
  signal.throwIfAborted()
  const total = query.end - query.start + 3
  onProgress('Loading NASA precipitation and root-zone soil wetness…', 0, total)
  const settled = await Promise.allSettled([
    getSeries({ ...query, variable: 'PRECTOTCORR' }, false, signal),
    getSoil(query, false, signal),
  ])
  signal.throwIfAborted()
  if (settled[0].status === 'rejected') throw settled[0].reason
  const rain = settled[0].value
  match(query, rain)
  const rainfall = precipitationTotals(rain)
  const sources = [powerSource('rain', rain)]
  const warnings = [...rain.warnings, 'Precipitation rates converted to calendar-month totals using actual month lengths, including leap years.']
  let soil: Observation[] = []
  if (settled[1].status === 'fulfilled') {
    const response = settled[1].value
    match(query, response)
    if (response.parameter !== 'GWETROOT' || response.unit !== '1') throw new Error('Memory soil data require dimensionless NASA GWETROOT.')
    soil = response.series
    sources.push(powerSource('soil', response))
    warnings.push(...response.warnings)
  } else warnings.push(`Root-zone soil wetness was unavailable. Its observations and recovery remain unknown. ${settled[1].reason instanceof Error ? settled[1].reason.message : ''}`)
  const vegetation: Observation[] = []
  const vegetationQuality: NonNullable<MemoryDataset['vegetationQuality']> = []
  let consecutiveFailures = 0
  for (let year = query.start; year <= query.end; year++) {
    signal.throwIfAborted()
    onProgress(`Loading quality-filtered MODIS vegetation: ${year}…`, year - query.start + 2, total)
    try {
      const report = await getVegetation({ ...query, start: year, end: year }, false, signal, () => {})
      match({ ...query, start: year, end: year }, report)
      sources.push(...vegetationSources(report))
      // Validate each response before combining it, preserving true zero and missing values.
      vegetation.push(...observations(report.series, 'vegetation', year, year))
      vegetationQuality.push(...report.series.map(({ date, available_composites, expected_composites }) => ({ date, available_composites, expected_composites })))
      warnings.push(...report.warnings)
      consecutiveFailures = 0
    } catch (cause) {
      signal.throwIfAborted()
      consecutiveFailures++
      warnings.push(`MODIS ${year} is unavailable and remains missing. ${cause instanceof Error ? cause.message : ''}`)
      if (consecutiveFailures >= 3) {
        if (year < query.end) warnings.push(`Stopped after three consecutive MODIS failures. Years ${year + 1}–${query.end} were not downloaded and remain missing. Retry to reuse already cached responses.`)
        break
      }
    }
  }
  onProgress('Matching calendar months and checking source coverage…', total, total)
  warnings.push('NDVI describes vegetation greenness, not crop yield or a direct measurement of ecosystem recovery. Weather and soil share MERRA-2; MODIS has a smaller footprint. No causal attribution is made.')
  return parseMemoryDataset({ schemaVersion: 1, location: { name, lat: query.lat, lon: query.lon }, start: query.start, end: query.end, rain: rainfall, soil, vegetation, vegetationQuality, sources, warnings: [...new Set(warnings)] })
}
