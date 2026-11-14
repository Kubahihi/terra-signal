import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Icon from './components/Icon'
import MapPicker from './components/MapPicker'
import SeriesChart from './components/SeriesChart'
import TrendEvidence from './components/TrendEvidence'
import InvestigationStarter from './components/InvestigationStarter'
import LocationComparison from './components/LocationComparison'
import DataResources from './components/DataResources'
import LocalQuestions from './components/LocalQuestions'
import DailyWeather from './components/DailyWeather'
import DailyComparison from './components/DailyComparison'
import { getHealth, getSeries } from './lib/api'
import { coordinates, exampleLocations, locationAt, type Location } from './lib/locations'
import { variableInfo, type Investigation } from './lib/investigations'
import { seriesCsv } from './lib/csv'
import { useDailyRecord } from './lib/useDailyRecord'
import type { CalendarSelection, DailyMetric, DailySelection, SeriesResponse, Variable } from './types/api'

const lastYear = new Date().getUTCFullYear() - 1
const variableLabels: Record<Variable, string> = { T2M: 'Air temperature', PRECTOTCORR: 'Precipitation' }
const workspaces = [
  { id: 'explore', label: 'Explore', icon: 'map', title: 'A closer look at a changing Earth.', description: 'Find a place on the map and explore its long-term record.' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', title: 'Every season tells a story.', description: 'Explore individual months, seasons and departures from the reference.' },
  { id: 'daily', label: 'Daily weather', icon: 'sun', title: 'Look beyond the average.', description: 'Follow hot days, frost, warm nights and stretches without rain.' },
  { id: 'compare', label: 'Compare places', icon: 'compare', title: 'One question. Two places.', description: 'Compare the same period and variable at two points on Earth.' },
  { id: 'methods', label: 'Data & methods', icon: 'info', title: 'Follow the evidence.', description: 'Understand the observations, the analysis and its limitations.' },
] as const
type Workspace = typeof workspaces[number]['id']
type ComparisonView = 'daily' | 'monthly'

function routeFromHash() {
  const hash = window.location.hash.slice(1)
  const aliases: Record<string, Workspace> = {
    'analysis-settings': 'explore', 'location-map-panel': 'explore',
    'local-questions': 'calendar', 'daily-extremes': 'daily',
    'daily-place-comparison': 'compare', 'location-comparison': 'compare', 'comparison-heading': 'compare',
    'data-resources': 'methods',
  }
  const workspace = workspaces.find(item => item.id === hash.replace(/^workspace-/, ''))?.id ?? aliases[hash] ?? 'explore'
  return { workspace, hash, comparison: hash === 'location-comparison' || hash === 'comparison-heading' ? 'monthly' as const : 'daily' as const }
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => routeFromHash().workspace)
  const [scrollTarget, setScrollTarget] = useState(() => routeFromHash().hash)
  const [comparisonView, setComparisonView] = useState<ComparisonView>(() => routeFromHash().comparison)
  const [location, setLocation] = useState<Location>(exampleLocations[0])
  const [variable, setVariable] = useState<Variable>('T2M')
  const [start, setStart] = useState(1981)
  const [end, setEnd] = useState(lastYear)
  const [service, setService] = useState<'checking' | 'online' | 'offline'>('checking')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SeriesResponse | null>(null)
  const [refreshId, setRefreshId] = useState(0)
  const [coordinateError, setCoordinateError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [comparisonEnabled, setComparisonEnabled] = useState(() => routeFromHash().workspace === 'compare')
  const [comparisonLocation, setComparisonLocation] = useState<Location>(exampleLocations[1])
  const [mapTarget, setMapTarget] = useState<'a' | 'b'>('a')
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const [calendarSelection, setCalendarSelection] = useState<CalendarSelection>({ period: 'year', view: 'anomaly' })
  const [dailySelection, setDailySelection] = useState<DailySelection>({ metric: 'hot_days', autoLoad: false })
  const [dailyMetric, setDailyMetric] = useState<DailyMetric>('hot_days')
  const [dailyYear, setDailyYear] = useState(lastYear)
  const refreshRequested = useRef(false)
  const requestCache = useRef(new Map<string, SeriesResponse>())

  const validPeriod = Number.isInteger(start) && Number.isInteger(end) && start >= 1981 && end <= lastYear && start <= end
  const dailyRecord = useDailyRecord({ lat: location.lat, lon: location.lon, start, end }, validPeriod)
  const selectedDailyYear = Math.max(start, Math.min(end, dailyYear))
  const activeWorkspace = workspaces.find(item => item.id === workspace)!
  const matches = result && result.latitude === location.lat && result.longitude === location.lon && result.variable === variable && result.start === start && result.end === end
  const current = matches && !error && !loading ? result : null
  const activeInvestigation = investigation && investigation.location.lat === location.lat && investigation.location.lon === location.lon && investigation.variable === variable && investigation.start === start && investigation.end === end ? investigation : null
  const pickLocation = useCallback((next: Location) => { setLocation(next); setCoordinateError('') }, [])

  useEffect(() => {
    function followHash() {
      const route = routeFromHash()
      setWorkspace(route.workspace)
      setScrollTarget(route.hash)
      if (route.workspace === 'compare') {
        setComparisonEnabled(true)
        setComparisonView(route.comparison)
      }
    }
    window.addEventListener('hashchange', followHash)
    return () => window.removeEventListener('hashchange', followHash)
  }, [])

  useEffect(() => {
    if (!scrollTarget) return
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(scrollTarget) ?? document.getElementById('workspace-start')
      target?.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [workspace, scrollTarget])

  function navigate(next: Workspace, target?: string) {
    const destination = target ?? (next === 'compare' ? comparisonView === 'daily' ? 'daily-place-comparison' : 'location-comparison' : next)
    setWorkspace(next)
    setScrollTarget(destination)
    if (next === 'compare') setComparisonEnabled(true)
    if (window.location.hash !== `#${destination}`) window.location.hash = destination
  }

  function navigateWithKeys(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    const key = event.key
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    event.preventDefault()
    const next = key === 'Home' ? 0 : key === 'End' ? workspaces.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + workspaces.length) % workspaces.length
    document.getElementById(`tab-${workspaces[next].id}`)?.focus()
    navigate(workspaces[next].id)
  }

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal).then(() => setService('online')).catch(() => {
      if (!controller.signal.aborted) setService('offline')
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!validPeriod) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const query = { lat: location.lat, lon: location.lon, variable, start, end }
    const key = JSON.stringify(query)
    const timer = window.setTimeout(async () => {
      const refresh = refreshRequested.current
      refreshRequested.current = false
      try {
        const cached = requestCache.current.get(key)
        const response = cached && !refresh ? cached : await getSeries(query, refresh, controller.signal)
        if (!controller.signal.aborted) {
          requestCache.current.set(key, response)
          setResult(response)
          setService('online')
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The observations could not be loaded.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [location.lat, location.lon, variable, start, end, refreshId, validPeriod])

  function applyCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const lat = Number(fields.get('latitude'))
    const lon = Number(fields.get('longitude'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setCoordinateError('Latitude must be −90 to 90; longitude must be −180 to 180.')
      return
    }
    const next = locationAt(lat, lon)
    if (comparisonEnabled && mapTarget === 'b') setComparisonLocation(next)
    else pickLocation(next)
    setCoordinateError('')
  }

  function refresh() {
    refreshRequested.current = true
    setRefreshId(id => id + 1)
  }

  function startInvestigation(next: Investigation) {
    pickLocation(next.location)
    setVariable(next.variable)
    setStart(next.start)
    setEnd(Math.min(next.end, lastYear))
    setComparisonLocation(next.comparison)
    setComparisonEnabled(false)
    setMapTarget('a')
    setCalendarSelection({ period: next.calendarPeriod, view: next.calendarView })
    setDailySelection({ metric: next.dailyMetric ?? 'hot_days', autoLoad: next.focus === 'daily' })
    setInvestigation(next)
    setActionMessage(`Investigation started: ${next.question}`)
    navigate(next.focus === 'daily' ? 'daily' : 'calendar', next.focus === 'daily' ? 'daily-extremes' : 'local-questions')
  }

  function toggleComparison() {
    setMapTarget(comparisonEnabled ? 'a' : 'b')
    setComparisonEnabled(value => !value)
  }

  function chooseOnMap(point: 'a' | 'b') {
    setComparisonEnabled(true)
    setMapTarget(point)
    navigate('explore', 'location-map-panel')
  }

  function downloadData() {
    if (!current) return
    const csv = seriesCsv(current)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrasignal-${current.variable}-${current.latitude}-${current.longitude}-${start}-${end}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setActionMessage('Monthly data downloaded with source details.')
  }

  return <div className="app-shell">
    <a className="skip-link" href={`#workspace-${workspace}`} onClick={event => { event.preventDefault(); const panel = document.getElementById(`workspace-${workspace}`); panel?.focus({ preventScroll: true }); panel?.scrollIntoView({ block: 'start' }) }}>Skip to workspace</a>
    <header className="topbar workspace-header">
      <div className="workspace-brand-row">
        <a className="brand" href="#explore" aria-label="TerraSignal home" onClick={event => { event.preventDefault(); navigate('explore') }}><Icon name="globe" />TerraSignal</a>
        <span className="project-label">Earth system explorer</span>
        <div className="source-status" role="status"><span className={`status-dot ${service}`} />{service === 'online' ? 'NASA analysis online' : service === 'checking' ? 'Connecting to data' : 'Data service unavailable'}</div>
      </div>
      <nav aria-label="Workspace navigation"><div className="workspace-tabs" role="tablist" aria-label="Analysis workspaces">
        {workspaces.map((item, index) => <a key={item.id} id={`tab-${item.id}`} role="tab" href={`#${item.id === 'compare' ? comparisonView === 'daily' ? 'daily-place-comparison' : 'location-comparison' : item.id}`} aria-selected={workspace === item.id} aria-controls={`workspace-${item.id}`} tabIndex={workspace === item.id ? 0 : -1} onKeyDown={event => navigateWithKeys(event, index)} onClick={event => { event.preventDefault(); navigate(item.id) }}><Icon name={item.icon} /><span>{item.label}</span></a>)}
      </div></nav>
    </header>

    <main id="workspace-start">
      <div className="page-heading">
        <div><p className="workspace-eyebrow">{activeWorkspace.label}</p><h1>{activeWorkspace.title}</h1><p>{activeWorkspace.description}</p></div>
        {workspace !== 'methods' && <div className="selection-summary"><span><Icon name="pin" />{location.name}</span><span>{start || '—'}–{end || '—'}</span></div>}
      </div>

      <div hidden={workspace === 'methods'}>
      <div className="filter-bar" id="analysis-settings" aria-label="Analysis settings">
        <div className="variable-control" hidden={workspace === 'daily' || workspace === 'compare' && comparisonView === 'daily'}><span className="control-label">Variable</span><div className="segmented" aria-label="Earth system variable">
          <button type="button" aria-pressed={variable === 'T2M'} onClick={() => setVariable('T2M')}>Temperature</button>
          <button type="button" aria-pressed={variable === 'PRECTOTCORR'} onClick={() => setVariable('PRECTOTCORR')}>Precipitation</button>
        </div></div>
        <div className="period-control"><span className="control-label">Period</span><div className="year-inputs">
          <input aria-label="Start year" type="number" min="1981" max={lastYear} value={start || ''} onChange={event => setStart(Number(event.target.value))} />
          <span aria-hidden="true">—</span>
          <input aria-label="End year" type="number" min="1981" max={lastYear} value={end || ''} onChange={event => setEnd(Number(event.target.value))} />
        </div><button type="button" className="text-button full-record" onClick={() => { setStart(1981); setEnd(lastYear) }}>Full record</button></div>
        <div className="example-control"><label className="control-label" htmlFor="example">Jump to</label><select id="example" value={location.id ?? 'custom'} onChange={event => { const next = exampleLocations.find(item => item.id === event.target.value); if (next) pickLocation(next) }}>
          <option value="custom" disabled>Selected map point</option>
          {exampleLocations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></div>
        {workspace !== 'explore' && <button type="button" className="secondary-button choose-on-map" onClick={() => navigate('explore', 'location-map-panel')}><Icon name="map" />Choose on map</button>}
      </div>
      {!validPeriod && <p className="form-error" role="alert">Choose whole years between 1981 and {lastYear}, with the start before the end.</p>}
      <div className="variable-context" hidden={workspace === 'daily' || workspace === 'compare' && comparisonView === 'daily'}><Icon name="info" /><p><strong>{variable} · {variableInfo[variable].title}.</strong> {variableInfo[variable].definition} <a href="#data-resources">Understand the dataset</a></p></div>
      </div>
      {activeInvestigation && workspace !== 'methods' && <aside className="investigation-prompt" aria-label="Investigation guide"><strong>{activeInvestigation.question}</strong><p>{activeInvestigation.prompt}</p><div className="guide-actions"><a href={activeInvestigation.focus === 'daily' ? '#daily-extremes' : '#local-questions'}>View the investigation <Icon name="arrow" /></a><button type="button" className="text-button" onClick={() => setInvestigation(null)}>Dismiss guide</button></div></aside>}

      <section className="workspace-panel" id="workspace-explore" role="tabpanel" aria-labelledby="tab-explore" tabIndex={0} hidden={workspace !== 'explore'}>
      <div className="explorer">
        <section className="map-panel" id="location-map-panel" aria-label="Choose a location">
          <div className="section-heading"><h2>Explore the map</h2><span>Scroll to zoom · drag to explore</span></div>
          <div className="map-comparison-controls">{comparisonEnabled ? <><div className="segmented" aria-label="Choose which map point to move"><button type="button" aria-pressed={mapTarget === 'a'} onClick={() => setMapTarget('a')}>Point A</button><button type="button" aria-pressed={mapTarget === 'b'} onClick={() => setMapTarget('b')}>Point B</button></div><span>Click the map to move point {mapTarget.toUpperCase()}.</span><button type="button" className="text-button" onClick={toggleComparison}>Finish comparison</button></> : <><span>Click to select a place.</span><button type="button" className="secondary-button" onClick={toggleComparison}>Compare two places <Icon name="pin" /></button></>}</div>
          <MapPicker visible={workspace === 'explore'} location={location} onSelect={pickLocation} comparisonLocation={comparisonEnabled ? comparisonLocation : undefined} onComparisonSelect={setComparisonLocation} activePoint={mapTarget} />
          <div className="map-caption"><span><span className="map-key" />{comparisonEnabled ? `A · ${location.name}` : 'Selected point'}</span><span>{comparisonEnabled ? `B · ${comparisonLocation.name}` : 'NASA model grid cell · not a weather station'}</span></div>
          {comparisonEnabled && <div className="map-comparison-summary"><p><strong>A</strong> {coordinates(location.lat, location.lon)}</p><p><strong>B</strong> {coordinates(comparisonLocation.lat, comparisonLocation.lon)}</p><a href="#daily-place-comparison">Compare these places <Icon name="arrow" /></a></div>}
          <details className="coordinate-details"><summary>Enter coordinates {comparisonEnabled ? `for point ${mapTarget.toUpperCase()}` : 'instead'} <Icon name="chevron" /></summary>
            <form onSubmit={applyCoordinates} key={`${mapTarget},${location.lat},${location.lon},${comparisonLocation.lat},${comparisonLocation.lon}`}>
              <label>Latitude<input type="number" name="latitude" min="-90" max="90" step="any" defaultValue={comparisonEnabled && mapTarget === 'b' ? comparisonLocation.lat : location.lat} required /></label>
              <label>Longitude<input type="number" name="longitude" min="-180" max="180" step="any" defaultValue={comparisonEnabled && mapTarget === 'b' ? comparisonLocation.lon : location.lon} required /></label>
              <button className="secondary-button" type="submit">Select point <Icon name="arrow" /></button>
            </form>
            {coordinateError && <p className="form-error" role="alert">{coordinateError}</p>}
          </details>
        </section>

        <section className="analysis-panel" aria-label="Selected point analysis" aria-busy={loading}>
          <div className="location-heading"><div><p className="overline">Selected location</p><h2>{location.name}</h2><p className="coordinates">{coordinates(location.lat, location.lon)}</p></div><span className="location-symbol"><Icon name="pin" /></span></div>
          <div className="analysis-heading"><h3>{variableLabels[variable]}</h3><span className="period-label">{start || '—'}–{end || '—'}</span></div>
          {error ? <div className="data-error" role="alert"><h3>We couldn’t load this point.</h3><p>{error}</p><button className="secondary-button" onClick={refresh}>Try again <Icon name="refresh" /></button><p className="small-note">Prague and Medicine Hat have saved NASA records available during an outage.</p></div>
            : <SeriesChart key={`${location.lat},${location.lon},${variable},${start},${end}`} result={current} loading={loading} />}

          <TrendEvidence result={current} variable={variable} loading={loading} />

          <details className="method-details"><summary>Method & data notes <Icon name="chevron" /></summary><div>
            <p>The linear model controls for calendar-month seasonality. Its 95% interval and p-value use HAC uncertainty with 12 monthly lags. Results depend on the selected period and model; a trend does not establish a cause.</p>
            {current?.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            {current && <p>Source: {current.source}. Retrieved <time dateTime={current.retrieved_at}>{new Date(current.retrieved_at).toLocaleString()}</time>.</p>}
          </div></details>

          <div className="data-footer"><span>{current ? `${current.series.filter(point => point.value !== null).length} months · ${current.data_origin === 'live' ? 'NASA live' : current.data_origin === 'cache' ? 'NASA cached' : 'NASA saved record'}` : loading ? 'Requesting NASA observations…' : 'No observations loaded'}</span><div>
            <button type="button" className="icon-button" aria-label="Refresh from NASA" title="Refresh from NASA" disabled={loading || !validPeriod} onClick={refresh}><Icon name="refresh" /></button>
            <button type="button" className="icon-button" aria-label="Download monthly data as CSV" title="Download monthly data as CSV" disabled={!current || loading} onClick={downloadData}><Icon name="download" /></button>
            {current && <a className="icon-button" aria-label="Open original NASA response" title="Open original NASA response" href={current.source_url} target="_blank" rel="noreferrer"><Icon name="external" /></a>}
          </div></div>
          <span className="sr-only" role="status">{actionMessage}</span>
        </section>
      </div>

      <div className="workspace-note"><Icon name="info" /><p>Local patterns, long-term context. Each selection represents a NASA model grid cell. Statistical evidence describes the selected record; it does not explain the cause.</p></div>
      <InvestigationStarter onStart={startInvestigation} />
      </section>
      <section className="workspace-panel" id="workspace-calendar" role="tabpanel" aria-labelledby="tab-calendar" tabIndex={0} hidden={workspace !== 'calendar'}>
      <LocalQuestions location={location} variable={variable} start={start} end={end} validPeriod={validPeriod} selection={calendarSelection} />
      </section>
      <section className="workspace-panel" id="workspace-daily" role="tabpanel" aria-labelledby="tab-daily" tabIndex={0} hidden={workspace !== 'daily'}>
      <DailyWeather location={location} start={start} end={end} validPeriod={validPeriod} selection={dailySelection} record={dailyRecord} metric={dailyMetric} onMetric={setDailyMetric} year={dailyYear} onYear={setDailyYear} />
      </section>
      <section className="workspace-panel" id="workspace-compare" role="tabpanel" aria-labelledby="tab-compare" tabIndex={0} hidden={workspace !== 'compare'}>
        <div className="comparison-workspace-toolbar"><div className="segmented" aria-label="Comparison resolution"><button type="button" aria-pressed={comparisonView === 'daily'} onClick={() => { setComparisonView('daily'); navigate('compare', 'daily-place-comparison') }}><Icon name="sun" />Daily extremes</button><button type="button" aria-pressed={comparisonView === 'monthly'} onClick={() => { setComparisonView('monthly'); navigate('compare', 'location-comparison') }}><Icon name="calendar" />Monthly trends</button></div><button type="button" className="secondary-button" onClick={() => chooseOnMap('b')}><Icon name="map" />Edit map points</button></div>
        <div hidden={comparisonView !== 'daily'}><DailyComparison standalone enabled={comparisonEnabled} onToggle={toggleComparison} onChooseMapPoint={chooseOnMap} location={location} comparisonLocation={comparisonLocation} onSelect={setComparisonLocation} primary={dailyRecord} metric={dailyMetric} onMetric={setDailyMetric} year={selectedDailyYear} onYear={setDailyYear} start={start} end={end} validPeriod={validPeriod} /></div>
        <div hidden={comparisonView !== 'monthly'}><LocationComparison standalone enabled={comparisonEnabled} onToggle={toggleComparison} location={location} comparisonLocation={comparisonLocation} onSelect={setComparisonLocation} primary={current} primaryLoading={loading} variable={variable} start={start} end={end} validPeriod={validPeriod} /></div>
      </section>
      <section className="workspace-panel" id="workspace-methods" role="tabpanel" aria-labelledby="tab-methods" tabIndex={0} hidden={workspace !== 'methods'}>
      <DataResources />
      </section>
    </main>
    <footer><span>TerraSignal</span><span>NASA Space Apps Challenge 2026</span><a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">Data from NASA POWER <Icon name="external" /></a></footer>
  </div>
}
