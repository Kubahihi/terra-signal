import { useEffect, useState } from 'react'
import { getDailyPeriods } from '../lib/api'
import { dailyMetrics } from '../lib/dailyData'
import { dailyPeriodsCsv, matchesDailyPeriods, periodEvidence } from '../lib/dailyPeriods'
import { formatDailyP } from '../lib/dailyTrends'
import { formatRate } from '../lib/evidence'
import type { DailyDataset, DailyMetric, DailyPeriodsResponse } from '../types/api'
import Icon from './Icon'

export default function DailyPeriodSensitivity({ data, metric, locationName, compact = false }: {
  data: DailyDataset; metric: DailyMetric; locationName: string; compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState<{ data: DailyDataset; result: DailyPeriodsResponse } | null>(null)
  const [status, setStatus] = useState<{ data: DailyDataset | null; busy: boolean; error: string }>({ data: null, busy: false, error: '' })
  const [retry, setRetry] = useState(0)
  const [message, setMessage] = useState('')
  const busy = status.data === data && status.busy
  const error = status.data === data ? status.error : ''
  const result = reply?.data === data && !busy && !error ? reply.result : null
  const definition = dailyMetrics.find(item => item.id === metric)!

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setStatus({ data, busy: true, error: '' })
    setMessage('')
    getDailyPeriods(data, controller.signal).then(response => {
      if (!matchesDailyPeriods(data, response)) throw new Error('Period results do not match this point, record or predefined windows.')
      if (!controller.signal.aborted) setReply({ data, result: response })
    }).catch(cause => {
      if (!controller.signal.aborted) setStatus({ data, busy: false, error: cause instanceof Error ? cause.message : 'Period analysis could not be loaded.' })
    }).finally(() => { if (!controller.signal.aborted) setStatus(previous => ({ ...previous, busy: false })) })
    return () => controller.abort()
  }, [open, data, retry])

  function download() {
    if (!result) return
    const url = URL.createObjectURL(new Blob([dailyPeriodsCsv(data, result)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `terrasignal-daily-periods-${data.lat}-${data.lon}-${data.start}-${data.end}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('All period/index results downloaded with coverage, correction and source details.')
  }

  return <details className={`daily-period-sensitivity${compact ? ' compact' : ''}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Compare fitted periods <Icon name="chevron" /></summary>
    <div className="daily-period-content" aria-busy={busy}>
      <p>{locationName} · {definition.title}. The full record and available starts in 1991 and 2001 share an end year.</p>
      {busy ? <p role="status">Comparing predefined periods…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Retry period analysis <Icon name="refresh" /></button></div> : result && <>
        <p className="daily-period-family">Holm correction across {result.family_size} tests: four indices × {result.periods.length} {result.periods.length === 1 ? 'period' : 'periods'} at this point. Main-chart badges use a separate four-index family.</p>
        <div className="daily-period-cards">{result.periods.map(period => {
          const value = period.metrics[metric]
          const analysis = value.analysis
          const evidence = periodEvidence(value)
          return <article className="daily-period-card" key={period.start} aria-label={`Period ${period.start}–${period.end}`}>
            <h4>{period.start}–{period.end}</h4><p>{value.complete_years} / {value.expected_years} complete years</p>
            <strong className="daily-period-rate">{analysis ? formatRate(analysis.slope_per_decade) : '—'}<small>days / decade</small></strong>
            <p>Individual 95% interval</p><strong className="daily-period-interval">{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(formatRate).join(' to ') : '—'}</strong><p>days / decade</p>
            <span className={`evidence-badge ${evidence.state}`}>{evidence.label}</span><p>Adjusted p {formatDailyP(analysis?.p_value_holm)}</p>
            <p>{value.first_year != null ? `Complete values: ${value.first_year}–${value.last_year}.` : 'No complete annual values.'}</p>
            {value.warnings.map((warning, i) => <p className="daily-period-warning" key={i}>{warning}</p>)}
          </article>
        })}</div>
        <div className="daily-period-method">{result.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>
        <button type="button" className="secondary-button" onClick={download}>Download period comparison <Icon name="download" /></button>
      </>}
      <span className="sr-only" role="status">{message}</span>
    </div>
  </details>
}
