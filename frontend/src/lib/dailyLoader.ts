import type { DailyDataset, DailyQuery, DailyResponse } from '../types/api'
import { combineDaily, dailyBatches } from './dailyData.ts'

export type DailyProgress = { completed: number; total: number; years: number }
type FetchDaily = (query: DailyQuery, refresh: boolean, signal: AbortSignal) => Promise<DailyResponse>

export async function loadDailyRange(query: DailyQuery, options: {
  fetchDaily: FetchDaily; cache: Map<string, DailyResponse>; signal: AbortSignal
  refresh: boolean; lastYear: number; onProgress: (value: DailyProgress) => void
}): Promise<DailyDataset> {
  const { signal, cache, refresh } = options
  const batches = dailyBatches(query.start, query.end, options.lastYear)
  const reports: DailyResponse[] = []
  const failures: DailyDataset['failures'] = []
  options.onProgress({ completed: 0, total: batches.length, years: 0 })
  for (let offset = 0; offset < batches.length; offset += 2) {
    signal.throwIfAborted()
    const pair = batches.slice(offset, offset + 2)
    const settled = await Promise.allSettled(pair.map(async batch => {
      const cacheKey = JSON.stringify({ lat: query.lat, lon: query.lon, ...batch })
      const memo = cache.get(cacheKey)
      const age = memo ? Date.now() - Date.parse(memo.retrieved_at) : Infinity
      const response = !refresh && memo && age >= 0 && age < 86400000 ? memo
        : await options.fetchDaily({ lat: query.lat, lon: query.lon, ...batch }, refresh, signal)
      signal.throwIfAborted()
      if (response.latitude !== query.lat || response.longitude !== query.lon || response.start !== batch.start || response.end !== batch.end || response.time_standard !== 'LST') {
        throw new Error('The daily response does not match the requested place, period or time standard.')
      }
      cache.set(cacheKey, response)
      if (cache.size > 64) cache.delete(cache.keys().next().value!)
      return response
    }))
    signal.throwIfAborted()
    settled.forEach((item, index) => {
      if (item.status === 'fulfilled') reports.push(item.value)
      else failures.push({ ...pair[index], message: item.reason instanceof Error ? item.reason.message : 'Daily data could not be loaded.' })
    })
    options.onProgress({ completed: offset + settled.length, total: batches.length,
      years: reports.reduce((count, report) => count + report.years.filter(item => item.year >= query.start && item.year <= query.end).length, 0) })
  }
  return combineDaily(reports, query, failures)
}
