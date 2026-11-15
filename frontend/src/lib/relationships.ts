import type { SeriesResponse } from '../types/api'
import type { RelationshipDataset, RelationshipRequest, RelationshipResponse, RelationshipSettings, RelationshipSource, SoilResponse, VegetationData } from '../types/relationships'

const baseUrl = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const weatherFootprint = 'NASA POWER / MERRA-2 weather grid cell, approximately 0.5° × 0.625°'

async function request<T>(path: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...init?.headers }, signal })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status}).`)
  if (!body) throw new Error('The service returned an unreadable response.')
  return body as T
}

export const getRelationship = (body: RelationshipRequest, signal?: AbortSignal) => request<RelationshipResponse>('/api/relationships', signal, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
export function getSoil(query: { lat: number; lon: number; start: number; end: number }, refresh: boolean, signal?: AbortSignal) {
  return request<SoilResponse>(`/api/soil?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])), refresh: String(refresh) })}`, signal)
}

export async function getVegetation(query: { lat: number; lon: number; start: number; end: number }, refresh: boolean, signal: AbortSignal, onProgress: (completed: number, total: number) => void): Promise<VegetationData> {
  const first = Math.max(2001, query.start)
  if (first > query.end) throw new Error('MODIS vegetation data are available from 2001 in this workspace. Choose a later period.')
  const total = Math.ceil((query.end - first + 1) / 5)
  const reports: VegetationData[] = []
  for (let start = first; start <= query.end; start += 5) {
    signal.throwIfAborted()
    const end = Math.min(start + 4, query.end)
    const params = new URLSearchParams({ lat: String(query.lat), lon: String(query.lon), start: String(start), end: String(end), refresh: String(refresh) })
    const report = await request<VegetationData>(`/api/vegetation?${params}`, signal)
    if (report.latitude !== query.lat || report.longitude !== query.lon || report.start !== start || report.end !== end || report.product !== 'MOD13Q1' || report.unit !== 'NDVI') throw new Error('Vegetation observations do not match this place, period or product.')
    if (!Number.isFinite(report.pixel_size_m) || report.pixel_size_m! < 200 || report.pixel_size_m! > 300 || !Number.isInteger(report.nrows) || report.nrows! <= 0 || !Number.isInteger(report.ncols) || report.ncols! <= 0 || report.collections?.length !== 1 || !/^\d{3}$/.test(report.collections[0]) || !report.spatial_support?.trim()) throw new Error('Vegetation data require one consistent MODIS collection and a documented pixel footprint.')
    if (!report.sources?.length || report.sources.some(source => !Number.isFinite(Date.parse(source.retrieved_at)) || !['live', 'cache'].includes(source.data_origin) || !source.source_url)) throw new Error('Vegetation data require original source requests and valid retrieval dates.')
    reports.push(report)
    onProgress(reports.length, total)
  }
  const seed = reports[0]
  if (reports.some(report => report.spatial_support !== seed.spatial_support || report.pixel_size_m !== seed.pixel_size_m || report.nrows !== seed.nrows || report.ncols !== seed.ncols || report.collections?.[0] !== seed.collections?.[0])) throw new Error('Vegetation batches have different spatial footprints or MODIS collections; they cannot be combined.')
  const sources = reports.flatMap(report => report.sources ?? [])
  const oldest = sources.reduce((left, right) => Date.parse(left.retrieved_at) <= Date.parse(right.retrieved_at) ? left : right)
  return { ...seed, start: query.start, end: query.end, series: reports.flatMap(report => report.series),
    sources, retrieved_at: oldest.retrieved_at, data_origin: reports.every(report => report.data_origin === 'cache') ? 'cache' : 'live',
    warnings: [...new Set(reports.flatMap(report => report.warnings).concat(query.start < 2001 ? ['MODIS has no observations before 2001 in this analysis; earlier months remain missing.'] : []))] }
}

function sameQuery(left: { latitude: number; longitude: number; start: number; end: number }, right: typeof left) {
  return left.latitude === right.latitude && left.longitude === right.longitude && left.start === right.start && left.end === right.end
}
export function precipitationTotals(data: SeriesResponse) {
  if (data.variable !== 'PRECTOTCORR' || data.unit !== 'mm/day') throw new Error('Monthly precipitation requires NASA mean daily rates in mm/day.')
  return data.series.map(point => {
    const [year, month] = point.date.split('-').map(Number)
    return { date: point.date, value: point.value === null ? null : point.value * new Date(Date.UTC(year, month, 0)).getUTCDate() }
  })
}
function weatherSource(data: SeriesResponse, role: 'x' | 'y'): RelationshipSource {
  return { role, source: data.source, source_url: data.source_url, retrieved_at: data.retrieved_at, data_origin: data.data_origin, spatial_support: weatherFootprint }
}
export function weatherDataset(temperature: SeriesResponse, rain: SeriesResponse): RelationshipDataset {
  if (!sameQuery(temperature, rain) || temperature.variable !== 'T2M' || temperature.unit !== 'C') throw new Error('Weather records must match this place and period, with temperature in C.')
  return { latitude: rain.latitude, longitude: rain.longitude, start: rain.start, end: rain.end, mode: 'weather',
    x: { name: 'Air temperature', unit: '°C', observations: temperature.series }, y: { name: 'Precipitation total', unit: 'mm', observations: precipitationTotals(rain) },
    sources: [weatherSource(temperature, 'x'), weatherSource(rain, 'y')], warnings: [...new Set([...temperature.warnings, ...rain.warnings])] }
}
export function soilDataset(rain: SeriesResponse, soil: SoilResponse): RelationshipDataset {
  if (!sameQuery(rain, soil) || soil.parameter !== 'GWETROOT' || soil.unit !== '1') throw new Error('Soil wetness records must match this place and period, with a dimensionless wetness fraction.')
  return { latitude: rain.latitude, longitude: rain.longitude, start: rain.start, end: rain.end, mode: 'soil',
    x: { name: 'Precipitation total', unit: 'mm', observations: precipitationTotals(rain) }, y: { name: 'Root-zone soil wetness', unit: 'fraction', observations: soil.series },
    sources: [weatherSource(rain, 'x'), { role: 'y', source: soil.source, source_url: soil.source_url, retrieved_at: soil.retrieved_at, data_origin: soil.data_origin, spatial_support: weatherFootprint }],
    warnings: [...new Set([...rain.warnings, ...soil.warnings])] }
}
export function vegetationDataset(rain: SeriesResponse, vegetation: VegetationData): RelationshipDataset {
  if (!sameQuery(rain, vegetation) || vegetation.product !== 'MOD13Q1' || vegetation.unit !== 'NDVI') throw new Error('Vegetation records must match this place, period and MODIS product.')
  const collection = vegetation.collections?.join(', ') ?? vegetation.collection
  const sourceName = vegetation.source + (collection ? `; MODIS collection ${collection}` : '') + (vegetation.filename ? `; ${vegetation.filename}` : '')
  const satellite = { role: 'y' as const, source: sourceName, spatial_support: vegetation.spatial_support, product: vegetation.product, ...(collection ? { collection } : {}) }
  return { latitude: rain.latitude, longitude: rain.longitude, start: rain.start, end: rain.end, mode: 'vegetation',
    x: { name: 'Precipitation total', unit: 'mm', observations: precipitationTotals(rain) }, y: { name: 'Vegetation greenness', unit: 'NDVI', observations: vegetation.series.map(({ date, value }) => ({ date, value })) },
    sources: [weatherSource(rain, 'x'), ...(vegetation.sources?.length ? vegetation.sources.map(source => ({ ...source, ...satellite })) : [{ ...satellite, source_url: vegetation.source_url, retrieved_at: vegetation.retrieved_at ?? null, data_origin: vegetation.data_origin }])],
    warnings: [...new Set([...rain.warnings, ...vegetation.warnings, 'The MODIS vegetation footprint and NASA POWER weather grid have different sizes. This is an exploratory relationship between observations around the same point, not measurements of identical areas.'])] }
}
export function relationshipRequest(data: RelationshipDataset, settings: RelationshipSettings): RelationshipRequest {
  const { latitude, longitude, start, end, x, y } = data
  const monthly = (series: typeof x) => ({ ...series, observations: series.observations.map(({ date, value }) => ({ date, value })) })
  return { latitude, longitude, start, end, x: monthly(x), y: monthly(y), ...settings }
}
export function matchesRelationship(data: RelationshipDataset, settings: RelationshipSettings, result: RelationshipResponse) {
  if (!sameQuery(data, result) || result.x_name !== data.x.name || result.y_name !== data.y.name || result.x_unit !== data.x.unit || result.y_unit !== data.y.unit || result.lag_months !== settings.lag_months || result.month !== settings.month || result.detrended !== settings.detrend || !Array.isArray(result.pairs)) return false
  if (!Number.isInteger(data.start) || !Number.isInteger(data.end) || data.start < 1981 || data.start > data.end || ![0, 1, 2].includes(settings.lag_months) || settings.month !== null && (!Number.isInteger(settings.month) || settings.month < 1 || settings.month > 12)) return false
  const validMonth = (date: string) => /^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(date)
  for (const series of [data.x, data.y]) {
    if (new Set(series.observations.map(point => point.date)).size !== series.observations.length || series.observations.some(point => !validMonth(point.date) || point.value !== null && !Number.isFinite(point.value))) return false
  }
  const xValues = new Map(data.x.observations.map(point => [point.date, point.value]))
  const yValues = new Map(data.y.observations.map(point => [point.date, point.value]))
  const expectedPairs: { x_date: string; y_date: string; x_raw: number; y_raw: number }[] = []
  let expected = 0
  for (let number = data.start * 12; number < (data.end + 1) * 12 - settings.lag_months; number++) {
    if (settings.month !== null && number % 12 + 1 !== settings.month) continue
    expected++
    const format = (value: number) => `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, '0')}-01`
    const xDate = format(number), yDate = format(number + settings.lag_months)
    const x = xValues.get(xDate), y = yValues.get(yDate)
    if (x != null && y != null) expectedPairs.push({ x_date: xDate, y_date: yDate, x_raw: x, y_raw: y })
  }
  if (result.pairs.length !== expectedPairs.length || result.n_pairs !== expectedPairs.length || result.expected_pairs !== expected || !Number.isFinite(result.coverage) || Math.abs(result.coverage - (expected ? expectedPairs.length / expected : 0)) > 1e-12) return false
  const years = new Set(expectedPairs.map(pair => Number(pair.x_date.slice(0, 4))))
  const first = expectedPairs.length ? Number(expectedPairs[0].x_date.slice(0, 4)) : null
  const last = expectedPairs.length ? Number(expectedPairs[expectedPairs.length - 1].y_date.slice(0, 4)) : null
  if (result.n_years !== years.size || result.reference_start !== first || result.reference_end !== last || result.p_value !== null || result.ci95 !== null || result.pearson_r !== null && (!Number.isFinite(result.pearson_r) || Math.abs(result.pearson_r) > 1)) return false
  return result.pairs.every((pair, index) => {
    const expectedPair = expectedPairs[index]
    return pair.x_date === expectedPair.x_date && pair.y_date === expectedPair.y_date && pair.x_raw === expectedPair.x_raw && pair.y_raw === expectedPair.y_raw && Number.isFinite(pair.x) && Number.isFinite(pair.y)
  })
}
export function relationshipCsv(data: RelationshipDataset, settings: RelationshipSettings, result: RelationshipResponse) {
  if (!matchesRelationship(data, settings, result)) throw new Error('Relationship results do not match the selected data and settings.')
  const clean = (value: unknown) => String(value ?? 'unavailable').replace(/[\r\n]+/g, ' ')
  const metadata: [string, unknown][] = [
    ['latitude', data.latitude], ['longitude', data.longitude], ['start_year', data.start], ['end_year', data.end],
    ['x', `${data.x.name} (${data.x.unit})`], ['y', `${data.y.name} (${data.y.unit})`], ['lag_months_y_after_x', settings.lag_months],
    ['x_calendar_month', settings.month ?? 'all'], ['detrended', settings.detrend], ['method', result.method], ['seasonality', result.seasonality],
    ['reference_years', `${result.reference_start ?? 'unavailable'}-${result.reference_end ?? 'unavailable'}`], ['pearson_r', result.pearson_r], ['n_pairs', result.n_pairs], ['expected_pairs', result.expected_pairs], ['coverage', result.coverage],
    ['inference', 'Descriptive correlation; no independent-observation p-value or confidence interval; correlation does not establish causation'],
    ['precipitation_conversion', 'NASA monthly mean daily precipitation rate multiplied by actual calendar-month length, including leap days'],
    ...data.sources.flatMap((source, index): [string, unknown][] => Object.entries(source).map(([key, value]) => [`source_${index + 1}_${key}`, value])),
    ['warnings', [...data.warnings, ...result.warnings].join(' | ')],
  ]
  const paired = new Map(result.pairs.map(pair => [pair.x_date, pair]))
  const xValues = new Map(data.x.observations.map(point => [point.date, point.value]))
  const yValues = new Map(data.y.observations.map(point => [point.date, point.value]))
  const rows = ['x_date,y_date,x_raw,y_raw,x_adjusted,y_adjusted,pair_available']
  for (let year = data.start; year <= data.end; year++) for (let month = 1; month <= 12; month++) {
    if (settings.month !== null && month !== settings.month) continue
    const xDate = `${year}-${String(month).padStart(2, '0')}-01`
    const target = new Date(Date.UTC(year, month - 1 + settings.lag_months, 1))
    if (target.getUTCFullYear() > data.end) continue
    const yDate = target.toISOString().slice(0, 10)
    const pair = paired.get(xDate)
    rows.push([xDate, yDate, xValues.get(xDate) ?? '', yValues.get(yDate) ?? '', pair?.x ?? '', pair?.y ?? '', pair ? 1 : 0].join(','))
  }
  return [...metadata.map(([key, value]) => `# ${key}: ${clean(value)}`), ...rows].join('\r\n')
}
export function relationshipRawCsv(data: RelationshipDataset) {
  const x = new Map(data.x.observations.map(point => [point.date, point.value]))
  const y = new Map(data.y.observations.map(point => [point.date, point.value]))
  const dates = [...new Set([...x.keys(), ...y.keys()])].sort()
  const clean = (value: string) => value.replace(/[\r\n]+/g, ' ')
  return [`# latitude: ${data.latitude}`, `# longitude: ${data.longitude}`, `# start_year: ${data.start}`, `# end_year: ${data.end}`, `# x: ${clean(data.x.name)} (${clean(data.x.unit)})`, `# y: ${clean(data.y.name)} (${clean(data.y.unit)})`,
    ...data.sources.map(source => `# ${source.role}_source: ${clean(source.source)} | ${clean(source.source_url)} | ${source.retrieved_at ?? 'imported; original retrieval unknown'} | ${source.data_origin} | ${clean(source.spatial_support)}`),
    `# warnings: ${clean(data.warnings.join(' | '))}`,
    'date,x_raw,y_raw', ...dates.map(date => `${date},${x.get(date) ?? ''},${y.get(date) ?? ''}`)].join('\r\n')
}
