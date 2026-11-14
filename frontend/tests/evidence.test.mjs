import test from 'node:test'
import assert from 'node:assert/strict'
import { coverageFor, evidenceFor, formatRate } from '../src/lib/evidence.ts'
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
  assert.match(csv, /# warnings: A saved record\. Check its date\./)
  assert.ok(csv.endsWith('date,value\r\n2000-01-01,0\r\n2000-02-01,'))
})
