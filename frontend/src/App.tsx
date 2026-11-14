import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Icon from './components/Icon'
import MapPicker from './components/MapPicker'
import SeriesChart from './components/SeriesChart'
import { getHealth, getSeries } from './lib/api'
import { coordinates, exampleLocations, locationAt, type Location } from './lib/locations'
import type { SeriesResponse, Variable } from './types/api'

const lastYear = new Date().getUTCFullYear() - 1
const variableLabels: Record<Variable, string> = { T2M: 'Air temperature', PRECTOTCORR: 'Precipitation' }
const unitLabel = (unit: string) => unit === 'C' ? '°C' : unit

export default function App() {
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
  const refreshRequested = useRef(false)
  const requestCache = useRef(new Map<string, SeriesResponse>())

  const validPeriod = Number.isInteger(start) && Number.isInteger(end) && start >= 1981 && end <= lastYear && start <= end
  const matches = result && result.latitude === location.lat && result.longitude === location.lon && result.variable === variable && result.start === start && result.end === end
  const current = matches ? result : null
  const analysis = current?.analysis
  const unit = current ? unitLabel(current.unit) : variable === 'T2M' ? '°C' : 'mm/day'
  const pickLocation = useCallback((next: Location) => { setLocation(next); setCoordinateError('') }, [])

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
    pickLocation(locationAt(lat, lon))
  }

  function refresh() {
    refreshRequested.current = true
    setRefreshId(id => id + 1)
  }

  function downloadData() {
    if (!current) return
    const metadata = [
      ['source', current.source], ['source_url', current.source_url], ['retrieved_at', current.retrieved_at],
      ['data_origin', current.data_origin], ['latitude', current.latitude], ['longitude', current.longitude],
      ['variable', current.variable], ['unit', current.unit], ['trend_method', current.analysis?.method ?? 'unavailable'],
    ].map(([key, value]) => `# ${key}: ${value}`)
    const csv = [...metadata, 'date,value', ...current.series.map(point => `${point.date},${point.value ?? ''}`)].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrasignal-${current.variable}-${current.latitude}-${current.longitude}-${start}-${end}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setActionMessage('Monthly data downloaded with source details.')
  }

  const rate = analysis ? `${analysis.slope_per_decade > 0 ? '+' : ''}${analysis.slope_per_decade.toFixed(3)}` : '—'
  const conclusion = !analysis ? 'A longer, sufficiently complete record is needed to estimate a trend.'
    : analysis.p_value === null ? 'The estimated trend is shown. Statistical significance is unavailable for this series.'
    : analysis.p_value < 0.05 ? `This model finds evidence of a ${analysis.slope_per_decade > 0 ? 'rising' : 'falling'} linear trend over the selected period.`
    : 'This model does not distinguish the trend from zero at the 5% level. That does not establish an absence of change.'

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="./" aria-label="TerraSignal home"><Icon name="globe" />TerraSignal</a>
      <span className="header-divider" />
      <span className="project-label">Earth system explorer</span>
      <a className="header-link" href="https://power.larc.nasa.gov/docs/" target="_blank" rel="noreferrer">About the data <Icon name="external" /></a>
    </header>

    <main>
      <div className="page-heading">
        <div><h1>A closer look at a changing Earth.</h1><p>Pick a place. Explore the record. Understand the trend.</p></div>
        <div className="source-status" role="status"><span className={`status-dot ${service}`} />{service === 'online' ? 'NASA POWER connected' : service === 'checking' ? 'Connecting to data' : 'Data service unavailable'}</div>
      </div>

      <div className="filter-bar" aria-label="Analysis settings">
        <div className="variable-control"><span className="control-label">Variable</span><div className="segmented" aria-label="Earth system variable">
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
      </div>
      {!validPeriod && <p className="form-error" role="alert">Choose whole years between 1981 and {lastYear}, with the start before the end.</p>}

      <div className="explorer">
        <section className="map-panel" aria-label="Choose a location">
          <div className="section-heading"><h2>Explore the map</h2><span>Click anywhere to select a point</span></div>
          <MapPicker location={location} onSelect={pickLocation} />
          <div className="map-caption"><span><span className="map-key" />Selected point</span><span>NASA model grid cell · not a weather station</span></div>
          <details className="coordinate-details"><summary>Enter coordinates instead <Icon name="chevron" /></summary>
            <form onSubmit={applyCoordinates} key={`${location.lat},${location.lon}`}>
              <label>Latitude<input type="number" name="latitude" min="-90" max="90" step="any" defaultValue={location.lat} required /></label>
              <label>Longitude<input type="number" name="longitude" min="-180" max="180" step="any" defaultValue={location.lon} required /></label>
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

          <div className="metrics" aria-label="Trend estimates">
            <div className="metric"><p>Change / decade</p><strong>{rate}<span>{unit}</span></strong></div>
            <div className="metric"><p>95% confidence interval</p><strong className="interval">{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(value => value.toFixed(3)).join(' to ') : '—'}</strong><span className="metric-unit">{unit} / decade</span></div>
          </div>
          <div className="evidence"><div className="evidence-heading"><h3>What the data tells us</h3><span>{analysis?.p_value != null ? `p ${analysis.p_value < 0.001 ? '< 0.001' : `= ${analysis.p_value.toPrecision(3)}`}` : 'p unavailable'}</span></div><p>{current ? conclusion : loading ? 'Loading the observations and estimating the trend…' : 'Select a valid period to explore the evidence.'}</p></div>

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
    </main>
    <footer><span>TerraSignal</span><span>NASA Space Apps Challenge 2026</span><a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">Data from NASA POWER <Icon name="external" /></a></footer>
  </div>
}
