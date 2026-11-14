import { useEffect, useState, type FormEvent } from 'react'
import SeriesChart from './components/SeriesChart'
import { getHealth, getSeries } from './lib/api'
import type { SeriesResponse, Variable } from './types/api'

const locations = [
  { id: 'prague', name: 'Prague, Czechia', lat: 50.0755, lon: 14.4378 },
  { id: 'medicine-hat', name: 'Medicine Hat, Canada', lat: 50.0405, lon: -110.6765 },
]
const variables: Record<Variable, string> = { T2M: 'Air temperature', PRECTOTCORR: 'Precipitation' }
const lastCompleteYear = new Date().getUTCFullYear() - 1

export default function App() {
  const [locationId, setLocationId] = useState(locations[0].id)
  const [variable, setVariable] = useState<Variable>('T2M')
  const [start, setStart] = useState(1981)
  const [end, setEnd] = useState(lastCompleteYear)
  const [service, setService] = useState<'checking' | 'online' | 'offline'>('checking')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SeriesResponse | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal).then(() => setService('online')).catch(() => {
      if (!controller.signal.aborted) setService('offline')
    })
    return () => controller.abort()
  }, [])

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (start > end) { setError('Choose an end year on or after the start year.'); return }
    const location = locations.find(item => item.id === locationId)!
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await getSeries({ lat: location.lat, lon: location.lon, variable, start, end }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The analysis could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  const analysis = result?.analysis
  const rate = analysis ? `${analysis.slope_per_decade > 0 ? '+' : ''}${analysis.slope_per_decade.toFixed(3)}` : '—'

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="./" aria-label="TerraSignal home"><span className="brand-orbit" aria-hidden="true" />Terra<span>Signal</span></a>
      <span className="topbar-label">EARTH SYSTEM TREND DETECTIVE</span>
      <div className={`service-status ${service}`} role="status"><i />{service === 'online' ? 'Service available' : service === 'checking' ? 'Connecting' : 'Service unavailable'}</div>
    </header>

    <main>
      <section className="intro">
        <p className="eyebrow">A CHANGING PLANET. A CLEARER PICTURE.</p>
        <h1>Find the trend.<br /><span>Understand the evidence.</span></h1>
        <p className="intro-copy">Explore how Earth is changing through NASA data — with the context and uncertainty that every conclusion deserves.</p>
        <div className="planet" aria-hidden="true"><div /><span /></div>
      </section>

      <div className="workspace">
        <aside className="panel investigation">
          <p className="eyebrow">01 / YOUR INVESTIGATION</p>
          <h2>What would you like to explore?</h2>
          <form onSubmit={analyze}>
            <label htmlFor="location">Location</label>
            <select id="location" value={locationId} onChange={event => setLocationId(event.target.value)} disabled={loading}>
              {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
            <label htmlFor="variable">Earth system variable</label>
            <select id="variable" value={variable} onChange={event => setVariable(event.target.value as Variable)} disabled={loading}>
              {Object.entries(variables).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <div className="year-fields">
              <div><label htmlFor="start">From</label><input id="start" type="number" min="1981" max={lastCompleteYear} required value={start} onChange={event => setStart(Number(event.target.value))} disabled={loading} /></div>
              <div><label htmlFor="end">To</label><input id="end" type="number" min="1981" max={lastCompleteYear} required value={end} onChange={event => setEnd(Number(event.target.value))} disabled={loading} /></div>
            </div>
            <button className="analyze-button" disabled={loading} type="submit">{loading ? 'Loading observations…' : 'Explore the evidence'}<span aria-hidden="true">↗</span></button>
          </form>
          <p className="field-note">A location represents a model grid cell, rather than an individual weather station.</p>
        </aside>

        <section className="results" aria-busy={loading}>
          {error && <div className="error-message" role="alert">{error}</div>}
          <div className="panel chart-panel">
            <div className="panel-heading"><div><p className="eyebrow">02 / OBSERVE THE CHANGE</p><h2>{result ? variables[result.variable] : 'The evidence, over time'}</h2></div><span className="tag">{result ? `${result.start}–${result.end}` : 'Monthly data'}</span></div>
            <SeriesChart result={result} />
            <div className="chart-footer"><span>Source: {result?.source ?? 'NASA POWER · connection pending'}</span><span>{result ? `${result.series.filter(point => point.value !== null).length} available observations` : 'Awaiting observations'}</span></div>
          </div>
          <div className="metrics">
            <div className="panel metric"><p>Change per decade</p><strong>{rate}</strong><span>{result ? `${result.unit} / decade` : 'Analysis pending'}</span></div>
            <div className="panel metric"><p>95% confidence interval</p><strong className="interval">{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(value => value.toFixed(3)).join(' to ') : '—'}</strong><span>{result ? `${result.unit} / decade` : 'Analysis pending'}</span></div>
            <div className="panel metric"><p>p-value</p><strong>{analysis?.p_value != null ? analysis.p_value.toPrecision(3) : '—'}</strong><span>{analysis ? analysis.method : 'Analysis pending'}</span></div>
          </div>
          <div className="panel context"><span className="context-icon" aria-hidden="true">i</span><div><h3>Look beyond the line.</h3><p>A trend describes change over time. Its uncertainty tells us how precise the estimate is. A trend alone does not establish its cause.</p></div></div>
          {result?.warnings.map((warning, index) => <p className="notice" key={index}>{warning}</p>)}
        </section>
      </div>
    </main>
    <footer>TerraSignal <span>NASA Space Apps Challenge 2026</span><a href="https://power.larc.nasa.gov/docs/" target="_blank" rel="noreferrer">About the data ↗</a></footer>
  </div>
}
