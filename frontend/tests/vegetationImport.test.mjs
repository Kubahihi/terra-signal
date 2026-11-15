import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVegetationCsv } from '../src/lib/vegetationImport.ts'

const filename = 'filtered_scaled_250m_16_days_NDVI.csv'
const place = { lat: 49.1951, lon: 16.6068 }
const processing = '2026001000000'
function row(day, values = ['0.2', '0.4', '0.6', '0.8'], { year = 2024, center = 'Lat49.1951Lon16.6068Samp2Line2', collection = '061' } = {}) {
  const acquisition = `A${year}${String(day).padStart(3, '0')}`
  return [`MOD13Q1.${acquisition}.h19v04.${collection}.${processing}.250m_16_days_NDVI`, 'MOD13Q1', acquisition, center, processing, '250m_16_days_NDVI', ...values].join(',')
}
const parse = text => parseVegetationCsv(text, filename, place, 2024, 2024)

test('ORNL scaled pixels become equally weighted monthly composite-start means with provenance', () => {
  const result = parse(`\uFEFF${row(1)}\r\n${row(17, ['0.4', '0.6', 'F', 'F'])}\r\n`)
  assert.equal(result.product, 'MOD13Q1')
  assert.equal(result.collection, '061')
  assert.equal(result.series.length, 12)
  assert.deepEqual(result.series[0], { date: '2024-01-01', value: 0.5, available_composites: 2, expected_composites: 2, received_composites: 2 })
  assert.equal(result.composites[1].valid_pixels, 2)
  assert.equal(result.data_origin, 'import')
  assert.equal(result.filename, filename)
  assert.equal(result.latitude, place.lat)
  assert.match(result.source_url, /modis\.ornl\.gov\/documentation/)
  assert.match(result.spatial_support, /2 × 2 nominal 250 m/)
  assert.ok(result.warnings.some(warning => /not been independently authenticated/.test(warning)))
  assert.ok(result.warnings.some(warning => /not a day-weighted/.test(warning)))
})

test('missing or quality-failed composites leave the whole month missing rather than becoming zero', () => {
  const absent = parse(row(1))
  assert.equal(absent.series[0].value, null)
  assert.equal(absent.series[0].received_composites, 1)
  assert.equal(absent.series[0].available_composites, 1)
  const filtered = parse(`${row(1)}\n${row(17, ['0.5', 'F', 'F', 'F'])}`)
  assert.equal(filtered.composites[1].value, null)
  assert.equal(filtered.series[0].value, null)
  assert.equal(filtered.series[0].received_composites, 2)
  assert.equal(filtered.series[0].available_composites, 1)
  const zero = parse(`${row(1, ['0', '0', 'F', 'F'])}\n${row(17, ['0', '0', '0', '0'])}`)
  assert.equal(zero.series[0].value, 0)
})

test('locations, rectangles, collection and acquisition IDs cannot be silently relabelled', () => {
  assert.throws(() => parse(row(1, undefined, { center: 'Lat50Lon16.6068Samp2Line2' })), /does not match/)
  assert.throws(() => parse(`${row(1)}\n${row(17, undefined, { center: 'Lat49.1952Lon16.6068Samp2Line2' })}`), /one center/)
  assert.throws(() => parse(row(1, ['0.1', '0.2'])), /pixel count/)
  assert.throws(() => parse(`${row(1)}\n${row(17, undefined, { collection: '006' })}`), /one center.*collection/)
  assert.throws(() => parse(row(1).replace(',A2024001,', ',A2024017,')), /row identifier/)
  assert.throws(() => parse(`${row(1)}\n${row(1)}`), /duplicate acquisition/)
})

test('raw pixels, nonfinite values, missing strings and wrong file formats are rejected', () => {
  for (const value of ['4000', 'NaN', 'Infinity', '', '-0.3', '0.123456']) assert.throws(() => parse(row(1, [value, 'F', 'F', 'F'])), /pixels|scaled/)
  assert.throws(() => parseVegetationCsv(row(1), '250m_16_days_NDVI.csv', place, 2024, 2024), /filtered_scaled/)
  assert.throws(() => parse(row(1).replace(/250m_16_days_NDVI/g, '250m_16_days_EVI')), /NDVI metadata/)
  assert.throws(() => parse('"unfinished'), /unterminated/)
})

test('16-day dates respect calendar boundaries and product start while out-of-window rows are excluded', () => {
  assert.throws(() => parse(row(367)), /invalid MOD13Q1/)
  assert.throws(() => parse(row(2)), /invalid MOD13Q1/)
  assert.throws(() => parse(row(1, undefined, { year: 2000 })), /invalid MOD13Q1/)
  const old = parseVegetationCsv(row(49, ['0.1', '0.2', '0.3', '0.4'], { year: 2000 }), filename, place, 1981, 2000)
  assert.deepEqual(old.series[0], { date: '1981-01-01', value: null, available_composites: 0, expected_composites: 0, received_composites: 0 })
  assert.equal(old.series.find(point => point.date === '2000-01-01').value, null)
  assert.equal(old.series.find(point => point.date === '2000-02-01').expected_composites, 1)
  assert.equal(old.series.find(point => point.date === '2000-02-01').value, 0.25)
  const trimmed = parse(`${row(1, undefined, { year: 2023 })}\n${row(1)}\n${row(17)}`)
  assert.equal(trimmed.composites.length, 2)
  assert.ok(trimmed.warnings.some(warning => /outside the requested period/.test(warning)))
})

test('quoted ORNL fields and dateline-equivalent centers retain explicit actual coordinates', () => {
  const quoted = row(1).split(',').map(value => `"${value}"`).join(',')
  assert.equal(parse(quoted).composites.length, 1)
  const dateline = parseVegetationCsv(row(1, ['0.1', '0.2', '0.3', '0.4'], { center: 'Lat0Lon180Samp2Line2' }), filename, { lat: 0, lon: -180 }, 2024, 2024)
  assert.equal(dateline.longitude, 180)
  assert.equal(dateline.requested_longitude, -180)
})
