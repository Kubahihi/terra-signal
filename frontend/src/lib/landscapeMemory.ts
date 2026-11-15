import type { Observation } from '../types/api'
import type { MemoryAnalysis, MemoryDataset, MemoryEvent, MemoryMonth, MemoryRecovery, MemoryRole } from '../types/memory'
import { MEMORY_EVIDENCE_VERSION, memoryEventEvidence, memoryEvidenceSummary } from './memoryEvidence.ts'

const MIN_REFERENCE_YEARS = 10
const DRY_THRESHOLD = 0.2
const RECOVERY_THRESHOLD = 0.5
const FOLLOWUP_MONTHS = 12
const RESPONSE_MONTHS = 3
const ROLES = ['rain', 'soil', 'vegetation'] as const
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/

function monthNumber(date: string): number {
  if (!MONTH.test(date)) throw new Error('Memory observations require calendar-month dates (YYYY-MM-01).')
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
}

function monthDate(index: number): string {
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`
}

/** Signed number of calendar months from a to b; missing rows never compress time. */
export function memoryMonthOffset(a: string, b: string): number {
  return monthNumber(b) - monthNumber(a)
}

function observations(data: MemoryDataset, role: MemoryRole): Map<number, number | null> {
  if (!Array.isArray(data[role])) throw new Error(`Missing ${role} observation array.`)
  const result = new Map<number, number | null>()
  for (const point of data[role] as Observation[]) {
    if (!point || typeof point.date !== 'string') throw new Error(`Invalid ${role} observation.`)
    const number = monthNumber(point.date)
    if (number < data.start * 12 || number >= (data.end + 1) * 12) throw new Error(`${role} observation is outside the declared record.`)
    if (result.has(number)) throw new Error(`Duplicate ${role} calendar month.`)
    if (point.value !== null && (typeof point.value !== 'number' || !Number.isFinite(point.value))) throw new Error(`${role} observations must be finite numbers or null.`)
    if (point.value !== null && (role === 'rain' && point.value < 0 || role === 'soil' && (point.value < 0 || point.value > 1) || role === 'vegetation' && (point.value < -0.2 || point.value > 1))) throw new Error(`${role} observation is outside its physical product range.`)
    result.set(number, point.value)
  }
  return result
}

function validate(data: MemoryDataset): void {
  if (!data || data.schemaVersion !== 1 || !Number.isInteger(data.start) || !Number.isInteger(data.end) || data.start < 1981 || data.end > 2100 || data.end < data.start) throw new Error('Invalid landscape memory record period or schema.')
  if (!data.location || typeof data.location.name !== 'string' || !data.location.name.trim() || !Number.isFinite(data.location.lat) || Math.abs(data.location.lat) > 90 || !Number.isFinite(data.location.lon) || Math.abs(data.location.lon) > 180) throw new Error('Invalid landscape memory location.')
  if (!Array.isArray(data.sources) || !Array.isArray(data.warnings) || data.warnings.some(warning => typeof warning !== 'string')) throw new Error('Landscape memory requires source metadata and warnings.')
  for (const source of data.sources) {
    let url: URL
    try { url = new URL(source.source_url) } catch { throw new Error('Invalid landscape memory source URL.') }
    if (!ROLES.includes(source.role) || !['live', 'cache', 'snapshot', 'import'].includes(source.data_origin) || url.protocol !== 'https:' || typeof source.source !== 'string' || !source.source.trim() || typeof source.spatial_support !== 'string' || !source.spatial_support.trim() || source.retrieved_at !== null && !Number.isFinite(Date.parse(source.retrieved_at))) throw new Error('Invalid landscape memory source provenance.')
  }
  for (const role of ROLES) {
    const points = observations(data, role)
    if ([...points.values()].some(value => value !== null) && !data.sources.some(source => source.role === role)) throw new Error(`Available ${role} observations require matching source provenance.`)
  }
}

type Rank = { value: number | null; count: number; eligible: number }

/** Midranks treat ties symmetrically. Constant reference cohorts have no rank. */
function rank(value: number | null, reference: (number | null)[]): Rank {
  const available = reference.filter((item): item is number => item !== null)
  if (value === null || available.length < MIN_REFERENCE_YEARS || Math.max(...available) === Math.min(...available)) return { value: null, count: available.length, eligible: reference.length }
  let less = 0, ties = 0
  for (const item of available) {
    if (item < value) less++
    else if (item === value) ties++
  }
  return { value: (less + ties / 2) / available.length, count: available.length, eligible: reference.length }
}

type Episode = { firstWindow: number; lastWindow: number; anchor: number; severity: number }

function episodes(months: MemoryMonth[]): Episode[] {
  const runs: Episode[] = []
  let first = -1
  for (let i = 0; i <= months.length; i++) {
    if (i < months.length && months[i].rainRank !== null && months[i].rainRank! <= DRY_THRESHOLD) {
      if (first < 0) first = i
      continue
    }
    if (first >= 0 && i - first >= 2) {
      let anchor = first
      for (let j = first + 1; j < i; j++) if (months[j].rainRank! < months[anchor].rainRank!) anchor = j
      const run = { firstWindow: first, lastWindow: i - 1, anchor, severity: months[anchor].rainRank! }
      const previous = runs.at(-1)
      // Two disjoint runs can still describe overlapping three-month periods.
      if (previous && first - 2 <= previous.lastWindow) {
        previous.lastWindow = run.lastWindow
        if (run.severity < previous.severity) { previous.anchor = run.anchor; previous.severity = run.severity }
      } else runs.push(run)
    }
    first = -1
  }
  return runs
}

function firstRainReturn(months: MemoryMonth[], after: number, stop: number): { index: number | null; ambiguous: boolean } {
  let missing = false
  for (let i = after + 1; i <= stop; i++) {
    if (months[i].rainRank === null) missing = true
    if (i > after + 1 && months[i - 1].rainRank !== null && months[i].rainRank !== null && months[i - 1].rainRank! > DRY_THRESHOLD && months[i].rainRank! > DRY_THRESHOLD) return { index: i, ambiguous: missing }
  }
  return { index: null, ambiguous: missing }
}

function response(months: MemoryMonth[], role: 'soil' | 'vegetation', start: number, end: number, stop: number, rainReturn: { index: number | null; ambiguous: boolean }): MemoryRecovery {
  const key = role === 'soil' ? 'soilRank' : 'vegetationRank'
  const intendedStop = end + FOLLOWUP_MONTHS
  const intendedDipStop = end + RESPONSE_MONTHS
  const dipStop = Math.min(intendedDipStop, stop)
  const window = months.slice(start, stop + 1)
  const observed = window.filter(point => point[key] !== null).length
  const expected = intendedStop - start + 1
  const dipWindow = months.slice(start, dipStop + 1)
  let minimum: number | null = null
  for (let i = start; i <= dipStop; i++) if (months[i][key] !== null && (minimum === null || months[i][key]! < months[minimum][key]!)) minimum = i
  const base = {
    minimumDate: minimum === null ? null : months[minimum].date,
    minimumRank: minimum === null ? null : months[minimum][key],
    recoveryDate: null,
    monthsAfterRain: null,
    observedMonths: observed,
    expectedMonths: expected,
  }
  if (minimum === null) return { ...base, status: 'unavailable' }
  if (months[minimum][key]! > DRY_THRESHOLD) {
    // An absent response is a finding only if its entire predefined window is seen.
    const complete = dipStop === intendedDipStop && dipWindow.every(point => point[key] !== null)
    return { ...base, status: complete ? 'not-depressed' : 'gap' }
  }
  for (let i = minimum + 2; i <= stop; i++) {
    if (months[i - 1][key] === null || months[i][key] === null || months[i - 1][key]! < RECOVERY_THRESHOLD || months[i][key]! < RECOVERY_THRESHOLD) continue
    const hasGap = months.slice(start, i + 1).some(point => point[key] === null)
    return { ...base, status: hasGap ? 'gap' : 'recovered', recoveryDate: months[i].date,
      monthsAfterRain: hasGap || rainReturn.ambiguous || rainReturn.index === null ? null : i - rainReturn.index }
  }
  // End-of-record and a new dry episode censor follow-up, never imply persistence.
  const incomplete = stop < intendedStop || window.some(point => point[key] === null)
  return { ...base, status: incomplete ? 'gap' : 'not-observed' }
}

function classify(months: MemoryMonth[], event: MemoryEvent, end: number, stop: number, rainIndex: number | null): MemoryEvent['classification'] {
  const responses = [event.soil, event.vegetation]
  if (rainIndex !== null) {
    const measuredLag = responses.some(item => item.status === 'recovered' && item.monthsAfterRain !== null && item.monthsAfterRain > 0)
    const observedLowAfterRain = (['soil', 'vegetation'] as const).some(role => {
      const item = event[role]
      if (item.minimumRank === null || item.minimumRank > DRY_THRESHOLD) return false
      const key = role === 'soil' ? 'soilRank' : 'vegetationRank'
      // A later relapse, after an observed return, is not this episode's memory.
      const recoveryIndex = item.recoveryDate === null ? stop + 1 : memoryMonthOffset(months[0].date, item.recoveryDate)
      return months.slice(Math.max(end + 1, rainIndex + 1), Math.min(stop + 1, recoveryIndex)).some(point => point[key] !== null && point[key]! <= DRY_THRESHOLD)
    })
    if (measuredLag || observedLowAfterRain) return 'lingering'
  }
  if (responses.every(item => item.status === 'not-depressed')) return 'counterexample'
  if (rainIndex !== null && responses.every(item => item.status === 'not-depressed' || item.status === 'recovered' && item.monthsAfterRain !== null && item.monthsAfterRain <= 0)) return 'quick'
  return 'incomplete'
}

/** Exploratory event reconstruction; no fitted cause, p-value or resilience score. */
export function analyzeMemory(data: MemoryDataset): MemoryAnalysis {
  validate(data)
  const first = data.start * 12, stop = (data.end + 1) * 12
  const raw = { rain: observations(data, 'rain'), soil: observations(data, 'soil'), vegetation: observations(data, 'vegetation') }
  const rain3 = new Map<number, number | null>()
  for (let number = first; number < stop; number++) {
    const values = [number - 2, number - 1, number].map(index => raw.rain.get(index) ?? null)
    rain3.set(number, values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) : null)
  }
  let sparseReferences = 0
  const months: MemoryMonth[] = []
  for (let number = first; number < stop; number++) {
    const year = Math.floor(number / 12), month = number % 12
    const reference = Array.from({ length: data.end - data.start + 1 }, (_, index) => (data.start + index) * 12 + month).filter(index => Math.floor(index / 12) !== year)
    // Adjacent cross-year three-month windows must not share any source months.
    const rainReference = reference.filter(index => index - 2 >= first && Math.abs(index - number) > 2)
    const r = rank(rain3.get(number) ?? null, rainReference.map(index => rain3.get(index) ?? null))
    const s = rank(raw.soil.get(number) ?? null, reference.map(index => raw.soil.get(index) ?? null))
    const v = rank(raw.vegetation.get(number) ?? null, reference.map(index => raw.vegetation.get(index) ?? null))
    sparseReferences += [r, s, v].filter(item => item.value !== null && item.count < 0.8 * item.eligible).length
    months.push({ date: monthDate(number), rain: raw.rain.get(number) ?? null, soil: raw.soil.get(number) ?? null, vegetation: raw.vegetation.get(number) ?? null,
      rain3: rain3.get(number) ?? null, rainRank: r.value, soilRank: s.value, vegetationRank: v.value,
      rainReferenceYears: r.count, soilReferenceYears: s.count, vegetationReferenceYears: v.count })
  }
  const detected = episodes(months)
  let censored = 0
  const events: MemoryEvent[] = detected.map((episode, index) => {
    const start = episode.firstWindow - 2, end = episode.lastWindow
    const nextStart = detected[index + 1] ? detected[index + 1].firstWindow - 2 : months.length
    const followupStop = Math.min(end + FOLLOWUP_MONTHS, months.length - 1, nextStart - 1)
    const followupReason: MemoryEvent['followupReason'] = detected[index + 1] && nextStart - 1 < end + FOLLOWUP_MONTHS && nextStart - 1 <= months.length - 1 ? 'next-episode' : months.length - 1 < end + FOLLOWUP_MONTHS ? 'record-end' : 'limit'
    if (followupStop < end + FOLLOWUP_MONTHS) censored++
    const rainReturn = firstRainReturn(months, end, followupStop)
    const event: MemoryEvent = {
      id: `${months[start].date}_${months[end].date}`,
      start: months[start].date, end: months[end].date, anchor: months[episode.anchor].date,
      duration: end - start + 1, severity: episode.severity,
      rainRecovery: rainReturn.index === null ? null : months[rainReturn.index].date,
      rainRecoveryStatus: rainReturn.ambiguous ? 'gap' : rainReturn.index !== null ? 'confirmed' : followupReason !== 'limit' ? 'censored' : 'not-observed',
      followupEnd: months[followupStop].date,
      followupReason,
      soil: response(months, 'soil', start, end, followupStop, rainReturn),
      vegetation: response(months, 'vegetation', start, end, followupStop, rainReturn),
      classification: 'incomplete',
    }
    event.classification = classify(months, event, end, followupStop, rainReturn.index)
    return event
  })
  const warnings = [
    'Ranks describe the position among available same-calendar-month observations in this record, with the target year excluded. They are not climate probabilities, significance tests or a complete climate normal.',
    `At least ${MIN_REFERENCE_YEARS} valid reference years are required per rank. Ties use a midrank; constant reference cohorts and missing observations have no rank. Quality-filtered missing MODIS values may bias the available reference.`,
    'A dry episode requires at least two consecutive three-month rainfall windows at or below rank 0.20. Its start includes the first window\'s two preceding months. Overlapping windows are merged; thresholds are exploratory definitions, not an official drought classification.',
    'Rain-index return requires two consecutive ranks above 0.20. Soil and vegetation returns are measured independently: two consecutive ranks at least 0.50 after an observed low rank at or below 0.20. Dates label the second confirming month, at monthly resolution. Signed timing differences are negative for a proxy return before the rain-index return; their thresholds describe different quantities.',
    `Proxy response is searched during the episode and the next ${RESPONSE_MONTHS} months. Follow-up ends ${FOLLOWUP_MONTHS} months after the last dry window, at the record boundary or when the next dry episode starts. Missing months are never interpolated; a gap may hide an earlier return, so its delay is withheld.`,
    'Rainfall and root-zone wetness share the MERRA-2 modelling system and are not independent validation. MODIS NDVI measures greenness in a much smaller footprint, not plant health, crop losses or complete ecosystem recovery. Observed timing does not establish causation.',
    'The reference is not detrended. Long-term change, land management, irrigation, harvest, snow and other influences can affect the observed sequence.',
  ]
  if (sparseReferences) warnings.push(`${sparseReferences} published monthly ranks use less than 80% of their eligible reference years. Inspect the valid-year counts; this is an incomplete available-observation reference.`)
  if (censored) warnings.push(`${censored} of ${events.length} episodes have follow-up shortened by the end of the record or the next dry episode. A missing confirmed return does not establish persistent stress.`)
  return { months, events, referenceStart: data.start, referenceEnd: data.end, minReferenceYears: MIN_REFERENCE_YEARS, dryThreshold: DRY_THRESHOLD, recoveryThreshold: RECOVERY_THRESHOLD, recoveryMonths: 2, followupMonths: FOLLOWUP_MONTHS, warnings }
}

function verifiedEvent(data: MemoryDataset, analysis: MemoryAnalysis, event: MemoryEvent): MemoryEvent {
  const expected = analyzeMemory(data)
  if (JSON.stringify(expected) !== JSON.stringify(analysis)) throw new Error('Memory results do not match the supplied observations and method.')
  const selected = expected.events.find(candidate => candidate.id === event.id)
  if (!selected || JSON.stringify(selected) !== JSON.stringify(event)) throw new Error('Selected memory episode does not match this record.')
  return selected
}

export function memoryCsv(data: MemoryDataset, analysis: MemoryAnalysis, event: MemoryEvent): string {
  const selected = verifiedEvent(data, analysis, event)
  const clean = (value: unknown) => String(value ?? 'unavailable').replace(/[\r\n]+/g, ' ')
  const metadata: [string, unknown][] = [
    ['location', data.location.name], ['latitude', data.location.lat], ['longitude', data.location.lon],
    ['reference_start', data.start], ['reference_end', data.end], ['min_valid_reference_years', MIN_REFERENCE_YEARS],
    ['rank_definition', '(number of valid same-month references below target + 0.5 * tied references) / valid references; target year excluded; constant cohorts withheld'],
    ['rank_interpretation', 'Available-observation descriptive rank in 0..1; not a climate probability or a complete climate normal'],
    ['rain_units', 'monthly total mm; rolling rain3 sums three complete calendar months'], ['soil_units', 'dimensionless NASA POWER GWETROOT wetness fraction'], ['vegetation_units', 'quality-filtered MOD13Q1 NDVI greenness proxy'],
    ['episode_id', selected.id], ['episode_start', selected.start], ['episode_last_dry_window', selected.end], ['episode_driest_window', selected.anchor], ['episode_classification', selected.classification],
    ['episode_classification_scope', 'Original return-timing navigation label; claim_assessment is the separate low-response verdict used by the interface'],
    ['algorithm_version', 'landscape-memory-v1'], ['rain_return_confirmed_month', selected.rainRecovery], ['rain_return_status', selected.rainRecoveryStatus], ['followup_end', selected.followupEnd], ['followup_end_reason', selected.followupReason], ['soil_response', JSON.stringify(selected.soil)], ['vegetation_response', JSON.stringify(selected.vegetation)],
    ['claim_evidence_version', MEMORY_EVIDENCE_VERSION],
    ['tested_claim', 'Every dry episode includes both a low soil-wetness rank and a low greenness rank during the episode through three subsequent months; low means rank <=0.20'],
    ['claim_assessment', JSON.stringify(memoryEventEvidence(analysis, selected))],
    ['claim_counts', JSON.stringify((() => { const summary = memoryEvidenceSummary(analysis); return { total: summary.events.length, counterexamples: summary.counterexamples.length, low_observed_in_both: summary.lowObserved.length, unknown: summary.unknown.length } })())],
    ['claim_threshold_sensitivity', 'Proxy low-band thresholds 0.15/0.20/0.25 use the same response window and the same rainfall episodes selected at0.20; missing values are never counterexamples; fast returns do not establish absence of a low response'],
    ['dry_definition', 'At least two consecutive rolling3 rainfall ranks <=0.20; overlapping periods merged'],
    ['return_definition', 'Independently confirmed second consecutive month: rain rank >0.20; proxy rank >=0.50 after observed rank <=0.20; signed timing differences withheld across gaps or when either return is unknown'],
    ['followup', '12 months past last dry window, shortened by record boundary or next dry episode'],
    ...data.sources.flatMap((source, index): [string, unknown][] => Object.entries(source).map(([key, value]) => [`source_${index + 1}_${key}`, value])),
    ['warnings', [...data.warnings, ...analysis.warnings].join(' | ')],
  ]
  const rows = ['date,rain_total_mm,soil_wetness_fraction,vegetation_ndvi,rain_3month_total_mm,rain_rank,soil_rank,vegetation_rank,rain_valid_reference_years,soil_valid_reference_years,vegetation_valid_reference_years,selected_episode']
  for (const point of analysis.months) rows.push([point.date, point.rain, point.soil, point.vegetation, point.rain3, point.rainRank, point.soilRank, point.vegetationRank, point.rainReferenceYears, point.soilReferenceYears, point.vegetationReferenceYears, point.date >= selected.start && point.date <= selected.end ? 1 : 0].map(value => value ?? '').join(','))
  return [...metadata.map(([key, value]) => `# ${key}: ${clean(value)}`), ...rows].join('\r\n')
}

export function memoryEvidenceJson(data: MemoryDataset, analysis: MemoryAnalysis, event: MemoryEvent): string {
  const selected = verifiedEvent(data, analysis, event)
  return JSON.stringify({ schemaVersion: 1, algorithmVersion: 'landscape-memory-v1', method: 'TerraSignal landscape memory: descriptive calendar-month ranks and confirmed observed returns', selectedEvent: selected, data, analysis,
    claimEvidence: { version: MEMORY_EVIDENCE_VERSION, claim: 'Every dry episode includes both low soil wetness and low greenness during the episode and its next three months.', lowThreshold: DRY_THRESHOLD, selected: memoryEventEvidence(analysis, selected), summary: memoryEvidenceSummary(analysis), sensitivity: 'The same rainfall-selected episodes and response windows are checked at proxy thresholds 0.15,0.20,0.25. These checks are descriptive, not confidence levels.' } }, null, 2)
}
