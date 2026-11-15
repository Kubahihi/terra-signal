import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { Location } from '../lib/locations'
import type { DailyRecordState } from '../lib/useDailyRecord'
import { getSeries } from '../lib/api'
import { getRelationship, getSoil, getVegetation, matchesRelationship, relationshipCsv, relationshipRawCsv, relationshipRequest, soilDataset, vegetationDataset, weatherDataset } from '../lib/relationships'
import { parseVegetationCsv } from '../lib/vegetationImport'
import type { RelationshipDataset, RelationshipMode, RelationshipResponse, RelationshipSettings, VegetationData } from '../types/relationships'
import CompoundWeather from './CompoundWeather'
import RelationshipCharts from './RelationshipCharts'
import Icon from './Icon'
import './Relationships.css'

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const questions = {
  weather: { title: 'Do warmer months also receive less rain?', x: 'Air temperature', y: 'Precipitation total', icon: 'sun' },
  soil: { title: 'How does soil wetness follow rainfall?', x: 'Precipitation total', y: 'Root-zone soil wetness', icon: 'water' },
  vegetation: { title: 'Does greener vegetation follow wetter months?', x: 'Precipitation total', y: 'Vegetation greenness', icon: 'leaf' },
} as const
type Props = { visible?: boolean; location: Location; start: number; end: number; validPeriod: boolean; record: DailyRecordState; onSelect: (location: Location) => void; onPeriod: (start: number, end: number) => void }

export default function Relationships(props: Props) {
  const [view, setView] = useState<'compound' | RelationshipMode>('compound')
  return <section className="relationships" id="relationships" aria-label="Relationships between Earth observations">
    <div className="relationship-view-picker" aria-label="Relationship investigation">
      <button type="button" aria-pressed={view === 'compound'} onClick={() => setView('compound')}><Icon name="sun" /><span>Hot & dry days</span></button>
      <button type="button" aria-pressed={view === 'weather'} onClick={() => setView('weather')}><Icon name="relationships" /><span>Temperature & rain</span></button>
      <button type="button" aria-pressed={view === 'soil'} onClick={() => setView('soil')}><Icon name="water" /><span>Rain & soil</span></button>
      <button type="button" aria-pressed={view === 'vegetation'} onClick={() => setView('vegetation')}><Icon name="leaf" /><span>Rain & vegetation</span></button>
    </div>
    <div hidden={view !== 'compound'}><CompoundWeather {...props} /></div>
    <div hidden={view === 'compound'}><CorrelationExplorer {...props} active={props.visible !== false && view !== 'compound'} mode={view === 'compound' ? 'weather' : view} /></div>
  </section>
}

function CorrelationExplorer({ location, start, end, validPeriod, active, mode, onSelect, onPeriod }: Props & { active: boolean; mode: RelationshipMode }) {
  const [settings, setSettings] = useState<RelationshipSettings>({ month: 6, lag_months: 0, detrend: true })
  const [dataset, setDataset] = useState<{ key: string; value: RelationshipDataset } | null>(null)
  const [analysis, setAnalysis] = useState<{ key: string; value: RelationshipResponse } | null>(null)
  const [status, setStatus] = useState({ key: '', busy: false, error: '' })
  const [analysisState, setAnalysisState] = useState({ key: '', busy: false, error: '' })
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [revision, setRevision] = useState(0)
  const [vegetationIntent, setVegetationIntent] = useState('')
  const [imported, setImported] = useState<VegetationData | null>(null)
  const importedFile = useRef<{ text: string; filename: string; sha: string; importedAt: string } | null>(null)
  const [importError, setImportError] = useState('')
  const [message, setMessage] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const cache = useRef(new Map<string, RelationshipDataset>())
  const refreshWanted = useRef(false)
  const placeKey = JSON.stringify({ lat: location.lat, lon: location.lon, start, end })
  const importGeneration = useRef(0)
  const latestImportContext = useRef('')
  latestImportContext.current = `${active}:${mode}:${placeKey}`
  const matchingImport = imported?.latitude === location.lat && imported.longitude === location.lon && imported.start === start && imported.end === end ? imported : null
  const dataKey = JSON.stringify({ placeKey, mode, imported: mode === 'vegetation' ? matchingImport?.filename ?? null : null, revision })
  const current = dataset?.key === dataKey && status.key === dataKey && !status.busy && !status.error ? dataset.value : null
  const analysisKey = useMemo(() => JSON.stringify({ dataKey, settings }), [dataKey, settings])
  const result = current && analysis?.key === analysisKey && analysisState.key === analysisKey && !analysisState.busy && !analysisState.error ? analysis.value : null
  const loading = status.key === dataKey && status.busy
  const error = status.key === dataKey ? status.error : ''
  const analysisError = analysisState.key === analysisKey ? analysisState.error : ''
  const wanted = mode !== 'vegetation' || !!matchingImport || vegetationIntent === placeKey
  const satelliteEnd = end >= 2001 ? end : new Date().getUTCFullYear() - 1

  useEffect(() => {
    const file = importedFile.current
    if (!file || !imported || !validPeriod || imported.latitude !== location.lat || imported.longitude !== location.lon || imported.start === start && imported.end === end) return
    try {
      const parsed = parseVegetationCsv(file.text, file.filename, { lat: location.lat, lon: location.lon }, start, end)
      setImported({ ...parsed, warnings: [...parsed.warnings, `Imported file SHA-256: ${file.sha}. Imported at ${file.importedAt}; the original retrieval date is unknown.`] })
      setVegetationIntent(placeKey)
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : 'Import the original NDVI CSV again for this period.') }
  }, [placeKey, imported, validPeriod])

  useEffect(() => { setSettings(previous => ({ ...previous, lag_months: mode === 'weather' ? 0 : 1 })); setImportError(''); setMessage('') }, [mode])

  useEffect(() => {
    if (!active || !validPeriod || !wanted) return
    const controller = new AbortController()
    controllerRef.current = controller
    const refresh = refreshWanted.current
    refreshWanted.current = false
    setStatus({ key: dataKey, busy: true, error: '' })
    setProgress({ completed: 0, total: mode === 'vegetation' ? Math.ceil((end - Math.max(start, 2001) + 1) / 5) : 1 })
    const timer = window.setTimeout(async () => {
      try {
        const memoized = cache.current.get(dataKey)
        let response = memoized
        if (!response || refresh) {
          const query = { lat: location.lat, lon: location.lon, start, end }
          const rainPromise = getSeries({ ...query, variable: 'PRECTOTCORR' }, refresh, controller.signal)
          if (mode === 'weather') {
            const [temperature, rain] = await Promise.all([getSeries({ ...query, variable: 'T2M' }, refresh, controller.signal), rainPromise])
            response = weatherDataset(temperature, rain)
          } else if (mode === 'soil') {
            const [soil, rain] = await Promise.all([getSoil(query, refresh, controller.signal), rainPromise])
            response = soilDataset(rain, soil)
          } else {
            const [vegetation, rain] = await Promise.all([matchingImport ?? getVegetation(query, refresh, controller.signal, (completed, total) => { if (!controller.signal.aborted) setProgress({ completed, total }) }), rainPromise])
            response = vegetationDataset(rain, vegetation)
          }
          if (response.latitude !== location.lat || response.longitude !== location.lon || response.start !== start || response.end !== end) throw new Error('Relationship sources do not match the selected point and period.')
        }
        if (!controller.signal.aborted) { cache.current.set(dataKey, response); setDataset({ key: dataKey, value: response }); setStatus({ key: dataKey, busy: false, error: '' }) }
      } catch (cause) { if (!controller.signal.aborted) setStatus({ key: dataKey, busy: false, error: cause instanceof Error ? cause.message : 'The observations could not be loaded.' }) }
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [active, validPeriod, wanted, dataKey])

  useEffect(() => {
    if (!active || !current) return
    const controller = new AbortController()
    setAnalysisState({ key: analysisKey, busy: true, error: '' })
    getRelationship(relationshipRequest(current, settings), controller.signal).then(response => {
      if (!matchesRelationship(current, settings, response)) throw new Error('The relationship result does not match these observations and settings.')
      if (!controller.signal.aborted) { setAnalysis({ key: analysisKey, value: response }); setAnalysisState({ key: analysisKey, busy: false, error: '' }) }
    }).catch(cause => { if (!controller.signal.aborted) setAnalysisState({ key: analysisKey, busy: false, error: cause instanceof Error ? cause.message : 'The relationship could not be calculated.' }) })
    return () => controller.abort()
  }, [active, current, analysisKey])

  function retry(refresh = false) { refreshWanted.current = refresh; setVegetationIntent(placeKey); setRevision(value => value + 1) }
  function stop() { controllerRef.current?.abort(); setStatus({ key: dataKey, busy: false, error: 'Loading stopped. You can retry this selection.' }) }
  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const generation = ++importGeneration.current
    const importContext = latestImportContext.current
    setImportError('')
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a CSV smaller than 20 MB.')
      const selectedPlace = { lat: location.lat, lon: location.lon, start, end }
      const bytes = await file.arrayBuffer()
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const parsed = parseVegetationCsv(content, file.name, selectedPlace, start, end)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const sha = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
      if (generation !== importGeneration.current || importContext !== latestImportContext.current) return
      importedFile.current = { text: content, filename: file.name, sha, importedAt: parsed.imported_at }
      setImported({ ...parsed, warnings: [...parsed.warnings, `Imported file SHA-256: ${sha}. Imported at ${parsed.imported_at}; the original retrieval date is unknown.`] })
      // Use the actual export centre for both providers, never relabel a nearby pixel.
      if (parsed.latitude !== selectedPlace.lat || parsed.longitude !== selectedPlace.lon) onSelect({ name: `${location.name} · MODIS export centre`, lat: parsed.latitude, lon: parsed.longitude })
      setVegetationIntent(JSON.stringify({ lat: parsed.latitude, lon: parsed.longitude, start, end }))
      setRevision(value => value + 1)
      setMessage(`Imported ${file.name}. Coordinates and quality-filtered format were checked; the file's origin is user supplied.`)
    } catch (cause) { if (generation === importGeneration.current && importContext === latestImportContext.current) setImportError(cause instanceof Error ? cause.message : 'The NDVI file could not be imported.') }
  }
  function download(paired: boolean) {
    if (!current || paired && !result) return
    const csv = paired ? relationshipCsv(current, settings, result!) : relationshipRawCsv(current)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url
    anchor.download = `terrasignal-${mode}-${paired ? 'relationship' : 'monthly'}-${location.lat}-${location.lon}-${start}-${end}.csv`
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Data downloaded with source details, settings and missing values retained.')
  }
  const question = questions[mode]
  return <section className="correlation-explorer" aria-labelledby="relationship-heading" aria-busy={loading}>
    <div className="relationship-question"><div><p className="overline">{location.name} · {start || '—'}–{end || '—'}</p><h2 id="relationship-heading">{question.title}</h2><p>Choose a calendar month and ask whether departures from its usual conditions move together.</p></div><span className="relationship-question-icon"><Icon name={question.icon} /></span></div>
    <div className="relationship-controls">
      <label>Month of X<select aria-label="Relationship calendar month" value={settings.month ?? 0} onChange={event => setSettings(previous => ({ ...previous, month: Number(event.target.value) || null }))}><option value="0">All months · seasonal cycle removed</option>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
      <label>Time between X and Y<select aria-label="Relationship time lag" value={settings.lag_months} onChange={event => setSettings(previous => ({ ...previous, lag_months: Number(event.target.value) as 0 | 1 | 2 }))}><option value="0">Same month</option><option value="1">Y one month after X</option><option value="2">Y two months after X</option></select></label>
      <label className="relationship-checkbox"><input type="checkbox" checked={settings.detrend} onChange={event => setSettings(previous => ({ ...previous, detrend: event.target.checked }))} />Remove long-term linear trends</label>
    </div>
    <p className="relationship-direction"><span>X · {question.x}{settings.month ? ` in ${months[settings.month - 1]}` : ''}</span><Icon name="arrow" /><span>Y · {question.y}{settings.month ? ` in ${months[(settings.month - 1 + settings.lag_months) % 12]}` : ''}</span></p>
    {mode === 'vegetation' && <div className="vegetation-access"><div><p className="overline">NASA Terra / MODIS · NDVI</p><h3>Follow vegetation greenness.</h3><p>NDVI is a satellite measure of vegetation greenness. Quality-screened 16-day composites are grouped by their start month; incomplete months stay gaps.</p><div className="vegetation-examples"><span>Try a place:</span><button type="button" className="text-button" onClick={() => { onSelect({ name: 'South Moravia, Czechia', lat: 48.85, lon: 16.85 }); onPeriod(2001, end < 2001 ? new Date().getUTCFullYear() - 1 : end) }}>South Moravia</button><button type="button" className="text-button" onClick={() => { onSelect({ id: 'medicine-hat', name: 'Medicine Hat, Canada', lat: 50.0405, lon: -110.6765 }); onPeriod(2001, end < 2001 ? new Date().getUTCFullYear() - 1 : end) }}>Medicine Hat</button></div></div><div className="vegetation-actions"><button type="button" className="secondary-button" disabled={!validPeriod || loading || end < 2001} onClick={() => retry()}><Icon name="leaf" />{matchingImport ? 'Recalculate imported NDVI' : 'Load MODIS vegetation data'}</button><label className="secondary-button vegetation-import"><Icon name="download" />Import filtered NDVI CSV<input type="file" accept=".csv,text/csv" aria-label="Import ORNL filtered and scaled NDVI CSV" onChange={importCsv} disabled={!validPeriod} /></label><a className="text-button" href="https://modis.ornl.gov/data.html" target="_blank" rel="noreferrer">Get an ORNL NDVI export <Icon name="external" /></a></div><p className="vegetation-access-note">The first satellite load may take several minutes. Public ORNL availability varies; its export tools may require Earthdata Login. Import accepts the original filtered_scaled_250m_16_days_NDVI.csv format for the selected point, with coordinates and quality gaps retained.</p>{start < 2001 && <p className="vegetation-period-note">Our MODIS integration starts in 2001. Earlier months cannot enter the correlation. <button type="button" className="text-button" onClick={() => onPeriod(2001, satelliteEnd)}>Use 2001–{satelliteEnd}</button></p>}{matchingImport && <p className="vegetation-import-note">Using imported file: {matchingImport.filename}. <button type="button" className="text-button" onClick={() => { importedFile.current = null; setImported(null); setVegetationIntent(''); setMessage('Imported NDVI removed from this workspace.') }}>Use NASA API instead</button></p>}{imported && !matchingImport && <p className="vegetation-import-note">A saved import belongs to another point or period. Return to its coordinates or import the original CSV for this selection.</p>}{importError && <p role="alert" className="form-error">{importError}</p>}</div>}
    {!validPeriod ? <p className="form-error">Choose a valid analysis period above.</p> : loading ? <div className="relationship-loading" role="status"><Icon name="refresh" /><div><strong>{mode === 'vegetation' && !matchingImport ? 'Loading quality-screened MODIS observations…' : 'Loading matching NASA monthly records…'}</strong><p>{mode === 'vegetation' && !matchingImport ? `${progress.completed} / ${progress.total} satellite batches received. Raw responses are cached for reuse.` : 'The same point and requested period are used for both variables.'}</p></div><button type="button" className="text-button" onClick={stop}>Cancel loading</button></div> : error ? <div className="relationship-error" role="alert"><h3>The relationship data could not be loaded.</h3><p>{error}</p><button type="button" className="secondary-button" onClick={() => retry()}>Retry data <Icon name="refresh" /></button>{mode === 'vegetation' && <p>Temperature, soil and compound-weather analyses remain available. You can import an original filtered NDVI export above.</p>}</div> : !wanted ? <div className="relationship-empty">Choose a satellite period and load MODIS data, or import a quality-filtered export for this point.</div> : null}
    {current && <>
      {analysisState.key === analysisKey && analysisState.busy && <p role="status" className="relationship-status">Pairing calendar months and removing the selected effects…</p>}
      {analysisError && <div role="alert" className="relationship-error"><p>{analysisError}</p><button type="button" className="secondary-button" onClick={() => setRevision(value => value + 1)}>Retry analysis</button></div>}
      {result && <><div className="relationship-statistics"><div><span>Descriptive Pearson correlation</span><strong>{result.pearson_r === null ? '—' : result.pearson_r.toFixed(3)}</strong><small>{result.pearson_r === null ? 'Not enough usable variation or coverage' : result.pearson_r > 0 ? 'Positive association' : result.pearson_r < 0 ? 'Negative association' : 'No linear association in these adjusted pairs'}</small></div><div><span>Matched observations</span><strong>{result.n_pairs}<small> / {result.expected_pairs}</small></strong><small>{(100 * result.coverage).toFixed(1)}% of requested calendar pairs</small></div><div><span>Years represented</span><strong>{result.n_years}</strong><small>{result.reference_start !== null ? `${result.reference_start}–${result.reference_end} matched reference` : 'No common reference'}</small></div></div><RelationshipCharts result={result} />
        <div className="relationship-caution"><Icon name="info" /><p>This coefficient describes association, not a cause or a forecast. No significance badge or independent-observation p-value is calculated. Nearby months can be correlated with each other, and trying many places, lags or variables can produce chance findings.</p></div>
        {mode === 'soil' && <p className="relationship-model-note">Rainfall and soil wetness come from the same MERRA-2 modelling system. This examines its coupled water-cycle behaviour; it is not an independent satellite validation. Soil wetness is a dimensionless fraction, not volumetric water content.</p>}
        <details className="relationship-method"><summary>Method, coverage & source records <Icon name="chevron" /></summary><div><p>{result.method}</p><p>{result.seasonality}</p><p>Each month's reference is calculated from matched observations in this selected record. It is separate from the fixed 1991–2020 reference in Calendar. At least five paired years, 80% requested coverage and adequate variation are required to show r.</p>{[...new Set([...result.warnings, ...current.warnings])].map((warning, index) => <p key={index}>{warning}</p>)}<ul>{current.sources.map((source, index) => <li key={index}><strong>{source.role.toUpperCase()} · {source.source}</strong><a href={source.source_url} target="_blank" rel="noreferrer">Source record <Icon name="external" /></a><span>{source.data_origin} · {source.retrieved_at ? new Date(source.retrieved_at).toLocaleString() : 'original retrieval unknown; user-supplied import'}</span><span>{source.spatial_support}</span></li>)}</ul></div></details>
      </>}
      <div className="relationship-footer"><div><button type="button" className="secondary-button" disabled={!result} onClick={() => download(true)}>Download matched pairs <Icon name="download" /></button><button type="button" className="secondary-button" onClick={() => download(false)}>Download monthly records <Icon name="download" /></button></div><button type="button" className="text-button" disabled={loading} onClick={() => retry(true)}>Refresh observations <Icon name="refresh" /></button></div>
    </>}
    <span className="sr-only" role="status">{message}</span>
  </section>
}
