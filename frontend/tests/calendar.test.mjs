import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarAmount, calendarCsv, calendarValue } from '../src/lib/calendarData.ts'
import { evidenceFor } from '../src/lib/evidence.ts'

const analysis = { method: 'Yearly OLS + HAC(1 annual lag)', lag_unit: 'years', hac_lags: 1,
  slope_per_year: 0.0123456, slope_per_decade: 0.123456, ci95_per_decade: [0.01, 0.2], p_value: 0.01, sample_size: 30 }
const period = { id: 'djf', label: 'Dec–Feb (DJF)', months: [12, 1, 2], crosses_year: true,
  analysis, warnings: [], points: [
    { year: 2023, value: 0, baseline_value: 0, anomaly: 0, available_months: 3, expected_months: 3 },
    { year: 2024, value: null, baseline_value: 1, anomaly: null, available_months: 2, expected_months: 3 },
  ] }
const result = { source: 'Test fixture', source_url: 'https://example.test/nasa', retrieved_at: '2026-11-14T00:00:00Z',
  data_origin: 'snapshot', latitude: 50, longitude: 14, variable: 'T2M', unit: 'C', original_unit: 'C',
  start: 2023, end: 2024, baseline_start: 1991, baseline_end: 2020, normals: [], periods: [period], warnings: [] }

test('anomaly and observed value remain distinct, including a true zero', () => {
  const point = { ...period.points[0], value: 10, baseline_value: 12, anomaly: -2 }
  assert.equal(calendarValue(point, 'anomaly'), -2)
  assert.equal(calendarValue(point, 'values'), 10)
  assert.equal(calendarValue(period.points[0], 'anomaly'), 0)
  assert.equal(calendarValue(period.points[1], 'anomaly'), null)
})

test('missing values are never formatted as zero, and rounded zero has no sign', () => {
  assert.equal(calendarAmount(null), '—')
  assert.equal(calendarAmount(0), '0.00')
  assert.equal(calendarAmount(-0.0001), '0.00')
  assert.equal(calendarAmount(-0.0001, true), '0.00')
  assert.equal(calendarAmount(1.5, true), '+1.50')
})

test('calendar export preserves the fixed reference, cross-year convention and full precision', () => {
  const csv = calendarCsv(result, period)
  assert.match(csv, /# baseline: 1991-2020; separate calendar-month normals; all 30 years required/)
  assert.match(csv, /# year_convention: December of previous year; January and February of labelled year/)
  assert.match(csv, /# slope_per_decade: 0.123456/)
  assert.match(csv, /# trend_lag_unit: years/)
  assert.match(csv, /# data_origin: snapshot/)
  assert.ok(csv.endsWith('2023,0,0,0,3,3\r\n2024,,1,,2,3'))
})

test('precipitation export documents totals in mm derived from rates in mm/day', () => {
  const csv = calendarCsv({ ...result, variable: 'PRECTOTCORR', unit: 'mm', original_unit: 'mm/day', baseline_start: null, baseline_end: null }, period)
  assert.match(csv, /# unit: mm\r\n/)
  assert.match(csv, /# original_unit: mm\/day/)
  assert.match(csv, /# aggregation: sum of monthly mm\/day times actual days in month/)
  assert.match(csv, /# baseline: not applicable/)
})

test('annual inference is not described as the monthly seasonal model', () => {
  const evidence = evidenceFor(analysis, 'yearly linear model')
  assert.match(evidence.conclusion, /yearly linear model/)
  assert.doesNotMatch(evidence.conclusion, /seasonal linear model/)
})
