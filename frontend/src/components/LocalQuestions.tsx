import { useEffect, useId, useRef, useState } from 'react'
import { getCalendar } from '../lib/api'
import { calendarAmount, calendarCsv, calendarMonths } from '../lib/calendarData'
import { evidenceFor, formatRate, originLabel } from '../lib/evidence'
import type { Location } from '../lib/locations'
import type { CalendarPeriodId, CalendarResponse, CalendarSelection, CalendarView, Variable } from '../types/api'
import CalendarChart from './CalendarChart'
import Icon from './Icon'

export default function LocalQuestions({ location, variable, start, end, validPeriod, selection }: {
  location: Location
  variable: Variable
  start: number
  end: number
  validPeriod: boolean
  selection: CalendarSelection
}) {
  const [periodId, setPeriodId] = useState<CalendarPeriodId>(selection.period)
  const [view, setView] = useState<CalendarView>(selection.view)
  const [year, setYear] = useState(end)
  const [result, setResult] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [message, setMessage] = useState('')
  const refreshRequested = useRef(false)
  const yearId = useId()
  const temperature = variable === 'T2M'
  const displayView = temperature ? view : 'values'
  const matches = result?.latitude === location.lat && result.longitude === location.lon && result.variable === variable && result.start === start && result.end === end
  const current = matches && !loading && !error ? result : null
  const period = current?.periods.find(item => item.id === periodId)
  const selectedYear = Math.max(start, Math.min(end, year))
  const point = period?.points.find(item => item.year === selectedYear)
  const unit = temperature ? '°C' : 'mm'
  const analysis = period?.analysis
  const evidence = evidenceFor(analysis, 'yearly linear model')

  useEffect(() => { setPeriodId(selection.period); setView(selection.view); setYear(end) }, [selection])

  useEffect(() => {
    if (!validPeriod) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = window.setTimeout(async () => {
      const refresh = refreshRequested.current
      refreshRequested.current = false
      try {
        const response = await getCalendar({ lat: location.lat, lon: location.lon, variable, start, end }, refresh, controller.signal)
        if (!controller.signal.aborted) setResult(response)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'This investigation could not be loaded.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 350)
    return () => { clearTimeout(timer); controller.abort() }
  }, [location.lat, location.lon, variable, start, end, validPeriod, retry])

  function refresh() { refreshRequested.current = true; setRetry(value => value + 1) }

  function download() {
    if (!current || !period) return
    const url = URL.createObjectURL(new Blob([calendarCsv(current, period)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrasignal-calendar-${variable}-${period.id}-${location.lat}-${location.lon}-${start}-${end}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Calendar values downloaded with reference, aggregation and trend details.')
  }

  return <section className="local-questions" id="local-questions" aria-labelledby="local-heading" aria-busy={loading}>
    <h2 id="local-heading" className="sr-only">Calendar</h2>
    <p className="calendar-method">{location.name} · {start || '—'}–{end || '—'} · {temperature ? 'Reference: 1991–2020' : 'Precipitation totals from monthly rates'}</p>
    {!validPeriod ? <p className="form-error" role="status">Choose a valid period above to explore years and seasons.</p>
      : error ? <div className="calendar-error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={refresh}>Try again <Icon name="refresh" /></button></div>
      : <>
        <div className="calendar-controls">
          <div className="segmented calendar-seasons" aria-label="Year or calendar season">{[
            ['year', 'Whole year'], ['djf', 'Dec–Feb'], ['mam', 'Mar–May'], ['jja', 'Jun–Aug'], ['son', 'Sep–Nov'],
          ].map(([id, label]) => <button type="button" key={id} aria-pressed={periodId === id} onClick={() => setPeriodId(id as CalendarPeriodId)}>{label}</button>)}</div>
          {temperature && <div className="segmented calendar-view" aria-label="Temperature view"><button type="button" aria-pressed={view === 'anomaly'} onClick={() => setView('anomaly')}>Departure</button><button type="button" aria-pressed={view === 'values'} onClick={() => setView('values')}>Temperature</button></div>}
        </div>
        <div className="calendar-workspace">
          <div className="calendar-plot-panel"><div className="calendar-plot-heading"><h3>{period?.label ?? 'Selected period'}</h3><span>{unit}</span></div>
            {period ? <CalendarChart period={period} view={displayView} unit={unit} selectedYear={selectedYear} onSelect={setYear} /> : <div className="calendar-loading" role="status">Loading the monthly record{temperature ? ' and fixed reference' : ''}…</div>}
            <div className="calendar-months" aria-label="Select a calendar month">{calendarMonths.map((month, index) => {
              const id = `m${String(index + 1).padStart(2, '0')}` as CalendarPeriodId
              return <button type="button" key={month} aria-pressed={periodId === id} onClick={() => setPeriodId(id)}>{month}</button>
            })}</div>
            <p className="calendar-convention">{periodId === 'djf' ? 'DJF uses December of the previous year and January–February of the labelled year.' : 'Calendar periods use complete months only. An incomplete year or season stays a gap.'} {temperature ? 'Temperature means are weighted by the actual number of days.' : 'Monthly mm/day × actual days in that month, summed to mm. Leap days are included.'}</p>
          </div>
          <div className="calendar-year-panel"><label className="year-slider-label" htmlFor={yearId}>Choose a year <strong>{validPeriod ? selectedYear : '—'}</strong></label><input id={yearId} type="range" min={start} max={end} step="1" value={selectedYear} disabled={!period || start === end} onChange={event => setYear(Number(event.target.value))} />
            <div className="year-slider-ends"><span>{start}</span><span>{end}</span></div>
            <div className="selected-year-record" aria-live="polite"><p className="overline">{period?.label ?? 'Selected period'} · {selectedYear}</p><h3>{temperature ? 'Temperature departure' : 'Precipitation total'}</h3><strong className="year-metric">{calendarAmount(temperature ? point?.anomaly : point?.value, temperature)}<span>{unit}</span></strong>
              {temperature && <dl><div><dt>Observed mean</dt><dd>{calendarAmount(point?.value)} °C</dd></div><div><dt>1991–2020 reference</dt><dd>{calendarAmount(point?.baseline_value)} °C</dd></div></dl>}
              <p>{!point ? 'Loading this year…' : point.value === null ? `Incomplete record: ${point.available_months} of ${point.expected_months} months available. No partial value is substituted.` : temperature && point.anomaly === null ? 'The complete 30-year reference is unavailable for one or more selected months. The observed mean is still available.' : temperature ? 'Each calendar month is compared with the same month in 1991–2020, then weighted for this year’s selected months. Displayed values are rounded; exports retain full precision.' : `${point.available_months} complete months. This is a water-equivalent total, not a count of wet days or the length of a dry spell.`}</p>
            </div>
          </div>
        </div>
        {period && <div className="calendar-trend-panel"><div className="calendar-trend-summary"><p className="overline">Trend across {start}–{end}</p><h3>{period.label} · {temperature ? 'temperature' : 'precipitation total'}</h3><p>{period.points.filter(p => p.value !== null).length} / {period.points.length} complete years or seasons</p>
          <p className="calendar-method">{analysis?.method ?? 'Not enough complete years to estimate this trend'}. The selected year highlights an observation; it does not refit the trend.</p></div>
          <div className="calendar-trend-results"><div className="metrics"><div className="metric"><p>Change / decade</p><strong>{analysis ? formatRate(analysis.slope_per_decade) : '—'}<span>{unit}</span></strong></div><div className="metric"><p>95% confidence interval</p><strong className="interval">{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(formatRate).join(' to ') : '—'}</strong><span className="metric-unit">{unit} / decade</span></div></div>
            <div className="evidence"><div className="evidence-heading"><span className={`evidence-badge ${evidence.state}`}>{evidence.label}</span><span>{analysis?.p_value != null ? `p ${analysis.p_value < 0.001 ? '< 0.001' : `= ${analysis.p_value.toPrecision(3)}`}` : 'p unavailable'}</span></div><p>{evidence.conclusion}</p></div>
          </div></div>}
        {period && <p className="calendar-comparison-note">These are exploratory tests without an adjustment for testing many months or periods. Different fitted rates alone do not establish a significant difference between seasons.</p>}
        <details className="calendar-notes"><summary>Reference, method & data notes <Icon name="chevron" /></summary><div>
          {temperature && <p>The reference stays fixed at 1991–2020 even when the analysis period is shortened. All 30 observations are required separately for each reference month. The trend uses complete yearly temperature means for the selected calendar period.</p>}
          <p>Calendar periods are labelled by months, so the same selection works in either hemisphere. Trying many months or periods can produce chance findings. These are exploratory single-trend tests, without a multiple-comparison correction.</p>
          {current?.warnings.map((warning, index) => <p key={`source-${index}`}>{warning}</p>)}{period?.warnings.map((warning, index) => <p key={`period-${index}`}>{warning}</p>)}
        </div></details>
        <div className="calendar-footer"><span>{current ? `${originLabel(current.data_origin)} · retrieved ${new Date(current.retrieved_at).toLocaleString()}` : 'Loading source details…'}</span><div><button type="button" className="secondary-button" disabled={!current || !period} onClick={download}>Download this view <Icon name="download" /></button><button type="button" className="icon-button" disabled={loading} aria-label="Refresh local investigation from NASA" onClick={refresh}><Icon name="refresh" /></button>{current && <a className="icon-button" href={current.source_url} target="_blank" rel="noreferrer" aria-label="Open NASA source for local investigation"><Icon name="external" /></a>}</div></div>
      </>}
    <p className="calendar-resolution"><Icon name="info" />NASA POWER meteorology represents an approximately 0.5° × 0.625° model grid cell: the surrounding area, rather than an individual street. The Daily weather tab calculates hot days, frost days, warm-night proxies and dry runs from daily NASA records.</p>
    <span className="sr-only" role="status">{message}</span>
  </section>
}
