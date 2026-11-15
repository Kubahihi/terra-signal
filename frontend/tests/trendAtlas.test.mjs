import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { atlasAnnualValue, atlasMarker, atlasMetrics, atlasScale, loadTrendAtlas, parseTrendAtlas } from '../src/lib/trendAtlas.ts'

const source = JSON.parse(readFileSync(new URL('../public/data/daily-example-analysis-1981-2025.json', import.meta.url), 'utf8'))
const data = parseTrendAtlas(source)
const point = id => data.points.find(item => item.location.id === id)
const clone = () => structuredClone(source)

test('the real archive preserves ten fixed NASA grid points, 45 exact years and the 40-test family', () => {
  assert.equal(data.points.length, 10)
  assert.equal(data.familySize, 40)
  assert.equal(data.start, 1981)
  assert.equal(data.end, 2025)
  for (const item of data.points) {
    assert.equal(item.years.length, 45)
    assert.equal(item.sources.length, 9)
    for (const metric of atlasMetrics) {
      assert.equal(item.metrics[metric].completeYears, 45)
      assert.ok(item.years.every(row => atlasAnnualValue(item, metric, row.year) === row[metric].observed_count))
    }
  }
  assert.equal(point('brno').metrics.hot_days.slope, 4.5401844532279325)
  assert.equal(point('athens').metrics.hot_days.slope, 7.424242424242433)
  assert.equal(point('brno').years.find(row => row.year === 2024).expected_days, 366)
})

test('atlas evidence uses global Holm40; an individual interval excluding zero need not be significant', () => {
  const warm = point('prague').metrics.warm_nights
  assert.equal(source.results[0].trends.metrics.warm_nights.analysis.significant, true)
  assert.ok(warm.ci95[0] > 0)
  assert.equal(warm.pHolm, 0.44147199847402896)
  assert.equal(warm.evidence, 'unresolved')
  assert.equal(point('prague').metrics.hot_days.evidence, 'increase')
  assert.equal(point('prague').metrics.frost_days.evidence, 'decrease')
  assert.ok(data.points.every(item => item.metrics.longest_dry_spell.evidence === 'unresolved'))
})

test('constant zero values remain visible with unavailable inference, separately from missing observations', () => {
  const london = point('london')
  assert.equal(london.metrics.warm_nights.slope, 0)
  assert.equal(london.metrics.warm_nights.evidence, 'unavailable')
  assert.equal(london.metrics.warm_nights.pHolm, null)
  assert.equal(atlasAnnualValue(london, 'warm_nights', 2000), 0)
  assert.equal(atlasAnnualValue(london, 'warm_nights', 1900), null)
  const incomplete = structuredClone(london)
  const year = incomplete.years.find(row => row.year === 2000)
  year.warm_nights = { value: null, available_days: 365, observed_count: 0 }
  assert.equal(atlasAnnualValue(incomplete, 'warm_nights', 2000), null)
})

test('map scales stay fixed across years and compare magnitude consistently across all points', () => {
  const yearScale = atlasScale(data, 'hot_days', 'year')
  const expectedMax = Math.max(...data.points.flatMap(item => item.years.map(row => row.hot_days.value)))
  assert.equal(yearScale.maximum, expectedMax)
  assert.equal(yearScale.unit, 'days')
  assert.equal(yearScale.signed, false)
  const trendScale = atlasScale(data, 'frost_days', 'trend')
  assert.equal(trendScale.maximum, Math.max(...data.points.map(item => Math.abs(item.metrics.frost_days.slope))))
  assert.equal(trendScale.unit, 'days / decade')
  assert.equal(atlasMarker(5, trendScale).radius, atlasMarker(-5, trendScale).radius)
  assert.notEqual(atlasMarker(5, trendScale).color, atlasMarker(-5, trendScale).color)
  assert.notEqual(atlasMarker(null, trendScale).color, atlasMarker(0, trendScale).color)
  assert.equal(atlasMarker(5, yearScale).color, atlasMarker(50, yearScale).color)
  const r0 = atlasMarker(0, { maximum: 10, signed: true, unit: '' }).radius
  const r5 = atlasMarker(5, { maximum: 10, signed: true, unit: '' }).radius
  const r10 = atlasMarker(10, { maximum: 10, signed: true, unit: '' }).radius
  assert.ok(Math.abs((r5 ** 2 - r0 ** 2) / (r10 ** 2 - r0 ** 2) - 0.5) < 1e-12)
})

test('a versioned archive cannot silently relabel periods, places or annual day coverage', () => {
  let broken = clone(); broken.start = 1991
  assert.throws(() => parseTrendAtlas(broken), /archive period/)
  broken = clone(); broken.results[0].trends.start = 1991
  assert.throws(() => parseTrendAtlas(broken), /place or period/)
  broken = clone(); broken.results[0].location.lat += 1
  assert.throws(() => parseTrendAtlas(broken), /fixed candidate/)
  broken = clone(); broken.results[0].years[3].expected_days = 365
  assert.throws(() => parseTrendAtlas(broken), /calendar-year day count/)
  broken = clone(); broken.results[0].years[0].hot_days.available_days = 364
  assert.throws(() => parseTrendAtlas(broken), /complete coverage/)
  broken = clone(); broken.results[0].years.push(broken.results[0].years[0])
  assert.throws(() => parseTrendAtlas(broken), /duplicate annual/)
})

test('independent OLS and Holm checks reject stale or corrupted calculations', () => {
  let broken = clone()
  broken.results[0].trends.metrics.hot_days.analysis.slope_per_decade *= 10
  assert.throws(() => parseTrendAtlas(broken), /slope units/)
  broken = clone()
  broken.results[0].trends.metrics.hot_days.analysis.slope_per_decade += 1
  broken.results[0].trends.metrics.hot_days.analysis.slope_per_year += 0.1
  assert.throws(() => parseTrendAtlas(broken), /OLS line/)
  broken = clone()
  broken.results[0].trends.metrics.hot_days.p_holm_40 = broken.results[0].trends.metrics.hot_days.analysis.p_value_holm
  assert.throws(() => parseTrendAtlas(broken), /global Holm correction/)
  broken = clone()
  broken.results[0].trends.metrics.hot_days.significant_across_scan = false
  assert.throws(() => parseTrendAtlas(broken), /significance flag/)
  broken = clone()
  broken.results[0].sources[0].source_url = 'https://example.test/not-nasa'
  assert.throws(() => parseTrendAtlas(broken), /NASA POWER source URL/)
})
function adjustExpanded(snapshot) {
  const entries = snapshot.results.flatMap(point => atlasMetrics.map(metric => point.trends.metrics[metric]))
  const ordered = entries.map(result => ({ result, p: result.analysis?.p_value ?? 1 })).sort((a, b) => a.p - b.p)
  let previous = 0
  ordered.forEach(({result, p}, rank) => {
    previous = Math.min(1, Math.max(previous, p * (snapshot.family_size - rank)))
    result.p_holm_scan = result.analysis?.p_value == null ? null : previous
    result.significant_across_scan = result.p_holm_scan === null ? null : result.p_holm_scan < 0.05
    delete result.p_holm_40
  })
  return snapshot
}
function expandedFixture(count = 3) {
  const fixture = clone()
  fixture.schema_version = 2
  fixture.candidates = fixture.candidates.slice(0, count)
  fixture.results = fixture.results.slice(0, count)
  fixture.family_size = count * 4
  fixture.correction = `Test fixture: Holm over ${count} prespecified points and four indices`
  return adjustExpanded(fixture)
}

test('a versioned expanded scan uses every candidate and all four family slots without changing legacy findings', () => {
  const expanded = parseTrendAtlas(expandedFixture())
  assert.equal(expanded.points.length, 3)
  assert.equal(expanded.candidateCount, 3)
  assert.equal(expanded.availablePointCount, 3)
  assert.equal(expanded.familySize, 12)
  assert.equal(expanded.sourceHref, '/data/trend-atlas-1981-2025.json')
  assert.equal(data.sourceHref, '/data/daily-example-analysis-1981-2025.json')
  assert.equal(data.candidateCount, 10)
  assert.equal(data.availablePointCount, 10)
  assert.notEqual(expanded.points[0].metrics.hot_days.pHolm, data.points[0].metrics.hot_days.pHolm)
  assert.equal(expanded.points[0].metrics.hot_days.slope, data.points[0].metrics.hot_days.slope)
})

test('an unavailable point preserves four prespecified correction slots and stays missing rather than zero', () => {
  const fixture = expandedFixture(4)
  const last = fixture.results.at(-1)
  last.years = []; last.sources = []
  for (const metric of atlasMetrics) {
    last.trends.metrics[metric] = { complete_years: 0, expected_years: 45, nonzero_years: 0, first_year: null, last_year: null,
      analysis: null, warnings: ['Test fixture has no observations'], p_holm_scan: null, significant_across_scan: null }
  }
  const expanded = parseTrendAtlas(adjustExpanded(fixture))
  assert.equal(expanded.familySize, 16)
  assert.equal(expanded.candidateCount, 4)
  assert.equal(expanded.availablePointCount, 3)
  for (const metric of atlasMetrics) {
    assert.equal(expanded.points.at(-1).metrics[metric].slope, null)
    assert.equal(expanded.points.at(-1).metrics[metric].pHolm, null)
    assert.equal(expanded.points.at(-1).metrics[metric].evidence, 'unavailable')
    assert.equal(atlasAnnualValue(expanded.points.at(-1), metric, 2025), null)
  }
})

test('expanded family metadata cannot drop tests, duplicate candidates or reuse a legacy correction', () => {
  let broken = expandedFixture(); broken.family_size = 8
  assert.throws(() => parseTrendAtlas(broken), /correction family/)
  broken = expandedFixture(); broken.candidates[1] = broken.candidates[0]
  assert.throws(() => parseTrendAtlas(broken), /distinct candidate/)
  broken = expandedFixture(); broken.results.pop()
  assert.throws(() => parseTrendAtlas(broken), /missing or duplicate/)
  broken = expandedFixture(); delete broken.results[0].trends.metrics.hot_days.p_holm_scan
  assert.throws(() => parseTrendAtlas(broken), /scan-adjusted probability/)
  broken = expandedFixture(7)
  // This raw p is so small that an absolute 1e-10 tolerance would miss a stale family.
  const strongest = broken.results.at(-1).trends.metrics.warm_nights
  assert.ok(strongest.p_holm_scan < 1e-9)
  strongest.p_holm_scan *= 0.9
  assert.throws(() => parseTrendAtlas(broken), /global Holm correction/)
  broken = expandedFixture(); broken.schema_version = 3
  assert.throws(() => parseTrendAtlas(broken), /unsupported archive schema/)
})

test('scan records cannot relabel another source place, period or daily data endpoint', () => {
  let broken = expandedFixture()
  let url = new URL(broken.results[0].sources[0].source_url)
  url.searchParams.set('latitude', '0')
  broken.results[0].sources[0].source_url = url.href
  assert.throws(() => parseTrendAtlas(broken), /source place, period or daily variables/)
  broken = expandedFixture()
  broken.results[0].sources[0].source_url = broken.results[0].sources[0].source_url.replace('/daily/', '/monthly/')
  assert.throws(() => parseTrendAtlas(broken), /source place, period or daily variables/)
  broken = expandedFixture(); broken.results[0].sources = []
  assert.throws(() => parseTrendAtlas(broken), /source provenance/)
  broken = expandedFixture(); broken.results[0].sources.push(broken.results[0].sources[0])
  assert.throws(() => parseTrendAtlas(broken), /overlapping source/)
})

test('loader falls back only for a missing expanded file and keeps the original forty-test scope', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({url, signal: options.signal})
      return calls.length === 1 ? new Response('', {status:404}) : Response.json(source)
    }
    const fallback = await loadTrendAtlas(controller.signal)
    assert.deepEqual(calls.map(call => call.url), ['/data/trend-atlas-1981-2025.json', '/data/daily-example-analysis-1981-2025.json'])
    assert.ok(calls.every(call => call.signal === controller.signal))
    assert.equal(fallback.familySize, 40)
    assert.equal(fallback.points.length, 10)
    assert.equal(fallback.sourceHref, '/data/daily-example-analysis-1981-2025.json')
  } finally { globalThis.fetch = originalFetch }
})

test('loader does not conceal a service error or corrupt expanded data behind a legacy fallback', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => { calls++; return new Response('', {status:503}) }
    await assert.rejects(loadTrendAtlas(), /could not be loaded/)
    assert.equal(calls, 1)
    calls = 0
    globalThis.fetch = async () => { calls++; return Response.json({...expandedFixture(), family_size:40}) }
    await assert.rejects(loadTrendAtlas(), /correction family/)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = originalFetch }
})
