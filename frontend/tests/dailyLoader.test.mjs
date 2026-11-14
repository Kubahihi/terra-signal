import test from 'node:test'
import assert from 'node:assert/strict'
import { loadDailyRange } from '../src/lib/dailyLoader.ts'

const query = { lat: 50.0755, lon: 14.4378, start: 1981, end: 1995 }
function report(q) {
  return { latitude: q.lat, longitude: q.lon, start: q.start, end: q.end, time_standard: 'LST', daily: [],
    years: Array.from({ length: q.end - q.start + 1 }, (_, i) => ({ year: q.start + i })),
    source: 'Test fixture', source_url: `https://example.test/daily/${q.start}`, retrieved_at: new Date().toISOString(), data_origin: 'live', warnings: [] }
}
function options(fetchDaily, extra = {}) {
  return { fetchDaily, cache: new Map(), signal: new AbortController().signal, refresh: false, lastYear: 2025, onProgress() {}, ...extra }
}

test('one shared loader bounds concurrency, combines the full period, and reports progress for either point', async () => {
  let active = 0, peak = 0
  const progress = []
  const data = await loadDailyRange(query, options(async q => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return report(q)
  }, { onProgress: value => progress.push(value) }))
  assert.equal(peak, 2)
  assert.equal(data.years.length, 15)
  assert.deepEqual(progress.at(-1), { completed: 3, total: 3, years: 15 })
})

test('retry reuses valid batches and only fetches failed batches, preserving missing years before retry', async () => {
  const calls = []
  const cache = new Map()
  const partial = await loadDailyRange(query, options(async q => {
    calls.push(q.start)
    if (q.start === 1986) throw new Error('offline')
    return report(q)
  }, { cache }))
  assert.deepEqual(partial.years.map(row => row.year), [1981, 1982, 1983, 1984, 1985, 1991, 1992, 1993, 1994, 1995])
  assert.deepEqual(partial.failures, [{ start: 1986, end: 1990, message: 'offline' }])
  calls.length = 0
  const complete = await loadDailyRange(query, options(async q => { calls.push(q.start); return report(q) }, { cache }))
  assert.deepEqual(calls, [1986])
  assert.equal(complete.years.length, 15)
  assert.equal(complete.failures.length, 0)
})

test('another point has its own cache entries and refresh bypasses valid memoized records', async () => {
  const cache = new Map()
  const calls = []
  const fetchDaily = async (q, refresh) => { calls.push([q.lat, refresh]); return report(q) }
  await loadDailyRange(query, options(fetchDaily, { cache }))
  await loadDailyRange(query, options(fetchDaily, { cache }))
  assert.equal(calls.length, 3)
  await loadDailyRange({ ...query, lat: 51 }, options(fetchDaily, { cache }))
  assert.equal(calls.length, 6)
  await loadDailyRange(query, options(fetchDaily, { cache, refresh: true }))
  assert.equal(calls.length, 9)
  assert.ok(calls.slice(6).every(([, refresh]) => refresh))
})

test('cancellation stops the queue and a late response cannot enter another point cache', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(loadDailyRange(query, options(async q => { calls++; return report(q) }, {
    signal: controller.signal, onProgress: value => { if (value.completed === 2) controller.abort() },
  })), { name: 'AbortError' })
  assert.equal(calls, 2)
  const lateController = new AbortController()
  const cache = new Map()
  await assert.rejects(loadDailyRange(query, options(async q => { lateController.abort(); return report(q) }, { signal: lateController.signal, cache })), { name: 'AbortError' })
  assert.equal(cache.size, 0)
})

test('mismatched point, batch range or day basis is a failed batch and never poisoned cache', async () => {
  for (const changed of [{ latitude: 40 }, { longitude: -100 }, { start: 2000 }, { time_standard: 'UTC' }]) {
    const cache = new Map()
    const data = await loadDailyRange(query, options(async q => ({ ...report(q), ...changed }), { cache }))
    assert.equal(data.sources.length, 0)
    assert.equal(data.years.length, 0)
    assert.equal(data.failures.length, 3)
    assert.equal(cache.size, 0)
  }
})
