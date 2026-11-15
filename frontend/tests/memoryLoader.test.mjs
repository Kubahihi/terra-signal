import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseMemoryDataset, loadMemoryExample, loadMemory } from '../src/lib/memoryLoader.ts'

const query = { lat: 50.0755, lon: 14.4378, start: 2001, end: 2002 }
const stamp = '2026-11-01T00:00:00Z'
const sourceUrl = (role, overrides = {}) => `https://power.larc.nasa.gov/api/temporal/monthly/point?${new URLSearchParams({ latitude: String(query.lat), longitude: String(query.lon), start: String(query.start), end: String(query.end), parameters: role === 'rain' ? 'PRECTOTCORR' : 'GWETROOT', ...overrides })}`
const source = role => ({ role, source: 'NASA test fixture', source_url: role === 'vegetation' ? 'https://planetarycomputer.microsoft.com/api/stac/v1/search' : sourceUrl(role), retrieved_at: stamp, data_origin: 'cache', spatial_support: role === 'vegetation' ? '9 × 9 native MODIS pixels' : 'NASA POWER MERRA-2 grid cell', ...(role === 'vegetation' ? { product: 'MOD13Q1', collection: '061' } : {}) })
const monthly = (value, start = query.start, end = query.end) => Array.from({ length: (end - start + 1) * 12 }, (_, index) => ({ date: `${start + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`, value }))
function dataset(overrides = {}) {
  return { schemaVersion: 1, location: { name: 'Fixture', lat: query.lat, lon: query.lon }, start: query.start, end: query.end, rain: monthly(20), soil: monthly(0.4), vegetation: monthly(0.6), sources: ['rain', 'soil', 'vegetation'].map(source), warnings: [], ...overrides }
}
function rain(overrides = {}) {
  return { latitude: query.lat, longitude: query.lon, start: query.start, end: query.end, variable: 'PRECTOTCORR', unit: 'mm/day', series: monthly(2), warnings: [], source: 'NASA POWER fixture', source_url: sourceUrl('rain'), retrieved_at: stamp, data_origin: 'cache', analysis: null, ...overrides }
}
function soil(overrides = {}) {
  return { ...rain(), parameter: 'GWETROOT', unit: '1', series: monthly(0.4), source_url: sourceUrl('soil'), ...overrides }
}
function vegetation(year, overrides = {}) {
  // The 23 annual composites leave October with one start in normal years,
  // and November with one start in leap years; every other month has two.
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return { latitude: query.lat, longitude: query.lon, start: year, end: year, product: 'MOD13Q1', unit: 'NDVI', series: monthly(0.6, year, year).map(row => {
    const count = Number(row.date.slice(5, 7)) === (leap ? 11 : 10) ? 1 : 2
    return { ...row, available_composites: count, expected_composites: count }
  }), source: 'NASA MODIS fixture', source_url: 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-13Q1-061', spatial_support: '9 × 9 native MODIS pixels', pixel_size_m: 231.656358264, nrows: 9, ncols: 9, collections: ['061'], sources: [{ source_url: `https://planetarycomputer.microsoft.com/api/stac/v1/search?year=${year}`, retrieved_at: stamp, data_origin: 'cache' }], retrieved_at: stamp, data_origin: 'cache', warnings: [], ...overrides }
}

test('memory parser retains true zero and negative valid NDVI while explicit calendar gaps stay null', () => {
  const parsed = parseMemoryDataset(dataset({ rain: [{ date: '2001-02-01', value: 0 }], vegetation: [{ date: '2001-02-01', value: -0.1 }] }))
  assert.equal(parsed.rain.length, 24)
  assert.equal(parsed.rain[0].value, null)
  assert.equal(parsed.rain[1].value, 0)
  assert.equal(parsed.vegetation[1].value, -0.1)
  assert.equal(parsed.soil[0].value, 0.4)
})

test('memory parser rejects unsupported dates, duplicates and nonfinite or physically impossible values', () => {
  for (const date of ['2001-02-02', '2001-13-01', '2000-12-01']) assert.throws(() => parseMemoryDataset(dataset({ rain: [{ date, value: 2 }] })), /month/)
  assert.throws(() => parseMemoryDataset(dataset({ rain: [...monthly(20), { date: '2001-01-01', value: 20 }] })), /duplicate/)
  for (const [role, value] of [['rain', -1], ['rain', Infinity], ['soil', 1.1], ['vegetation', -0.21], ['vegetation', NaN]]) assert.throws(() => parseMemoryDataset(dataset({ [role]: [{ date: '2001-01-01', value }] })), /value/)
})

test('memory provenance cannot relabel another place, parameter, period or retrieval date', () => {
  for (const overrides of [{ latitude: '0' }, { parameters: 'T2M' }, { start: '2002' }, { end: '2001' }]) assert.throws(() => parseMemoryDataset(dataset({ sources: [{ ...source('rain'), source_url: sourceUrl('rain', overrides) }, source('soil'), source('vegetation')] })), /original NASA request/)
  assert.throws(() => parseMemoryDataset(dataset({ sources: [source('rain'), source('soil')] })), /lack original provenance/)
  assert.throws(() => parseMemoryDataset(dataset({ sources: [{ ...source('rain'), retrieved_at: '2999-01-01T00:00:00Z' }, source('soil'), source('vegetation')] })), /retrieval/)
  assert.throws(() => parseMemoryDataset(dataset({ sources: [{ ...source('rain'), retrieved_at: '2026-01-01T00:00:00' }, source('soil'), source('vegetation')] })), /retrieval/)
})

test('missing optional series is allowed only as unknown observations, never invented values', () => {
  const parsed = parseMemoryDataset(dataset({ soil: [], vegetation: [], sources: [source('rain')] }))
  assert.equal(parsed.soil.filter(row => row.value !== null).length, 0)
  assert.equal(parsed.vegetation.filter(row => row.value !== null).length, 0)
})

test('NDVI composite quality is retained and cannot turn an incomplete month into an observed value', () => {
  const row = { date: '2001-01-01', available_composites: 2, expected_composites: 2 }
  const raw = dataset({ vegetation: [{ date: row.date, value: 0.5 }], vegetationQuality: [row] })
  assert.deepEqual(parseMemoryDataset(raw).vegetationQuality, [row])
  assert.throws(() => parseMemoryDataset({ ...raw, vegetationQuality: [{ ...row, available_composites: 1 }] }), /quality/)
  assert.throws(() => parseMemoryDataset({ ...raw, vegetationQuality: [] }), /lacks composite quality/)
  assert.throws(() => parseMemoryDataset({ ...raw, vegetationQuality: [row, row] }), /quality/)
  const missing = parseMemoryDataset({ ...raw, vegetation: [{ date: row.date, value: null }], vegetationQuality: [{ ...row, available_composites: 0 }] })
  assert.equal(missing.vegetation[0].value, null)
  assert.equal(missing.vegetationQuality[0].available_composites, 0)
})

test('a saved NDVI month cannot lower its expected schedule to make partial coverage look complete', () => {
  const june = { date: '2001-06-01', available_composites: 1, expected_composites: 1 }
  const raw = dataset({ vegetation: [{ date: june.date, value: 0.5 }], vegetationQuality: [june] })
  assert.throws(() => parseMemoryDataset(raw), /scheduled composites/)
  assert.throws(() => parseMemoryDataset({ ...raw, vegetation: [{ date: june.date, value: null }] }), /scheduled composites/)
  const october = { date: '2001-10-01', available_composites: 1, expected_composites: 1 }
  assert.equal(parseMemoryDataset(dataset({ vegetation: [{ date: october.date, value: 0.5 }], vegetationQuality: [october] })).vegetationQuality[0].expected_composites, 1)
})

test('the MODIS monthly schedule respects the leap-day shift rather than assuming two composites per month', () => {
  const sources = ['rain', 'soil', 'vegetation'].map(role => role === 'vegetation' ? source(role) : { ...source(role), source_url: sourceUrl(role, { end: '2004' }) })
  const base = dataset({ end: 2004, sources, vegetation: [{ date: '2004-10-01', value: 0.5 }, { date: '2004-11-01', value: 0.6 }], vegetationQuality: [
    { date: '2004-10-01', available_composites: 2, expected_composites: 2 },
    { date: '2004-11-01', available_composites: 1, expected_composites: 1 },
  ] })
  assert.deepEqual(parseMemoryDataset(base).vegetationQuality.map(row => row.expected_composites), [2, 1])
  assert.throws(() => parseMemoryDataset({ ...base, vegetationQuality: base.vegetationQuality.map(row => ({ ...row, expected_composites: 2, available_composites: 2 })) }), /scheduled composites/)
})

test('live memory loading converts precipitation and keeps matching, quality-checked source chains', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input), 'http://localhost')
      const result = url.pathname === '/api/series' ? rain() : url.pathname === '/api/soil' ? soil() : vegetation(Number(url.searchParams.get('start')))
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
    }
    const progress = []
    const data = await loadMemory(query, 'Fixture', new AbortController().signal, (...args) => progress.push(args))
    assert.equal(data.rain[0].value, 62)
    assert.equal(data.rain[1].value, 56)
    assert.equal(data.soil[0].value, 0.4)
    assert.equal(data.vegetation[0].value, 0.6)
    assert.equal(data.sources.filter(row => row.role === 'vegetation').length, 2)
    assert.equal(progress.at(-1)[1], progress.at(-1)[2])
  } finally { globalThis.fetch = original }
})

test('a satellite outage retains weather and soil plus explicit missing NDVI', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async input => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path === '/api/vegetation') return new Response(JSON.stringify({ detail: 'Source outage' }), { status: 503 })
      return new Response(JSON.stringify(path === '/api/series' ? rain() : soil()))
    }
    const data = await loadMemory(query, 'Fixture', new AbortController().signal, () => {})
    assert.ok(data.rain.every(row => row.value !== null))
    assert.ok(data.vegetation.every(row => row.value === null))
    assert.ok(data.warnings.some(warning => warning.includes('unavailable')))
  } finally { globalThis.fetch = original }
})

test('live NDVI with a forged complete schedule is rejected without publishing its observations or source', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input), 'http://localhost')
      const year = Number(url.searchParams.get('start'))
      let result
      if (url.pathname === '/api/series') result = rain()
      else if (url.pathname === '/api/soil') result = soil()
      else {
        result = vegetation(year)
        const june = result.series.find(row => row.date.endsWith('-06-01'))
        june.available_composites = 1
        june.expected_composites = 1
      }
      return new Response(JSON.stringify(result))
    }
    const data = await loadMemory(query, 'Fixture', new AbortController().signal, () => {})
    assert.ok(data.vegetation.every(row => row.value === null))
    assert.equal(data.sources.filter(row => row.role === 'vegetation').length, 0)
    assert.ok(data.warnings.some(warning => warning.includes('every scheduled composite')))
  } finally { globalThis.fetch = original }
})

test('mismatched weather is rejected and aborted loads do not publish partial results', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async input => new Response(JSON.stringify(new URL(String(input), 'http://localhost').pathname === '/api/series' ? rain({ longitude: 0 }) : soil()))
    await assert.rejects(loadMemory(query, 'Fixture', new AbortController().signal, () => {}), /match/)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(loadMemory(query, 'Fixture', controller.signal, () => {}), { name: 'AbortError' })
  } finally { globalThis.fetch = original }
})

test('saved example is parsed through the same strict contract and retains source dates', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(dataset({ savedAt: stamp })))
    const data = await loadMemoryExample(new AbortController().signal)
    assert.equal(data.sources[0].retrieved_at, stamp)
    assert.equal(data.savedAt, stamp)
  } finally { globalThis.fetch = original }
})

test('bundled landscape example contains real retained source metadata and 25 years of monthly slots', () => {
  const raw = JSON.parse(readFileSync(new URL('../public/data/landscape-memory-example.json', import.meta.url), 'utf8'))
  const data = parseMemoryDataset(raw)
  assert.equal(data.start, 2001)
  assert.equal(data.end, 2025)
  assert.equal(data.rain.length, 300)
  assert.equal(data.soil.length, 300)
  assert.equal(data.vegetation.length, 300)
  assert.ok(data.sources.length > 500)
  assert.ok(data.sources.every(source => source.data_origin === 'snapshot'))
  assert.ok(data.vegetation.some(row => row.value !== null))
  assert.equal(data.vegetationQuality.length, 300)
  assert.ok(data.vegetationQuality.some(row => row.available_composites < row.expected_composites))
})
