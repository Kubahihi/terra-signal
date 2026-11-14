import { useEffect, useId, useState } from 'react'
import { dailyMetrics } from '../lib/dailyData'
import { dailyComparisonCsv, dailyComparisonRows, sameLocation, sharedDailyMaximum } from '../lib/dailyComparison'
import { dailyEvidence, dailyFit, formatDailyP } from '../lib/dailyTrends'
import { formatRate, originLabel } from '../lib/evidence'
import { coordinates, exampleLocations, type Location } from '../lib/locations'
import { useDailyRecord, type DailyRecordState } from '../lib/useDailyRecord'
import type { DailyMetric } from '../types/api'
import { YearBarChart } from './CalendarChart'
import Icon from './Icon'

type Props = {
  enabled: boolean; onToggle: () => void; onChooseMapPoint: (point: 'a' | 'b') => void
  location: Location; comparisonLocation: Location; onSelect: (location: Location) => void
  primary: DailyRecordState; metric: DailyMetric; onMetric: (metric: DailyMetric) => void
  year: number; onYear: (year: number) => void; start: number; end: number; validPeriod: boolean
}

export default function DailyComparison(props: Props) {
  const selector = useId()
  return <section className="daily-place-comparison" id="daily-place-comparison" aria-labelledby="daily-comparison-heading">
    <div className="support-section-heading"><div><p className="overline">Daily indices · two map points</p><h2 id="daily-comparison-heading">The same question. Another place.</h2><p>Mark A and B on the map to compare daily extremes over the same period.</p></div><button type="button" className="secondary-button" onClick={props.onToggle} aria-expanded={props.enabled} aria-controls="daily-comparison-content">{props.enabled ? 'Hide daily comparison' : 'Compare daily places'}<Icon name="chevron" /></button></div>
    {props.enabled && <div id="daily-comparison-content">
      <div className="daily-comparison-picker"><div><span className="comparison-point-key">A</span><div><strong>{props.location.name}</strong><p>{coordinates(props.location.lat, props.location.lon)}</p></div><button type="button" className="text-button" onClick={() => props.onChooseMapPoint('a')}>Choose A on map <Icon name="pin" /></button></div><div><span className="comparison-point-key point-b">B</span><div><strong>{props.comparisonLocation.name}</strong><p>{coordinates(props.comparisonLocation.lat, props.comparisonLocation.lon)}</p></div><button type="button" className="text-button" onClick={() => props.onChooseMapPoint('b')}>Choose B on map <Icon name="pin" /></button></div></div>
      <details className="daily-comparison-examples"><summary>Or choose a comparison example <Icon name="chevron" /></summary><label htmlFor={selector}>Point B</label><select id={selector} value={props.comparisonLocation.id ?? 'custom'} onChange={event => { const next = exampleLocations.find(item => item.id === event.target.value); if (next) props.onSelect(next) }}><option value="custom" disabled>Clicked map point</option>{exampleLocations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></details>
      {!props.validPeriod ? <p className="form-error">Choose a valid period above to compare locations.</p>
        : sameLocation(props.location, props.comparisonLocation) ? <p className="comparison-hint" role="status">A and B are the same point. Choose B on the map and click a different place.</p>
        : <ComparisonBody {...props} />}
    </div>}
  </section>
}

function ComparisonBody({ location, comparisonLocation, primary, metric, onMetric, year, onYear, start, end }: Props) {
  const secondary = useDailyRecord({ lat: comparisonLocation.lat, lon: comparisonLocation.lon, start, end }, true, true)
  const slider = useId()
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!primary.current && !primary.busy) primary.load()
  }, [location.lat, location.lon, start, end])
  useEffect(() => setMessage(''), [location.lat, location.lon, comparisonLocation.lat, comparisonLocation.lon, start, end])
  const maximum = sharedDailyMaximum(metric, [{ data: primary.current, trends: primary.trends }, { data: secondary.current, trends: secondary.trends }])
  const ready = !!primary.current?.sources.length && !!secondary.current?.sources.length
  const definition = dailyMetrics.find(item => item.id === metric)!

  function download() {
    if (!primary.current || !secondary.current) return
    const csv = dailyComparisonCsv({ location, data: primary.current, trends: primary.trends }, { location: comparisonLocation, data: secondary.current, trends: secondary.trends })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrasignal-daily-comparison-${location.lat}-${location.lon}-vs-${comparisonLocation.lat}-${comparisonLocation.lon}-${start}-${end}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Comparison downloaded with both locations, annual values, trends, coverage and source details.')
  }

  return <>
    <div className="daily-comparison-toolbar"><div className="segmented" aria-label="Compared daily index">{dailyMetrics.map(item => <button type="button" key={item.id} aria-pressed={metric === item.id} onClick={() => onMetric(item.id)}>{item.title}</button>)}</div><span>{start}–{end} · shared chart scale · days</span></div>
    <div className="daily-comparison-year"><label htmlFor={slider}>Comparison year <strong>{year}</strong></label><input id={slider} type="range" min={start} max={end} value={year} step="1" disabled={start === end} onChange={event => onYear(Number(event.target.value))} /><span>{start}–{end}</span></div>
    <p className="daily-comparison-rule">{definition.rule}. The selected year changes the counts below; trends use the full requested period.</p>
    <div className="daily-comparison-grid"><PointCard label="A" location={location} record={primary} metric={metric} year={year} onYear={onYear} start={start} end={end} maximum={maximum} /><PointCard label="B" location={comparisonLocation} record={secondary} metric={metric} year={year} onYear={onYear} start={start} end={end} maximum={maximum} /></div>
    {ready && <div className="daily-comparison-table-wrap"><table className="daily-comparison-table"><caption>All four exact annual indices · {year} · days</caption><thead><tr><th scope="col">Index</th><th scope="col">Point A</th><th scope="col">Point B</th><th scope="col">A − B</th></tr></thead><tbody>{dailyComparisonRows(primary.current, secondary.current, year).map(row => <tr key={row.id}><th scope="row">{row.title}</th><td>{row.left?.value ?? '—'}</td><td>{row.right?.value ?? '—'}</td><td>{row.difference == null ? '—' : row.difference.toLocaleString('en', { signDisplay: 'exceptZero' })}</td></tr>)}</tbody></table><p>Only complete annual values enter A − B. This arithmetic difference is descriptive.</p></div>}
    <p className="daily-comparison-caution">Trends are tested against zero separately at each place, with Holm correction across four indices per point. Significance at A and an unresolved trend at B do not establish that their slopes differ. Check both fitted spans and coverage. These are surrounding NASA grid cells; nearby points may share a cell. Warm nights use daily minima as a proxy, and dry runs are clipped to each calendar year.</p>
    <div className="daily-comparison-footer"><button type="button" className="secondary-button" disabled={!ready || primary.trendLoading || secondary.trendLoading} onClick={download}>Download comparison CSV <Icon name="download" /></button><span>{ready ? `${location.name} ↔ ${comparisonLocation.name}` : 'Received records stay visible while the other point loads.'}</span></div>
    <span className="sr-only" role="status">{message}</span>
  </>
}

function PointCard({ label, location, record, metric, year, onYear, start, end, maximum }: {
  label: 'A' | 'B'; location: Location; record: DailyRecordState; metric: DailyMetric
  year: number; onYear: (year: number) => void; start: number; end: number; maximum: number
}) {
  const { current: data, trends } = record
  const definition = dailyMetrics.find(item => item.id === metric)!
  const annual = data?.years.find(row => row.year === year)
  const count = annual?.[metric]
  const result = trends?.metrics[metric]
  const analysis = result?.analysis
  const evidence = dailyEvidence(metric, result)
  return <article className={`daily-comparison-card point-${label.toLowerCase()}`} aria-label={`Daily comparison point ${label}`} aria-busy={record.busy}>
    <div className="daily-comparison-card-heading"><span className={`comparison-point-key ${label === 'B' ? 'point-b' : ''}`}>{label}</span><div><h3>{location.name}</h3><p>{coordinates(location.lat, location.lon)}</p></div></div>
    {record.busy ? <div className="daily-comparison-loading" role="status"><p>Loading daily records · {record.progress.years} / {end - start + 1} years received</p><progress value={record.progress.completed} max={record.progress.total || 1} aria-label={`Point ${label} download progress`} /><button type="button" className="text-button" onClick={record.stop}>Stop loading point {label}</button></div>
      : !data?.sources.length ? <div className="daily-comparison-loading"><p>{record.error || data?.failures[0]?.message || 'Daily records are not loaded for this point.'}</p><button type="button" className="secondary-button" onClick={() => record.load()}>Load point {label} data <Icon name="refresh" /></button></div>
      : <>
        <div className="daily-comparison-count"><div><span>{definition.title} · {year}</span><strong>{count?.value ?? '—'}<small>days</small></strong></div><p>{count && annual ? `${count.available_days} / ${annual.expected_days} valid days` : 'No daily response for this year'}{count?.value === null && count.available_days > 0 && <><br />Observed {metric === 'longest_dry_spell' ? 'run' : 'count'}: {count.observed_count} days · lower bound</>}</p></div>
        <YearBarChart points={Array.from({ length: end - start + 1 }, (_, i) => ({ year: start + i, value: data.years.find(row => row.year === start + i)?.[metric].value ?? null }))} label={`Point ${label} · ${definition.title}`} unit="days" selectedYear={year} onSelect={onYear} fit={dailyFit(result)} scaleMaximum={maximum} caption="Both charts share the same vertical scale. Crosses mark incomplete or unavailable years." />
        <div className="daily-comparison-trend"><p className="overline">Trend · {start}–{end}</p>{record.trendLoading ? <p role="status">Estimating the annual trend…</p> : record.trendError ? <div role="alert"><p>{record.trendError}</p><button type="button" className="text-button" onClick={record.retryTrends}>Retry point {label} trend</button></div> : <>
          <div className="daily-comparison-statistics"><div><span>Change / decade</span><strong>{analysis ? formatRate(analysis.slope_per_decade) : '—'}<small>days</small></strong></div><div><span>Individual 95% interval</span><strong>{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(formatRate).join(' to ') : '—'}</strong><small>days / decade</small></div></div>
          <div className="daily-comparison-evidence"><span className={`evidence-badge ${evidence.state}`}>{evidence.label}</span><span>Holm p {formatDailyP(analysis?.p_value_holm)}</span></div><p>{evidence.conclusion}</p><p>{result?.complete_years ?? '—'} / {end - start + 1} complete annual values{result?.first_year != null ? ` · fitted span ${result.first_year}–${result.last_year}` : ''}. {analysis?.method ?? 'At least 20 complete years and 80% coverage are required.'}</p>{result?.warnings.map((note, i) => <p className="daily-comparison-warning" key={i}>{note}</p>)}
        </>}</div>
        {data.failures.length > 0 && <div className="daily-comparison-warning" role="alert"><p>{data.failures.length} batches unavailable; those years stay gaps.</p><button type="button" className="text-button" onClick={() => record.load()}>Retry point {label} missing batches</button></div>}
      </>}
    {data && <details className="daily-comparison-sources"><summary>Point {label} sources & coverage <Icon name="chevron" /></summary><div>{data.warnings.map((warning, i) => <p key={i}>{warning}</p>)}{data.failures.map(item => <p key={item.start}>{item.start}–{item.end}: {item.message}</p>)}{trends?.warnings.map((warning, i) => <p key={`trend-${i}`}>{warning}</p>)}<ul>{data.sources.map(source => <li key={source.start}><a href={source.source_url} target="_blank" rel="noreferrer">NASA daily {source.start}–{source.end} <Icon name="external" /></a><span>{originLabel(source.data_origin)} · retrieved {new Date(source.retrieved_at).toLocaleString()}</span></li>)}</ul></div></details>}
    {data?.sources.length ? <button type="button" className="text-button daily-comparison-refresh" disabled={record.busy} onClick={() => record.load(true)}>Refresh point {label} from NASA <Icon name="refresh" /></button> : null}
  </article>
}
