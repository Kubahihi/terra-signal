import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyComparisonCsv, dailyComparisonRows, sameLocation, sharedDailyMaximum } from '../src/lib/dailyComparison.ts'

const a = { name: 'Point A', lat: 50, lon: 14 }
const b = { name: 'Point B', lat: 49, lon: 16 }
function data(location, value = 0) {
  const count = { value, observed_count: value, available_days: 366 }
  return { lat: location.lat, lon: location.lon, start: 2024, end: 2025, daily: [],
    years: [{ year: 2024, expected_days: 366, hot_days: { ...count }, frost_days: { ...count }, warm_nights: { ...count }, longest_dry_spell: { ...count } }],
    warnings: [], failures: [], sources: [{ start: 2021, end: 2025, source_url: `https://example.test/${location.lat}`, retrieved_at: '2026-11-14T00:00:00Z', data_origin: 'cache' }] }
}
function trends(location) {
  return { latitude: location.lat, longitude: location.lon, start: 2024, end: 2025, warnings: [],
    metrics: Object.fromEntries(['hot_days', 'frost_days', 'warm_nights', 'longest_dry_spell'].map(id => [id, {
      first_year: 2024, last_year: 2024, complete_years: 1, analysis: null, warnings: ['Short record'],
    }])) }
}
function cells(line) { return [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map(match => (match[1] ?? match[2]).replace(/""/g, '"')) }

test('map point identity uses coordinates rather than names or preset IDs', () => {
  assert.ok(sameLocation(a, { ...a, name: 'Renamed point', id: 'custom' }))
  assert.equal(sameLocation(a, b), false)
})

test('shared vertical scale includes both places and fitted values, even for a constant zero series', () => {
  const left = data(a, 10), right = data(b, 90)
  assert.equal(sharedDailyMaximum('hot_days', [{ data: left, trends: null }, { data: right, trends: null }]), 101)
  const fit = trends(b)
  fit.metrics.hot_days.analysis = { reference_year: 2024, intercept: 120, slope_per_year: 0 }
  assert.equal(sharedDailyMaximum('hot_days', [{ data: left, trends: null }, { data: right, trends: fit }]), 135)
  assert.equal(sharedDailyMaximum('warm_nights', [{ data: data(a), trends: null }, { data: data(b), trends: null }]), 1)
})

test('differences distinguish true zero, incomplete lower bounds and unavailable years', () => {
  const left = data(a), right = data(b)
  left.years[0].hot_days = { value: null, observed_count: 3, available_days: 365 }
  const rows = dailyComparisonRows(left, right, 2024)
  assert.equal(rows[0].difference, null)
  assert.equal(rows[0].left.observed_count, 3)
  assert.equal(rows[1].difference, 0)
  assert.ok(dailyComparisonRows(left, right, 2025).every(row => row.left === null && row.right === null && row.difference === null))
})

test('CSV cannot relabel another place, unequal periods or unrelated trends as the chosen pair', () => {
  const first = { location: a, data: data(a), trends: null }
  const second = { location: b, data: data(b), trends: trends(b) }
  assert.throws(() => dailyComparisonCsv(first, { ...second, data: { ...second.data, start: 2023 } }), /periods/)
  assert.throws(() => dailyComparisonCsv(first, { ...second, location: { ...b, lat: 10 } }), /labelled/)
  assert.throws(() => dailyComparisonCsv(first, { ...second, trends: { ...second.trends, latitude: 10 } }), /labelled/)
  assert.throws(() => dailyComparisonCsv(first, first), /different/)
})

test('CSV contains both provenance chains and preserves blanks versus zero without inventing a contrast test', () => {
  const left = data(a), right = data(b)
  left.years[0].hot_days = { value: null, observed_count: 3, available_days: 365 }
  const csv = dailyComparisonCsv({ location: a, data: left, trends: trends(a) }, { location: b, data: right, trends: null })
  assert.match(csv, /# a_source_1_url: https:\/\/example.test\/50/)
  assert.match(csv, /# b_source_1_url: https:\/\/example.test\/49/)
  assert.match(csv, /# b_trend_status: unavailable/)
  assert.match(csv, /no between-location significance test/)
  const lines = csv.split('\r\n').filter(line => !line.startsWith('#'))
  assert.equal(lines.length, 9)
  const headers = cells(lines[0])
  const rows = lines.slice(1).map(line => Object.fromEntries(cells(line).map((value, i) => [headers[i], value])))
  assert.equal(rows[0].a_value, '')
  assert.equal(rows[0].a_observed, '3')
  assert.equal(rows[0].b_value, '0')
  assert.equal(rows[0].difference_a_minus_b, '')
  assert.equal(rows[1].difference_a_minus_b, '0')
  assert.equal(rows[0].a_p_holm, '')
  assert.equal(rows[0].a_trend_warnings, 'Short record')
  assert.equal(rows[4].a_value, '')
  assert.ok(rows.every(row => Object.keys(row).length === headers.length))
})
