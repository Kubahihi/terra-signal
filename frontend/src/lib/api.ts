import type { CalendarResponse, DailyDataset, DailyPeriodsResponse, DailyQuery, DailyResponse, DailyTrendsResponse, HealthResponse, SeriesQuery, SeriesResponse } from '../types/api'

const baseUrl = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
    signal,
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body
      ? (body as { detail: unknown }).detail : null
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status}).`)
  }
  if (body === null) throw new Error('The service returned an unreadable response.')
  return body as T
}

export const getHealth = (signal?: AbortSignal) => request<HealthResponse>('/api/health', signal)

export function getSeries(query: SeriesQuery, refresh = false, signal?: AbortSignal): Promise<SeriesResponse> {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
  if (refresh) params.set('refresh', 'true')
  return request<SeriesResponse>(`/api/series?${params}`, signal)
}

export function getCalendar(query: SeriesQuery, refresh = false, signal?: AbortSignal): Promise<CalendarResponse> {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
  if (refresh) params.set('refresh', 'true')
  return request<CalendarResponse>(`/api/calendar?${params}`, signal)
}

export function getDaily(query: DailyQuery, refresh = false, signal?: AbortSignal): Promise<DailyResponse> {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
  if (refresh) params.set('refresh', 'true')
  return request<DailyResponse>(`/api/daily?${params}`, signal)
}

export function getDailyTrends(data: DailyDataset, signal?: AbortSignal): Promise<DailyTrendsResponse> {
  return request<DailyTrendsResponse>('/api/daily/trends', signal, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: data.lat, longitude: data.lon, start: data.start, end: data.end, years: data.years }),
  })
}

export function getDailyPeriods(data: DailyDataset, signal?: AbortSignal): Promise<DailyPeriodsResponse> {
  return request<DailyPeriodsResponse>('/api/daily/periods', signal, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: data.lat, longitude: data.lon, start: data.start, end: data.end, years: data.years }),
  })
}
