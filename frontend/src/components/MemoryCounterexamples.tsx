import type { MemoryAnalysis, MemoryEvent } from '../types/memory'
import type { MemoryEventEvidence, MemoryEvidenceSummary, MemoryRoleEvidence } from '../lib/memoryEvidence'
import Icon from './Icon'
import './MemoryCounterexamples.css'

const roleNames = { soil: 'Soil wetness', vegetation: 'Vegetation greenness' } as const
const verdictNames = { counterexample: 'Verified counterexample', 'low-observed': 'Low rank observed', unknown: 'Cannot determine' } as const
const rank = (value: number) => (value * 100).toLocaleString('en', { maximumFractionDigits: 1 })
const month = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const period = (start: string, end: string) => `${month(start)} – ${month(end)}`

function bestCounterexample(evidence: MemoryEventEvidence) {
  return evidence.roles.filter(role => role.verdict === 'counterexample').sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity))[0]
}

function Sensitivity({ evidence }: { evidence: MemoryRoleEvidence }) {
  return <div className="mce-sensitivity"><span>Sensitivity check: low-band cutoffs</span><div>{evidence.thresholdChecks.map(check => <span key={check.threshold} className={`mce-check ${check.verdict}`}><b>≤ {rank(check.threshold)}</b><span>{check.verdict === 'counterexample' ? 'above band' : check.verdict === 'low-observed' ? 'low seen' : 'unknown'}</span></span>)}</div><small>Same episode and response months; only the proxy cutoff changes.</small></div>
}

function BoundaryNote({ evidence }: { evidence: MemoryRoleEvidence }) {
  if (evidence.verdict !== 'counterexample') return null
  const near = evidence.margin !== null && evidence.margin <= 0.05
  const alsoAbove25 = evidence.thresholdChecks.some(check => check.threshold === 0.25 && check.verdict === 'counterexample')
  return <p className={`mce-boundary${near ? ' near' : ''}`}><strong>{near ? 'Near the cutoff.' : alsoAbove25 ? 'Also above the 25 cutoff.' : 'Defined at the current cutoff.'}</strong> {evidence.margin !== null && <>The lowest rank is {rank(evidence.margin)} rank point{Math.abs(evidence.margin * 100 - 1) < 1e-9 ? '' : 's'} above the current low band.</>}</p>
}

export default function MemoryCounterexamples({ analysis, evidence, selectedEventId, onSelect }: {
  analysis: MemoryAnalysis
  evidence: MemoryEvidenceSummary
  selectedEventId: string
  onSelect: (event: MemoryEvent) => void
}) {
  const candidates = evidence.counterexamples.map(item => ({ evidence: item, role: bestCounterexample(item), event: analysis.events.find(event => event.id === item.eventId) }))
    .filter((item): item is typeof item & { event: MemoryEvent; role: MemoryRoleEvidence } => Boolean(item.event && item.role))
    .sort((a, b) => (b.role.margin ?? -Infinity) - (a.role.margin ?? -Infinity) || b.event.start.localeCompare(a.event.start))
  return <section className="mce-counterexamples" aria-labelledby="memory-counterexamples-heading">
    <div className="mce-heading"><div><p className="mce-eyebrow">Try to disprove the claim</p><h3 id="memory-counterexamples-heading">Counterexamples <span>{candidates.length}</span></h3><p>The claim requires <strong>both</strong> records to enter the low band. One fully checked record staying above it is enough to contradict that claim for an episode.</p></div><div className="mce-rule"><strong>Low band: rank ≤ 20</strong><span>Check every month of the episode and the next three months.</span></div></div>
    {candidates.length ? <div className="mce-case-grid">{candidates.map(({ evidence: item, role, event }) => <article className={`mce-case${selectedEventId === event.id ? ' selected' : ''}`} key={event.id}>
      <div className="mce-case-top"><span><Icon name={role.role === 'soil' ? 'water' : 'leaf'} />{roleNames[role.role]} counterexample</span><span className={`mce-tag${role.margin !== null && role.margin <= 0.05 ? ' near' : ''}`}>{role.margin !== null && role.margin <= 0.05 ? 'Near cutoff' : 'Full window checked'}</span></div>
      <h4>{period(event.start, event.end)}</h4><p className="mce-case-conclusion">{roleNames[role.role]} stayed above the low band in <strong>every checked month.</strong></p>
      <dl className="mce-proof-metrics"><div><dt>Eligible months</dt><dd>{role.observedMonths} / {role.expectedMonths}</dd></div><div><dt>Lowest rank</dt><dd>{role.minimumRank === null ? '—' : rank(role.minimumRank)}<small> / 100</small></dd></div><div><dt>Low band</dt><dd>≤ 20</dd></div></dl>
      <p className="mce-window">Response checked: {period(role.windowStart, role.windowEnd)}</p><BoundaryNote evidence={role} /><Sensitivity evidence={role} />
      <p className="mce-other-record">{item.roles.filter(other => other.role !== role.role).map(other => `${roleNames[other.role]}: ${other.verdict === 'low-observed' ? 'a low rank was observed' : other.verdict === 'counterexample' ? 'also stayed above the low band throughout' : 'cannot be assessed completely'}.`).join(' ')}</p>
      <button type="button" className="mce-inspect" aria-pressed={selectedEventId === event.id} onClick={() => onSelect(event)}>{selectedEventId === event.id ? 'Inspecting this counterexample' : 'Inspect this counterexample'}<Icon name="arrow" /></button>
    </article>)}</div> : <div className="mce-no-counters"><Icon name="info" /><div><strong>No verified counterexample under this rule.</strong><p>{evidence.lowObserved.length} episode{evidence.lowObserved.length === 1 ? '' : 's'} contain observed lows in both records; {evidence.unknown.length} cannot be assessed completely. Missing months do not count as counterexamples. This result does not prove that every drought produces a low response.</p></div></div>}
    <p className="mce-scope">These are counterexamples to the displayed rank rule in these records. They do not establish absence of ecological damage or the cause of a response.</p>
  </section>
}

export function MemoryAssessment({ evidence, onInspectMonth }: { evidence: MemoryEventEvidence; onInspectMonth: (date: string) => void }) {
  return <section className="mce-assessment" aria-label="Evidence for each record"><div className="mce-assessment-heading"><h3>What does each record establish?</h3><p>The low-response question and the timing of a return are assessed separately.</p></div><div className="mce-assessment-grid">{evidence.roles.map(role => <article key={role.role} className={`mce-role ${role.verdict}`}>
    <div className="mce-role-heading"><h4><Icon name={role.role === 'soil' ? 'water' : 'leaf'} />{roleNames[role.role]}</h4><strong>{verdictNames[role.verdict]}</strong></div>
    <p className="mce-role-conclusion">{role.verdict === 'counterexample' ? 'Every eligible month stays above rank 20. The whole response window is covered.' : role.verdict === 'low-observed' ? `A low rank was observed${role.minimumDate ? ` in ${month(role.minimumDate)}` : ''}. Other missing months do not erase that observation.` : 'The whole response window cannot be checked. Absence of a low response is unresolved.'}</p>
    <dl className="mce-role-facts"><div><dt>Response window</dt><dd>{period(role.windowStart, role.windowEnd)}</dd></div><div><dt>Eligible months</dt><dd>{role.observedMonths} / {role.expectedMonths}</dd></div><div><dt>Lowest eligible rank</dt><dd>{role.minimumRank === null ? 'Unavailable' : `${rank(role.minimumRank)} / 100`}</dd></div></dl>
    <BoundaryNote evidence={role} />
    {role.verdict === 'counterexample' && <Sensitivity evidence={role} />}
    {role.minimumDate && <button type="button" className="mce-month-link" onClick={() => onInspectMonth(role.minimumDate!)}>Inspect lowest month · {month(role.minimumDate)}<Icon name="arrow" /></button>}
  </article>)}</div></section>
}
