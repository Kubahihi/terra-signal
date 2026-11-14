import { useEffect, useState } from 'react'
import { getSeries } from '../lib/api'
import { coordinates, exampleLocations, type Location } from '../lib/locations'
import { originLabel } from '../lib/evidence'
import type { SeriesResponse, Variable } from '../types/api'
import SeriesChart from './SeriesChart'
import TrendEvidence from './TrendEvidence'
import Icon from './Icon'

type Props = {
  standalone?: boolean
  enabled: boolean
  onToggle: () => void
  location: Location
  comparisonLocation: Location
  onSelect: (location: Location) => void
  primary: SeriesResponse | null
  primaryLoading: boolean
  variable: Variable
  start: number
  end: number
  validPeriod: boolean
}

export default function LocationComparison({ enabled, onToggle, location, comparisonLocation, onSelect,
  primary, primaryLoading, variable, start, end, validPeriod, standalone }: Props) {
  const [result, setResult] = useState<SeriesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const samePoint = location.lat === comparisonLocation.lat && location.lon === comparisonLocation.lon
  const matches = result?.latitude === comparisonLocation.lat && result.longitude === comparisonLocation.lon && result.variable === variable && result.start === start && result.end === end
  const current = matches && !loading && !error ? result : null

  useEffect(() => {
    if (!enabled || !validPeriod || samePoint) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = window.setTimeout(() => {
      getSeries({ lat: comparisonLocation.lat, lon: comparisonLocation.lon, variable, start, end }, false, controller.signal)
        .then(response => { if (!controller.signal.aborted) setResult(response) })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Comparison data could not be loaded.') })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [enabled, comparisonLocation.lat, comparisonLocation.lon, variable, start, end, validPeriod, samePoint, retry])

  return <section className="comparison-section" id="location-comparison" aria-labelledby="comparison-heading">
    <div className="support-section-heading"><div><p className="overline">Where is it changing?</p><h2 id="comparison-heading">One variable. Two places.</h2><p>A trend in one place does not tell the whole story. Compare the same period in another model grid cell.</p></div>
      {!standalone && <button type="button" className="secondary-button" onClick={onToggle} aria-expanded={enabled} aria-controls="location-comparison-content">{enabled ? 'Hide comparison' : 'Compare places'}<Icon name="chevron" /></button>}
    </div>
    {enabled && <div id="location-comparison-content">
      <div className="comparison-controls"><label htmlFor="comparison-location">Compare with</label><select id="comparison-location" value={comparisonLocation.id ?? 'pinned'} onChange={event => { const next = exampleLocations.find(item => item.id === event.target.value); if (next) onSelect(next) }}>
        {!comparisonLocation.id && <option value="pinned">Pinned map point</option>}
        {exampleLocations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select><button type="button" className="text-button" onClick={() => onSelect(location)}>Pin selected map point here</button><span>{start}–{end} · {variable === 'T2M' ? 'Air temperature' : 'Precipitation'}</span></div>
      {samePoint ? <p className="comparison-hint" role="status">This is the selected map point. Move the map marker or choose a different place above to compare two locations.</p>
        : !validPeriod ? <p className="form-error">Choose a valid period above to compare locations.</p>
        : <>
          <div className="comparison-grid">
            <article className="comparison-card"><p className="overline">Selected map point</p><h3>{location.name}</h3><p className="coordinates">{coordinates(location.lat, location.lon)}</p>
              <SeriesChart key={`primary-${location.lat}-${location.lon}-${variable}-${start}-${end}`} result={primary} loading={primaryLoading} />
              <TrendEvidence result={primary} variable={variable} loading={primaryLoading} />
              {primary && <p className="comparison-source">{originLabel(primary.data_origin)} · <a href={primary.source_url} target="_blank" rel="noreferrer">Original NASA response <Icon name="external" /></a><br />Retrieved {new Date(primary.retrieved_at).toLocaleString()}</p>}
            </article>
            <article className="comparison-card" aria-busy={loading}><p className="overline">Comparison point</p><h3>{comparisonLocation.name}</h3><p className="coordinates">{coordinates(comparisonLocation.lat, comparisonLocation.lon)}</p>
              {error ? <div className="comparison-error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>
                : <SeriesChart key={`comparison-${comparisonLocation.lat}-${comparisonLocation.lon}-${variable}-${start}-${end}`} result={current} loading={loading} />}
              <TrendEvidence result={current} variable={variable} loading={loading} />
              {current && <><details className="method-details"><summary>Comparison data notes <Icon name="chevron" /></summary><div>{current.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></details>
                <p className="comparison-source">{originLabel(current.data_origin)} · <a href={current.source_url} target="_blank" rel="noreferrer">Original NASA response <Icon name="external" /></a><br />Retrieved {new Date(current.retrieved_at).toLocaleString()}</p></>}
            </article>
          </div>
          <p className="comparison-hint">Each chart has its own vertical scale. Significance is tested against a zero trend at each place; different estimates do not by themselves establish a significant difference between places. These are grid-cell records, not city-wide or country-wide averages.</p>
        </>}
    </div>}
  </section>
}
