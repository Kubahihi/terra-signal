import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dailyExamples, exampleAnalysis, referenceFindings } from '../src/lib/dailyExamples.ts'

const snapshot = JSON.parse(readFileSync(new URL('../public/data/daily-example-analysis-1981-2025.json', import.meta.url), 'utf8'))

test('each displayed finding matches the archived NASA analysis and the full forty-test Holm correction', () => {
  assert.equal(snapshot.family_size, exampleAnalysis.familySize)
  assert.equal(snapshot.candidates.length, exampleAnalysis.candidateCount)
  assert.equal(snapshot.finished_at.slice(0, 10), exampleAnalysis.date)
  const tests = snapshot.results.flatMap(point => Object.entries(point.trends.metrics).map(([metric, result]) => ({
    point: point.location.id, metric, result, p: result.analysis?.p_value ?? 1,
  })))
  assert.equal(tests.length, 40)
  const sorted = [...tests].sort((a, b) => a.p - b.p)
  let previous = 0
  for (const [i, entry] of sorted.entries()) {
    entry.adjusted = Math.min(1, Math.max(previous, (40 - i) * entry.p))
    previous = entry.adjusted
  }
  for (const finding of referenceFindings) {
    const source = tests.find(row => row.point === finding.locationId && row.metric === finding.metric)
    assert.ok(source)
    assert.equal(source.result.analysis.slope_per_decade, finding.slopePerDecade)
    assert.ok(Math.abs(source.result.p_holm_40 - source.adjusted) < 1e-12)
    assert.ok(source.adjusted < 0.05)
    assert.equal(source.result.complete_years, 45)
    assert.ok(source.result.analysis.ci95_per_decade[0] <= finding.slopePerDecade)
    assert.ok(source.result.analysis.ci95_per_decade[1] >= finding.slopePerDecade)
  }
})

test('opening an example labels the same coordinates, period and metric as its reference finding', () => {
  assert.equal(exampleAnalysis.start, snapshot.start)
  assert.equal(exampleAnalysis.end, snapshot.end)
  assert.equal(new Set(dailyExamples.map(example => example.id)).size, dailyExamples.length)
  for (const example of dailyExamples) {
    assert.notDeepEqual([example.location.lat, example.location.lon], [example.comparison.lat, example.comparison.lon])
    for (const place of [example.location, example.comparison]) {
      const original = snapshot.candidates.find(row => row.id === place.id)
      assert.equal(place.lat, original.lat)
      assert.equal(place.lon, original.lon)
    }
    for (const finding of example.findings) {
      assert.equal(finding.metric, example.metric)
      assert.ok([example.location.id, example.comparison.id].includes(finding.locationId))
    }
  }
  const featured = dailyExamples.filter(example => example.featured)
  assert.equal(featured.length, 1)
  assert.deepEqual([featured[0].location.id, featured[0].comparison.id, featured[0].metric], ['brno', 'athens', 'hot_days'])
})

test('the downloadable evidence keeps all ten candidates, daily coverage and original source chains', () => {
  assert.equal(snapshot.results.length, 10)
  for (const point of snapshot.results) {
    assert.equal(point.failures.length, 0)
    assert.equal(point.years.length, 45)
    assert.equal(point.sources.length, 9)
    for (const source of point.sources) {
      const url = new URL(source.source_url)
      assert.equal(url.origin, 'https://power.larc.nasa.gov')
      assert.equal(url.searchParams.get('time-standard'), 'LST')
      assert.equal(Number(url.searchParams.get('latitude')), point.location.lat)
      assert.equal(Number(url.searchParams.get('longitude')), point.location.lon)
      assert.ok(source.retrieved_at)
    }
  }
})
