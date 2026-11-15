import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyzeMemory } from '../src/lib/landscapeMemory.ts'
import { MEMORY_EVIDENCE_VERSION, memoryEventEvidence, memoryEvidenceSummary } from '../src/lib/memoryEvidence.ts'

function fixture() {
  const recovery = { status: 'not-depressed', minimumDate: null, minimumRank: 0.6, recoveryDate: null, monthsAfterRain: null, observedMonths: 16, expectedMonths: 16 }
  const event = { id: '2015-03-01_2015-06-01', start: '2015-03-01', end: '2015-06-01', anchor: '2015-06-01', duration: 4, severity: 0.1,
    rainRecovery: '2015-08-01', rainRecoveryStatus: 'confirmed', followupEnd: '2016-06-01', followupReason: 'limit', soil: { ...recovery }, vegetation: { ...recovery }, classification: 'counterexample' }
  const months = []
  for (let index = 2015 * 12; index <= 2016 * 12 + 5; index++) {
    const year = Math.floor(index / 12), month = index % 12 + 1
    months.push({ date: `${year}-${String(month).padStart(2, '0')}-01`, rain: 50, rain3: 150, soil: 0.6, vegetation: 0.7,
      rainRank: index <= 2015 * 12 + 5 ? 0.1 : 0.7, soilRank: 0.6, vegetationRank: 0.7,
      rainReferenceYears: 24, soilReferenceYears: 24, vegetationReferenceYears: 24 })
  }
  const analysis = { months, events: [event], referenceStart: 2001, referenceEnd: 2025, minReferenceYears: 10, dryThreshold: 0.2, recoveryThreshold: 0.5, recoveryMonths: 2, followupMonths: 12, warnings: [] }
  return { analysis, event }
}
function row(analysis, date) { return analysis.months.find(item => item.date === date) }
function role(evidence, selected = 'soil') { return evidence.roles.find(item => item.role === selected) }
function earlyReturnFixture() {
  const { analysis, event } = fixture()
  for (const month of analysis.months) if (month.date >= event.start && month.date <= '2015-05-01') {
    month.soilRank = 0.1
    month.vegetationRank = 0.1
  }
  for (const selected of ['soil', 'vegetation']) event[selected] = { ...event[selected], status: 'recovered', minimumDate: event.start, minimumRank: 0.1, recoveryDate: '2015-07-01', monthsAfterRain: -1 }
  event.classification = 'quick'
  return { analysis, event }
}

test('the complete intended window, not a recovery label, establishes a no-low counterexample', () => {
  const { analysis, event } = fixture()
  event.soil.status = 'gap'
  const evidence = memoryEventEvidence(analysis, event)
  assert.equal(evidence.verdict, 'counterexample')
  assert.deepEqual({ start: role(evidence).windowStart, end: role(evidence).windowEnd, observed: role(evidence).observedMonths, expected: role(evidence).expectedMonths }, { start: '2015-03-01', end: '2015-09-01', observed: 7, expected: 7 })
  assert.equal(role(evidence).minimumRank, 0.6)
  assert.ok(Math.abs(role(evidence).margin - 0.4) < 1e-12)
  assert.equal(MEMORY_EVIDENCE_VERSION, 'landscape-memory-evidence-v1')
})

test('a single missing month prevents counterevidence, even with a forged not-depressed status', () => {
  const { analysis, event } = fixture()
  row(analysis, '2015-07-01').soilRank = null
  row(analysis, '2015-07-01').vegetationRank = null
  const evidence = memoryEventEvidence(analysis, event)
  assert.equal(evidence.verdict, 'unknown')
  assert.equal(role(evidence).verdict, 'unknown')
  assert.equal(role(evidence).observedMonths, 6)
  assert.equal(role(evidence).margin, null)
  assert.match(role(evidence).reason, /6 of 7/)
})

test('missing rows and too few reference years remain unknown without compressing the calendar', () => {
  const missing = fixture()
  missing.analysis.months = missing.analysis.months.filter(month => month.date !== '2015-06-01')
  assert.equal(role(memoryEventEvidence(missing.analysis, missing.event)).verdict, 'unknown')
  const insufficient = fixture()
  row(insufficient.analysis, '2015-06-01').soilReferenceYears = 9
  const result = role(memoryEventEvidence(insufficient.analysis, insufficient.event))
  assert.equal(result.verdict, 'unknown')
  assert.equal(result.observedMonths, 6)
})

test('a record or next-episode boundary cannot shorten the no-low claim to an easier window', () => {
  for (const reason of ['record-end', 'next-episode']) {
    const { analysis, event } = fixture()
    event.followupEnd = '2015-08-01'
    event.followupReason = reason
    const evidence = memoryEventEvidence(analysis, event)
    assert.equal(evidence.verdict, 'unknown')
    assert.equal(role(evidence).windowEnd, '2015-09-01')
    assert.equal(role(evidence).observedMonths, 6)
    assert.equal(role(evidence).expectedMonths, 7)
  }
})

test('an actual low rank stays observed with other gaps, and an exact threshold tie is low', () => {
  const { analysis, event } = fixture()
  for (const selected of ['soilRank', 'vegetationRank']) {
    row(analysis, '2015-03-01')[selected] = 0.2
    row(analysis, '2015-05-01')[selected] = null
  }
  const evidence = memoryEventEvidence(analysis, event)
  assert.equal(evidence.verdict, 'low-observed')
  assert.equal(role(evidence).verdict, 'low-observed')
  assert.equal(role(evidence).minimumRank, 0.2)
  assert.deepEqual(role(evidence).thresholdChecks, [
    { threshold: 0.15, verdict: 'unknown' }, { threshold: 0.2, verdict: 'low-observed' }, { threshold: 0.25, verdict: 'low-observed' },
  ])
})

test('one complete no-low proxy is a counterexample to the both-proxies claim, while the other low remains visible', () => {
  const { analysis, event } = fixture()
  row(analysis, '2015-04-01').vegetationRank = 0.1
  row(analysis, '2015-05-01').vegetationRank = null
  const evidence = memoryEventEvidence(analysis, event)
  assert.equal(evidence.verdict, 'counterexample')
  assert.equal(role(evidence, 'soil').verdict, 'counterexample')
  assert.equal(role(evidence, 'vegetation').verdict, 'low-observed')
})

test('quick returns are separate timing evidence and never imply absence of a low response', () => {
  const { analysis, event } = earlyReturnFixture()
  const evidence = memoryEventEvidence(analysis, event)
  assert.equal(evidence.verdict, 'low-observed')
  assert.ok(evidence.timing.every(item => item.verdict === 'by-rain' && item.monthsAfterRain === -1))
  const summary = memoryEvidenceSummary(analysis)
  assert.equal(summary.counterexamples.length, 0)
  assert.equal(summary.lowObserved.length, 1)
})

test('return timing validates the actual qualifying pairs, signed lag and gap-free observations', () => {
  const forged = earlyReturnFixture()
  forged.event.soil.monthsAfterRain = 5
  assert.equal(memoryEventEvidence(forged.analysis, forged.event).timing[0].verdict, 'unknown')
  const missing = earlyReturnFixture()
  row(missing.analysis, '2015-04-01').soilRank = null
  assert.equal(memoryEventEvidence(missing.analysis, missing.event).timing[0].verdict, 'unknown')
  const rainfall = earlyReturnFixture()
  rainfall.event.rainRecoveryStatus = 'gap'
  assert.ok(memoryEventEvidence(rainfall.analysis, rainfall.event).timing.every(item => item.verdict === 'unknown'))
  const falseDate = earlyReturnFixture()
  falseDate.event.rainRecovery = '2015-09-01'
  assert.ok(memoryEventEvidence(falseDate.analysis, falseDate.event).timing.every(item => item.verdict === 'unknown'))
})

test('a later confirmed return is distinguished from an earlier or same-month return', () => {
  const { analysis, event } = earlyReturnFixture()
  for (const month of analysis.months) if (month.date >= '2015-06-01' && month.date <= '2015-08-01') month.soilRank = 0.1
  event.soil.recoveryDate = '2015-10-01'
  event.soil.monthsAfterRain = 2
  const timing = memoryEventEvidence(analysis, event).timing[0]
  assert.equal(timing.verdict, 'after')
  assert.equal(timing.monthsAfterRain, 2)
  const same = earlyReturnFixture()
  row(same.analysis, '2015-06-01').soilRank = 0.1
  same.event.soil.recoveryDate = '2015-08-01'
  same.event.soil.monthsAfterRain = 0
  const simultaneous = memoryEventEvidence(same.analysis, same.event)
  assert.equal(simultaneous.timing[0].verdict, 'by-rain')
  assert.equal(simultaneous.timing[0].monthsAfterRain, 0)
  assert.equal(simultaneous.verdict, 'low-observed')
})

test('invalid ranks, dates, duplicate months and impossible reference counts fail closed', () => {
  for (const value of [NaN, Infinity, -0.1, 1.1, '0.8']) {
    const { analysis, event } = fixture()
    row(analysis, '2015-06-01').soilRank = value
    assert.throws(() => memoryEventEvidence(analysis, event), /ranks/)
  }
  const duplicate = fixture()
  duplicate.analysis.months.push({ ...duplicate.analysis.months[0] })
  assert.throws(() => memoryEvidenceSummary(duplicate.analysis), /duplicate/)
  const badReferences = fixture()
  row(badReferences.analysis, '2015-06-01').soilReferenceYears = 25
  assert.throws(() => memoryEventEvidence(badReferences.analysis, badReferences.event), /reference-year/)
  const badDate = fixture()
  badDate.event.end = '2015-06-30'
  assert.throws(() => memoryEventEvidence(badDate.analysis, badDate.event), /calendar-month/)
  const unsupported = fixture()
  unsupported.analysis.minReferenceYears = 1
  assert.throws(() => memoryEventEvidence(unsupported.analysis, unsupported.event), /unsupported/)
})

test('real Prague evidence retains two soil counterexamples and distinguishes their threshold margin', () => {
  const data = JSON.parse(readFileSync(new URL('../public/data/landscape-memory-example.json', import.meta.url), 'utf8'))
  const analysis = analyzeMemory(data)
  const summary = memoryEvidenceSummary(analysis)
  assert.equal(summary.events.length, 14)
  assert.equal(summary.counterexamples.length, 2)
  assert.equal(summary.counterexamples.length + summary.lowObserved.length + summary.unknown.length, summary.events.length)
  assert.deepEqual(summary.counterexamples.map(event => event.eventId), ['2016-11-01_2017-02-01', '2011-01-01_2011-05-01'])
  const early = summary.counterexamples.find(event => event.eventId.startsWith('2011'))
  const recent = summary.counterexamples.find(event => event.eventId.startsWith('2016'))
  assert.equal(role(early, 'vegetation').verdict, 'low-observed')
  assert.ok(Math.abs(role(early).minimumRank - 13 / 24) < 1e-12)
  assert.ok(role(early).thresholdChecks.every(item => item.verdict === 'counterexample'))
  assert.ok(Math.abs(role(recent).minimumRank - 5 / 24) < 1e-12)
  assert.equal(role(recent).thresholdChecks.find(item => item.threshold === 0.25).verdict, 'low-observed')
  assert.equal(role(recent, 'vegetation').verdict, 'unknown')
  const drought2018 = summary.events.find(event => event.eventId.startsWith('2018'))
  assert.equal(drought2018.verdict, 'low-observed')
  assert.equal(drought2018.timing.find(item => item.role === 'soil').monthsAfterRain, 2)
  assert.equal(drought2018.timing.find(item => item.role === 'vegetation').verdict, 'unknown')
})
