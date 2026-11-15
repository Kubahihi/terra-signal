import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeMemory, memoryCsv, memoryEvidenceJson, memoryMonthOffset } from '../src/lib/landscapeMemory.ts'

// Deliberately constructed observations, not a representation of real NASA data.
function fixture({ delayedSoil = true, end = 2025 } = {}) {
  const data = {
    schemaVersion: 1, location: { name: 'Synthetic test location', lat: 49, lon: 16 }, start: 2001, end,
    rain: [], soil: [], vegetation: [],
    sources: ['rain', 'soil', 'vegetation'].map(role => ({ role, source: 'Synthetic test fixture', source_url: `https://example.test/${role}`, retrieved_at: '2026-11-01T00:00:00Z', data_origin: 'cache', spatial_support: 'Synthetic test footprint' })),
    warnings: ['Synthetic fixture; never display as observed environmental data.'],
  }
  for (let year = data.start; year <= data.end; year++) for (let month = 1; month <= 12; month++) {
    const date = `${year}-${String(month).padStart(2, '0')}-01`
    data.rain.push({ date, value: year === 2015 && month >= 5 && month <= 8 ? 1 : 100 + (year - 2001) * 2 + month % 3 })
    data.soil.push({ date, value: delayedSoil && date >= '2015-05-01' && date <= '2016-03-01' ? 0.1 : 0.3 + (year - 2001) * 0.01 + month * 0.001 })
    data.vegetation.push({ date, value: 0.4 + (year - 2001) * 0.01 + month * 0.002 })
  }
  return data
}

function change(data, role, date, value) {
  const point = data[role].find(point => point.date === date)
  assert.ok(point, `${date} exists in fixture`)
  point.value = value
}

function target(analysis) {
  const event = analysis.events.find(event => event.start.startsWith('2015'))
  assert.ok(event, '2015 dry episode is present')
  return event
}

test('calendar offsets preserve year boundaries and reject non-monthly dates', () => {
  assert.equal(memoryMonthOffset('2015-11-01', '2016-03-01'), 4)
  assert.equal(memoryMonthOffset('2016-03-01', '2015-11-01'), -4)
  assert.throws(() => memoryMonthOffset('2015-02-29', '2016-03-01'), /calendar-month/)
})

test('an episode links complete rainfall windows to an observed five-month soil return, while retaining no vegetation dip', () => {
  const analysis = analyzeMemory(fixture())
  const event = target(analysis)
  assert.equal(event.start, '2015-03-01')
  assert.equal(event.end, '2015-10-01')
  assert.equal(event.duration, 8)
  assert.equal(event.rainRecovery, '2015-12-01')
  assert.equal(event.rainRecoveryStatus, 'confirmed')
  assert.equal(event.soil.recoveryDate, '2016-05-01')
  assert.equal(event.soil.monthsAfterRain, 5)
  assert.equal(event.soil.status, 'recovered')
  assert.equal(event.vegetation.status, 'not-depressed')
  assert.equal(event.classification, 'lingering')
  assert.equal(event.followupEnd, '2016-10-01')
  assert.equal(event.followupReason, 'limit')
})

test('same-calendar-month ranks exclude the target year and preserve raw monthly totals across December', () => {
  const analysis = analyzeMemory(fixture())
  const march = analysis.months.find(point => point.date === '2015-03-01')
  assert.equal(march.vegetationReferenceYears, 24)
  assert.equal(march.vegetationRank, 14 / 24)
  const january = analysis.months.find(point => point.date === '2016-01-01')
  assert.equal(january.rain3, 389)
  assert.equal(january.rain, 131)
  // The first record year has no complete January/February rolling windows.
  assert.equal(analysis.months[0].rain3, null)
  assert.equal(analysis.months[1].rainRank, null)
  assert.equal(january.rainReferenceYears, 23)
})

test('a missing source month invalidates all three affected rainfall windows and never bridges them', () => {
  const data = fixture()
  change(data, 'rain', '2015-06-01', null)
  const analysis = analyzeMemory(data)
  for (const date of ['2015-06-01', '2015-07-01', '2015-08-01']) {
    const point = analysis.months.find(point => point.date === date)
    assert.equal(point.rain3, null)
    assert.equal(point.rainRank, null)
  }
  assert.equal(target(analysis).start, '2015-07-01')
})

test('one isolated low rainfall window is not promoted to a dry episode', () => {
  const data = fixture()
  for (const point of data.rain) if (point.date.startsWith('2015')) point.value = 128 + Number(point.date.slice(5, 7)) % 3
  change(data, 'rain', '2015-05-01', 1)
  change(data, 'rain', '2015-06-01', 1000)
  change(data, 'rain', '2015-07-01', 1000)
  const analysis = analyzeMemory(data)
  assert.ok(analysis.months.find(point => point.date === '2015-05-01').rainRank <= 0.2)
  assert.ok(!analysis.events.some(event => event.start.startsWith('2015')))
})

test('separate low-window runs whose actual three-month periods overlap become one episode', () => {
  const data = fixture()
  for (const point of data.rain) if (point.date.startsWith('2015')) point.value = 128 + Number(point.date.slice(5, 7)) % 3
  for (const [month, value] of [[3, 10], [4, 10], [5, 100], [6, 100], [7, 150], [8, 1], [9, 1]]) change(data, 'rain', `2015-${String(month).padStart(2, '0')}-01`, value)
  const analysis = analyzeMemory(data)
  assert.ok(analysis.months.find(point => point.date === '2015-06-01').rainRank <= 0.2)
  assert.ok(analysis.months.find(point => point.date === '2015-07-01').rainRank > 0.2)
  assert.ok(analysis.months.find(point => point.date === '2015-08-01').rainRank <= 0.2)
  const selected = analysis.events.filter(event => event.start.startsWith('2015'))
  assert.equal(selected.length, 1)
  assert.equal(selected[0].start, '2015-01-01')
  assert.equal(selected[0].end, '2015-11-01')
})

test('a missing soil month can hide an earlier return: the later observed pair gets no exact delay', () => {
  const data = fixture()
  change(data, 'soil', '2016-04-01', null)
  const event = target(analyzeMemory(data))
  assert.equal(event.soil.recoveryDate, '2016-06-01')
  assert.equal(event.soil.status, 'gap')
  assert.equal(event.soil.monthsAfterRain, null)
})

test('missing rainfall windows retain the observed return but mark its timing ambiguous', () => {
  const data = fixture()
  change(data, 'rain', '2015-11-01', null)
  const event = target(analyzeMemory(data))
  assert.equal(event.rainRecovery, '2016-03-01')
  assert.equal(event.rainRecoveryStatus, 'gap')
  assert.equal(event.soil.status, 'recovered')
  assert.equal(event.soil.monthsAfterRain, null)
})

test('complete proxy coverage without low observations is kept as a counterexample', () => {
  const event = target(analyzeMemory(fixture({ delayedSoil: false })))
  assert.equal(event.soil.status, 'not-depressed')
  assert.equal(event.vegetation.status, 'not-depressed')
  assert.equal(event.classification, 'counterexample')
})

test('an absent proxy is unavailable, never a counterexample or a recovery', () => {
  const data = fixture({ delayedSoil: false })
  data.vegetation = []
  const event = target(analyzeMemory(data))
  assert.equal(event.vegetation.status, 'unavailable')
  assert.equal(event.classification, 'incomplete')
  assert.equal(event.vegetation.recoveryDate, null)
})

test('record boundaries and the next episode censor follow-up instead of declaring persistent stress', () => {
  const truncated = target(analyzeMemory(fixture({ end: 2015 })))
  assert.equal(truncated.followupReason, 'record-end')
  assert.equal(truncated.followupEnd, '2015-12-01')
  assert.equal(truncated.soil.status, 'gap')
  assert.equal(truncated.soil.monthsAfterRain, null)
  const data = fixture()
  for (let month = 5; month <= 8; month++) change(data, 'rain', `2016-${String(month).padStart(2, '0')}-01`, 1)
  const event = target(analyzeMemory(data))
  assert.equal(event.followupReason, 'next-episode')
  assert.equal(event.followupEnd, '2016-02-01')
  assert.equal(event.soil.status, 'gap')
})

test('published sparse references retain their exact counts and warning; nine years are insufficient', () => {
  const data = fixture()
  for (const point of data.vegetation) if (Number(point.date.slice(0, 4)) > 2010 && !point.date.startsWith('2015')) point.value = null
  const sparse = analyzeMemory(data)
  const selected = sparse.months.find(point => point.date === '2015-06-01')
  assert.equal(selected.vegetationReferenceYears, 10)
  assert.equal(selected.vegetationRank, 1)
  assert.ok(sparse.warnings.some(warning => warning.includes('less than 80%')))
  change(data, 'vegetation', '2001-06-01', null)
  const insufficient = analyzeMemory(data).months.find(point => point.date === '2015-06-01')
  assert.equal(insufficient.vegetationReferenceYears, 9)
  assert.equal(insufficient.vegetationRank, null)
})

test('ties use midranks; constant rainfall references do not turn an arid cell into perpetual drought', () => {
  const data = fixture()
  for (const point of data.vegetation) point.value = Number(point.date.slice(0, 4)) % 2 ? 0.5 : 0.4
  const selected = analyzeMemory(data).months.find(point => point.date === '2015-06-01')
  assert.equal(selected.vegetationRank, 0.75)
  for (const point of data.rain) point.value = 0
  const constant = analyzeMemory(data)
  assert.ok(constant.months.every(point => point.rainRank === null))
  assert.equal(constant.events.length, 0)
})

test('a later relapse after an already confirmed same-month return is not labelled as a lingering response', () => {
  const data = fixture()
  for (const point of data.soil) if (point.date >= '2015-10-01') point.value = 0.3 + (Number(point.date.slice(0, 4)) - 2001) * 0.01 + Number(point.date.slice(5, 7)) * 0.001
  change(data, 'soil', '2016-08-01', 0.1)
  const event = target(analyzeMemory(data))
  assert.equal(event.soil.status, 'recovered')
  assert.equal(event.soil.monthsAfterRain, -1)
  assert.equal(event.classification, 'quick')
})

test('a proxy can return before rainfall does, with an explicit signed timing difference', () => {
  const data = fixture()
  for (const point of data.soil) if (point.date >= '2015-07-01') point.value = 0.8
  const event = target(analyzeMemory(data))
  assert.equal(event.soil.recoveryDate, '2015-08-01')
  assert.equal(event.rainRecovery, '2015-12-01')
  assert.equal(event.soil.monthsAfterRain, -4)
  assert.equal(event.soil.status, 'recovered')
  assert.equal(event.classification, 'quick')
})

test('a confirmed proxy return is retained even when rainfall return is censored and unavailable', () => {
  const data = fixture({ end: 2015 })
  for (const point of data.soil) if (point.date >= '2015-07-01') point.value = 0.8
  change(data, 'rain', '2015-11-01', 1)
  change(data, 'rain', '2015-12-01', 1)
  const event = target(analyzeMemory(data))
  assert.equal(event.rainRecovery, null)
  assert.equal(event.rainRecoveryStatus, 'censored')
  assert.equal(event.soil.recoveryDate, '2015-08-01')
  assert.equal(event.soil.status, 'recovered')
  assert.equal(event.soil.monthsAfterRain, null)
})

test('validation rejects duplicate, nonfinite, mismatched and physically invalid raw observations', () => {
  const duplicate = fixture()
  duplicate.rain.push({ ...duplicate.rain[0] })
  assert.throws(() => analyzeMemory(duplicate), /Duplicate/)
  for (const [role, value] of [['rain', -1], ['soil', 1.1], ['vegetation', -0.3], ['rain', Infinity]]) {
    const data = fixture()
    data[role][0].value = value
    assert.throws(() => analyzeMemory(data), /physical|finite/)
  }
  const outside = fixture()
  outside.rain[0].date = '2000-12-01'
  assert.throws(() => analyzeMemory(outside), /outside/)
  const provenance = fixture()
  provenance.sources = provenance.sources.filter(source => source.role !== 'soil')
  assert.throws(() => analyzeMemory(provenance), /provenance/)
})

test('evidence exports include complete raw data, all events, version and provenance, and reject relabelled results', () => {
  const data = fixture(), analysis = analyzeMemory(data), event = target(analysis)
  const json = JSON.parse(memoryEvidenceJson(data, analysis, event))
  assert.equal(json.algorithmVersion, 'landscape-memory-v1')
  assert.deepEqual(json.data, data)
  assert.deepEqual(json.analysis.events, analysis.events)
  assert.equal(json.selectedEvent.id, event.id)
  const csv = memoryCsv(data, analysis, event)
  assert.match(csv, /reference_start: 2001/)
  assert.match(csv, /valid_reference_years/)
  assert.match(csv, /target year excluded/)
  assert.match(csv, /source_1_source_url: https:\/\/example.test\/rain/)
  assert.match(csv, /Synthetic fixture/)
  assert.equal(csv.split('\r\n').filter(line => /^\d{4}-/.test(line)).length, 300)
  assert.throws(() => memoryCsv(data, { ...analysis, referenceStart: 1991 }, event), /do not match/)
  assert.throws(() => memoryEvidenceJson(data, analysis, { ...event, classification: 'quick' }), /does not match/)
})
