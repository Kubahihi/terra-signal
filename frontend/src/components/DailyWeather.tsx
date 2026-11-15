import { useEffect, useId, useState } from 'react'
import { dailyAnnualCsv, dailyMetrics, dailyObservationsCsv } from '../lib/dailyData'
import { dailyFit, dailyTrendsCsv } from '../lib/dailyTrends'
import type { DailyRecordState } from '../lib/useDailyRecord'
import { originLabel } from '../lib/evidence'
import type { Location } from '../lib/locations'
import type { DailyMetric, DailySelection } from '../types/api'
import { YearBarChart } from './CalendarChart'
import DailyTrendPanel from './DailyTrendPanel'
import DailyPeriodSensitivity from './DailyPeriodSensitivity'
import Icon from './Icon'

const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function DailyWeather({ location, start, end, validPeriod, selection, record, metric, onMetric: setMetric, year, onYear: setYear }: {
  location: Location; start: number; end: number; validPeriod: boolean; selection: DailySelection
  record: DailyRecordState; metric: DailyMetric; onMetric: (metric: DailyMetric) => void
  year: number; onYear: (year: number) => void
}) {
  const [message, setMessage] = useState('')
  const { current, busy, error: fatalError, progress, trends, trendLoading, trendError, load, stop, retryTrends, changed } = record
  const sliderId = useId()
  const selectedYear = Math.max(start, Math.min(end, year))
  const selected = current?.years.find(item => item.year === selectedYear)
  const selectedMetric = dailyMetrics.find(item => item.id === metric)!
  const fit = dailyFit(trends?.metrics[metric])

  useEffect(() => {
    setMetric(selection.metric)
    setYear(Math.max(start, Math.min(end, selection.year ?? end)))
    if (selection.autoLoad) load()
  }, [selection])
  useEffect(() => setMessage(''), [location.lat, location.lon, start, end])

  function download(kind: 'indices' | 'observations' | 'trends') {
    if (!current) return
    if (kind === 'trends' && !trends) return
    const csv = kind === 'observations' ? dailyObservationsCsv(current) : kind === 'trends' ? dailyTrendsCsv(current, trends!) : dailyAnnualCsv(current)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrasignal-daily-${kind}-${location.lat}-${location.lon}-${start}-${end}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(`${kind === 'observations' ? 'Daily observations' : kind === 'trends' ? 'Daily index trends' : 'Annual daily indices'} downloaded with thresholds, coverage and source details.`)
  }

  const hasData = current && current.sources.length > 0
  const spell = selected?.longest_dry_spell
  return <section className="daily-weather" id="daily-extremes" aria-labelledby="daily-heading" aria-busy={busy}>
    <h2 id="daily-heading" className="sr-only">Daily weather</h2>
    <p className="daily-record-summary">{location.name} · {start || '—'}–{end || '—'}</p>
    {!validPeriod ? <p className="form-error">Choose a valid period above to load daily records.</p> : <>
      {busy ? <div className="daily-loading" role="status"><div><strong>Loading daily records…</strong><span>{progress.years} / {end - start + 1} years received</span></div><progress value={progress.completed} max={progress.total || 1} aria-label="Daily download progress" /><p>Daily records are downloaded in cached five-year batches. You can stop loading or change the selected place.</p><button type="button" className="secondary-button" onClick={stop}>Stop loading</button></div>
        : !hasData && <div className="daily-intro"><Icon name="globe" /><div><p>{changed ? 'The place or period changed. Load its daily record.' : 'Load hot days, frost days, warm-night proxies and dry spells for this place.'}</p><button type="button" className="secondary-button" onClick={() => load()}>Load daily data <Icon name="arrow" /></button></div></div>}
      {!busy && fatalError && <p className="form-error" role="alert">{fatalError}</p>}
      {!busy && current && current.failures.length > 0 && <div className="daily-failures" role="alert"><strong>{current.failures.length} daily {current.failures.length === 1 ? 'batch is' : 'batches are'} unavailable.</strong><p>Received records are retained. Unavailable years remain gaps and are never replaced by monthly data.</p><details><summary>Show unavailable periods</summary>{current.failures.map(item => <p key={item.start}>{item.start}–{item.end}: {item.message}</p>)}</details><button type="button" className="secondary-button" onClick={() => load()}>Retry missing batches <Icon name="refresh" /></button></div>}
      {hasData && <>
        <div className="daily-workspace"><div className="daily-plot-panel"><p className="daily-record-summary">{selectedMetric.rule} · {current.years.length} / {end - start + 1} years received</p>
          <YearBarChart points={Array.from({ length: end - start + 1 }, (_, index) => {
            const year = start + index
            return { year, value: current.years.find(item => item.year === year)?.[metric].value ?? null }
          })} label={`${selectedMetric.title} per calendar year`} unit="days" selectedYear={selectedYear} onSelect={setYear} fit={fit}
            caption="Select a bar or use the year slider. Only complete annual indices are plotted. Crosses mark incomplete or unavailable years, not zero days." />
          <p className="daily-quality-note">Exact annual values require every relevant day in that year. Observed counts or runs from incomplete records are lower bounds; they are not extrapolated. {fit ? 'The dashed line is the linear fit across complete annual values. Its significance is reported below.' : 'Trend estimates and data requirements are shown below.'}</p>
        </div><div className="daily-year-panel"><label className="year-slider-label" htmlFor={sliderId}>Daily indices for year <strong>{selectedYear}</strong></label><input id={sliderId} type="range" min={start} max={end} step="1" value={selectedYear} disabled={start === end} onChange={event => setYear(Number(event.target.value))} /><div className="year-slider-ends"><span>{start}</span><span>{end}</span></div>
          <div className="daily-metric-grid">{dailyMetrics.map(item => {
            const count = selected?.[item.id]
            return <button type="button" key={item.id} className="daily-metric-card" aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}>
              <span className="daily-metric-title">{item.title}</span><strong>{count?.value == null ? '—' : count.value}<span>{count?.value === 1 ? 'day' : 'days'}</span></strong><span className="daily-rule">{item.rule}</span>
              <span className="daily-coverage">{count && selected ? `${count.available_days} / ${selected.expected_days} valid days` : 'No daily response for this year'}</span>
              {count?.value === null && count.available_days > 0 && <span className="daily-lower-bound">{item.id === 'longest_dry_spell' ? 'Longest observed run' : 'Observed count'}: {count.observed_count} days · incomplete year</span>}
            </button>
          })}</div>
          <div className="daily-spell-detail" aria-live="polite"><strong>Longest {spell?.value === null ? 'observed ' : ''}dry run in {selectedYear}</strong><p>{!spell ? 'No daily precipitation response for this year.' : spell.start_date && spell.end_date ? `${dayLabel(spell.start_date)}–${dayLabel(spell.end_date)} · ${spell.observed_count} consecutive days with less than 1 mm/day.` : spell.available_days === 0 ? 'No valid daily precipitation observations.' : 'No dry run was found among the available days.'}</p>{spell?.touches_year_boundary && <p>The run touches a year boundary and may continue into an adjacent year.</p>}<p>Runs are clipped to each calendar year. Missing days interrupt a run; on ties, the earliest observed run is shown.</p></div>
        </div></div>
        <DailyTrendPanel result={trends} metric={metric} locationName={location.name} start={start} end={end} loading={trendLoading} error={trendError} onRetry={retryTrends} onSelect={setMetric} />
        <DailyPeriodSensitivity data={current} metric={metric} locationName={location.name} />
        <p className="daily-definition-note">Warm-night counts use the daily minimum as a proxy, not nighttime-only hourly measurements. All three variables use NASA Local Solar Time (LST), which differs from civil time and daylight saving time.</p>
        <details className="daily-sources"><summary>Daily sources, coverage & method notes <Icon name="chevron" /></summary><div>{current.warnings.map((warning, index) => <p key={index}>{warning}</p>)}<ul>{current.sources.map(source => <li key={`${source.start}-${source.end}`}><a href={source.source_url} target="_blank" rel="noreferrer">NASA daily response {source.start}–{source.end} <Icon name="external" /></a><span>{originLabel(source.data_origin)} · retrieved {new Date(source.retrieved_at).toLocaleString()}</span></li>)}</ul></div></details>
        <div className="daily-footer"><div><button className="secondary-button" type="button" onClick={() => download('indices')}>Download annual indices <Icon name="download" /></button><button className="secondary-button" type="button" onClick={() => download('observations')}>Download daily observations <Icon name="download" /></button><button className="secondary-button" type="button" disabled={!trends || trendLoading || !!trendError} onClick={() => download('trends')}>Download trends <Icon name="download" /></button></div><button type="button" className="text-button" onClick={() => load(true)}>Refresh daily data from NASA <Icon name="refresh" /></button></div>
      </>}
    </>}
    <span className="sr-only" role="status">{message}</span>
  </section>
}
