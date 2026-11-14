import test from 'node:test'
import assert from 'node:assert/strict'
import { combineDaily, dailyAnnualCsv, dailyBatches, dailyObservationsCsv } from '../src/lib/dailyData.ts'

const query = { lat: 50.0755, lon: 14.4378, start: 2024, end: 2025 }
function report() {
  const daily = Array.from({ length: 366 }, (_, day) => ({
    date: new Date(Date.UTC(2024, 0, day + 1)).toISOString().slice(0, 10), tmax: 30, tmin: 0, precipitation: 1,
  }))
  const count = { value: 0, observed_count: 0, available_days: 366 }
  return { latitude: query.lat, longitude: query.lon, start: 2024, end: 2024, time_standard: 'LST', daily,
    thresholds: {}, source: 'Test fixture', source_url: 'https://example.test/daily', retrieved_at: '2026-11-14T00:00:00Z', data_origin: 'cache', warnings: [],
    years: [{ year: 2024, expected_days: 366, hot_days: { ...count }, frost_days: { ...count }, warm_nights: { ...count },
      longest_dry_spell: { ...count, start_date: null, end_date: null, touches_year_boundary: false } }],
  }
}

test('five-year batches are stable across overlapping display windows and bounded by the last complete year', () => {
  assert.deepEqual(dailyBatches(2024, 2025, 2025), [{ start: 2021, end: 2025 }])
  assert.deepEqual(dailyBatches(1983, 1987, 2025), [{ start: 1981, end: 1985 }, { start: 1986, end: 1990 }])
  assert.deepEqual(dailyBatches(2026, 2027, 2027), [{ start: 2026, end: 2027 }])
})

test('merging trims downloaded years to the actual display interval without changing provenance', () => {
  const result = combineDaily([report()], { ...query, end: 2024 }, [])
  assert.equal(result.daily.length, 366)
  assert.equal(result.years.length, 1)
  assert.equal(result.sources[0].retrieved_at, '2026-11-14T00:00:00Z')
  const absent = combineDaily([report()], { ...query, start: 2025 }, [])
  assert.equal(absent.daily.length, 0)
  assert.equal(absent.years.length, 0)
})

test('another point or a different daily time basis cannot be relabelled as the selected place', () => {
  assert.throws(() => combineDaily([{ ...report(), latitude: 51 }], query, []), /does not match/)
  assert.throws(() => combineDaily([{ ...report(), time_standard: 'UTC' }], query, []), /does not match/)
})

test('annual CSV distinguishes a real zero, an observed lower bound, and a missing response', () => {
  const data = report()
  data.years[0].hot_days = { value: null, observed_count: 2, available_days: 365 }
  const result = combineDaily([data], query, [{ start: 2025, end: 2025, message: 'offline' }])
  const csv = dailyAnnualCsv(result)
  const rows = csv.split('\r\n').filter(row => !row.startsWith('# '))
  const first = rows[1].split(',')
  assert.deepEqual(first.slice(0, 9), ['2024', '1', '366', '', '2', '365', '0', '0', '366'])
  const missing = rows[2].split(',')
  assert.equal(missing[0], '2025')
  assert.equal(missing[1], '0')
  assert.ok(missing.slice(2).every(value => value === ''))
  assert.match(csv, /# time_standard: LST/)
  assert.match(csv, /# unavailable_batches: 2025-2025: offline/)
  assert.match(csv, /# source_1_origin: cache/)
})

test('raw export uses strict thresholds and keeps missing daily observations blank', () => {
  const data = report()
  data.daily[1] = { ...data.daily[1], tmax: 30.01, tmin: 20 }
  data.daily[2] = { ...data.daily[2], tmax: 31, tmin: 20.01, precipitation: 0.99 }
  data.daily[3] = { ...data.daily[3], tmax: null, tmin: -0.01, precipitation: null }
  const csv = dailyObservationsCsv(combineDaily([data], { ...query, end: 2024 }, []))
  assert.match(csv, /2024-01-01,30,0,1,0,0,0,0/)
  assert.match(csv, /2024-01-02,30.01,20,1,1,0,0,0/)
  assert.match(csv, /2024-01-03,31,20.01,0.99,1,0,1,1/)
  assert.match(csv, /2024-01-04,,-0.01,,,1,0,/)
})
