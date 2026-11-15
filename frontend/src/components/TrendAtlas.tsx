import { useEffect, useId, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Icon from './Icon'
import { coordinates, type Location } from '../lib/locations'
import { dailyMetrics } from '../lib/dailyData'
import { atlasAnnualValue, atlasMarker, atlasScale, loadTrendAtlas, type AtlasPoint, type TrendAtlasData } from '../lib/trendAtlas'
import { atlasColor, atlasLegend } from '../lib/atlasLayers'
import { atlasBaseline, atlasDeparture, atlasDepartureScale } from '../lib/atlasDepartures'
import type { DailyMetric } from '../types/api'
import './TrendAtlas.css'

type Mode = 'trend' | 'year' | 'anomaly'
type Pair = { a: string; b: string }
const number = (value: number | null, signed = false) => value == null ? '—' : value.toLocaleString('en', { maximumFractionDigits: 2, minimumFractionDigits: signed ? 2 : 0, signDisplay: signed ? 'exceptZero' : 'auto' })
const evidenceText = { increase: 'Increase detected', decrease: 'Decrease detected', unresolved: 'Trend unresolved', unavailable: 'Inference unavailable' }
function initialSettings() {
  const query = new URLSearchParams(window.location.search)
  const metric = dailyMetrics.find(item => item.id === query.get('atlasMetric'))?.id ?? 'hot_days'
  const year = Number(query.get('atlasYear'))
  return { metric, year: Number.isInteger(year) && year >= 1981 && year <= 2025 ? year : 2025,
    mode: query.get('atlasMode') === 'trend' ? 'trend' as const : query.get('atlasMode') === 'year' ? 'year' as const : 'anomaly' as const,
    pair: { a: query.get('atlasA') || 'brno', b: query.get('atlasB') || 'athens' } }
}

function mapValue(point: AtlasPoint, metric: DailyMetric, year: number, mode: Mode): number | null {
  return mode === 'trend' ? point.metrics[metric].slope : mode === 'anomaly' ? atlasDeparture(point, metric, year) : atlasAnnualValue(point, metric, year)
}

function fitOptions(map: L.Map, comparisonOpen: boolean): L.FitBoundsOptions {
  const sidebar = comparisonOpen && !window.matchMedia('(max-width: 760px)').matches
  return { paddingTopLeft: [45, 110], paddingBottomRight: [sidebar ? 350 : 45, 120], maxZoom: 6, animate: false }
}

export default function TrendAtlas({ visible = true, onOpenAnalysis }: {
  visible?: boolean; onOpenAnalysis: (a: Location, b: Location, metric: DailyMetric, year: number) => void
}) {
  const initial = useRef(initialSettings())
  const [data, setData] = useState<TrendAtlasData | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [metric, setMetric] = useState<DailyMetric>(initial.current.metric)
  const [mode, setMode] = useState<Mode>(initial.current.mode)
  const [year, setYear] = useState(initial.current.year)
  const [pair, setPair] = useState<Pair>(initial.current.pair)
  const [target, setTarget] = useState<'a' | 'b'>('a')
  const [playing, setPlaying] = useState(false)
  const [comparisonOpen, setComparisonOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches)
  const [tileError, setTileError] = useState(false)
  const [message, setMessage] = useState('')
  const [placeFilter, setPlaceFilter] = useState('')
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const selectRef = useRef<(id: string) => void>(() => {})
  const sliderId = useId()
  const definition = dailyMetrics.find(item => item.id === metric)!
  const a = data?.points.find(point => point.location.id === pair.a)
  const b = data?.points.find(point => point.location.id === pair.b)
  const scale = useMemo(() => data ? mode === 'anomaly' ? atlasDepartureScale(data, metric) : atlasScale(data, metric, mode) : null, [data, metric, mode])
  const legend = useMemo(() => scale ? atlasLegend(scale) : null, [scale])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    loadTrendAtlas(controller.signal).then(next => {
      if (controller.signal.aborted) return
      setData(next)
      setPair(previous => {
        const first = next.points.some(point => point.location.id === previous.a) ? previous.a : next.points[0].location.id
        const second = next.points.some(point => point.location.id === previous.b && previous.b !== first) ? previous.b : next.points.find(point => point.location.id !== first)!.location.id
        return { a: first, b: second }
      })
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The atlas could not be loaded.') })
    return () => controller.abort()
  }, [retry])
  useEffect(() => { if (!visible) setPlaying(false) }, [visible])
  useEffect(() => {
    if (!playing || !visible || !data) return
    const first = data.start
    const timer = window.setInterval(() => setYear(previous => previous >= data.end || previous < first ? first : previous + 1), 800)
    return () => window.clearInterval(timer)
  }, [playing, visible, data])
  useEffect(() => {
    if (!visible || !data) return
    const url = new URL(window.location.href)
    Object.entries({ atlasA: pair.a, atlasB: pair.b, atlasMetric: metric, atlasYear: String(year), atlasMode: mode }).forEach(([key, value]) => url.searchParams.set(key, value))
    url.searchParams.delete('atlasLayer')
    window.history.replaceState(null, '', url)
  }, [data, pair, metric, year, mode, visible])

  function choose(id: string, point = target) {
    setPair(previous => previous[point === 'a' ? 'b' : 'a'] === id ? { a: previous.b, b: previous.a } : { ...previous, [point]: id })
    const place = data?.points.find(item => item.location.id === id)?.location
    if (place) {
      setMessage(`Point ${point.toUpperCase()}: ${place.name}.`)
      const map = mapRef.current
      if (map && !map.getBounds().contains([place.lat, place.lon])) map.panTo([place.lat, place.lon], { animate: false })
    }
    if (point === 'a') setTarget('b')
  }
  selectRef.current = choose
  useEffect(() => {
    if (!data || !mapContainer.current) return
    const map = L.map(mapContainer.current, { center: [47, 16], zoom: 4, minZoom: 0, maxZoom: 10, zoomControl: false, scrollWheelZoom: true, wheelPxPerZoomLevel: 120, worldCopyJump: true })
    mapRef.current = map
    L.control.zoom({ position: 'bottomleft' }).addTo(map)
    map.attributionControl.setPrefix('<a href="https://leafletjs.com/" target="_blank" rel="noreferrer">Leaflet</a>')
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>', className: 'base-map-tiles', maxZoom: 19 }).addTo(map)
    tiles.on('tileerror', () => setTileError(true)); tiles.on('tileload', () => setTileError(false))
    layerRef.current = L.layerGroup().addTo(map)
    const first = data.points.find(point => point.location.id === pair.a)
    const second = data.points.find(point => point.location.id === pair.b)
    if (first && second) map.fitBounds([[first.location.lat, first.location.lon], [second.location.lat, second.location.lon]], fitOptions(map, comparisonOpen))
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!entry?.contentRect.width || !entry.contentRect.height) return
      window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    })
    observer.observe(mapContainer.current)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); map.remove(); mapRef.current = null; layerRef.current = null }
  }, [data])
  useEffect(() => {
    const map = mapRef.current, group = layerRef.current
    if (!map || !group || !data || !scale) return
    group.clearLayers()
    for (const point of data.points) {
      const trend = point.metrics[metric]
      const value = mapValue(point, metric, year, mode)
      const radius = atlasMarker(value, scale).radius
      const selected = point.location.id === pair.a ? 'A' : point.location.id === pair.b ? 'B' : ''
      const resolved = trend.evidence === 'increase' || trend.evidence === 'decrease'
      const icon = document.createElement('span'); icon.className = 'atlas-marker-hit'
      const bubble = document.createElement('span')
      bubble.className = `atlas-marker-inner${selected ? ' is-selected' : ''}${mode === 'trend' && !resolved ? ' is-unresolved' : ''}${value == null ? ' is-missing' : ''}`
      bubble.style.setProperty('--marker-color', atlasColor(value, scale)); bubble.style.width = `${radius * 2}px`; bubble.style.height = `${radius * 2}px`
      icon.append(bubble)
      if (selected) { const label = document.createElement('span'); label.className = `atlas-map-point-label ${selected.toLowerCase()}`; label.textContent = selected; icon.append(label) }
      const marker = L.marker([point.location.lat, point.location.lon], { title: `${point.location.name}: ${number(value, mode !== 'year')} ${scale.unit}. Select point ${target.toUpperCase()}.`, alt: point.location.name, keyboard: true, zIndexOffset: selected ? 500 : 0,
        icon: L.divIcon({ className: 'atlas-map-marker', html: icon, iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(group)
      const tooltip = document.createElement('span'); tooltip.textContent = `${point.location.name} · ${number(value, mode !== 'year')} ${scale.unit}${mode === 'trend' ? ` · ${evidenceText[trend.evidence]}` : ` · ${year}`}`
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -20], className: 'atlas-tooltip' })
      marker.on('click', () => selectRef.current(point.location.id))
    }
  }, [data, metric, mode, year, pair, scale, target])
  useEffect(() => {
    if (!visible) return
    const frame = window.requestAnimationFrame(() => mapRef.current?.invalidateSize({ animate: false }))
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  function fitPlaces(points: L.LatLngExpression[]) {
    const map = mapRef.current
    if (!map) return
    // Read the current container before fitting: a resize observer may still be queued.
    map.invalidateSize({ animate: false })
    const closeDrawer = comparisonOpen && window.matchMedia('(max-width: 760px)').matches
    if (closeDrawer) setComparisonOpen(false)
    map.fitBounds(L.latLngBounds(points), fitOptions(map, closeDrawer ? false : comparisonOpen))
  }
  function fitPair() { if (a && b) fitPlaces([[a.location.lat, a.location.lon], [b.location.lat, b.location.lon]]) }
  function changeYear(next: number) { setPlaying(false); setYear(next) }
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setMessage('Map link copied, with both places, view and year.') }
    catch { setMessage('Copy your browser address to share this map view.') }
  }
  if (error && !data) return <div className="atlas-loading" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Retry map</button></div>
  if (!data || !a || !b || !scale || !legend) return <div className="atlas-loading" role="status">Opening the saved NASA map…</div>
  const av = mapValue(a, metric, year, mode), bv = mapValue(b, metric, year, mode)

  return <div className="trend-atlas compact-atlas">
    <div className="atlas-toolbar">
      <h1 className="sr-only">Map</h1>
      <label className="atlas-field"><select aria-label="Map indicator" value={metric} onChange={event => setMetric(event.target.value as DailyMetric)}>{dailyMetrics.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="segmented atlas-mode" aria-label="Map values"><button type="button" aria-pressed={mode === 'year'} onClick={() => setMode('year')}>Year</button><button type="button" aria-pressed={mode === 'anomaly'} onClick={() => setMode('anomaly')}>Vs usual</button><button type="button" aria-pressed={mode === 'trend'} onClick={() => { setMode('trend'); setPlaying(false) }}>Trend</button></div>
      <button className="atlas-toggle-comparison" type="button" aria-expanded={comparisonOpen} aria-controls={`${sliderId}-comparison`} onClick={() => setComparisonOpen(value => !value)}><Icon name="compare" />Compare</button>
    </div>
    <div className={`atlas-workbench${comparisonOpen ? ' has-comparison' : ''}`}>
      <div ref={mapContainer} className="atlas-map" role="region" aria-label={`Interactive data map. Click a colored marker to select point ${target.toUpperCase()}. Scroll to zoom, drag to pan.`} />
      <div className="atlas-map-controls"><div className="atlas-geography" role="group" aria-label="Map extent"><button type="button" onClick={() => fitPlaces(data.points.map(point => [point.location.lat, point.location.lon]))}>World</button><button type="button" onClick={() => mapRef.current?.setView([48, 13], 4, { animate: false })}>Europe</button><button type="button" onClick={() => mapRef.current?.setView([49.8, 16.2], 7, { animate: false })}>Czechia</button></div><button type="button" className="atlas-fit" aria-label="Show both comparison points on map" onClick={fitPair}><Icon name="target" />A + B</button></div>
      <div className="atlas-map-target"><span>Select</span><div className="segmented" aria-label="Map selection target"><button type="button" aria-pressed={target === 'a'} onClick={() => setTarget('a')}>A</button><button type="button" aria-pressed={target === 'b'} onClick={() => setTarget('b')}>B</button></div></div>
      <div className="atlas-data-label"><span>{mode === 'trend' ? `${data.start}–${data.end} · days / decade` : mode === 'anomaly' ? `${year} vs 1991–2020` : `${year} · days`}</span></div>
      {tileError && <p className="atlas-map-notice" role="status">Some map tiles are unavailable. The counts still work.</p>}
      <div className="atlas-color-legend" aria-label={`${definition.title} color scale`}><div><strong>{mode === 'trend' ? 'Trend' : mode === 'anomaly' ? 'Vs usual' : 'Days'}</strong><span>{scale.unit}</span></div><div className="atlas-gradient" style={{ background: legend.gradient }} /><div className="atlas-legend-ticks">{legend.ticks.map(tick => <span key={tick.value}>{number(tick.value)}</span>)}</div>{mode === 'trend' && <small><i />Dashed outline: unresolved / inference unavailable</small>}</div>
      <aside id={`${sliderId}-comparison`} className="atlas-comparison" aria-label="Quick comparison of two places" hidden={!comparisonOpen}>
        <div className="atlas-comparison-heading"><h2 className="sr-only">Compare places</h2><button type="button" className="atlas-icon-button" aria-label="Swap comparison points A and B" onClick={() => setPair(previous => ({ a: previous.b, b: previous.a }))}><Icon name="compare" /></button><button type="button" className="atlas-icon-button" aria-label="Close quick comparison" onClick={() => setComparisonOpen(false)}>×</button></div>
        {([['a', a], ['b', b]] as const).map(([key, point]) => <div key={key} className="atlas-point-row"><label className={`atlas-point-letter ${key}`} htmlFor={`${sliderId}-${key}`}>{key.toUpperCase()}</label><div className="atlas-point-value"><select id={`${sliderId}-${key}`} aria-label={`Point ${key.toUpperCase()}`} value={point.location.id} onChange={event => choose(event.target.value, key)}>{data.points.map(item => <option key={item.location.id} value={item.location.id}>{item.location.name}</option>)}</select><span>{mode === 'trend' ? evidenceText[point.metrics[metric].evidence] : mode === 'anomaly' ? atlasBaseline(point, metric).mean == null ? 'Reference unavailable' : `Usual: ${number(atlasBaseline(point, metric).mean)} days` : `${year} · ${atlasAnnualValue(point, metric, year) == null ? 'unavailable' : 'days'}`}</span></div><strong>{number(mapValue(point, metric, year, mode), mode !== 'year')}<small>{mode === 'anomaly' ? 'days vs usual' : scale.unit}</small></strong></div>)}
        <AtlasPairChart a={a} b={b} metric={metric} start={data.start} end={data.end} year={year} onYear={changeYear} departures={mode === 'anomaly'} />
        <div className="atlas-year-comparison" hidden={mode === 'trend'}><span>{year} · A − B{mode === 'anomaly' ? ' vs usual' : ''}</span><strong>{av == null || bv == null ? '—' : number(av - bv, mode === 'anomaly')} days</strong></div>
        <details className="atlas-pair-evidence"><summary>Details <Icon name="chevron" /></summary><div>{([['A', a], ['B', b]] as const).map(([label, point]) => <p key={label}><strong>{label} · {point.location.name}</strong><br />{point.metrics[metric].completeYears} / 45 complete years.<br />{mode === 'anomaly' ? <>1991–2020 average: {number(atlasBaseline(point, metric).mean)} days · {atlasBaseline(point, metric).completeYears} / 30 reference years.<br /></> : mode === 'trend' ? <>Individual 95% slope interval: {point.metrics[metric].ci95 ? point.metrics[metric].ci95!.map(value => number(value, true)).join(' to ') : 'unavailable'} days / decade.<br /></> : null}{coordinates(point.location.lat, point.location.lon)}</p>)}<p>Yearly departures are descriptive, not significance tests. Differences use unrounded values. Atlas trend evidence uses Holm correction across {data.familySize} tests. Individual intervals are not simultaneous. Annual A − B is descriptive; separate trends do not test their difference. Full analysis recalculates four tests per place and can have different labels.</p></div></details>
        <div className="atlas-actions"><button type="button" className="atlas-open" onClick={() => onOpenAnalysis(a.location, b.location, metric, year)}>Daily counts <Icon name="arrow" /></button><button type="button" className="atlas-icon-button" aria-label="Copy map link" onClick={copyLink}><Icon name="external" /></button></div>
      </aside>
    </div>
    <div className="atlas-time-control">{mode !== 'trend' && <button type="button" className="atlas-play" aria-label={playing ? 'Pause years' : 'Play years'} onClick={() => setPlaying(value => !value)}>{playing ? 'Ⅱ' : '▶'}</button>}<label htmlFor={sliderId}>{mode === 'trend' ? 'Chart year' : 'Map year'} <strong>{year}</strong></label><span>{data.start}</span><input id={sliderId} aria-label="Atlas year" type="range" min={data.start} max={data.end} value={year} onChange={event => changeYear(Number(event.target.value))} /><span>{data.end}</span><button type="button" className="text-button" onClick={copyLink}>Share</button></div>
    <div className="atlas-bottom-row"><p>{data.points.length} sampled grid cells · {definition.rule}{metric === 'longest_dry_spell' ? ' · clipped to calendar year' : ''}</p><details className="atlas-place-menu"><summary>Places <Icon name="chevron" /></summary><div><input type="search" aria-label="Find a place" placeholder="Find a place" value={placeFilter} onChange={event => setPlaceFilter(event.target.value)} />{data.points.filter(point => point.location.name.toLowerCase().includes(placeFilter.toLowerCase().trim())).map(point => <button type="button" key={point.location.id} onClick={() => choose(point.location.id)}>{point.location.name}<span>{number(mapValue(point, metric, year, mode), mode !== 'year')}</span></button>)}</div></details><details className="atlas-provenance"><summary>Data <Icon name="chevron" /></summary><div><p>Colors and sizes describe {data.points.length} sampled NASA POWER grid-cell records, not administrative areas or an interpolated global trend surface. The scale is fixed across all places and years. Dashed outlines indicate unresolved or unavailable inference. Warm nights use daily minima as a proxy; dry runs stop at each calendar-year boundary.</p><p>All four indices use exact complete annual values from {data.start}–{data.end}. {data.method}. Atlas labels use the fixed {data.familySize}-test Holm family. Latest source retrieval: {new Date(data.retrievedAt).toLocaleDateString('en')}; analysis created: {new Date(data.generatedAt).toLocaleDateString('en')}. <a href={data.sourceHref} target="_blank" rel="noreferrer">Complete analysis and original NASA URLs</a>.</p><p>“Vs usual” subtracts each place’s mean annual count over all 30 complete years in 1991–2020. A missing baseline year withholds the departure. This describes an individual year, not a trend test. Both the map and comparison chart use these same departures.</p></div></details></div>
    <p className="atlas-live-message sr-only" role="status" aria-live="polite">{message}</p>
  </div>
}
function AtlasPairChart({ a, b, metric, start, end, year, onYear, departures }: { a: AtlasPoint; b: AtlasPoint; metric: DailyMetric; start: number; end: number; year: number; onYear: (year: number) => void; departures: boolean }) {
  const width = 440, left = 34, right = 424, top = 20, bottom = 145
  const years = Array.from({ length: end - start + 1 }, (_, index) => start + index)
  const chartValue = (point: AtlasPoint, selected: number) => departures ? atlasDeparture(point, metric, selected) : atlasAnnualValue(point, metric, selected)
  const values = [a, b].flatMap(point => years.map(value => chartValue(point, value))).filter((value): value is number => value != null)
  const maximum = Math.max(1, Math.ceil(Math.max(0, ...values.map(Math.abs)) * 1.12))
  const minimum = departures ? -maximum : 0
  const x = (value: number) => left + (value - start) / Math.max(1, end - start) * (right - left)
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * (bottom - top)
  function path(point: AtlasPoint) {
    let open = false
    return years.map(value => { const count = chartValue(point, value); if (count == null) { open = false; return '' }; const segment = `${open ? 'L' : 'M'}${x(value)},${y(count)}`; open = true; return segment }).join(' ')
  }
  return <div className="atlas-pair-chart"><div className="atlas-chart-heading"><span>{departures ? 'Vs 1991–2020' : 'Annual counts'}</span><span><i className="a" />A <i className="b" />B · days</span></div><div tabIndex={0} role="group" aria-label="Annual comparison chart. Use left and right arrows, Home or End to select a year." onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); onYear(event.key === 'Home' ? start : event.key === 'End' ? end : Math.max(start, Math.min(end, year + (event.key === 'ArrowRight' ? 1 : -1)))) }}><svg viewBox={`0 0 ${width} 178`} role="img" aria-label={`${a.location.name} and ${b.location.name}, annual ${dailyMetrics.find(item => item.id === metric)!.title}, ${start} to ${end}, ${departures ? 'departures from the 1991–2020 mean' : 'counts'}, shared scale in days. Gaps are missing data.`} onPointerDown={event => { const bounds = event.currentTarget.getBoundingClientRect(); const value = (event.clientX - bounds.left) / bounds.width * width; onYear(Math.max(start, Math.min(end, Math.round(start + (value - left) / (right - left) * (end - start))))) }}>
      {[minimum, departures ? 0 : Math.round(maximum / 2), maximum].filter((value, index, items) => items.indexOf(value) === index).map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className={`atlas-chart-grid${departures && value === 0 ? ' atlas-chart-zero' : ''}`} /><text x={left - 7} y={y(value) + 4} textAnchor="end">{value}</text></g>)}
      <path d={path(a)} className="atlas-series a" /><path d={path(b)} className="atlas-series b" /><line className="atlas-chart-selection" x1={x(year)} x2={x(year)} y1={top} y2={bottom} />
      {([['a', a], ['b', b]] as const).map(([key, point]) => { const value = chartValue(point, year); return value == null ? <path key={key} d={`M${x(year) - 3},${bottom - 5}l6,6m-6,0l6,-6`} className={`atlas-series ${key}`} /> : <circle key={key} cx={x(year)} cy={y(value)} r="3.5" className={`atlas-chart-dot ${key}`}><title>{key.toUpperCase()} · {year}: {number(value, departures)} days{departures ? ' vs 1991–2020' : ''}</title></circle> })}
      {[start, Math.round((start + end) / 2), end].map(value => <text key={value} x={x(value)} y="168" textAnchor="middle">{value}</text>)}
    </svg></div></div>
}

