import test from 'node:test'
import assert from 'node:assert/strict'
import { getVegetation, matchesRelationship, precipitationTotals, relationshipCsv, relationshipRawCsv, relationshipRequest, vegetationDataset, weatherDataset } from '../src/lib/relationships.ts'

const settings = { lag_months: 1, month: 6, detrend: true }
const location = { latitude: 48.85, longitude: 16.85, start: 2020, end: 2025 }

function weather(variable, overrides = {}) {
  const series = []
  for (let year = location.start; year <= location.end; year++) for (let month = 1; month <= 12; month++) series.push({ date: `${year}-${String(month).padStart(2, '0')}-01`, value: variable === 'T2M' ? month + year % 4 : 2 })
  return { ...location, variable, unit: variable === 'T2M' ? 'C' : 'mm/day', series, source: 'NASA POWER test fixture',
    source_url: 'https://example.test/nasa', retrieved_at: '2026-11-01T00:00:00Z', data_origin: 'cache', warnings: ['Weather grid is model data.'], analysis: null, ...overrides }
}

function vegetation(overrides = {}) {
  return { ...location, product: 'MOD13Q1', unit: 'NDVI', source: 'NASA MODIS test fixture', source_url: 'https://example.test/modis',
    series: weather('T2M').series.map((point, i) => ({ ...point, value: i % 3 === 0 ? 0 : 0.4, available_composites: 2, expected_composites: 2 })),
    pixel_size_m: 231.656358264, nrows: 9, ncols: 9, collections: ['061'], spatial_support: '9 by 9 native MODIS pixels',
    retrieved_at: '2026-11-01T00:00:00Z', data_origin: 'cache', warnings: ['Complete quality-filtered composites only.'],
    sources: [{ source_url: 'https://example.test/modis?batch=1', retrieved_at: '2026-11-01T00:00:00Z', data_origin: 'cache' }], ...overrides }
}

// A contract fixture, deliberately without a computed significance claim.
function resultFor(data, selected = settings) {
  const pairs = [], expected = []
  for (let year = data.start; year <= data.end; year++) for (let month = 1; month <= 12; month++) {
    if (selected.month !== null && selected.month !== month) continue
    const target = new Date(Date.UTC(year, month - 1 + selected.lag_months, 1))
    if (target.getUTCFullYear() > data.end) continue
    const x_date = `${year}-${String(month).padStart(2, '0')}-01`, y_date = target.toISOString().slice(0, 10)
    expected.push(x_date)
    const x = data.x.observations.find(point => point.date === x_date)?.value
    const y = data.y.observations.find(point => point.date === y_date)?.value
    if (x != null && y != null) pairs.push({ x_date, y_date, x_raw: x, y_raw: y, x: x - 5, y: y - 10 })
  }
  return { latitude: data.latitude, longitude: data.longitude, start: data.start, end: data.end,
    lag_months: selected.lag_months, month: selected.month, detrended: selected.detrend,
    x_name: data.x.name, y_name: data.y.name, x_unit: data.x.unit, y_unit: data.y.unit,
    pairs, pearson_r: null, n_pairs: pairs.length, n_years: new Set(pairs.map(pair => pair.x_date.slice(0, 4))).size,
    expected_pairs: expected.length, coverage: pairs.length / expected.length,
    reference_start: pairs.length ? Number(pairs[0].x_date.slice(0, 4)) : null,
    reference_end: pairs.length ? Number(pairs.at(-1).y_date.slice(0, 4)) : null,
    method: 'Descriptive contract fixture', seasonality: 'Calendar-month reference', p_value: null, ci95: null, warnings: ['Correlation does not establish causation.'] }
}

test('precipitation rates become calendar totals with leap days and keep true zero distinct from missing', () => {
  const data = weather('PRECTOTCORR', { series: [
    { date: '2023-02-01', value: 2 }, { date: '2024-02-01', value: 2 },
    { date: '2024-03-01', value: 0 }, { date: '2024-04-01', value: null },
  ] })
  assert.deepEqual(precipitationTotals(data).map(point => point.value), [56, 58, 0, null])
  assert.throws(() => precipitationTotals({ ...data, unit: 'mm' }), /mm\/day/)
  assert.throws(() => precipitationTotals({ ...data, variable: 'T2M' }), /mm\/day/)
})

test('another place or period cannot be relabelled as weather or vegetation at the chosen point', () => {
  assert.throws(() => weatherDataset(weather('T2M'), weather('PRECTOTCORR', { latitude: 49 })), /match/)
  assert.throws(() => vegetationDataset(weather('PRECTOTCORR'), vegetation({ end: 2024 })), /match/)
  assert.throws(() => vegetationDataset(weather('PRECTOTCORR'), vegetation({ longitude: 18 })), /match/)
})

test('NDVI quality metadata stays in provenance but only date/value reaches the strict monthly analysis contract', () => {
  const data = vegetationDataset(weather('PRECTOTCORR'), vegetation())
  assert.deepEqual(Object.keys(data.y.observations[0]).sort(), ['date', 'value'])
  const request = relationshipRequest(data, settings)
  assert.deepEqual(Object.keys(request.y.observations[0]).sort(), ['date', 'value'])
  assert.equal(data.sources[1].collection, '061')
  assert.equal(data.sources[1].product, 'MOD13Q1')
  assert.match(data.sources[1].source, /collection 061/)
  const imported = vegetationDataset(weather('PRECTOTCORR'), vegetation({ data_origin: 'import', collections: undefined, collection: '006', filename: 'filtered_scaled_250m_16_days_NDVI.csv', sources: undefined, retrieved_at: undefined }))
  assert.match(imported.sources[1].source, /collection 006/)
  assert.match(imported.sources[1].source, /filtered_scaled/)
  assert.equal(imported.sources[1].retrieved_at, null)
})

test('vegetation batches preserve the oldest source date and reject footprint or collection changes', async () => {
  const originalFetch = globalThis.fetch
  const report = (url, changed = {}) => {
    const params = new URL(String(url), 'http://localhost').searchParams
    const start = Number(params.get('start')), end = Number(params.get('end'))
    return vegetation({ latitude: 48.85, longitude: 16.85, start, end, series: [],
      sources: [{ source_url: `https://example.test/modis?start=${start}`, retrieved_at: start === 2001 ? '2026-11-10T00:00:00Z' : '2026-10-01T00:00:00Z', data_origin: 'cache' }],
      ...(start === 2006 ? changed : {}) })
  }
  try {
    globalThis.fetch = async url => new Response(JSON.stringify(report(url)))
    const progress = []
    const query = { lat: 48.85, lon: 16.85, start: 2001, end: 2010 }
    const data = await getVegetation(query, false, new AbortController().signal, (...args) => progress.push(args))
    assert.equal(data.retrieved_at, '2026-10-01T00:00:00Z')
    assert.deepEqual(progress, [[1, 2], [2, 2]])
    assert.equal(data.sources.length, 2)
    for (const changes of [{ collections: ['006'] }, { pixel_size_m: 250 }, { nrows: 7 }, { spatial_support: 'Another rectangle' }]) {
      globalThis.fetch = async url => new Response(JSON.stringify(report(url, changes)))
      await assert.rejects(getVegetation(query, false, new AbortController().signal, () => {}), /different spatial footprints or MODIS collections/)
    }
  } finally { globalThis.fetch = originalFetch }
})

test('a result from old observations, an incorrect lag or inconsistent coverage cannot be exported', () => {
  const data = weatherDataset(weather('T2M'), weather('PRECTOTCORR'))
  const result = resultFor(data)
  assert.equal(matchesRelationship(data, settings, result), true)
  const changed = structuredClone(data)
  changed.y.observations.find(point => point.date === '2022-07-01').value += 1
  assert.equal(matchesRelationship(changed, settings, result), false)
  assert.throws(() => relationshipCsv(changed, settings, result), /do not match/)
  for (const alter of [
    response => { response.pairs[0].y_date = '2020-08-01' },
    response => { response.pairs[0].x = Infinity },
    response => { response.n_pairs += 1 },
    response => { response.coverage = 0.5 },
    response => { response.reference_start = 1981 },
    response => { response.pearson_r = 1.1 },
    response => { response.pairs.push(response.pairs[0]) },
  ]) {
    const incorrect = structuredClone(result)
    alter(incorrect)
    assert.equal(matchesRelationship(data, settings, incorrect), false)
  }
})

test('raw and adjusted CSV preserve warnings, collection provenance, true zeros and missing pairs', () => {
  const rain = weather('PRECTOTCORR')
  rain.series.find(point => point.date === '2020-06-01').value = 0
  const modis = vegetation()
  modis.series.find(point => point.date === '2021-07-01').value = null
  const data = vegetationDataset(rain, modis)
  const result = resultFor(data)
  const csv = relationshipCsv(data, settings, result)
  assert.match(csv, /# source_2_collection: 061/)
  const rows = csv.split('\r\n').filter(line => !line.startsWith('#'))
  assert.equal(rows.find(line => line.startsWith('2020-06-01,2020-07-01,')).split(',')[2], '0')
  const missing = rows.find(line => line.startsWith('2021-06-01,2021-07-01,')).split(',')
  assert.equal(missing[3], '')
  assert.equal(missing[6], '0')
  const raw = relationshipRawCsv(data)
  assert.match(raw, /# warnings: .*Complete quality-filtered composites only/)
  assert.match(raw, /collection 061/)
  assert.match(raw, /2021-07-01,62,\r?\n/)
})
