import type { SeriesResponse, Variable } from '../types/api'
import { coverageFor, evidenceFor, fittedChangeFor, formatRate } from '../lib/evidence'

export default function TrendEvidence({ result, variable, loading = false }: {
  result: SeriesResponse | null
  variable: Variable
  loading?: boolean
}) {
  const analysis = result?.analysis
  const evidence = evidenceFor(analysis)
  const unit = result?.unit === 'C' ? '°C' : result?.unit ?? (variable === 'T2M' ? '°C' : 'mm/day')
  const coverage = result ? coverageFor(result) : null
  const fitted = result ? fittedChangeFor(result) : null
  const monthLabel = (date: string) => new Date(date).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return <div className="trend-evidence">
    {coverage && <div className="record-coverage"><span>{coverage.available} / {coverage.expected} months available</span><span>{coverage.percent}% coverage</span></div>}
    <div className="metrics" aria-label="Trend estimates">
      <div className="metric"><p>Change / decade</p><strong>{analysis ? formatRate(analysis.slope_per_decade) : '—'}<span>{unit}</span></strong>
        {analysis && <span className="metric-unit">{formatRate(analysis.slope_per_year)} {unit} / year</span>}
      </div>
      <div className="metric"><p>95% confidence interval</p><strong className="interval">{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(value => formatRate(value)).join(' to ') : '—'}</strong><span className="metric-unit">{unit} / decade</span></div>
    </div>
    {fitted && <div className="fitted-change">
      <p><span>Fitted change</span><strong>{formatRate(fitted.change)} {unit}</strong></p>
      <p><time dateTime={fitted.first}>{monthLabel(fitted.first)}</time> – <time dateTime={fitted.last}>{monthLabel(fitted.last)}</time>. Rate × elapsed time, excluding the seasonal cycle; not the difference between two observed values.{variable === 'PRECTOTCORR' ? ' This is a change in daily rainfall rate, not accumulated rainfall.' : ''}</p>
      {fitted.ci95 && <p>95% interval: {fitted.ci95.map(formatRate).join(' to ')} {unit} under the same model.</p>}
    </div>}
    <div className="evidence" aria-live="polite">
      <div className="evidence-heading"><span className="evidence-label">Trend</span><span>{analysis?.p_value != null ? `p ${analysis.p_value < 0.001 ? '< 0.001' : `= ${analysis.p_value.toPrecision(3)}`}` : 'p unavailable'}</span></div>
      {result && <span className={`evidence-badge ${evidence.state}`}>{evidence.label}</span>}
      <p>{result ? evidence.conclusion : loading ? 'Loading observations and estimating the trend…' : 'Choose a valid period and load observations to explore the evidence.'}</p>
      {analysis?.ci95_per_decade && <p className="interval-explanation">{analysis.ci95_per_decade[0] <= 0 && analysis.ci95_per_decade[1] >= 0
        ? 'The interval includes zero: both little change and a trend are compatible with this model.'
        : 'The interval excludes zero under this model. Its width shows uncertainty in the estimated rate, not the spread of individual observations.'}</p>}
    </div>
  </div>
}
