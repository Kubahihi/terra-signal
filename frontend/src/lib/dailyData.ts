import type { DailyDataset, DailyMetric, DailyQuery, DailyRange, DailyResponse } from '../types/api'

export const dailyMetrics: { id: DailyMetric; title: string; rule: string; question: string }[] = [
  { id: 'hot_days', title: 'Hot days', rule: 'Daily Tmax > 30 °C', question: 'Are hot days becoming more common?' },
  { id: 'frost_days', title: 'Frost days', rule: 'Daily Tmin < 0 °C', question: 'Are frost days becoming less common?' },
  { id: 'warm_nights', title: 'Warm nights', rule: 'Daily Tmin > 20 °C · proxy', question: 'Are warm nights becoming more common?' },
  { id: 'longest_dry_spell', title: 'Longest dry spell', rule: 'Consecutive days with P < 1 mm/day', question: 'How long did the longest dry spell last?' },
]

export function dailyBatches(start: number, end: number, lastYear: number): DailyRange[] {
  const batches = []
  for (let first = 1981 + Math.floor((start - 1981) / 5) * 5; first <= end; first += 5) {
    batches.push({ start: first, end: Math.min(first + 4, lastYear) })
  }
  return batches
}

export function combineDaily(reports: DailyResponse[], query: DailyQuery, failures: DailyDataset['failures']): DailyDataset {
  if (reports.some(report => report.latitude !== query.lat || report.longitude !== query.lon || report.time_standard !== 'LST')) {
    throw new Error('A daily response does not match the selected location or time standard.')
  }
  const days = new Map<string, DailyResponse['daily'][number]>()
  const years = new Map<number, DailyResponse['years'][number]>()
  for (const report of reports) {
    for (const day of report.daily) {
      const year = Number(day.date.slice(0, 4))
      if (year >= query.start && year <= query.end) days.set(day.date, day)
    }
    for (const year of report.years) if (year.year >= query.start && year.year <= query.end) years.set(year.year, year)
  }
  return {
    ...query, daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    years: [...years.values()].sort((a, b) => a.year - b.year),
    sources: reports.map(({ start, end, source, source_url, retrieved_at, data_origin }) => ({ start, end, source, source_url, retrieved_at, data_origin })),
    warnings: [...new Set(reports.flatMap(report => report.warnings))], failures,
  }
}

function metadata(dataset: DailyDataset) {
  const fields = [
    ['provider', 'NASA POWER Daily API'], ['latitude', dataset.lat], ['longitude', dataset.lon],
    ['start_year', dataset.start], ['end_year', dataset.end], ['time_standard', 'LST'],
    ['units', 'Tmax and Tmin: C; daily precipitation: mm/day; annual counts and run lengths: days'],
    ['hot_days', 'T2M_MAX > 30 C'], ['frost_days', 'T2M_MIN < 0 C'],
    ['warm_nights', 'T2M_MIN > 20 C; daily-minimum proxy, not nighttime-only observations'],
    ['dry_spell', 'consecutive PRECTOTCORR < 1 mm/day; clipped to calendar year; earliest run on ties'],
    ['quality', 'exact annual values require all 365/366 relevant days; observed values are lower bounds; gaps interrupt dry spells'],
    ['unavailable_batches', dataset.failures.map(item => `${item.start}-${item.end}: ${item.message}`).join(' | ') || 'none'],
    ...dataset.sources.flatMap((source, index) => [
      [`source_${index + 1}_years`, `${source.start}-${source.end}`], [`source_${index + 1}_url`, source.source_url],
      [`source_${index + 1}_retrieved_at`, source.retrieved_at], [`source_${index + 1}_origin`, source.data_origin],
    ]),
    ['warnings', dataset.warnings.join(' | ')],
  ]
  return fields.map(([key, value]) => `# ${key}: ${String(value).replace(/[\r\n]+/g, ' ')}`)
}

export function dailyAnnualCsv(dataset: DailyDataset) {
  const rows = ['year,response_available,expected_days,hot_days,hot_observed,hot_available_days,frost_days,frost_observed,frost_available_days,warm_nights,warm_observed,warm_available_days,longest_dry_spell,dry_observed,dry_available_days,dry_start,dry_end,touches_year_boundary']
  for (let year = dataset.start; year <= dataset.end; year++) {
    const row = dataset.years.find(item => item.year === year)
    rows.push([year, row ? 1 : 0, row?.expected_days ?? '',
      ...dailyMetrics.flatMap(({ id }) => [row?.[id].value ?? '', row?.[id].observed_count ?? '', row?.[id].available_days ?? '']),
      row?.longest_dry_spell.start_date ?? '', row?.longest_dry_spell.end_date ?? '',
      row ? Number(row.longest_dry_spell.touches_year_boundary) : '',
    ].join(','))
  }
  return [...metadata(dataset), ...rows].join('\r\n')
}

export function dailyObservationsCsv(dataset: DailyDataset) {
  const flag = (value: number | null, condition: (number: number) => boolean) => value === null ? '' : Number(condition(value))
  return [...metadata(dataset), 'date,tmax_C,tmin_C,precipitation_mm_day,hot_day,frost_day,warm_night_proxy,dry_day',
    ...dataset.daily.map(day => [day.date, day.tmax ?? '', day.tmin ?? '', day.precipitation ?? '',
      flag(day.tmax, value => value > 30), flag(day.tmin, value => value < 0),
      flag(day.tmin, value => value > 20), flag(day.precipitation, value => value < 1),
    ].join(',')),
  ].join('\r\n')
}
