import { useCallback, useEffect, useRef, useState } from 'react'
import { getDaily, getDailyTrends } from './api'
import { loadDailyRange, type DailyProgress } from './dailyLoader'
import { matchesDailyTrends } from './dailyTrends'
import type { DailyDataset, DailyQuery, DailyResponse, DailyTrendsResponse } from '../types/api'

// Shared across the selected and comparison points; responses retain NASA metadata.
const dailyCache = new Map<string, DailyResponse>()
const lastYear = new Date().getUTCFullYear() - 1

export function useDailyRecord(query: DailyQuery, valid: boolean, autoLoad = false) {
  const key = JSON.stringify(query)
  const [intent, setIntent] = useState<{ key: string; version: number; refresh: boolean; stopped: boolean } | null>(null)
  const [dataset, setDataset] = useState<DailyDataset | null>(null)
  const [status, setStatus] = useState({ key: '', loading: false, error: '' })
  const [progress, setProgress] = useState<DailyProgress>({ completed: 0, total: 0, years: 0 })
  const [trendResult, setTrendResult] = useState<{ dataset: DailyDataset; result: DailyTrendsResponse } | null>(null)
  const [trendState, setTrendState] = useState<{ dataset: DailyDataset | null; loading: boolean; error: string }>({ dataset: null, loading: false, error: '' })
  const [trendRetry, setTrendRetry] = useState(0)
  const latestQuery = useRef(query)
  latestQuery.current = query
  const wanted = valid && (autoLoad ? intent?.key !== key || !intent?.stopped : intent?.key === key && !intent?.stopped)
  const busy = wanted && (status.key !== key || status.loading)
  const error = status.key === key ? status.error : ''
  const matches = dataset?.lat === query.lat && dataset.lon === query.lon && dataset.start === query.start && dataset.end === query.end
  const current = valid && matches && !busy && !error ? dataset : null
  const trends = trendResult?.dataset === current ? trendResult.result : null

  const load = useCallback((refresh = false) => {
    setIntent(previous => ({ key, version: (previous?.version ?? 0) + 1, refresh, stopped: false }))
  }, [key])
  const stop = useCallback(() => {
    setIntent(previous => ({ key, version: (previous?.version ?? 0) + 1, refresh: false, stopped: true }))
  }, [key])

  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    const selectedQuery = latestQuery.current
    const refresh = intent?.key === key && intent.refresh
    setStatus({ key, loading: true, error: '' })
    setProgress({ completed: 0, total: 0, years: 0 })
    const timer = window.setTimeout(() => {
      loadDailyRange(selectedQuery, { fetchDaily: getDaily, cache: dailyCache, signal: controller.signal,
        refresh: !!refresh, lastYear, onProgress: setProgress,
      }).then(result => { if (!controller.signal.aborted) setDataset(result) })
        .catch(cause => { if (!controller.signal.aborted) setStatus({ key, loading: false, error: cause instanceof Error ? cause.message : 'Daily data could not be loaded.' }) })
        .finally(() => { if (!controller.signal.aborted) setStatus(previous => ({ ...previous, loading: false })) })
    }, autoLoad ? 350 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [key, intent, wanted, autoLoad])

  useEffect(() => {
    if (!current?.sources.length) return
    const controller = new AbortController()
    setTrendState({ dataset: current, loading: true, error: '' })
    getDailyTrends(current, controller.signal).then(result => {
      if (!matchesDailyTrends(current, result)) throw new Error('Trend results do not match this place and period.')
      if (!controller.signal.aborted) setTrendResult({ dataset: current, result })
    }).catch(cause => {
      if (!controller.signal.aborted) setTrendState({ dataset: current, loading: false, error: cause instanceof Error ? cause.message : 'Trend analysis could not be completed.' })
    }).finally(() => { if (!controller.signal.aborted) setTrendState(previous => ({ ...previous, loading: false })) })
    return () => controller.abort()
  }, [current, trendRetry])

  const trendError = trendState.dataset === current ? trendState.error : ''
  return { current, busy, error, progress, load, stop, changed: !!dataset && !matches,
    trends, trendLoading: !!current?.sources.length && (!trends || trendState.dataset === current && trendState.loading) && !trendError,
    trendError, retryTrends: () => setTrendRetry(value => value + 1) }
}

export type DailyRecordState = ReturnType<typeof useDailyRecord>
