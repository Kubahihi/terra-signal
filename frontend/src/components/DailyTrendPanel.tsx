import { dailyMetrics } from '../lib/dailyData'
import { dailyEvidence, formatDailyP } from '../lib/dailyTrends'
import { formatRate } from '../lib/evidence'
import type { DailyMetric, DailyTrendsResponse } from '../types/api'
import Icon from './Icon'

export default function DailyTrendPanel({ result, metric, locationName, start, end, loading, error, onRetry, onSelect }: {
  result: DailyTrendsResponse | null; metric: DailyMetric; start: number; end: number
  locationName: string
  loading: boolean; error: string; onRetry: () => void; onSelect: (metric: DailyMetric) => void
}) {
  const selected = result?.metrics[metric]
  const analysis = selected?.analysis
  const evidence = dailyEvidence(metric, selected)
  const warnings = selected?.warnings.filter(note => note !== evidence.conclusion) ?? []
  return <div className="daily-trends" aria-busy={loading} aria-labelledby="daily-trends-heading">
    <div className="daily-trends-heading"><div><p className="overline">Annual trends · {locationName} · {start}–{end}</p><h3 id="daily-trends-heading">Which changes stand out from year-to-year variation?</h3><p>Compare all four indices. Selecting a year above highlights an observation; the fitted period stays {start}–{end}.</p></div><span className="daily-family-note">Four tests · Holm correction · 5% level</span></div>
    {loading ? <p role="status">Estimating trends from complete annual indices…</p>
      : error ? <div className="daily-trend-error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={onRetry}>Retry trend analysis <Icon name="refresh" /></button></div>
      : result && <>
        <div className="daily-trend-overview">{dailyMetrics.map(item => {
          const value = result.metrics[item.id]
          const outcome = dailyEvidence(item.id, value)
          return <button type="button" className="daily-trend-choice" key={item.id} aria-pressed={metric === item.id} onClick={() => onSelect(item.id)}>
            <span>{item.title}</span><strong>{value.analysis ? formatRate(value.analysis.slope_per_decade) : '—'}<small>days / decade</small></strong>
            <span className={`evidence-badge ${outcome.state}`}>{outcome.label}</span><span className="daily-adjusted-p">Holm p {formatDailyP(value.analysis?.p_value_holm)}</span>
          </button>
        })}</div>
        <div className="calendar-trend-panel daily-selected-trend"><div className="calendar-trend-summary"><p className="overline">{dailyMetrics.find(item => item.id === metric)!.rule}</p><h3>{dailyMetrics.find(item => item.id === metric)!.title}</h3><p>{selected?.complete_years} / {selected?.expected_years} complete annual values · {selected?.nonzero_years} nonzero years</p><p className="calendar-method">{result.method}. {selected?.first_year != null ? `Complete values span ${selected.first_year}–${selected.last_year}.` : 'No complete annual values.'} At least {result.minimum_years} complete years and 80% coverage are required.</p></div>
          <div className="calendar-trend-results"><div className="metrics"><div className="metric"><p>Change / decade</p><strong>{analysis ? formatRate(analysis.slope_per_decade) : '—'}<span>days</span></strong></div><div className="metric"><p>Individual 95% confidence interval</p><strong className="interval">{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(formatRate).join(' to ') : '—'}</strong><span className="metric-unit">days / decade</span></div></div>
            <div className="evidence"><div className="evidence-heading"><span className={`evidence-badge ${evidence.state}`}>{evidence.label}</span><span>Holm p {formatDailyP(analysis?.p_value_holm)}</span></div><p>{evidence.conclusion}</p><p className="daily-raw-p">Two-sided unadjusted p {formatDailyP(analysis?.p_value)}. Confidence intervals are individual; significance uses the correction across four tests.</p></div></div>
        </div>
        {warnings.length > 0 && <div className="daily-trend-warnings" role="note">{warnings.map((note, i) => <p key={i}>{note}</p>)}</div>}
        <details className="daily-trend-method"><summary>How these trends are tested <Icon name="chevron" /></summary><div>{result.warnings.map((note, i) => <p key={i}>{note}</p>)}<p>Incomplete annual counts and observed lower bounds are excluded. Internal gaps withhold intervals and tests. Constant records, exact-line records, and fewer than five nonzero years also withhold significance. Short or poorly covered records withhold the trend.</p><p>Hot/frost-day counts, warm-night proxies and calendar-year dry spells retain the definitions shown above. This is a linear summary of annual values over the fitted years.</p><a href="https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLSResults.get_robustcov_results.html" target="_blank" rel="noreferrer">HAC method documentation <Icon name="external" /></a><a href="https://www.statsmodels.org/stable/generated/statsmodels.stats.multitest.multipletests.html" target="_blank" rel="noreferrer">Holm correction documentation <Icon name="external" /></a></div></details>
      </>}
  </div>
}
