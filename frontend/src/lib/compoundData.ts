import type { DailyDataset, DailyRecord } from '../types/api'

export const compoundThreshold = 'Daily Tmax > 30 C AND daily precipitation < 1 mm/day'

export type CompoundDay = {
  date: string
  response_available: boolean
  tmax: number | null
  precipitation: number | null
  hot_dry: 0 | 1 | null
}

export type CompoundYear = {
  year: number
  expected_days: number
  response_available: boolean
  available_days: number
  observed_count: number
  value: number | null
  hot_on_paired_days: number
  dry_on_paired_days: number
}

function validNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function indexRecords(dataset: DailyDataset) {
  if (!Number.isInteger(dataset.start) || !Number.isInteger(dataset.end) || dataset.start < 1981 || dataset.start > dataset.end || dataset.end - dataset.start > 199) {
    throw new Error('Choose an ordered period of at most 200 complete calendar years from 1981.')
  }
  const days = new Map<string, DailyRecord>()
  for (const record of dataset.daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) continue
    const parsed = new Date(`${record.date}T00:00:00Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== record.date) continue
    const year = parsed.getUTCFullYear()
    if (year < dataset.start || year > dataset.end) continue
    const previous = days.get(record.date)
    // A repeated date cannot increase coverage. Conflicting copies are unusable.
    if (previous && (previous.tmax !== record.tmax || previous.precipitation !== record.precipitation)) {
      days.set(record.date, { date: record.date, tmax: null, tmin: null, precipitation: null })
    } else if (!previous) days.set(record.date, record)
  }
  return days
}

export function compoundDays(dataset: DailyDataset): CompoundDay[] {
  const indexed = indexRecords(dataset)
  const rows: CompoundDay[] = []
  const stop = Date.UTC(dataset.end + 1, 0, 1)
  for (let time = Date.UTC(dataset.start, 0, 1); time < stop; time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10)
    const record = indexed.get(date)
    const tmax = validNumber(record?.tmax) ? record.tmax : null
    const precipitation = validNumber(record?.precipitation) && record.precipitation >= 0 ? record.precipitation : null
    rows.push({ date, response_available: !!record, tmax, precipitation,
      hot_dry: tmax !== null && precipitation !== null ? Number(tmax > 30 && precipitation < 1) as 0 | 1 : null })
  }
  return rows
}

export function compoundYears(dataset: DailyDataset): CompoundYear[] {
  const days = compoundDays(dataset)
  const years: CompoundYear[] = []
  let cursor = 0
  for (let year = dataset.start; year <= dataset.end; year++) {
    const expected = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000
    const annual = days.slice(cursor, cursor + expected)
    cursor += expected
    const paired = annual.filter(day => day.hot_dry !== null)
    const observed = paired.reduce((sum, day) => sum + day.hot_dry!, 0)
    years.push({ year, expected_days: expected, response_available: annual.some(day => day.response_available),
      available_days: paired.length, observed_count: observed, value: paired.length === expected ? observed : null,
      hot_on_paired_days: paired.filter(day => day.tmax! > 30).length,
      dry_on_paired_days: paired.filter(day => day.precipitation! < 1).length })
  }
  return years
}

function metadata(dataset: DailyDataset) {
  const fields = [
    ['provider', 'NASA POWER Daily API'], ['latitude', dataset.lat], ['longitude', dataset.lon],
    ['start_year', dataset.start], ['end_year', dataset.end], ['time_standard', 'LST'],
    ['compound_event', compoundThreshold],
    ['units', 'Tmax: C; precipitation: mm/day; annual compound counts: days'],
    ['meaning', 'A hot day with less than 1 mm precipitation; not an indicator of soil moisture, drought duration, vegetation damage or causation'],
    ['quality', 'An exact annual value requires paired Tmax and precipitation on every calendar day. Incomplete observed counts are lower bounds, not extrapolated estimates. Missing paired observations remain blank.'],
    ['inference', 'Descriptive annual counts only; no significance test or causal inference is performed for this compound index.'],
    ['spatial_support', 'NASA model grid cell, not an individual weather station or street'],
    ['unavailable_batches', dataset.failures.map(item => `${item.start}-${item.end}: ${item.message}`).join(' | ') || 'none'],
    ...dataset.sources.flatMap((source, index) => [
      [`source_${index + 1}_years`, `${source.start}-${source.end}`], [`source_${index + 1}_name`, source.source],
      [`source_${index + 1}_url`, source.source_url], [`source_${index + 1}_retrieved_at`, source.retrieved_at],
      [`source_${index + 1}_origin`, source.data_origin],
    ]),
    ['warnings', dataset.warnings.join(' | ')],
  ]
  return fields.map(([key, value]) => `# ${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
}

export function compoundAnnualCsv(dataset: DailyDataset) {
  return [...metadata(dataset),
    'year,response_available,expected_days,paired_available_days,hot_dry_days,observed_hot_dry_days,hot_days_among_paired_days,dry_days_among_paired_days',
    ...compoundYears(dataset).map(row => [row.year, Number(row.response_available), row.expected_days, row.available_days,
      row.value ?? '', row.available_days ? row.observed_count : '',
      row.available_days ? row.hot_on_paired_days : '', row.available_days ? row.dry_on_paired_days : '',
    ].join(',')),
  ].join('\r\n')
}

export function compoundObservationsCsv(dataset: DailyDataset) {
  return [...metadata(dataset), 'date,response_available,tmax_C,precipitation_mm_day,hot_and_dry_day',
    ...compoundDays(dataset).map(row => [row.date, Number(row.response_available), row.tmax ?? '', row.precipitation ?? '', row.hot_dry ?? ''].join(',')),
  ].join('\r\n')
}
