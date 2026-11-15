import { useEffect, useId, useMemo, useState } from 'react'
import type { Location } from '../lib/locations'
import type { DailyRecordState } from '../lib/useDailyRecord'
import { compoundAnnualCsv, compoundObservationsCsv, compoundYears } from '../lib/compoundData'
import { originLabel } from '../lib/evidence'
import { YearBarChart } from './CalendarChart'
import Icon from './Icon'
import './CompoundWeather.css'

export default function CompoundWeather({ location, start, end, validPeriod, record }: {
  location: Location; start: number; end: number; validPeriod: boolean; record: DailyRecordState
}) {
  const [year, setYear] = useState(end)
  const [message, setMessage] = useState('')
  const slider = useId()
  const { busy, error, progress, load, stop } = record
  const data = record.current?.lat === location.lat && record.current.lon === location.lon && record.current.start === start && record.current.end === end ? record.current : null
  const rows = useMemo(() => data && validPeriod ? compoundYears(data) : [], [data, validPeriod])
  const selectedYear = Math.max(start, Math.min(end, year))
  const selected = rows.find(row => row.year === selectedYear)
  const complete = rows.filter(row => row.value !== null)
  const hasData = !!data?.sources.length

  useEffect(() => { setYear(end); setMessage('') }, [location.lat, location.lon, start, end])

  function download(kind: 'annual' | 'daily') {
    if (!data) return
    const csv = kind === 'annual' ? compoundAnnualCsv(data) : compoundObservationsCsv(data)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrasignal-hot-dry-${kind}-${location.lat}-${location.lon}-${start}-${end}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(`${kind === 'annual' ? 'Annual compound counts' : 'Paired daily observations'} downloaded with thresholds, coverage and NASA source details.`)
  }

  return <section className="compound-weather" aria-labelledby="compound-heading" aria-busy={busy}>
    <div className="compound-intro"><div><p className="overline">Two conditions. The same day.</p><h2 id="compound-heading">When heat and little rain coincide.</h2><p>Count days with a maximum temperature above 30 °C and less than 1 mm of precipitation at {location.name}.</p></div><span className="compound-rule">Tmax &gt; 30 °C <span>and</span> P &lt; 1 mm/day</span></div>
    {!validPeriod ? <p className="form-error">Choose a valid period to investigate hot and dry days.</p> : <>
      {busy ? <div className="daily-loading" role="status"><div><strong>Loading paired daily observations…</strong><span>{progress.years} / {end - start + 1} years received</span></div><progress value={progress.completed} max={progress.total || 1} aria-label="Compound weather download progress" /><p>The daily record is shared with Daily weather. Stop loading or change the selected place at any time.</p><button type="button" className="secondary-button" onClick={stop}>Stop loading</button></div>
        : !hasData && <div className="daily-intro"><Icon name="sun" /><div><h3>Look for overlapping conditions.</h3><p>{record.changed ? 'The place or period changed. Load its daily record to count both conditions together.' : 'Load the selected NASA daily record. If you already loaded it in Daily weather, the same observations are reused here.'}</p><button type="button" className="secondary-button" onClick={() => load()}>Load hot and dry days <Icon name="arrow" /></button></div></div>}
      {!busy && error && <p className="form-error" role="alert">{error}</p>}
      {!busy && data && data.failures.length > 0 && <div className="daily-failures" role="alert"><strong>{data.failures.length} daily {data.failures.length === 1 ? 'batch is' : 'batches are'} unavailable.</strong><p>Received days are retained. Missing paired observations cannot become hot-and-dry events or complete annual counts.</p><details><summary>Unavailable periods</summary>{data.failures.map(item => <p key={item.start}>{item.start}–{item.end}: {item.message}</p>)}</details><button type="button" className="secondary-button" onClick={() => load()}>Retry missing batches <Icon name="refresh" /></button></div>}
      {hasData && <>
        <div className="compound-workspace"><div className="compound-plot-panel"><p className="overline">Annual overlapping events</p><h3>How often do hot and dry days occur together?</h3><p className="compound-coverage">{complete.length} / {rows.length} complete years · {start}–{end}</p><YearBarChart points={rows.map(row => ({ year: row.year, value: row.value }))} label="Hot and dry days per calendar year" unit="days" selectedYear={selectedYear} onSelect={setYear} caption="Only exact annual counts are plotted. Crosses mark incomplete or unavailable years, including years with observed lower bounds." /><p className="compound-explanation">These counts describe simultaneous conditions. No significance test is applied to this compound index.</p></div>
          <div className="compound-year-panel"><label className="year-slider-label" htmlFor={slider}>Hot and dry days in <strong>{selectedYear}</strong></label><input id={slider} type="range" min={start} max={end} value={selectedYear} disabled={start === end} onChange={event => setYear(Number(event.target.value))} /><div className="year-slider-ends"><span>{start}</span><span>{end}</span></div>
            <div className="compound-count" aria-live="polite"><span>{selected?.value !== null && selected?.value !== undefined ? 'Exact annual count' : selected?.available_days ? 'Incomplete annual count' : 'No paired observations'}</span><strong>{selected?.value ?? '—'}<small>days</small></strong>{selected?.value === null && selected.available_days > 0 && <p>At least <b>{selected.observed_count}</b> observed hot and dry {selected.observed_count === 1 ? 'day' : 'days'}. The full-year count is unknown.</p>}<p>{selected?.available_days ?? 0} / {selected?.expected_days ?? '—'} days have both observations.</p></div>
            <div className="compound-observed-stats"><div><span>Share of observed paired days</span><strong>{selected?.available_days ? `${(100 * selected.observed_count / selected.available_days).toFixed(1)}%` : '—'}</strong></div><div><span>Hot days among paired days</span><strong>{selected?.available_days ? selected.hot_on_paired_days : '—'}</strong></div><div><span>Dry days among paired days</span><strong>{selected?.available_days ? selected.dry_on_paired_days : '—'}</strong></div></div><p className="compound-explanation">A day is usable only when both Tmax and precipitation are available. Partial counts are lower bounds and are never scaled up to a whole year.</p>
          </div></div>
        <div className="compound-definition"><Icon name="info" /><p>“Dry” here means less than 1 mm of precipitation on that day. It does not measure soil drought, vegetation stress or the duration of a dry spell. NASA POWER describes a model grid cell, with days in Local Solar Time.</p></div>
        <details className="daily-sources"><summary>Paired data, coverage & sources <Icon name="chevron" /></summary><div><p>Thresholds are strict: 30 °C is not a hot day and 1 mm/day is not a dry day. An exact count requires both observations on every one of the year's 365 or 366 calendar days.</p>{data.warnings.map((warning, index) => <p key={index}>{warning}</p>)}<ul>{data.sources.map(source => <li key={`${source.start}-${source.end}`}><a href={source.source_url} target="_blank" rel="noreferrer">NASA daily response {source.start}–{source.end} <Icon name="external" /></a><span>{originLabel(source.data_origin)} · retrieved {new Date(source.retrieved_at).toLocaleString()}</span></li>)}</ul></div></details>
        <div className="daily-footer"><div><button type="button" className="secondary-button" onClick={() => download('annual')}>Download compound counts <Icon name="download" /></button><button type="button" className="secondary-button" onClick={() => download('daily')}>Download paired daily data <Icon name="download" /></button></div><button type="button" className="text-button" onClick={() => load(true)}>Refresh daily data <Icon name="refresh" /></button></div>
      </>}
    </>}
    <span className="sr-only" role="status">{message}</span>
  </section>
}
