import type { AtlasScale } from './trendAtlas'

export type AtlasColorStop = { offset: number; color: string }
export type AtlasColorLegend = {
  minimum: number
  maximum: number
  ticks: { value: number; position: number; color: string }[]
  gradient: string
  unit: string
}

export const atlasMissingColor = '#aab4ba'

const trendPalette: readonly AtlasColorStop[] = [
  { offset: 0, color: '#2166ac' },
  { offset: 0.5, color: '#f3f1e8' },
  { offset: 1, color: '#b64128' },
]
const annualPalette: readonly AtlasColorStop[] = [
  { offset: 0, color: '#fff2cc' },
  { offset: 0.5, color: '#ef9a62' },
  { offset: 1, color: '#b43c28' },
]

export function atlasColorStops(scale: AtlasScale): readonly AtlasColorStop[] {
  return scale.signed ? trendPalette : annualPalette
}

function channel(color: string, offset: number) { return Number.parseInt(color.slice(offset, offset + 2), 16) }
function mix(first: string, second: string, fraction: number) {
  return `#${[1, 3, 5].map(offset => Math.round(channel(first, offset) + (channel(second, offset) - channel(first, offset)) * fraction).toString(16).padStart(2, '0')).join('')}`
}

/** Interpolate scalar values only. No values are estimated between map locations. */
export function atlasColor(value: number | null, scale: AtlasScale): string {
  if (value === null || !Number.isFinite(value) || !Number.isFinite(scale.maximum) || scale.maximum <= 0) return atlasMissingColor
  const fraction = Math.max(0, Math.min(1, scale.signed ? (value / scale.maximum + 1) / 2 : value / scale.maximum))
  const stops = atlasColorStops(scale)
  const left = fraction <= 0.5 ? stops[0] : stops[1]
  const right = fraction <= 0.5 ? stops[1] : stops[2]
  return mix(left.color, right.color, (fraction - left.offset) / (right.offset - left.offset))
}

/** Pass the same full-record scale to map marks and legend; never derive it from a selected year or pair. */
export function atlasLegend(scale: AtlasScale): AtlasColorLegend {
  if (!Number.isFinite(scale.maximum) || scale.maximum <= 0) throw new Error('An atlas color legend requires a finite positive maximum.')
  const minimum = scale.signed ? -scale.maximum : 0
  const values = [minimum, scale.signed ? 0 : scale.maximum / 2, scale.maximum]
  const stops = atlasColorStops(scale)
  return {
    minimum, maximum: scale.maximum, unit: scale.unit,
    ticks: values.map((value, index) => ({ value, position: index / 2, color: atlasColor(value, scale) })),
    gradient: `linear-gradient(90deg, ${stops.map(stop => `${stop.color} ${stop.offset * 100}%`).join(', ')})`,
  }
}
