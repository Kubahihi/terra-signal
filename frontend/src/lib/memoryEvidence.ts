import type { MemoryAnalysis, MemoryEvent, MemoryMonth } from '../types/memory'

export const MEMORY_EVIDENCE_VERSION = 'landscape-memory-evidence-v1'
const RESPONSE_MONTHS = 3
const roles = ['soil', 'vegetation'] as const
const rankKeys = { rain: 'rainRank', soil: 'soilRank', vegetation: 'vegetationRank' } as const
const referenceKeys = { rain: 'rainReferenceYears', soil: 'soilReferenceYears', vegetation: 'vegetationReferenceYears' } as const
type ProxyRole = typeof roles[number]
export type MemoryEvidenceVerdict = 'counterexample' | 'low-observed' | 'unknown'
export type MemoryRoleEvidence = {
  role: ProxyRole
  verdict: MemoryEvidenceVerdict
  windowStart: string
  windowEnd: string
  observedMonths: number
  expectedMonths: number
  minimumRank: number | null
  minimumDate: string | null
  margin: number | null
  reason: string
  thresholdChecks: { threshold: number; verdict: MemoryEvidenceVerdict }[]
}
export type MemoryTimingEvidence = {
  role: ProxyRole
  verdict: 'after' | 'by-rain' | 'unknown'
  monthsAfterRain: number | null
  proxyReturn: string | null
  rainReturn: string | null
  reason: string
}
export type MemoryEventEvidence = {
  eventId: string
  verdict: MemoryEvidenceVerdict
  roles: MemoryRoleEvidence[]
  timing: MemoryTimingEvidence[]
}
export type MemoryEvidenceSummary = {
  events: MemoryEventEvidence[]
  counterexamples: MemoryEventEvidence[]
  lowObserved: MemoryEventEvidence[]
  unknown: MemoryEventEvidence[]
}

function number(date: string): number {
  if (typeof date !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(date)) throw new Error('Evidence requires calendar-month dates (YYYY-MM-01).')
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
}
function date(index: number): string {
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`
}
type Prepared = { analysis: MemoryAnalysis; months: Map<number, MemoryMonth> }

function prepare(analysis: MemoryAnalysis): Prepared {
  if (!analysis || !Array.isArray(analysis.months) || !Array.isArray(analysis.events) || !Number.isInteger(analysis.minReferenceYears) || analysis.minReferenceYears < 10 || !Number.isInteger(analysis.referenceStart) || !Number.isInteger(analysis.referenceEnd) || analysis.referenceEnd < analysis.referenceStart || !Number.isFinite(analysis.dryThreshold) || analysis.dryThreshold < 0 || analysis.dryThreshold > 1 || !Number.isFinite(analysis.recoveryThreshold) || analysis.recoveryThreshold < 0 || analysis.recoveryThreshold > 1 || analysis.recoveryMonths !== 2) throw new Error('Invalid or unsupported memory evidence definition.')
  const months = new Map<number, MemoryMonth>()
  for (const month of analysis.months) {
    const index = number(month.date)
    if (months.has(index)) throw new Error('Evidence cannot use duplicate calendar months.')
    if (index < analysis.referenceStart * 12 || index >= (analysis.referenceEnd + 1) * 12) throw new Error('Evidence month is outside the declared reference record.')
    for (const role of ['rain', ...roles] as const) {
      const rank = month[rankKeys[role]], references = month[referenceKeys[role]]
      if (rank !== null && (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 0 || rank > 1)) throw new Error('Evidence ranks must be finite values from zero to one, or null.')
      if (!Number.isInteger(references) || references < 0 || references > analysis.referenceEnd - analysis.referenceStart) throw new Error('Invalid evidence reference-year count.')
    }
    months.set(index, month)
  }
  return { analysis, months }
}

function eligible(prepared: Prepared, index: number, role: 'rain' | ProxyRole): number | null {
  const month = prepared.months.get(index)
  if (!month || month[referenceKeys[role]] < prepared.analysis.minReferenceYears) return null
  return month[rankKeys[role]]
}

function boundaries(event: MemoryEvent) {
  const start = number(event.start), end = number(event.end), followupEnd = number(event.followupEnd)
  if (start > end || followupEnd < end || typeof event.id !== 'string' || !event.id) throw new Error('Invalid memory episode evidence window.')
  return { start, end, followupEnd, intendedEnd: end + RESPONSE_MONTHS }
}

function roleEvidence(prepared: Prepared, event: MemoryEvent, role: ProxyRole): MemoryRoleEvidence {
  const { start, followupEnd, intendedEnd } = boundaries(event)
  let observed = 0, minimumRank: number | null = null, minimumDate: string | null = null
  for (let index = start; index <= Math.min(followupEnd, intendedEnd); index++) {
    const rank = eligible(prepared, index, role)
    if (rank === null) continue
    observed++
    if (minimumRank === null || rank < minimumRank) { minimumRank = rank; minimumDate = date(index) }
  }
  const expected = intendedEnd - start + 1
  const complete = observed === expected && followupEnd >= intendedEnd
  const verdictAt = (threshold: number): MemoryEvidenceVerdict => minimumRank !== null && minimumRank <= threshold ? 'low-observed' : complete ? 'counterexample' : 'unknown'
  const verdict = verdictAt(prepared.analysis.dryThreshold)
  const lowBand = Math.round(prepared.analysis.dryThreshold * 100)
  const reason = verdict === 'counterexample'
    ? `All ${expected} response months have eligible ranks; every rank is above ${lowBand}. This contradicts a low response for this proxy under this threshold.`
    : verdict === 'low-observed'
      ? `A rank at or below ${lowBand} was observed in the response window. This establishes an observed low value, not its cause or duration.`
      : `Only ${observed} of ${expected} response months have eligible ranks. Missing or truncated observations cannot establish that no low response occurred.`
  return {
    role, verdict, windowStart: date(start), windowEnd: date(intendedEnd), observedMonths: observed, expectedMonths: expected,
    minimumRank, minimumDate, margin: complete && minimumRank !== null ? minimumRank - prepared.analysis.dryThreshold : null, reason,
    thresholdChecks: [0.15, 0.2, 0.25].map(threshold => ({ threshold, verdict: verdictAt(threshold) })),
  }
}

function timingEvidence(prepared: Prepared, event: MemoryEvent, evidence: MemoryRoleEvidence): MemoryTimingEvidence {
  const role = evidence.role, proxy = event[role]
  const unknown = (reason: string): MemoryTimingEvidence => ({ role, verdict: 'unknown', monthsAfterRain: null, proxyReturn: proxy.recoveryDate, rainReturn: event.rainRecovery, reason })
  if (proxy.status !== 'recovered' || proxy.recoveryDate === null) return unknown('The first proxy return is not established by complete comparable observations.')
  if (event.rainRecoveryStatus !== 'confirmed' || event.rainRecovery === null) return unknown('The first rainfall-index return is not established; a precise relative delay is unavailable.')
  if (evidence.minimumRank === null || evidence.minimumRank > prepared.analysis.dryThreshold || evidence.minimumDate === null) return unknown('No eligible low proxy rank establishes a response from which to measure return.')
  const { start, end, followupEnd } = boundaries(event)
  let rainReturn: number | null = null, rainGap = false
  for (let index = end + 1; index <= followupEnd; index++) {
    const rank = eligible(prepared, index, 'rain')
    if (rank === null) rainGap = true
    const previous = index > end + 1 ? eligible(prepared, index - 1, 'rain') : null
    if (previous !== null && rank !== null && previous > prepared.analysis.dryThreshold && rank > prepared.analysis.dryThreshold) { rainReturn = index; break }
  }
  if (rainGap || rainReturn === null || date(rainReturn) !== event.rainRecovery) return unknown('Rainfall return metadata do not establish the first qualifying pair without gaps.')
  const minimum = number(evidence.minimumDate)
  let proxyReturn: number | null = null
  for (let index = minimum + 2; index <= followupEnd; index++) {
    const previous = eligible(prepared, index - 1, role), rank = eligible(prepared, index, role)
    if (previous !== null && rank !== null && previous >= prepared.analysis.recoveryThreshold && rank >= prepared.analysis.recoveryThreshold) { proxyReturn = index; break }
  }
  if (proxyReturn === null || date(proxyReturn) !== proxy.recoveryDate) return unknown('Proxy return metadata do not match the first observed qualifying pair.')
  for (let index = start; index <= proxyReturn; index++) if (eligible(prepared, index, role) === null) return unknown('A missing or ineligible proxy month could hide an earlier return.')
  const lag = proxyReturn - rainReturn
  if (!Number.isInteger(proxy.monthsAfterRain) || proxy.monthsAfterRain !== lag) return unknown('The reported delay does not match the two confirmed return months.')
  return { role, verdict: lag > 0 ? 'after' : 'by-rain', monthsAfterRain: lag, proxyReturn: date(proxyReturn), rainReturn: date(rainReturn),
    reason: lag > 0 ? 'The first qualifying proxy return is observed after the first rainfall-index return.' : 'The first qualifying proxy return is observed in the same month as, or before, the rainfall-index return. This timing does not establish absence of a low response.' }
}

function eventEvidence(prepared: Prepared, event: MemoryEvent): MemoryEventEvidence {
  const evidence = roles.map(role => roleEvidence(prepared, event, role))
  const verdict: MemoryEvidenceVerdict = evidence.some(item => item.verdict === 'counterexample') ? 'counterexample' : evidence.every(item => item.verdict === 'low-observed') ? 'low-observed' : 'unknown'
  return { eventId: event.id, verdict, roles: evidence, timing: evidence.map(item => timingEvidence(prepared, event, item)) }
}

/** Test one precisely stated low-response claim, independently of old event labels. */
export function memoryEventEvidence(analysis: MemoryAnalysis, event: MemoryEvent): MemoryEventEvidence {
  return eventEvidence(prepare(analysis), event)
}

/** Disjoint claim outcomes; unknown months never increase the counterexample count. */
export function memoryEvidenceSummary(analysis: MemoryAnalysis): MemoryEvidenceSummary {
  const prepared = prepare(analysis)
  if (new Set(analysis.events.map(event => event.id)).size !== analysis.events.length) throw new Error('Evidence cannot count duplicate episodes.')
  const ordered = [...analysis.events].sort((a, b) => b.start.localeCompare(a.start) || b.id.localeCompare(a.id))
  const events = ordered.map(event => eventEvidence(prepared, event))
  return { events, counterexamples: events.filter(event => event.verdict === 'counterexample'), lowObserved: events.filter(event => event.verdict === 'low-observed'), unknown: events.filter(event => event.verdict === 'unknown') }
}
