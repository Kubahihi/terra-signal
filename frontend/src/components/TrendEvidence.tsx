import type { SeriesResponse, Variable } from '../types/api'
import { coverageFor, evidenceFor, formatRate } from '../lib/evidence'

export default function TrendEvidence({ result, variable, loading = false }: {
  result: SeriesResponse | null
  variable: Variable
  loading?: boolean
}) {
  const analysis = result?.analysis
  const evidence = evidenceFor(analysis)
  const unit = result?.unit === 'C' ? '°C' : result?.unit ?? (variable === 'T2M' ? '°C' : 'mm/day')
  const coverage = result ? coverageFor(result) : null
  return <div className="trend-evidence">
    {coverage && <div className="record-coverage"><span>{coverage.available} / {coverage.expected} months available</span><span>{coverage.percent}% coverage</span></div>}
    <div className="metrics" aria-label="Trend estimates">
      <div className="metric"><p>Change / decade</p><strong>{analysis ? formatRate(analysis.slope_per_decade) : '—'}<span>{unit}</span></strong>
        {analysis && <span className="metric-unit">{formatRate(analysis.slope_per_year)} {unit} / year</span>}
      </div>
      <div className="metric"><p>95% confidence interval</p><strong className="interval">{analysis?.ci95_per_decade ? analysis.ci95_per_decade.map(value => formatRate(value)).join(' to ') : '—'}</strong><span className="metric-unit">{unit} / decade</span></div>
    </div>
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
