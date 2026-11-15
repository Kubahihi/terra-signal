import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { atlasColor, atlasColorStops, atlasLegend, atlasMissingColor } from '../src/lib/atlasLayers.ts'
import { atlasAnnualValue, atlasScale, parseTrendAtlas } from '../src/lib/trendAtlas.ts'

const signed = { maximum: 10, signed: true, unit: 'days / decade' }
const annual = { maximum: 100, signed: false, unit: 'days' }
const rgb = color => [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16))
const luminance = color => rgb(color).map(channel => channel / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)

test('signed colors preserve both directions, the neutral zero and distinct missing observations', () => {
  const stops = atlasColorStops(signed)
  assert.equal(atlasColor(-10, signed), stops[0].color)
  assert.equal(atlasColor(0, signed), stops[1].color)
  assert.equal(atlasColor(10, signed), stops[2].color)
  assert.notEqual(atlasColor(-5, signed), atlasColor(5, signed))
  for (const value of [null, NaN, Infinity, -Infinity]) assert.equal(atlasColor(value, signed), atlasMissingColor)
  assert.notEqual(atlasColor(0, signed), atlasMissingColor)
  assert.notEqual(atlasColor(0, annual), atlasMissingColor)
})

test('annual color intensity changes continuously and monotonically with the count', () => {
  const colors = Array.from({ length: 101 }, (_, value) => atlasColor(value, annual))
  assert.equal(colors[0], atlasColorStops(annual)[0].color)
  assert.equal(colors[50], atlasColorStops(annual)[1].color)
  assert.equal(colors[100], atlasColorStops(annual)[2].color)
  assert.equal(new Set(colors).size, 101)
  for (let index = 1; index < colors.length; index++) assert.ok(luminance(colors[index]) < luminance(colors[index - 1]))
})

test('trend intensity grows away from neutral on each side, while out-of-domain values clamp', () => {
  for (const sign of [-1, 1]) {
    let previous = luminance(atlasColor(0, signed))
    for (let value = 1; value <= 10; value++) {
      const next = luminance(atlasColor(sign * value, signed))
      assert.ok(next < previous)
      previous = next
    }
  }
  assert.equal(atlasColor(-100, signed), atlasColor(-10, signed))
  assert.equal(atlasColor(100, signed), atlasColor(10, signed))
  assert.equal(atlasColor(-1, annual), atlasColor(0, annual))
  assert.equal(atlasColor(101, annual), atlasColor(100, annual))
})

test('legend ticks and CSS gradient use the exact same domain, units and palette as map marks', () => {
  for (const scale of [signed, annual]) {
    const legend = atlasLegend(scale)
    assert.equal(legend.unit, scale.unit)
    assert.equal(legend.minimum, scale.signed ? -scale.maximum : 0)
    assert.deepEqual(legend.ticks.map(tick => tick.value), scale.signed ? [-10, 0, 10] : [0, 50, 100])
    assert.deepEqual(legend.ticks.map(tick => tick.position), [0, 0.5, 1])
    for (const tick of legend.ticks) assert.equal(tick.color, atlasColor(tick.value, scale))
    for (const stop of atlasColorStops(scale)) assert.ok(legend.gradient.includes(`${stop.color} ${stop.offset * 100}%`))
  }
  assert.equal(atlasColor(5, { ...signed, maximum: NaN }), atlasMissingColor)
  assert.throws(() => atlasLegend({ ...signed, maximum: 0 }), /finite positive/)
})

test('real archive colors use a fixed full-record scale across years and both comparison places', () => {
  const data = parseTrendAtlas(JSON.parse(readFileSync(new URL('../public/data/daily-example-analysis-1981-2025.json', import.meta.url), 'utf8')))
  const scale = atlasScale(data, 'hot_days', 'year')
  const legend = atlasLegend(scale)
  const expectedMaximum = Math.max(...data.points.flatMap(point => point.years.map(row => row.hot_days.value)))
  assert.equal(legend.maximum, expectedMaximum)
  const seen = new Map()
  for (const point of data.points) for (const year of point.years) {
    const count = atlasAnnualValue(point, 'hot_days', year.year)
    const color = atlasColor(count, scale)
    if (seen.has(count)) assert.equal(color, seen.get(count))
    seen.set(count, color)
  }
  const trendScale = atlasScale(data, 'frost_days', 'trend')
  assert.equal(atlasLegend(trendScale).minimum, -trendScale.maximum)
  assert.equal(atlasLegend(trendScale).ticks[1].value, 0)
})
