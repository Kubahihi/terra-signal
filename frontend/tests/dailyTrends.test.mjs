import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyEvidence, dailyTrendsCsv, formatDailyP, matchesDailyTrends } from '../src/lib/dailyTrends.ts'

const analysis = {
  method: 'Yearly OLS + HAC(1 annual lag)', slope_per_year: 0.2, slope_per_decade: 2,
  ci95_per_decade: [1, 3], p_value: 0.02, p_value_holm: 0.08, significant: false,
  sample_size: 45, hac_lags: 1, lag_unit: 'years', reference_year: 1981, intercept: 10,
}
const metric = { complete_years: 45, expected_years: 45, nonzero_years: 30, first_year: 1981, last_year: 2025, analysis, warnings: [] }
const data = { lat: 50.0755, lon: 14.4378, start: 1981, end: 2025, sources: [{ start: 1981, end: 1985, source_url: 'https://example.test/daily', retrieved_at: '2026-11-14T00:00:00Z', data_origin: 'cache' }], failures: [], warnings: [] }
function response() {
  return { latitude: data.lat, longitude: data.lon, start: data.start, end: data.end, method: analysis.method,
    correction: 'Holm across four daily indices', family_size: 4, alpha: 0.05, minimum_years: 20,
    metrics: Object.fromEntries(['hot_days', 'frost_days', 'warm_nights', 'longest_dry_spell'].map(key => [key, structuredClone(metric)])), warnings: ['Test metadata'] }
}

test('evidence uses Holm p even when the raw p and individual confidence interval appear significant', () => {
  assert.equal(dailyEvidence('hot_days', metric).state, 'inconclusive')
  assert.match(dailyEvidence('hot_days', metric).conclusion, /does not establish that there is no change/)
  const correctedBoundary = { ...metric, analysis: { ...analysis, p_value_holm: 0.05 } }
  assert.equal(dailyEvidence('hot_days', correctedBoundary).state, 'inconclusive')
})

test('direction follows estimates even when opposite to the posed question', () => {
  const rising = { ...metric, analysis: { ...analysis, p_value_holm: 0.01, significant: true } }
  assert.match(dailyEvidence('frost_days', rising).conclusion, /more frequent/)
  const falling = { ...rising, analysis: { ...rising.analysis, slope_per_decade: -2, ci95_per_decade: [-3, -1] } }
  assert.match(dailyEvidence('hot_days', falling).conclusion, /less frequent/)
  assert.match(dailyEvidence('longest_dry_spell', falling).conclusion, /shorter/)
  assert.match(dailyEvidence('longest_dry_spell', rising).conclusion, /longer/)
})

test('unknown, constant and sparse records are not given zero p-values or negative conclusions', () => {
  assert.equal(dailyEvidence('warm_nights', { ...metric, analysis: null, warnings: ['Too short'] }).conclusion, 'Too short')
  assert.equal(dailyEvidence('warm_nights', { ...metric, analysis: { ...analysis, p_value_holm: null, ci95_per_decade: null } }).state, 'unavailable')
  assert.equal(formatDailyP(null), 'unavailable')
  assert.equal(formatDailyP(0), '< 0.001')
})

test('trend results from another point or period cannot be exported under the selected dataset', () => {
  assert.ok(matchesDailyTrends(data, response()))
  for (const changed of [{ latitude: 51 }, { longitude: -110 }, { start: 2001 }, { end: 2024 }]) {
    const result = { ...response(), ...changed }
    assert.equal(matchesDailyTrends(data, result), false)
    assert.throws(() => dailyTrendsCsv(data, result), /do not match/)
  }
})

test('CSV preserves four-test correction, individual intervals, provenance and null versus real zero', () => {
  const result = response()
  result.metrics.warm_nights.analysis = { ...analysis, slope_per_decade: 0, intercept: 0, ci95_per_decade: null, p_value: null, p_value_holm: null, significant: null }
  result.metrics.warm_nights.warnings = ['Constant, "zero" record']
  const csv = dailyTrendsCsv(data, result)
  assert.match(csv, /# family_size: 4/)
  assert.match(csv, /# confidence_intervals: individual 95%; not adjusted or simultaneous/)
  assert.match(csv, /# source_1_url: https:\/\/example.test\/daily/)
  assert.match(csv, /"warm_nights","days\/decade","1981","2025","45","45","30","1981","2025","0",,,,,,"1981","0","1","Constant, ""zero"" record"/)
  assert.match(csv, /"0.02","0.08","0"/)
  assert.equal(csv.split('\r\n').filter(line => !line.startsWith('#')).length, 5)
})
