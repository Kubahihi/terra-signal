import test from 'node:test'
import assert from 'node:assert/strict'
import { compoundAnnualCsv, compoundDays, compoundObservationsCsv, compoundYears } from '../src/lib/compoundData.ts'

function fixture(start = 2024, end = 2024) {
  const daily = []
  for (let time = Date.UTC(start, 0, 1); time < Date.UTC(end + 1, 0, 1); time += 86400000) daily.push({
    date: new Date(time).toISOString().slice(0, 10), tmax: 30, tmin: 0, precipitation: 1,
  })
  return { lat: 50.0755, lon: 14.4378, start, end, daily, years: [], warnings: ['Real source fixture metadata'], failures: [],
    sources: [{ start, end, source: 'NASA POWER / test fixture', source_url: 'https://example.test/nasa?parameters=T2M_MAX,PRECTOTCORR', retrieved_at: '2026-11-14T00:00:00Z', data_origin: 'cache' }],
  }
}

test('compound events require strict heat and precipitation thresholds on the same day', () => {
  const data = fixture()
  data.daily[0].tmax = 30
  data.daily[0].precipitation = 0
  data.daily[1].tmax = 31
  data.daily[1].precipitation = 1
  data.daily[2].tmax = 30.01
  data.daily[2].precipitation = 0.99
  const row = compoundYears(data)[0]
  assert.equal(row.value, 1)
  assert.equal(row.available_days, 366)
  assert.equal(row.hot_on_paired_days, 2)
  assert.equal(row.dry_on_paired_days, 2)
  assert.deepEqual(compoundDays(data).slice(0, 3).map(day => day.hot_dry), [0, 0, 1])
})

test('leap day counts once and missing either variable withholds the exact annual value', () => {
  const data = fixture()
  const leap = data.daily.find(day => day.date === '2024-02-29')
  leap.tmax = 33
  leap.precipitation = 0
  assert.equal(compoundYears(data)[0].value, 1)
  data.daily[0].tmax = null
  data.daily[1].precipitation = null
  const row = compoundYears(data)[0]
  assert.equal(row.expected_days, 366)
  assert.equal(row.available_days, 364)
  assert.equal(row.observed_count, 1)
  assert.equal(row.value, null)
  assert.equal(compoundDays(data)[0].hot_dry, null)
})

test('unavailable years and a true complete zero remain different', () => {
  const data = fixture(2023, 2024)
  data.daily = data.daily.filter(day => day.date.startsWith('2023'))
  const rows = compoundYears(data)
  assert.equal(rows[0].expected_days, 365)
  assert.equal(rows[0].value, 0)
  assert.equal(rows[1].value, null)
  assert.equal(rows[1].response_available, false)
  assert.equal(rows[1].available_days, 0)
  assert.equal(compoundDays(data).length, 731)
})

test('duplicate dates cannot increase coverage and conflicting observations remain unavailable', () => {
  const data = fixture()
  data.daily.push({ ...data.daily[0] })
  assert.equal(compoundYears(data)[0].available_days, 366)
  data.daily.push({ ...data.daily[1], tmax: 38, precipitation: 0 })
  const row = compoundYears(data)[0]
  assert.equal(row.available_days, 365)
  assert.equal(row.value, null)
  assert.equal(row.observed_count, 0)
  data.daily.push({ ...data.daily[1] })
  assert.equal(compoundYears(data)[0].available_days, 365)
  assert.equal(compoundDays(data)[1].hot_dry, null)
})

test('invalid dates, negative rain and nonfinite values do not fabricate paired days', () => {
  const data = fixture()
  data.daily[0].tmax = Infinity
  data.daily[1].precipitation = -0.1
  data.daily.push({ date: '2024-02-30', tmax: 40, tmin: 20, precipitation: 0 })
  data.daily.push({ date: '2023-12-31', tmax: 40, tmin: 20, precipitation: 0 })
  assert.equal(compoundYears(data)[0].available_days, 364)
  assert.equal(compoundYears(data)[0].observed_count, 0)
  assert.throws(() => compoundYears({ ...data, start: 2025 }), /ordered period/)
})

test('compound exports retain provenance, lower bounds, missing dates and genuine zeros', () => {
  const data = fixture(2023, 2024)
  data.daily = data.daily.filter(day => day.date.startsWith('2023'))
  const annual = compoundAnnualCsv(data)
  const rows = annual.split('\r\n').filter(line => !line.startsWith('#'))
  assert.equal(rows[1], '2023,1,365,365,0,0,0,0')
  assert.equal(rows[2], '2024,0,366,0,,,,')
  assert.match(annual, /# source_1_retrieved_at: 2026-11-14T00:00:00Z/)
  assert.match(annual, /# source_1_origin: cache/)
  assert.match(annual, /# compound_event: Daily Tmax > 30 C AND daily precipitation < 1 mm\/day/)
  assert.match(annual, /no significance test or causal inference/)
  data.daily[0].tmax = 33
  data.daily[0].precipitation = 0
  data.daily[1].tmax = null
  const incomplete = compoundAnnualCsv(data).split('\r\n').filter(line => !line.startsWith('#'))[1]
  assert.equal(incomplete, '2023,1,365,364,,1,1,1')
  const raw = compoundObservationsCsv(data)
  assert.match(raw, /2023-01-01,1,33,0,1/)
  assert.match(raw, /2023-01-02,1,,1,/)
  assert.match(raw, /2024-02-29,0,,,/)
})
