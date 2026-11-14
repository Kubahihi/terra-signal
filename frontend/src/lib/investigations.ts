import { exampleLocations, type Location } from './locations'
import type { CalendarPeriodId, CalendarView, DailyMetric, Variable } from '../types/api'

export type Investigation = {
  id: string
  title: string
  question: string
  prompt: string
  variable: Variable
  location: Location
  comparison: Location
  start: number
  end: number
  calendarPeriod: CalendarPeriodId
  calendarView: CalendarView
  focus: 'calendar' | 'daily'
  dailyMetric?: DailyMetric
}

export const investigations: Investigation[] = [
  {
    id: 'winters', title: 'Are frost days becoming rarer near Prague?',
    question: 'Count days with a daily minimum below 0 °C.',
    prompt: 'Inspect annual frost-day counts from daily NASA records, then compare them with the monthly winter-temperature view. A complete year is required for an exact annual count; these are model grid-cell values rather than street-level station observations.',
    variable: 'T2M', location: exampleLocations[0], comparison: exampleLocations[1], start: 1981, end: 2025,
    calendarPeriod: 'djf', calendarView: 'values',
    focus: 'daily', dailyMetric: 'frost_days',
  },
  {
    id: 'dryness', title: 'Are dry spells lasting longer near Medicine Hat?',
    question: 'Inspect the longest annual run with less than 1 mm/day.',
    prompt: 'Use daily precipitation to inspect consecutive dry days and their dates. Runs are clipped to each calendar year; missing days are not assumed dry. The seasonal monthly-total view remains available for context.',
    variable: 'PRECTOTCORR', location: exampleLocations[1], comparison: exampleLocations[0], start: 1981, end: 2025,
    calendarPeriod: 'jja', calendarView: 'values',
    focus: 'daily', dailyMetric: 'longest_dry_spell',
  },
  {
    id: 'remembered-year', title: 'How unusual was a year you remember?',
    question: 'Compare that year with the 1991–2020 reference.',
    prompt: 'Move the year slider and inspect individual months. January is compared with the usual January, July with the usual July. A departure measures a difference from the reference, not the probability of an extreme event.',
    variable: 'T2M', location: exampleLocations[0], comparison: exampleLocations[1], start: 1981, end: 2025,
    calendarPeriod: 'year', calendarView: 'anomaly',
    focus: 'calendar',
  },
]

export const variableInfo: Record<Variable, { title: string; definition: string; question: string }> = {
  T2M: {
    title: 'Air temperature at 2 m',
    definition: 'Monthly mean air temperature near the surface, in °C. A positive trend means the selected model grid cell warmed over the chosen period.',
    question: 'Is this place warming or cooling?',
  },
  PRECTOTCORR: {
    title: 'Corrected precipitation',
    definition: 'Monthly mean daily precipitation rate, in mm/day. This includes rain and snow water equivalent; it is not a monthly rainfall total.',
    question: 'Is precipitation increasing or decreasing?',
  },
}
