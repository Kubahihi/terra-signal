import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { atlasBaseline, atlasDeparture, atlasDepartureScale } from '../src/lib/atlasDepartures.ts'
import { parseTrendAtlas } from '../src/lib/trendAtlas.ts'

const original = JSON.parse(readFileSync(new URL('../public/data/daily-example-analysis-1981-2025.json', import.meta.url), 'utf8'))
const data = parseTrendAtlas(original)
const point = id => data.points.find(item => item.location.id === id)
const metrics = ['hot_days', 'frost_days', 'warm_nights', 'longest_dry_spell']

test('real departures use the exact thirty-year 1991–2020 reference for every point and index', () => {
  for (const item of data.points) for (const metric of metrics) {
    const values = item.years.filter(row => row.year >= 1991 && row.year <= 2020).map(row => row[metric].value)
    const expectedMean = values.reduce((sum, value) => sum + value, 0) / 30
    assert.deepEqual(atlasBaseline(item, metric), { mean: expectedMean, completeYears: 30, start: 1991, end: 2020 })
    const selected = item.years.find(row => row.year === 2025)[metric].value
    assert.equal(atlasDeparture(item, metric, 2025), selected - expectedMean)
    const baselineDepartures = item.years.filter(row => row.year >= 1991 && row.year <= 2020).map(row => atlasDeparture(item, metric, row.year))
    assert.ok(Math.abs(baselineDepartures.reduce((sum, value) => sum + value, 0)) < 1e-10)
  }
  const brno = point('brno')
  assert.equal(brno.years.find(row => row.year === 1982).hot_days.value, 3)
  assert.equal(atlasBaseline(brno, 'hot_days').mean, 590 / 30)
  assert.equal(atlasDeparture(brno, 'hot_days', 1982), 3 - 590 / 30)
  assert.equal(atlasDeparture(brno, 'hot_days', 2025), 25 - 590 / 30)
  assert.equal(atlasBaseline(point('athens'), 'hot_days').mean, 2209 / 30)
  assert.equal(atlasDeparture(point('athens'), 'hot_days', 2025), 93 - 2209 / 30)
})

test('a true zero departure and zero annual count remain distinct from unavailable values', () => {
  const london = point('london')
  assert.equal(atlasBaseline(london, 'warm_nights').mean, 0)
  assert.equal(atlasDeparture(london, 'warm_nights', 2025), 0)
  assert.equal(atlasDeparture(london, 'warm_nights', 1900), null)
  const incomplete = structuredClone(london)
  const selected = incomplete.years.find(row => row.year === 2025)
  selected.warm_nights = { value: null, observed_count: 0, available_days: 364 }
  assert.equal(atlasDeparture(incomplete, 'warm_nights', 2025), null)
  assert.equal(atlasBaseline(incomplete, 'warm_nights').mean, 0)
})

test('one missing or incomplete reference year withholds the whole baseline rather than averaging 29', () => {
  const incomplete = structuredClone(point('brno'))
  const selected = incomplete.years.find(row => row.year === 2000)
  selected.hot_days = { value: null, observed_count: 10, available_days: 365 }
  assert.deepEqual(atlasBaseline(incomplete, 'hot_days'), { mean: null, completeYears: 29, start: 1991, end: 2020 })
  assert.equal(atlasDeparture(incomplete, 'hot_days', 2025), null)
  assert.equal(atlasBaseline(incomplete, 'frost_days').completeYears, 30)
  const absent = structuredClone(point('brno'))
  absent.years = absent.years.filter(row => row.year !== 1991)
  assert.equal(atlasBaseline(absent, 'hot_days').mean, null)
  assert.equal(atlasBaseline(absent, 'hot_days').completeYears, 29)
})

test('baseline weights annual counts equally and retains leap-year counts without rate normalization', () => {
  const synthetic = structuredClone(point('brno'))
  for (const row of synthetic.years) {
    const value = row.expected_days
    row.hot_days = { value, observed_count: value, available_days: value }
  }
  const leapYears = synthetic.years.filter(row => row.year >= 1991 && row.year <= 2020 && row.expected_days === 366).length
  assert.equal(leapYears, 8)
  assert.equal(atlasBaseline(synthetic, 'hot_days').mean, 365 + 8 / 30)
  assert.equal(atlasDeparture(synthetic, 'hot_days', 2024), 366 - (365 + 8 / 30))
})

test('the signed color domain covers all points and all archive years, independent of the chosen pair or year', () => {
  for (const metric of metrics) {
    const independentlyCalculated = data.points.flatMap(item => {
      const baseline = item.years.filter(row => row.year >= 1991 && row.year <= 2020).reduce((sum, row) => sum + row[metric].value, 0) / 30
      return item.years.map(row => Math.abs(row[metric].value - baseline))
    })
    const scale = atlasDepartureScale(data, metric)
    assert.equal(scale.maximum, Math.max(1, ...independentlyCalculated))
    assert.equal(scale.signed, true)
    assert.equal(scale.unit, 'days vs 1991–2020')
    for (const item of data.points) for (const row of item.years) assert.ok(Math.abs(atlasDeparture(item, metric, row.year)) <= scale.maximum)
  }
  const constantOnly = { ...data, points: [point('london')] }
  assert.equal(atlasDepartureScale(constantOnly, 'warm_nights').maximum, 1)
  const noReference = structuredClone(constantOnly)
  noReference.points[0].years = noReference.points[0].years.filter(row => row.year < 1991 || row.year > 2020)
  assert.equal(atlasDepartureScale(noReference, 'warm_nights').maximum, 1)
  assert.equal(atlasDeparture(noReference.points[0], 'warm_nights', 2025), null)
})
