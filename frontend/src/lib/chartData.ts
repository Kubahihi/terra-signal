import type { Observation } from '../types/api'

// Only complete calendar years are comparable. Weight monthly means by days.
export function annualMeans(series: Observation[]): Observation[] {
  const years = new Map<number, Observation[]>()
  for (const point of series) {
    const year = Number(point.date.slice(0, 4))
    years.set(year, [...(years.get(year) ?? []), point])
  }
  return [...years.entries()].sort(([a], [b]) => a - b).map(([year, points]) => {
    const months = new Set(points.map(point => Number(point.date.slice(5, 7))))
    if (points.length !== 12 || months.size !== 12 || points.some(point => point.value === null || !Number.isFinite(point.value))) {
      return { date: `${year}-07-01`, value: null }
    }
    let weighted = 0
    let days = 0
    for (const point of points) {
      const month = Number(point.date.slice(5, 7))
      const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
      weighted += point.value! * count
      days += count
    }
    return { date: `${year}-07-01`, value: weighted / days }
  })
}
