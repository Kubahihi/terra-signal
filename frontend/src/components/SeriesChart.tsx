import type { SeriesResponse } from '../types/api'

export default function SeriesChart({ result }: { result: SeriesResponse | null }) {
  if (!result || result.series.every(point => point.value === null)) {
    return <div className="chart-empty">
      <div className="empty-orbit" aria-hidden="true"><span /></div>
      <h3>Every signal starts with a question.</h3>
      <p>Choose a location, a variable, and a time period to explore its history.</p>
    </div>
  }

  const valid = result.series.filter(point => point.value !== null && Number.isFinite(point.value))
  if (!valid.length) return <p className="notice">There are no usable observations in this period.</p>
  const values = valid.map(point => point.value as number)
  const timestamps = result.series.map(point => Date.parse(point.date))
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const padding = (high - low || 1) * 0.12
  const minimum = low - padding
  const maximum = high + padding
  const x = (timestamp: number) => 58 + ((timestamp - first) / (last - first || 1)) * 634
  const y = (value: number) => 232 - ((value - minimum) / (maximum - minimum)) * 206
  let connected = false
  const path = result.series.map(point => {
    if (point.value === null || !Number.isFinite(point.value)) { connected = false; return '' }
    const segment = `${connected ? 'L' : 'M'}${x(Date.parse(point.date))},${y(point.value)}`
    connected = true
    return segment
  }).join(' ')

  return <div className="chart-container">
    <svg className="series-chart" viewBox="0 0 720 280" role="img"
      aria-label={`Monthly ${result.variable} observations from ${result.start} to ${result.end}, in ${result.unit}`}>
      {[0, 1, 2, 3, 4].map(index => {
        const value = minimum + (maximum - minimum) * index / 4
        return <g key={index}>
          <line x1="58" y1={y(value)} x2="692" y2={y(value)} className="grid-line" />
          <text x="46" y={y(value) + 4} textAnchor="end">{value.toFixed(1)}</text>
        </g>
      })}
      <path d={path} className="data-line" />
      {valid.length === 1 && <circle cx={x(Date.parse(valid[0].date))} cy={y(values[0])} r="4" fill="currentColor" />}
      <text x="58" y="262">{result.series[0].date.slice(0, 7)}</text>
      <text x="692" y="262" textAnchor="end">{result.series[result.series.length - 1].date.slice(0, 7)}</text>
      <text x="58" y="14">{result.unit}</text>
    </svg>
    <p className="caption">Monthly observations · Gaps are shown without connecting lines.</p>
  </div>
}
