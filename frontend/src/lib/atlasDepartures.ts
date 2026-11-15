import type { DailyMetric } from '../types/api'
import { atlasAnnualValue, type AtlasPoint, type AtlasScale, type TrendAtlasData } from './trendAtlas.ts'

export type AtlasBaseline = { mean: number | null; completeYears: number; start: 1991; end: 2020 }

/** Each complete calendar year has equal weight; counts are not converted to a daily rate. */
export function atlasBaseline(point: AtlasPoint, metric: DailyMetric): AtlasBaseline {
  const values = Array.from({ length: 30 }, (_, index) => atlasAnnualValue(point, metric, 1991 + index))
  const complete = values.filter((value): value is number => value !== null)
  return { mean: complete.length === 30 ? complete.reduce((sum, value) => sum + value, 0) / 30 : null,
    completeYears: complete.length, start: 1991, end: 2020 }
}

/** A descriptive departure, not a significance test or a trend estimate. */
export function atlasDeparture(point: AtlasPoint, metric: DailyMetric, year: number): number | null {
  const value = atlasAnnualValue(point, metric, year)
  if (value === null) return null
  const { mean } = atlasBaseline(point, metric)
  return mean === null ? null : value - mean
}

/** One signed domain for every point and animation year, including the baseline years. */
export function atlasDepartureScale(data: TrendAtlasData, metric: DailyMetric): AtlasScale {
  let maximum = 1
  for (const point of data.points) {
    const { mean } = atlasBaseline(point, metric)
    if (mean === null) continue
    for (const row of point.years) {
      const value = atlasAnnualValue(point, metric, row.year)
      if (value !== null) maximum = Math.max(maximum, Math.abs(value - mean))
    }
  }
  return { maximum, signed: true, unit: 'days vs 1991–2020' }
}
