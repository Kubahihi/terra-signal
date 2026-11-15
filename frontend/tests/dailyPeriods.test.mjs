import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyPeriodsCsv, dailyPeriodStarts, matchesDailyPeriods, periodEvidence } from '../src/lib/dailyPeriods.ts'

const data = { lat: 50, lon: 14, start: 1981, end: 2025, warnings: [], failures: [], sources: [{ start: 1981, end: 1985, source_url: 'https://example.test/nasa', retrieved_at: '2026-11-14T00:00:00Z', data_origin: 'cache' }] }
function response() {
  const metric = { complete_years: 45, expected_years: 45, first_year: 1981, last_year: 2025, warnings: [], analysis: { slope_per_decade: 2, ci95_per_decade: [1, 3], p_value: 0.02, p_value_holm: 0.12, significant: false } }
  return { latitude: data.lat, longitude: data.lon, start: data.start, end: data.end, family_size: 12, alpha: 0.05, warnings: ['No test of differences between slopes.'],
    periods: [1981, 1991, 2001].map(start => ({ latitude: data.lat, longitude: data.lon, start, end: 2025, family_size: 12, alpha: 0.05,
      metrics: Object.fromEntries(['hot_days', 'frost_days', 'warm_nights', 'longest_dry_spell'].map(id => [id, structuredClone(metric)])) })),
  }
}

test('predefined windows stay within the selected record and share a fixed end', () => {
  assert.deepEqual(dailyPeriodStarts(1981, 2025), [1981, 1991, 2001])
  assert.deepEqual(dailyPeriodStarts(1991, 2025), [1991, 2001])
  assert.deepEqual(dailyPeriodStarts(2005, 2025), [2005])
  assert.deepEqual(dailyPeriodStarts(1985, 1990), [1985])
})

test('a different point, missing period, changed family size or relabelled end cannot be displayed or exported', () => {
  assert.ok(matchesDailyPeriods(data, response()))
  for (const change of [result => { result.latitude = 20 }, result => { result.longitude = -100 }, result => { result.periods.pop() }, result => { result.family_size = 4 }, result => { result.periods[2].end = 2024 }, result => { result.periods[1].start = 1992 }, result => { result.periods[1].family_size = 4 }, result => { result.alpha = 0.1 }, result => { result.periods[0].alpha = 0.1 }]) {
    const result = response()
    change(result)
    assert.equal(matchesDailyPeriods(data, result), false)
    assert.throws(() => dailyPeriodsCsv(data, result), /does not match/)
  }
})

test('period evidence uses the whole family and keeps undefined tests unavailable', () => {
  const metric = response().periods[0].metrics.hot_days
  assert.equal(periodEvidence(metric).state, 'inconclusive')
  metric.analysis.p_value_holm = 0.05
  assert.equal(periodEvidence(metric).state, 'inconclusive')
  metric.analysis.p_value_holm = 0.01
  metric.analysis.slope_per_decade = -2
  assert.equal(periodEvidence(metric).label, 'Significant decrease')
  metric.analysis.p_value_holm = null
  assert.equal(periodEvidence(metric).state, 'unavailable')
})

test('CSV includes every period and index, correction scope, provenance, and real zero versus missing inference', () => {
  const result = response()
  result.periods[0].metrics.warm_nights.analysis = { slope_per_decade: 0, ci95_per_decade: null, p_value: null, p_value_holm: null, significant: null }
  result.periods[2].metrics.hot_days.analysis = null
  const csv = dailyPeriodsCsv(data, result)
  assert.match(csv, /# family_size: 12/)
  assert.match(csv, /# source_1_url: https:\/\/example.test\/nasa/)
  assert.match(csv, /# confidence_intervals: individual 95%; not simultaneous or adjusted/)
  const rows = csv.split('\r\n').filter(line => !line.startsWith('#'))
  assert.equal(rows.length, 13)
  assert.match(rows[3], /"warm_nights","45","45","1981","2025","0",/)
  assert.ok(!rows[3].includes('"0.12"'))
  assert.match(rows[9], /"hot_days","45","45","1981","2025",,,,,,,/)
})
