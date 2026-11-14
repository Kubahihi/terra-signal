import { useId } from 'react'
import { calendarAmount, calendarValue } from '../lib/calendarData'
import type { CalendarPeriod, CalendarView } from '../types/api'

export default function CalendarChart({ period, view, unit, selectedYear, onSelect }: {
  period: CalendarPeriod
  view: CalendarView
  unit: string
  selectedYear: number
  onSelect: (year: number) => void
}) {
  return <YearBarChart points={period.points.map(point => ({ year: point.year, value: calendarValue(point, view) }))}
    label={period.label} unit={unit} selectedYear={selectedYear} onSelect={onSelect} anomaly={view === 'anomaly'}
    caption="Select a bar or use the year slider. Crosses mark missing observations or an incomplete reference; they are not zeros." />
}

export function YearBarChart({ points, label, unit, selectedYear, onSelect, anomaly = false, caption, fit, scaleMaximum }: {
  points: { year: number; value: number | null }[]
  label: string
  unit: string
  selectedYear: number
  onSelect: (year: number) => void
  anomaly?: boolean
  caption: string
  fit?: { startYear: number; endYear: number; startValue: number; endValue: number }
  scaleMaximum?: number
}) {
  const description = useId()
  const integer = unit === 'days'
  const values = points.map(point => point.value).filter((value): value is number => value !== null)
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values, ...(fit ? [fit.startValue, fit.endValue] : []))
  const span = high - low || 1
  const minimum = integer ? 0 : low === 0 && high > 0 ? 0 : low - span * 0.12
  const maximum = scaleMaximum ?? (integer ? Math.max(1, Math.ceil(high + span * 0.12)) : high + span * 0.12)
  const y = (value: number) => 204 - (value - minimum) / (maximum - minimum) * 180
  const step = 566 / (points.length || 1)
  const x = (index: number) => 50 + (index + 0.5) * step
  const fitX = (year: number) => x(year - (points[0]?.year ?? year))
  const fitClipId = `${description}-fit`
  const active = Math.max(0, points.findIndex(point => point.year === selectedYear))
  const ticks = [...new Set([0, 1, 2, 3].map(tick => {
    const value = minimum + (maximum - minimum) * tick / 3
    return integer ? Math.round(value) : value
  }))]
  return <div className="calendar-chart">
    <div className="calendar-chart-label"><span>{anomaly ? 'Departure from the 1991–2020 reference' : label}</span><span>{unit}</span></div>
    <div className="calendar-canvas" role="group" tabIndex={0} aria-label="Year-by-year chart. Use arrow keys, Home or End to select a year." aria-describedby={description}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !points.length) return
        event.preventDefault()
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, active + (event.key === 'ArrowRight' ? 1 : -1)))
        onSelect(points[index].year)
      }}>
      <svg viewBox="0 0 640 244" role="img" aria-label={`${label}, ${anomaly ? 'temperature departures' : 'yearly values'}, ${points[0]?.year}–${points.at(-1)?.year}, ${unit}`}
        onPointerDown={event => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const pointer = (event.clientX - bounds.left) / bounds.width * 640
          const index = Math.max(0, Math.min(points.length - 1, Math.floor((pointer - 50) / step)))
          if (points[index]) onSelect(points[index].year)
        }}>
        {ticks.map(value => {
          return <g key={value}><line className="grid-line" x1="50" x2="616" y1={y(value)} y2={y(value)} /><text x="40" y={y(value) + 4} textAnchor="end">{value.toFixed(unit === 'mm' || integer ? 0 : 1)}</text></g>
        })}
        <line className="calendar-zero" x1="50" x2="616" y1={y(0)} y2={y(0)} />
        {points.map((point, index) => {
          const value = point.value
          const selected = point.year === selectedYear
          if (value === null) return <g key={point.year}><path className="calendar-missing" d={`M${x(index) - 2},196l4,5m-4,0l4,-5`} /><title>{point.year}: incomplete or unavailable record</title></g>
          return <rect key={point.year} x={x(index) - step * 0.32} y={Math.min(y(value), y(0))} width={Math.max(1, step * 0.64)} height={Math.max(1, Math.abs(y(value) - y(0)))} rx="1"
            className={`calendar-bar ${anomaly ? value >= 0 ? 'positive' : 'negative' : 'raw'}${selected ? ' selected' : ''}`}><title>{point.year}: {integer ? value : calendarAmount(value, anomaly)} {unit}{selected ? ' (selected)' : ''}</title></rect>
        })}
        {[...new Set([0, Math.round((points.length - 1) / 3), Math.round((points.length - 1) * 2 / 3), points.length - 1])].map(index => points[index] && <text key={index} x={x(index)} y="230" textAnchor="middle">{points[index].year}</text>)}
        {fit && <><defs><clipPath id={fitClipId}><rect x="50" y="20" width="566" height="184" /></clipPath></defs><g clipPath={`url(#${fitClipId})`}><line className="daily-fitted-line" x1={fitX(fit.startYear)} x2={fitX(fit.endYear)} y1={y(fit.startValue)} y2={y(fit.endValue)}><title>Linear fit over complete annual values, {fit.startYear}–{fit.endYear}; clipped to the chart bounds</title></line></g></>}
        {points[active] && <line className="calendar-selection-line" x1={x(active)} x2={x(active)} y1="20" y2="207" />}
      </svg>
      {!values.length && <p className="chart-placeholder">No complete records for this view.</p>}
    </div>
    <p className="calendar-chart-note" id={description}>{caption}</p>
    {anomaly && <div className="anomaly-legend"><span><i className="cool-key" />Cooler than the reference</span><span><i className="warm-key" />Warmer than the reference</span></div>}
  </div>
}
