import { useId, useState } from 'react'
import type { SeriesResponse } from '../types/api'
import { annualMeans } from '../lib/chartData'

export default function SeriesChart({ result, loading }: { result: SeriesResponse | null; loading: boolean }) {
  const [mode, setMode] = useState<'annual' | 'monthly'>('annual')
  const [active, setActive] = useState<number | null>(null)
  const descriptionId = useId()
  const points = result ? mode === 'annual' ? annualMeans(result.series) : result.series : []
  const valid = points.filter(point => point.value !== null && Number.isFinite(point.value))
  const values = valid.map(point => point.value as number)
  const first = points.length ? Date.parse(points[0].date) : 0
  const last = points.length ? Date.parse(points[points.length - 1].date) : 1
  const low = values.length ? Math.min(...values) : 0
  const high = values.length ? Math.max(...values) : 1
  const padding = (high - low || 1) * 0.16
  const minimum = result?.variable === 'PRECTOTCORR' && low >= 0 ? Math.max(0, low - padding) : low - padding
  const maximum = high + padding
  const x = (date: string) => 46 + ((Date.parse(date) - first) / (last - first || 1)) * 442
  const y = (value: number) => 203 - ((value - minimum) / (maximum - minimum)) * 177
  let connected = false
  const path = points.map(point => {
    if (point.value === null || !Number.isFinite(point.value)) { connected = false; return '' }
    const segment = `${connected ? 'L' : 'M'}${x(point.date)},${y(point.value)}`
    connected = true
    return segment
  }).join(' ')
  const selected = active === null ? null : points[active]
  const displayUnit = result?.unit === 'C' ? '°C' : result?.unit ?? ''
  const dateLabel = selected ? mode === 'annual' ? selected.date.slice(0, 4) : new Date(selected.date).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''

  return <div className="chart-block">
    <div className="chart-toolbar"><div className="segmented chart-mode" aria-label="Chart aggregation">
      <button aria-pressed={mode === 'annual'} onClick={() => { setMode('annual'); setActive(null) }}>Annual mean</button>
      <button aria-pressed={mode === 'monthly'} onClick={() => { setMode('monthly'); setActive(null) }}>Monthly</button>
    </div><span>{displayUnit}</span></div>
    <div className="chart-canvas" role="group" tabIndex={valid.length ? 0 : undefined} aria-label="Interactive time series. Use left and right arrow keys to inspect observations." aria-describedby={descriptionId}
      onKeyDown={event => {
        if (!points.length) return
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) event.preventDefault()
        if (event.key === 'ArrowRight') setActive(index => Math.min(points.length - 1, (index ?? -1) + 1))
        if (event.key === 'ArrowLeft') setActive(index => Math.max(0, (index ?? points.length) - 1))
        if (event.key === 'Home') setActive(0)
        if (event.key === 'End') setActive(points.length - 1)
        if (event.key === 'Escape') setActive(null)
      }}>
      <svg className="series-chart" viewBox="0 0 512 242" role="img" aria-label={result ? `${mode === 'annual' ? 'Annual mean' : 'Monthly'} ${result.variable} from ${result.start} to ${result.end}, in ${displayUnit}` : 'Time series awaiting observations'}
        onPointerMove={event => {
          if (!points.length) return
          const bounds = event.currentTarget.getBoundingClientRect()
          const pointer = (event.clientX - bounds.left) / bounds.width * 512
          const target = first + Math.max(0, Math.min(1, (pointer - 46) / 442)) * (last - first)
          let nearest = 0
          for (let index = 1; index < points.length; index++) {
            if (Math.abs(Date.parse(points[index].date) - target) < Math.abs(Date.parse(points[nearest].date) - target)) nearest = index
          }
          setActive(nearest)
        }} onPointerLeave={() => setActive(null)}>
        {[0, 1, 2, 3].map(index => {
          const value = minimum + (maximum - minimum) * index / 3
          return <g key={index}><line x1="46" y1={y(value)} x2="488" y2={y(value)} className="grid-line" />{valid.length > 0 && <text x="34" y={y(value) + 4} textAnchor="end">{value.toFixed(1)}</text>}</g>
        })}
        {valid.length > 0 && <><path d={path} className="data-line" />
          {valid.length === 1 && <circle cx={x(valid[0].date)} cy={y(valid[0].value!)} r="3" className="chart-dot" />}
          {[0, 1, 2, 3].map(index => <text key={index} x={46 + 442 * index / 3} y="229" textAnchor={index === 0 ? 'start' : index === 3 ? 'end' : 'middle'}>{Math.round(result!.start + (result!.end - result!.start) * index / 3)}</text>)}
        </>}
        {selected && <g><line x1={x(selected.date)} y1="20" x2={x(selected.date)} y2="203" className="hover-line" />{selected.value !== null && <circle cx={x(selected.date)} cy={y(selected.value)} r="4" className="chart-dot" />}</g>}
      </svg>
      {!valid.length && <div className="chart-placeholder" role="status">{loading ? 'Loading observations…' : result ? 'No complete observations for this view.' : 'Select a place and a valid period.'}</div>}
      {selected && <div className="chart-tooltip" role="status" style={{ left: `${Math.max(16, Math.min(79, x(selected.date) / 512 * 100))}%` }}><span>{dateLabel}</span><strong>{selected.value === null ? 'Missing observation' : `${selected.value.toFixed(2)} ${displayUnit}`}</strong></div>}
    </div>
    <p className="chart-caption" id={descriptionId}>{mode === 'annual' ? 'Day-weighted yearly means. Incomplete years are omitted.' : 'Monthly observations. Missing values appear as gaps.'}<span>Trend estimates use monthly data in both views.</span></p>
  </div>
}
