import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Location } from '../lib/locations'
import { coordinates } from '../lib/locations'
import { analyzeMemory, memoryCsv, memoryEvidenceJson, memoryMonthOffset } from '../lib/landscapeMemory'
import { loadMemory, loadMemoryExample } from '../lib/memoryLoader'
import type { MemoryAnalysis, MemoryDataset, MemoryEvent, MemoryMonth, MemoryRecovery, MemoryRole } from '../types/memory'
import Icon from './Icon'
import './LandscapeMemory.css'

type Props = { visible?: boolean; location: Location; onChoosePlace: () => void }
type LoadMode = 'example' | 'selected'
type EventFilter = 'all' | 'severe' | 'counterexample' | 'incomplete'
const lastYear = new Date().getUTCFullYear() - 1
const roles: MemoryRole[] = ['rain', 'soil', 'vegetation']
const roleLabels: Record<MemoryRole, string> = { rain: 'Rainfall', soil: 'Root-zone soil wetness', vegetation: 'Vegetation greenness' }
const rankKeys = { rain: 'rainRank', soil: 'soilRank', vegetation: 'vegetationRank' } as const
const referenceKeys = { rain: 'rainReferenceYears', soil: 'soilReferenceYears', vegetation: 'vegetationReferenceYears' } as const
const outcomeLabels: Record<MemoryEvent['classification'], string> = { lingering: 'Later proxy response', quick: 'Returns close together', counterexample: 'No low proxy response', incomplete: 'Incomplete evidence' }
const monthLabel = (date: string, short = false) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' })
const eventLabel = (event: MemoryEvent) => `${monthLabel(event.start, true)} – ${monthLabel(event.end, true)}`
const rankLabel = (value: number | null) => value === null ? 'Unavailable' : `${Math.round(value * 100)} / 100`
const percent = (observed: number, expected: number) => expected ? `${observed} / ${expected} months` : 'No observation window'

function recoveryLabel(recovery: MemoryRecovery) {
  switch (recovery.status) {
    case 'recovered': return recovery.monthsAfterRain === null ? 'Return observed; comparison unavailable' : recovery.monthsAfterRain === 0 ? 'Same month as rain' : `${Math.abs(recovery.monthsAfterRain)} month${Math.abs(recovery.monthsAfterRain) === 1 ? '' : 's'} ${recovery.monthsAfterRain < 0 ? 'before' : 'after'} rain`
    case 'not-depressed': return 'No low response observed'
    case 'not-observed': return 'No confirmed return in follow-up'
    case 'gap': return 'Return timing is unresolved'
    case 'unavailable': return 'Not enough comparable observations'
  }
}

function recoveryDetail(recovery: MemoryRecovery) {
  if (recovery.status === 'not-depressed') return 'No rank at or below 20 in the checked response window.'
  if (recovery.status === 'unavailable') return 'Missing observations or too few valid reference years.'
  if (recovery.status === 'gap') return recovery.recoveryDate ? `A later return is observed in ${monthLabel(recovery.recoveryDate, true)}, but a gap or the record boundary prevents measuring the first return.` : 'A gap or the end of the record could hide a return.'
  if (recovery.status === 'not-observed') return 'The observed follow-up does not contain two consecutive months at rank 50 or above.'
  return recovery.recoveryDate ? `Confirmed ${monthLabel(recovery.recoveryDate, true)} · two consecutive months at rank 50 or above.` : 'Two consecutive observed months are required.'
}

function hasCounterevidence(event: MemoryEvent) {
  return event.soil.status === 'not-depressed' || event.vegetation.status === 'not-depressed' || event.classification === 'quick' || event.classification === 'counterexample'
}

function followupLabel(event: MemoryEvent) {
  const ending = monthLabel(event.followupEnd, true)
  return event.followupReason === 'next-episode' ? `Follow-up ends ${ending}: another dry episode begins.` : event.followupReason === 'record-end' ? `Follow-up ends ${ending}: the record ends.` : `Follow-up through ${ending}: full 12-month window.`
}

function rainReturnLabel(event: MemoryEvent) {
  if (event.rainRecovery) return monthLabel(event.rainRecovery, true)
  return event.rainRecoveryStatus === 'censored' ? 'Follow-up ended' : 'Not confirmed'
}

function rainReturnDetail(event: MemoryEvent) {
  if (event.rainRecoveryStatus === 'gap') return 'An observed two-month pair clears rank 20, but missing months could hide an earlier return.'
  if (event.rainRecoveryStatus === 'censored') return 'Follow-up ended before two consecutive rain ranks above 20 were observed.'
  return 'Two consecutive three-month rain ranks above 20.'
}

function insightFor(event: MemoryEvent, analysis: MemoryAnalysis) {
  const noLowRoles = (['soil', 'vegetation'] as const).filter(role => event[role].status === 'not-depressed')
  if (noLowRoles.length) {
    const names = noLowRoles.map(role => role === 'soil' ? 'soil wetness' : 'vegetation greenness')
    const unresolved = (['soil', 'vegetation'] as const).some(role => ['gap', 'unavailable'].includes(event[role].status))
    return { title: noLowRoles.length === 2 ? 'This episode challenges the expected story.' : `${noLowRoles[0] === 'soil' ? 'Soil wetness' : 'Greenness'} stayed outside the low-rank band.`, text: `The observed ${names.join(' and ')} record${noLowRoles.length === 2 ? 's contain' : ' contains'} no rank at or below 20 in the checked response window.${unresolved ? ' The other proxy is unresolved because the evidence is incomplete.' : ''} Low rainfall does not produce the same observed response in every episode.` }
  }
  if (!event.rainRecovery) return { title: 'A return in rainfall is not confirmed.', text: 'Without two consecutive observed three-month rainfall ranks above 20, a delay after rain cannot be measured. Independently observed soil or greenness returns remain visible below.' }
  if (event.rainRecoveryStatus === 'gap') return { title: 'A rainfall return is observed, but its first timing is unresolved.', text: 'Missing months could hide an earlier return in the rainfall rank. The displayed return dates are observed pairs; exact delays relative to rain are withheld.' }
  const delays = [{ label: 'soil wetness', value: event.soil }, { label: 'vegetation greenness', value: event.vegetation }]
    .filter(item => item.value.status === 'recovered' && item.value.monthsAfterRain !== null && item.value.monthsAfterRain > 0)
    .sort((a, b) => (b.value.monthsAfterRain ?? 0) - (a.value.monthsAfterRain ?? 0))
  if (delays.length) {
    const longest = delays[0]
    return { title: `The rain index returned before ${longest.label} did.`, text: `The confirmed return in ${longest.label} came ${longest.value.monthsAfterRain} month${longest.value.monthsAfterRain === 1 ? '' : 's'} after the rainfall-index return. This is an observed sequence under the stated thresholds.` }
  }
  const lingering = analysis.months.some(month => month.date > event.rainRecovery! && month.date <= event.followupEnd && (month.soilRank !== null && month.soilRank <= analysis.dryThreshold || month.vegetationRank !== null && month.vegetationRank <= analysis.dryThreshold))
  if (event.classification === 'lingering' && lingering) return { title: 'Low proxy values were observed after the rain-index return.', text: 'At least one soil or greenness rank was at or below 20 after the rainfall-index return. Missing observations can still prevent timing a complete return.' }
  if (event.classification === 'counterexample') return { title: 'This episode challenges the expected story.', text: 'Despite the low rainfall ranks, neither the soil nor greenness record shows a rank at or below 20 in the checked response window. The observed records do not follow the full expected sequence.' }
  if (event.classification === 'quick') return { title: 'No delayed return is resolved in these monthly records.', text: 'The observed proxy returns occur by the confirmed rainfall return, or no low proxy response is observed. Monthly observations cannot resolve changes within a month.' }
  return { title: 'Part of the story remains unobserved.', text: 'The rainfall episode is visible, but gaps, limited reference years or the record boundary prevent a complete comparison of the soil and greenness response.' }
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function LandscapeMemory({ visible = true, location, onChoosePlace }: Props) {
  const [data, setData] = useState<MemoryDataset | null>(null)
  const [mode, setMode] = useState<LoadMode>('example')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ message: '', completed: 0, total: 0 })
  const [error, setError] = useState('')
  const [cancelled, setCancelled] = useState(false)
  const [eventId, setEventId] = useState('')
  const [filter, setFilter] = useState<EventFilter>('all')
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 550px)').matches)
  const controller = useRef<AbortController | null>(null)
  const firstOpened = useRef(false)

  const beginLoad = useCallback(async (next: LoadMode) => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setMode(next)
    setBusy(true)
    setError('')
    setCancelled(false)
    setPlaying(false)
    setData(null)
    setEventId('')
    setFilter('all')
    setShowAllEvents(false)
    setProgress({ message: next === 'example' ? 'Opening the saved NASA record…' : 'Loading rainfall and root-zone soil wetness…', completed: 0, total: 0 })
    try {
      const result = next === 'example' ? await loadMemoryExample(request.signal)
        : await loadMemory({ lat: location.lat, lon: location.lon, start: 2001, end: lastYear }, location.name, request.signal,
          (message, completed, total) => { if (!request.signal.aborted) setProgress({ message, completed, total }) })
      if (!request.signal.aborted) setData(result)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'The observations could not be loaded.')
    } finally {
      if (!request.signal.aborted) setBusy(false)
    }
  }, [location.lat, location.lon, location.name])

  useEffect(() => {
    if (visible && !firstOpened.current) {
      firstOpened.current = true
      void beginLoad('example')
    }
  }, [visible, beginLoad])
  useEffect(() => () => { controller.current?.abort(); firstOpened.current = false }, [])
  useEffect(() => { if (!visible) setPlaying(false) }, [visible])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 550px)')
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const { analysis, analysisError } = useMemo(() => {
    if (!data) return { analysis: null, analysisError: '' }
    try { return { analysis: analyzeMemory(data), analysisError: '' } }
    catch (cause) { return { analysis: null, analysisError: cause instanceof Error ? cause.message : 'The record could not be analyzed.' } }
  }, [data])
  const sortedEvents = useMemo(() => [...(analysis?.events ?? [])].sort((a, b) => b.start.localeCompare(a.start)), [analysis])
  const filteredEvents = sortedEvents.filter(event => filter === 'all' || filter === 'severe' && event.severity <= 0.1 || filter === 'counterexample' && hasCounterevidence(event) || filter === 'incomplete' && event.classification === 'incomplete')
  const preferredEvent = sortedEvents.find(event => event.rainRecoveryStatus === 'confirmed' && event.followupReason === 'limit')
    ?? sortedEvents.find(event => event.rainRecoveryStatus === 'confirmed') ?? sortedEvents[0]
  const event = sortedEvents.find(item => item.id === eventId) ?? preferredEvent ?? null
  const months = useMemo(() => {
    if (!analysis) return []
    if (!event) return analysis.months.slice(-36)
    return analysis.months.filter(month => memoryMonthOffset(event.start, month.date) >= -4 && month.date <= event.followupEnd)
  }, [analysis, event])
  const selectedMonth = months[Math.min(cursor, months.length - 1)] ?? null
  const insight = event && analysis ? insightFor(event, analysis) : null
  const counterexamples = sortedEvents.filter(hasCounterevidence)
  const changedPlace = data && mode === 'selected' && (data.location.lat !== location.lat || data.location.lon !== location.lon)
  const activeError = error || analysisError

  useEffect(() => {
    setPlaying(false)
    if (!event) { setCursor(0); return }
    setCursor(Math.max(0, months.findIndex(month => month.date === event.anchor)))
  }, [event?.id, data]) // Reset only when the selected episode or record changes.

  useEffect(() => {
    if (!playing || !visible || months.length < 2) return
    const timer = window.setInterval(() => setCursor(value => Math.min(value + 1, months.length - 1)), 750)
    return () => window.clearInterval(timer)
  }, [playing, visible, months.length])
  useEffect(() => { if (playing && cursor >= months.length - 1) setPlaying(false) }, [cursor, playing, months.length])

  function selectEvent(next: MemoryEvent) {
    setEventId(next.id)
    setPlaying(false)
    setDownloadMessage('')
  }
  function applyFilter(next: EventFilter) {
    setFilter(next)
    const candidates = sortedEvents.filter(item => next === 'all' || next === 'severe' && item.severity <= 0.1 || next === 'counterexample' && hasCounterevidence(item) || next === 'incomplete' && item.classification === 'incomplete')
    if (candidates.length && !candidates.some(item => item.id === event?.id)) selectEvent(candidates[0])
  }
  function cancelLoad() {
    controller.current?.abort()
    setBusy(false)
    setCancelled(true)
    setProgress({ message: '', completed: 0, total: 0 })
  }
  function exportEvidence(format: 'csv' | 'json') {
    if (!data || !analysis || !event) return
    try {
      const name = data.location.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const filename = `terrasignal-memory-${name}-${event.start.slice(0, 7)}-${event.end.slice(0, 7)}.${format}`
      download(format === 'csv' ? memoryCsv(data, analysis, event) : memoryEvidenceJson(data, analysis, event), filename, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json')
      setDownloadMessage(`${format.toUpperCase()} evidence downloaded with definitions and source information.`)
    } catch (cause) { setDownloadMessage(cause instanceof Error ? cause.message : 'The evidence could not be exported.') }
  }

  return <div className="landscape-memory">
    <div className="memory-heading">
      <div><p className="memory-eyebrow"><Icon name="leaf" />Landscape memory</p><h2>When rain returns, does the landscape recover?</h2><p>Follow a dry episode through rainfall, soil wetness and satellite greenness. Measure the observed return, and look for cases that tell a different story.</p></div>
      <div className="memory-data-keys" aria-label="Three linked records"><span><i className="memory-key-rain" />Rain</span><span><i className="memory-key-soil" />Soil</span><span><i className="memory-key-vegetation" />Greenness</span></div>
    </div>

    <div className="memory-access">
      <div className="memory-access-example"><button type="button" className={`memory-button${mode === 'example' && data ? ' selected' : ''}`} disabled={busy} onClick={() => void beginLoad('example')}><Icon name="calendar" />Open saved case</button><span>Original NASA observations · works without a new download</span></div>
      <div className="memory-access-live"><button type="button" className="memory-button" disabled={busy} onClick={() => void beginLoad('selected')}><Icon name="pin" />Investigate {location.name}<Icon name="arrow" /></button><button type="button" className="text-button" onClick={onChoosePlace}>Choose a place</button></div>
      <p className="memory-load-note">New places load {2001}–{lastYear}. Quality-filtered MODIS retrieval can take several minutes; gaps stay visible.</p>
    </div>

    {busy && <div className="memory-loading" role="status" aria-live="polite"><div><strong>{progress.message}</strong><p>{progress.total ? `${progress.completed} / ${progress.total} data steps completed` : mode === 'example' ? 'Reading the attributed saved record.' : 'The existing data connections are being queried for this point.'}</p>{progress.total > 0 && <progress aria-label="Data loading progress" value={progress.completed} max={progress.total} />}</div><button type="button" className="secondary-button" onClick={cancelLoad}>Cancel</button></div>}
    {cancelled && <div className="memory-notice" role="status"><p>Loading stopped. Completed source downloads remain cached by the data service.</p><button type="button" className="text-button" onClick={() => void beginLoad(mode)}>Try again</button></div>}
    {activeError && <div className="memory-error" role="alert"><strong>This record could not be opened.</strong><p>{activeError}</p><div><button type="button" className="secondary-button" onClick={() => void beginLoad(mode)}>Try again <Icon name="refresh" /></button>{mode !== 'example' && <button type="button" className="text-button" onClick={() => void beginLoad('example')}>Open saved case</button>}</div></div>}

    {data && analysis && <>
      <div className="memory-record"><div><strong>{data.location.name}</strong><span>{coordinates(data.location.lat, data.location.lon)}</span></div><div><span className="memory-origin">{mode === 'example' ? 'Saved NASA record' : 'Loaded NASA record'}</span><span>{data.start}–{data.end} · {analysis.events.length} dry episodes</span></div></div>
      <p className="memory-coverage-note">Satellite greenness: {data.vegetation.filter(month => month.value !== null).length} / {analysis.months.length} accepted months. Cloud, snow and other quality gaps can prevent measuring return timing.</p>
      {changedPlace && <div className="memory-notice"><p>The displayed record is for {data.location.name}. Your selected map point is now {location.name}.</p><button type="button" className="text-button" onClick={() => void beginLoad('selected')}>Load selected place <Icon name="arrow" /></button></div>}

      {event && insight && <>
        <div className={`memory-insight memory-outcome-${event.classification}`}><div><span className="memory-outcome">{outcomeLabels[event.classification]}</span><h3>{insight.title}</h3><p>{insight.text}</p></div><div className="memory-insight-date"><span>Selected episode</span><strong>{eventLabel(event)}</strong><small>Lowest three-month rain rank: {rankLabel(event.severity)}</small></div></div>
        <div className="memory-investigation">
          <aside className="memory-episodes" aria-label="Choose a dry episode">
            <div className="memory-episodes-heading"><h3>Dry episodes</h3><span>{filteredEvents.length}</span></div>
            <label className="sr-only" htmlFor="memory-episode-filter">Filter dry episodes</label><select id="memory-episode-filter" value={filter} onChange={change => applyFilter(change.target.value as EventFilter)}><option value="all">All episodes</option><option value="severe">Rain rank 10 or lower</option><option value="counterexample">Counterevidence</option><option value="incomplete">Incomplete evidence</option></select>
            <div className="memory-episode-list">{filteredEvents.map(item => <button type="button" key={item.id} aria-pressed={event.id === item.id} onClick={() => selectEvent(item)}><span>{eventLabel(item)}</span><small><i className={`memory-outcome-dot ${item.classification}`} />{outcomeLabels[item.classification]}</small><span className="memory-episode-rank">Rain rank <strong>{Math.round(item.severity * 100)}</strong></span></button>)}{!filteredEvents.length && <div className="memory-filter-empty"><p>No episodes match this filter.</p><button type="button" className="text-button" onClick={() => setFilter('all')}>Show all episodes</button></div>}</div>
            <p className="memory-episode-definition">At least two consecutive low three-month rainfall windows. Episodes are selected from rainfall alone. The initial view opens the latest episode with a confirmed rain return and full follow-up, if available.</p>
          </aside>

          <div className="memory-investigation-main">
            <div className="memory-return-cards">
              <div className="memory-return-card rain"><span><i className="memory-key-rain" />Rain return</span><strong>{rainReturnLabel(event)}</strong><p>{rainReturnDetail(event)}</p><small>Monthly observations · rainfall total in mm</small></div>
              {(['soil', 'vegetation'] as const).map(role => <div key={role} className={`memory-return-card ${role}`}><span><i className={`memory-key-${role}`} />{role === 'soil' ? 'Soil return' : 'Greenness return'}</span><strong>{recoveryLabel(event[role])}</strong><p>{recoveryDetail(event[role])}</p><small>{percent(event[role].observedMonths, event[role].expectedMonths)} with eligible ranks in the checked window</small></div>)}
            </div>

            <section className="memory-replay" aria-label="Linked monthly record">
              <div className="memory-chart-heading"><div><h3>Replay the evidence</h3><p>Same-month ranks · 0 = lower, 100 = higher than the available reference years</p></div><span><i />Dry episode</span></div>
              <div className="memory-chart-legend"><span><b className="memory-dash dry" />Low rank · 20</span><span><b className="memory-dash median" />Median rank · 50</span><span><b className="memory-dash return" />Rain return confirmed</span></div>
              {roles.map((role, index) => <MemoryTrack key={role} role={role} months={months} cursor={Math.min(cursor, months.length - 1)} event={event} compact={compact} showDates={index === roles.length - 1} onCursor={index => { setPlaying(false); setCursor(index) }} />)}
              <div className="memory-playback"><button type="button" className="memory-play-button" disabled={months.length < 2} aria-label={playing ? 'Pause monthly replay' : 'Play monthly replay'} aria-pressed={playing} onClick={() => { if (cursor >= months.length - 1) setCursor(0); setPlaying(value => !value) }}>{playing ? <span aria-hidden="true">Ⅱ</span> : <span aria-hidden="true">▶</span>}</button><input type="range" min="0" max={Math.max(0, months.length - 1)} value={Math.min(cursor, Math.max(0, months.length - 1))} disabled={!months.length} onChange={change => { setPlaying(false); setCursor(Number(change.target.value)) }} aria-label="Inspect a month in the episode" aria-valuetext={selectedMonth ? monthLabel(selectedMonth.date) : 'No observations'} /><time dateTime={selectedMonth?.date}>{selectedMonth ? monthLabel(selectedMonth.date, true) : '—'}</time></div>
              <p className="memory-chart-footnote">Shading marks the rainfall-selected episode. Broken lines are missing or ineligible ranks. A return is dated to the second confirming month. {followupLabel(event)}</p>
            </section>

            {selectedMonth && <section className="memory-inspector" aria-label={`Observations for ${monthLabel(selectedMonth.date)}`}><div className="memory-inspector-heading"><h3>{monthLabel(selectedMonth.date)}</h3><span>Inspect the observed values</span></div><div className="memory-inspector-table"><table><thead><tr><th scope="col">Record</th><th scope="col">Observed value</th><th scope="col">Seasonal rank</th><th scope="col">Reference years</th></tr></thead><tbody>{roles.map(role => <tr key={role}><th scope="row"><i className={`memory-key-${role}`} />{roleLabels[role]}</th><td>{rawValue(selectedMonth, role)}{role === 'rain' && <small>this month: {selectedMonth.rain === null ? 'missing' : `${selectedMonth.rain.toFixed(1)} mm`}</small>}</td><td>{rankLabel(selectedMonth[rankKeys[role]])}</td><td>{selectedMonth[referenceKeys[role]]} <small>target year excluded</small></td></tr>)}</tbody></table></div><p>Ranks describe the position among valid observations for the same calendar month in {analysis.referenceStart}–{analysis.referenceEnd}. They are not confidence levels or causal probabilities.</p></section>}
          </div>
        </div>

        <section className="memory-challenge" aria-label="Check alternative explanations"><div><p className="memory-eyebrow">Check the story</p><h3>Does every dry episode leave the same trace?</h3><p>Keep all rainfall-selected episodes in view, including different responses and incomplete records. Counterevidence includes a proxy with no low response, or observed returns without a resolved delay. Greenness can also change with temperature, harvest, land use or other conditions.</p></div><div className="memory-counterexample"><strong>{counterexamples.length}</strong><span>episode{counterexamples.length === 1 ? '' : 's'} with counterevidence in at least one observed proxy</span>{counterexamples.length > 0 ? <button type="button" className="text-button" onClick={() => { selectEvent(counterexamples[0]); setFilter('counterexample'); document.getElementById('memory-episode-filter')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}>Inspect a different response <Icon name="arrow" /></button> : <p>Missing evidence can limit this count. Zero does not prove a universal response.</p>}</div></section>

        <section className="memory-comparisons" aria-label="Compare dry episodes"><div className="memory-comparisons-heading"><h3>Compare the episodes</h3><span>The same definitions for every episode</span></div><div className="memory-comparison-scroll"><table><thead><tr><th scope="col">Episode</th><th scope="col">Rain return</th><th scope="col">Soil vs rain return</th><th scope="col">Greenness vs rain return</th><th scope="col">Evidence</th></tr></thead><tbody>{(showAllEvents ? sortedEvents : sortedEvents.slice(0, 8)).map(item => <tr key={item.id} className={event.id === item.id ? 'selected' : ''}><th scope="row"><button type="button" onClick={() => selectEvent(item)} aria-label={`Inspect episode ${eventLabel(item)}`}>{eventLabel(item)}<Icon name="arrow" /></button></th><td>{rainReturnLabel(item)}{item.rainRecoveryStatus === 'gap' && <small className="memory-table-note">earliest timing unresolved</small>}</td><td>{compactRecovery(item.soil)}</td><td>{compactRecovery(item.vegetation)}</td><td><span className={`memory-outcome-pill ${item.classification}`}>{outcomeLabels[item.classification]}</span></td></tr>)}</tbody></table></div>{sortedEvents.length > 8 && <button type="button" className="text-button memory-show-events" onClick={() => setShowAllEvents(value => !value)}>{showAllEvents ? 'Show fewer episodes' : `Show all ${sortedEvents.length} episodes`} <Icon name="chevron" /></button>}</section>

        <div className="memory-export"><p><Icon name="info" />An observed sequence does not establish a cause. Greenness is a satellite proxy, not a measure of ecological damage.</p><div><button type="button" className="secondary-button" onClick={() => exportEvidence('csv')}><Icon name="download" />Evidence CSV</button><button type="button" className="secondary-button" onClick={() => exportEvidence('json')}><Icon name="download" />Evidence JSON</button></div></div><span className="sr-only" role="status">{downloadMessage}</span>
      </>}

      {!event && <div className="memory-empty"><Icon name="water" /><h3>No eligible dry episodes in this record.</h3><p>The detection needs at least two consecutive low three-month rainfall windows, each with at least {analysis.minReferenceYears} valid reference years. Missing or constant reference records cannot supply a rank. This does not establish that the place has never experienced drought.</p><p>Rainfall: {analysis.months.filter(month => month.rainRank !== null).length} eligible three-month ranks out of {analysis.months.length} months. Soil: {analysis.months.filter(month => month.soilRank !== null).length}. Greenness: {analysis.months.filter(month => month.vegetationRank !== null).length}.</p><button type="button" className="secondary-button" onClick={() => download(JSON.stringify(data, null, 2), 'terrasignal-memory-observations.json', 'application/json')}><Icon name="download" />Download observed record</button></div>}

      <MemoryMethods data={data} analysis={analysis} />
    </>}
  </div>
}

function rawValue(month: MemoryMonth, role: MemoryRole) {
  if (role === 'rain') return month.rain3 === null ? 'Missing three-month total' : `${month.rain3.toFixed(1)} mm / 3 months`
  const value = month[role]
  return value === null ? 'Missing' : role === 'soil' ? `${value.toFixed(3)} fraction` : `${value.toFixed(3)} NDVI`
}

function compactRecovery(value: MemoryRecovery) {
  if (value.status === 'recovered' && value.monthsAfterRain !== null) return value.monthsAfterRain === 0 ? 'Same month' : `${Math.abs(value.monthsAfterRain)} month${Math.abs(value.monthsAfterRain) === 1 ? '' : 's'} ${value.monthsAfterRain < 0 ? 'before' : 'after'}`
  if (value.status === 'recovered') return 'Return observed; comparison unavailable'
  if (value.status === 'not-depressed') return 'No low rank observed'
  if (value.status === 'not-observed') return 'No confirmed return'
  return 'Unresolved'
}

function MemoryTrack({ role, months, cursor, event, compact, showDates, onCursor }: { role: MemoryRole; months: MemoryMonth[]; cursor: number; event: MemoryEvent; compact: boolean; showDates: boolean; onCursor: (index: number) => void }) {
  const width = compact ? 320 : 760, height = showDates ? compact ? 135 : 119 : compact ? 110 : 101, left = compact ? 27 : 34, right = compact ? 10 : 20, top = 8, bottom = compact ? 94 : 86
  const plotWidth = width - left - right
  const x = (index: number) => left + index / Math.max(1, months.length - 1) * plotWidth
  const y = (rank: number) => bottom - rank * (bottom - top)
  const datePosition = (date: string) => months.length ? x(memoryMonthOffset(months[0].date, date)) : left
  let connected = false
  const path = months.map((month, index) => {
    const rank = month[rankKeys[role]]
    if (rank === null) { connected = false; return '' }
    const result = `${connected ? 'L' : 'M'}${x(index).toFixed(2)},${y(rank).toFixed(2)}`
    connected = true
    return result
  }).join(' ')
  const current = months[cursor]
  const selectedRank = current?.[rankKeys[role]] ?? null
  const step = plotWidth / Math.max(1, months.length - 1)
  const shadeStart = Math.max(left, datePosition(event.start) - step / 2)
  const shadeEnd = Math.min(width - right, datePosition(event.end) + step / 2)
  const recoveryDate = role === 'rain' ? event.rainRecovery : event[role].recoveryDate
  const tickInterval = compact ? Math.max(1, Math.ceil((months.length - 1) / 3)) : months.length > 36 ? 12 : 6
  const ticks = months.map((month, index) => ({ month, index })).filter(({ index }) => index === 0 || index === months.length - 1 || index % tickInterval === 0 && months.length - 1 - index >= Math.ceil(tickInterval / 2))

  return <div className={`memory-track ${role}`}><div className="memory-track-label"><span><i className={`memory-key-${role}`} />{roleLabels[role]}{role === 'rain' && <small>3-month total</small>}</span><strong>{rankLabel(selectedRank)}</strong></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${roleLabels[role]} seasonal rank from ${months[0] ? monthLabel(months[0].date) : 'the start'} to ${months.at(-1) ? monthLabel(months.at(-1)!.date) : 'the end'}. Use the month slider to inspect values.`} onPointerMove={pointer => { if (pointer.buttons !== 1 && pointer.pointerType !== 'mouse') return; const bounds = pointer.currentTarget.getBoundingClientRect(); const position = (pointer.clientX - bounds.left) / bounds.width * width; onCursor(Math.max(0, Math.min(months.length - 1, Math.round((position - left) / plotWidth * (months.length - 1))))) }} onPointerDown={pointer => { const bounds = pointer.currentTarget.getBoundingClientRect(); const position = (pointer.clientX - bounds.left) / bounds.width * width; onCursor(Math.max(0, Math.min(months.length - 1, Math.round((position - left) / plotWidth * (months.length - 1))))) }}>
    {shadeEnd > shadeStart && <rect className="memory-episode-shade" x={shadeStart} y={top} width={shadeEnd - shadeStart} height={bottom - top} />}
    {[0, 0.5, 1].map(value => <g key={value}><line className={value === 0.5 ? 'memory-grid median' : 'memory-grid'} x1={left} x2={width - right} y1={y(value)} y2={y(value)} /><text x={left - 9} y={y(value) + 3} textAnchor="end">{value * 100}</text></g>)}
    <line className="memory-dry-line" x1={left} x2={width - right} y1={y(0.2)} y2={y(0.2)} />
    {event.rainRecovery && datePosition(event.rainRecovery) >= left && datePosition(event.rainRecovery) <= width - right && <line className="memory-rain-return" x1={datePosition(event.rainRecovery)} x2={datePosition(event.rainRecovery)} y1={top} y2={bottom} />}
    <path className="memory-observation-line" d={path} />
    {months.map((month, index) => month[rankKeys[role]] === null ? null : <circle className="memory-month-dot" key={month.date} cx={x(index)} cy={y(month[rankKeys[role]]!)} r={months.length > 55 ? 1.6 : 2.2} />)}
    {recoveryDate && months.some(month => month.date === recoveryDate && month[rankKeys[role]] !== null) && <circle className="memory-confirmed-dot" cx={datePosition(recoveryDate)} cy={y(months.find(month => month.date === recoveryDate)![rankKeys[role]]!)} r="5"><title>Observed two-month return pair {monthLabel(recoveryDate)}{role === 'rain' && event.rainRecoveryStatus === 'gap' || role !== 'rain' && event[role].status === 'gap' ? '; earliest timing unresolved' : ''}</title></circle>}
    {current && <line className="memory-cursor-line" x1={x(cursor)} x2={x(cursor)} y1={top - 2} y2={bottom + 2} />}
    {selectedRank !== null && <circle className="memory-selected-dot" cx={x(cursor)} cy={y(selectedRank)} r="4" />}
    {showDates && ticks.map(({ month, index }) => <text className="memory-date-tick" key={month.date} x={x(index)} y={compact ? 125 : 111} textAnchor={index === 0 ? 'start' : index === months.length - 1 ? 'end' : 'middle'}>{monthLabel(month.date, true)}</text>)}
  </svg></div>
}

function MemoryMethods({ data, analysis }: { data: MemoryDataset; analysis: MemoryAnalysis }) {
  const warnings = [...new Set([...data.warnings, ...analysis.warnings])]
  return <details className="memory-methods"><summary>Definitions, coverage & original sources <Icon name="chevron" /></summary><div className="memory-method-content"><div className="memory-method-rules"><h3>How the evidence is constructed</h3><p><strong>Reference.</strong> Each value is ranked against valid values for the same calendar month in {analysis.referenceStart}–{analysis.referenceEnd}, excluding the target year. At least {analysis.minReferenceYears} reference years are required. Ranks use the available valid years; missing references are not reconstructed.</p><p><strong>Dry episodes.</strong> Three-month rainfall totals require every constituent month. At least two consecutive ending months must rank at or below {Math.round(analysis.dryThreshold * 100)}. The displayed episode begins at the start of its first three-month window. Ties do not become artificially rare events.</p><p><strong>Return.</strong> Rain requires {analysis.recoveryMonths} consecutive observed ranks above {Math.round(analysis.dryThreshold * 100)}. Soil and greenness must first show a rank at or below {Math.round(analysis.dryThreshold * 100)}, then {analysis.recoveryMonths} consecutive ranks at or above {Math.round(analysis.recoveryThreshold * 100)}. Returns are detected independently and dated to the second confirming month. A negative lag means the proxy returned before the rain index; a lag is withheld when either first return is unresolved. Follow-up is limited to {analysis.followupMonths} months after the episode and ends earlier at the next episode or record boundary.</p><p><strong>Initial episode.</strong> The latest episode with a confirmed rainfall return and full {analysis.followupMonths}-month follow-up is opened first, if one is available. The default is not selected for a particular soil or vegetation outcome.</p><p><strong>Interpretation.</strong> This is an exploratory threshold-based comparison, not a forecast, a test of statistical significance, or causal attribution. POWER rainfall and soil wetness share the MERRA-2 modelling system. MODIS greenness has a smaller footprint and a different observation schedule. Harvest, land cover and cloud filtering can affect the observed sequence.</p><p>The CSV and JSON evidence exports retain definitions, observed values, reference counts, missing data and all original source requests.</p></div><div className="memory-source-groups">{roles.map(role => {
    const sources = data.sources.filter(source => source.role === role)
    const source = sources[0]
    const dates = sources.map(item => item.retrieved_at).filter((value): value is string => Boolean(value)).sort()
    return <div key={role} className="memory-source-group"><h4><i className={`memory-key-${role}`} />{roleLabels[role]}</h4>{source ? <><p>{source.source}{source.collection ? ` · collection ${source.collection}` : ''}</p><p>{source.spatial_support}</p><p>{sources.length} original request{sources.length === 1 ? '' : 's'} · {sources.every(item => item.data_origin === 'cache') ? 'cached source responses' : [...new Set(sources.map(item => item.data_origin))].join(', ')}</p>{dates.length > 0 && <p>Retrieved {new Date(dates[0]).toLocaleDateString('en', { timeZone: 'UTC' })}{dates[0] !== dates.at(-1) ? ` – ${new Date(dates.at(-1)!).toLocaleDateString('en', { timeZone: 'UTC' })}` : ''}</p>}<a href={source.source_url} target="_blank" rel="noreferrer">Open original source request <Icon name="external" /></a></> : <p>No source record available for this variable.</p>}</div>
  })}</div>{warnings.length > 0 && <div className="memory-warnings"><h3>Record-specific notes</h3><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}</div></details>
}
