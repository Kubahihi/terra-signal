import type { HealthResponse, SeriesQuery, SeriesResponse } from '../types/api'

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json' },
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

export function getSeries(query: SeriesQuery): Promise<SeriesResponse> {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
  return request<SeriesResponse>(`/api/series?${params}`)
}
