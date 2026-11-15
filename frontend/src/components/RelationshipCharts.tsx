import { useEffect, useState } from 'react'
import type { RelationshipPair, RelationshipResponse } from '../types/relationships'

const time = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
const format = (value: number, unit: string) => value.toLocaleString('en', { maximumFractionDigits: unit === 'NDVI' || unit === 'fraction' ? 4 : 2 })

export default function RelationshipCharts({ result }: { result: RelationshipResponse }) {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [result])
  const pairs = result.pairs
  const selectedIndex = Math.max(0, Math.min(selected, pairs.length - 1))
  const point = pairs[selectedIndex]
  if (!point) return <div className="relationship-empty">No matching observations are available for these months.</div>
  return <>
    <div className="relationship-charts">
      <article className="relationship-chart-card"><p className="overline">Matched original observations</p><h3>Follow the two records through time.</h3><p className="relationship-chart-note">Each line has its own vertical scale. Y is shown at its paired X date; its actual month is listed when you inspect a point.</p>
        <MiniSeries pairs={pairs} axis="x" name={result.x_name} unit={result.x_unit} selected={selectedIndex} onSelect={setSelected} annual={result.month !== null} />
        <MiniSeries pairs={pairs} axis="y" name={result.y_name} unit={result.y_unit} selected={selectedIndex} onSelect={setSelected} annual={result.month !== null} />
      </article>
      <article className="relationship-chart-card"><p className="overline">Seasonality removed{result.detrended ? ' · trend removed' : ''}</p><h3>Do the departures move together?</h3><ScatterPlot result={result} selected={selectedIndex} onSelect={setSelected} /><p className="relationship-chart-note">Select a dot or use Left/Right, Home or End to inspect a pair. The points show the adjusted values used for the descriptive correlation.</p></article>
    </div>
    <div className="relationship-point-detail" aria-live="polite"><div><span>Selected pair</span><strong>{point.x_date.slice(0, 7)} → {point.y_date.slice(0, 7)}</strong></div><div><span>{result.x_name} · original / adjusted</span><strong>{format(point.x_raw, result.x_unit)} / {format(point.x, result.x_unit)} <small>{result.x_unit}</small></strong></div><div><span>{result.y_name} · original / adjusted</span><strong>{format(point.y_raw, result.y_unit)} / {format(point.y, result.y_unit)} <small>{result.y_unit}</small></strong></div></div>
  </>
}

function MiniSeries({ pairs, axis, name, unit, selected, onSelect, annual }: { pairs: RelationshipPair[]; axis: 'x' | 'y'; name: string; unit: string; selected: number; onSelect: (index: number) => void; annual: boolean }) {
  const values = pairs.map(pair => axis === 'x' ? pair.x_raw : pair.y_raw)
  const low = Math.min(...values), high = Math.max(...values)
  const span = high - low || Math.max(Math.abs(high) * 0.1, 1)
  const first = time(pairs[0].x_date), last = time(pairs.at(-1)!.x_date)
  const x = (index: number) => 60 + (time(pairs[index].x_date) - first) / (last - first || 1) * 560
  const y = (value: number) => 101 - (value - low + span * 0.1) / (span * 1.2) * 80
  const path = pairs.map((pair, index) => `${index && time(pair.x_date) - time(pairs[index - 1].x_date) <= (annual ? 12 : 1) ? 'L' : 'M'}${x(index)},${y(values[index])}`).join(' ')
  return <div className={`relationship-mini axis-${axis}`}><div><strong>{name}</strong><span>{unit}</span></div><svg viewBox="0 0 640 130" role="img" aria-label={`${name}, original paired observations, ${pairs[0].x_date.slice(0, 4)}–${pairs.at(-1)!.x_date.slice(0, 4)}`} onPointerDown={event => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = (event.clientX - bounds.left) / bounds.width * 640
    const nearest = pairs.reduce((best, _, index) => Math.abs(x(index) - position) < Math.abs(x(best) - position) ? index : best, 0)
    onSelect(nearest)
  }}>
    {[low, low + (high - low) / 2, high].filter((v, i, all) => all.indexOf(v) === i).map(value => <g key={value}><line className="grid-line" x1="60" x2="620" y1={y(value)} y2={y(value)} /><text x="52" y={y(value) + 4} textAnchor="end">{format(value, unit)}</text></g>)}
    <path className="relationship-line" d={path} />
    <line className="hover-line" x1={x(selected)} x2={x(selected)} y1="15" y2="105" /><circle className="relationship-dot" cx={x(selected)} cy={y(values[selected])} r="3" />
    <text x="60" y="125">{pairs[0].x_date.slice(0, 4)}</text><text x="620" y="125" textAnchor="end">{pairs.at(-1)!.x_date.slice(0, 4)}</text>
  </svg></div>
}

function ScatterPlot({ result, selected, onSelect }: { result: RelationshipResponse; selected: number; onSelect: (index: number) => void }) {
  const pairs = result.pairs
  const xLow = Math.min(...pairs.map(p => p.x)), xHigh = Math.max(...pairs.map(p => p.x))
  const yLow = Math.min(...pairs.map(p => p.y)), yHigh = Math.max(...pairs.map(p => p.y))
  const dx = xHigh - xLow || 1, dy = yHigh - yLow || 1
  const x = (value: number) => 76 + (value - xLow + dx * 0.08) / (dx * 1.16) * 510
  const y = (value: number) => 264 - (value - yLow + dy * 0.08) / (dy * 1.16) * 222
  return <div className="relationship-scatter" role="group" tabIndex={0} aria-label="Relationship scatter plot. Use left and right arrow keys to inspect paired observations." onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    onSelect(event.key === 'Home' ? 0 : event.key === 'End' ? pairs.length - 1 : Math.max(0, Math.min(pairs.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1))))
  }}><svg viewBox="0 0 640 340" role="img" aria-label={`${result.x_name} and ${result.y_name}, ${pairs.length} adjusted pairs`}>
    {[0, 1, 2].map(index => { const xv = xLow + (xHigh - xLow) * index / 2, yv = yLow + (yHigh - yLow) * index / 2; return <g key={index}><line className="grid-line" x1="76" x2="586" y1={y(yv)} y2={y(yv)} /><text x="65" y={y(yv) + 4} textAnchor="end">{format(yv, result.y_unit)}</text><text x={x(xv)} y="289" textAnchor="middle">{format(xv, result.x_unit)}</text></g> })}
    <text x="330" y="324" textAnchor="middle">{result.x_name} departure ({result.x_unit})</text><text x="10" y="20">Y: {result.y_name} departure ({result.y_unit})</text>
    {pairs.map((pair, index) => <circle key={pair.x_date} className={`relationship-scatter-point${selected === index ? ' selected' : ''}`} cx={x(pair.x)} cy={y(pair.y)} r={selected === index ? 5 : 3.5} onClick={() => onSelect(index)}><title>{pair.x_date.slice(0, 7)} → {pair.y_date.slice(0, 7)}: {pair.x.toFixed(4)}, {pair.y.toFixed(4)}</title></circle>)}
  </svg></div>
}
