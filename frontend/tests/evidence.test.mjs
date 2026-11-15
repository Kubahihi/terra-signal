import test from 'node:test'
import assert from 'node:assert/strict'
import { coverageFor, evidenceFor, fittedChangeFor, formatRate } from '../src/lib/evidence.ts'
import { seriesCsv } from '../src/lib/csv.ts'

const analysis = {
  method: 'Seasonal OLS + HAC(12)', slope_per_year: 0.2, slope_per_decade: 2,
  ci95_per_decade: [1, 3], p_value: 0.01, sample_size: 60, hac_lags: 12,
}

test('a significant positive or negative slope is described in the correct direction', () => {
  assert.equal(evidenceFor(analysis).state, 'significant')
  assert.match(evidenceFor(analysis).conclusion, /rising/)
  assert.match(evidenceFor({ ...analysis, slope_per_decade: -2, ci95_per_decade: [-3, -1] }).conclusion, /falling/)
})

test('the 5% boundary does not become evidence of no change', () => {
  const evidence = evidenceFor({ ...analysis, p_value: 0.05, ci95_per_decade: [0, 4] })
  assert.equal(evidence.state, 'inconclusive')
  assert.match(evidence.conclusion, /does not prove there is no change/)
})

test('constant, gapped and insufficient series do not get a significance claim', () => {
  assert.equal(evidenceFor(null).state, 'unavailable')
  assert.equal(evidenceFor({ ...analysis, p_value: null }).state, 'unavailable')
  assert.equal(evidenceFor({ ...analysis, ci95_per_decade: null }).state, 'unavailable')
  assert.equal(evidenceFor({ ...analysis, slope_per_decade: 0, p_value: null, ci95_per_decade: null }).state, 'unavailable')
})

test('coverage counts available observations against the complete requested period', () => {
  const coverage = coverageFor({ start: 2000, end: 2000, series: [
    { date: '2000-01-01', value: 0 }, { date: '2000-02-01', value: null },
    { date: '2000-03-01', value: 2 },
  ] })
  assert.deepEqual(coverage, { available: 2, expected: 12, percent: 17 })
})

test('small nonzero rates retain their sign and magnitude, while zero has no sign', () => {
  assert.equal(formatRate(-0.00001), '-0.0000100')
  assert.equal(formatRate(0.0004), '+0.000400')
  assert.equal(formatRate(-0), '0.000')
  assert.equal(formatRate(0), '0.000')
  assert.equal(formatRate(0.2), '+0.200')
})

test('fitted change uses the actual observed months rather than extrapolating over missing edges', () => {
  const summary = fittedChangeFor({ start: 1981, end: 2025, analysis, series: [
    { date: '1981-01-01', value: null }, { date: '2000-01-01', value: 0 },
    { date: '2010-01-01', value: 90 }, { date: '2025-12-01', value: null },
  ] })
  assert.deepEqual(summary, { first: '2000-01-01', last: '2010-01-01', elapsedYears: 10, change: 2, ci95: [1, 3] })
  // A fitted change excludes the seasonal cycle and is not the 90-unit endpoint difference.
})

test('fitted change retains decreasing and zero estimates, and never invents unavailable inference', () => {
  const series = [{ date: '2000-01-01', value: 2 }, { date: '2001-01-01', value: 1 }]
  const decreasing = fittedChangeFor({ analysis: { ...analysis, slope_per_year: -0.2, ci95_per_decade: [-3, -1] }, series })
  assert.equal(decreasing.change, -0.2)
  assert.deepEqual(decreasing.ci95, [-0.3, -0.1])
  const constant = fittedChangeFor({ analysis: { ...analysis, slope_per_year: 0, ci95_per_decade: null, p_value: null }, series })
  assert.equal(constant.change, 0)
  assert.equal(constant.ci95, null)
  assert.equal(fittedChangeFor({ analysis: null, series }), null)
  assert.equal(fittedChangeFor({ analysis, series: series.slice(0, 1) }), null)
})

test('fitted elapsed time uses calendar months, includes leap years and does not round to whole years', () => {
  const summary = fittedChangeFor({ analysis, series: [
    { date: '2020-12-01', value: 0 }, { date: '2020-01-01', value: 1 },
  ] })
  assert.equal(summary.elapsedYears, 11 / 12)
  assert.equal(summary.change, 0.2 * 11 / 12)
})

test('CSV preserves missing observations, true zeros, provenance and uncertainty', () => {
  const result = {
    source: 'NASA POWER', source_url: 'https://power.larc.nasa.gov/api/example',
    retrieved_at: '2026-11-14T00:00:00Z', data_origin: 'snapshot',
    latitude: 50, longitude: 14, variable: 'T2M', unit: 'C', start: 2000, end: 2004,
    analysis: { ...analysis, p_value: 0, ci95_per_decade: null }, warnings: ['A saved record.\nCheck its date.'],
    series: [{ date: '2000-01-01', value: 0 }, { date: '2000-02-01', value: null }],
  }
  const csv = seriesCsv(result)
  assert.match(csv, /# data_origin: snapshot\r\n/)
  assert.match(csv, /# retrieved_at: 2026-11-14T00:00:00Z/)
  assert.match(csv, /# slope_per_decade: 2/)
  assert.match(csv, /# ci95_per_decade_low: unavailable/)
  assert.match(csv, /# p_value: 0\r\n/)
  assert.match(csv, /# fitted_start: unavailable/)
  assert.match(csv, /# warnings: A saved record\. Check its date\./)
  assert.ok(csv.endsWith('date,value\r\n2000-01-01,0\r\n2000-02-01,'))
})

test('CSV exports the same full-precision fitted change and uncertainty as the result panel', () => {
  const csv = seriesCsv({ source: 'NASA POWER', source_url: 'https://power.larc.nasa.gov/',
    retrieved_at: '2026-11-15T00:00:00Z', data_origin: 'cache', latitude: 0, longitude: 0,
    variable: 'PRECTOTCORR', unit: 'mm/day', start: 2000, end: 2010, analysis, warnings: [],
    series: [{ date: '2000-01-01', value: 1 }, { date: '2010-01-01', value: 1.5 }],
  })
  assert.match(csv, /# fitted_start: 2000-01-01/)
  assert.match(csv, /# fitted_end: 2010-01-01/)
  assert.match(csv, /# fitted_change: 2\r\n/)
  assert.match(csv, /# fitted_change_ci95_low: 1\r\n/)
  assert.match(csv, /# fitted_change_ci95_high: 3\r\n/)
  assert.match(csv, /Not an observed endpoint difference, rainfall accumulation or forecast/)
})
