const documentationUrl = 'https://modis.ornl.gov/documentation.html'
const productUrl = 'https://modis.gsfc.nasa.gov/data/dataprod/mod13.php'
const band = '250m_16_days_NDVI'

export type ImportedVegetation = {
  product: 'MOD13Q1'
  band: string
  collection: string
  unit: 'NDVI'
  latitude: number
  longitude: number
  requested_latitude: number
  requested_longitude: number
  start: number
  end: number
  series: { date: string; value: number | null; available_composites: number; expected_composites: number; received_composites: number }[]
  composites: { date: string; value: number | null; valid_pixels: number; total_pixels: number }[]
  samples: number
  lines: number
  spatial_support: string
  source: string
  source_url: string
  product_url: string
  filename: string
  imported_at: string
  data_origin: 'import'
  warnings: string[]
}

// ORNL's filtered_scaled files retain six identifying columns, followed by
// already-scaled pixels or F for pixels rejected by the service's QC/mask.
function csvRows(text: string): string[][] {
  if (!text.trim()) throw new Error('The NDVI file is empty.')
  if (text.length > 25_000_000) throw new Error('Choose an ORNL subset CSV smaller than 25 MB.')
  if (text.includes('\0')) throw new Error('The NDVI file must be a text CSV.')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closedQuote = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closedQuote = true }
      else field += char
      continue
    }
    if (char === '"') {
      if (field.trim() || closedQuote) throw new Error('The NDVI CSV has malformed quoted fields.')
      quoted = true
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field.trim()); field = ''; closedQuote = false
      if (char !== ',') {
        if (row.some(value => value !== '')) rows.push(row)
        row = []
        if (char === '\r' && text[i + 1] === '\n') i++
      }
    } else {
      if (closedQuote && char.trim()) throw new Error('The NDVI CSV has content after a quoted field.')
      field += char
    }
  }
  if (quoted) throw new Error('The NDVI CSV has an unterminated quoted field.')
  row.push(field.trim())
  if (row.some(value => value !== '')) rows.push(row)
  if (!rows.length) throw new Error('The NDVI file has no data rows.')
  return rows
}

function acquisitionDate(code: string): string {
  const match = /^A(\d{4})(\d{3})$/.exec(code)
  if (!match) throw new Error('An NDVI acquisition date must use ORNL AYYYYDDD format.')
  const year = Number(match[1]), day = Number(match[2])
  const maximum = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000
  if (year < 2000 || year > 2100 || day < 1 || day > maximum || (day - 1) % 16 !== 0 || year === 2000 && day < 49) {
    throw new Error('The NDVI file contains an invalid MOD13Q1 16-day acquisition date.')
  }
  return new Date(Date.UTC(year, 0, day)).toISOString().slice(0, 10)
}

function validProcessingDate(code: string, acquired: string) {
  if (!/^\d{13}$/.test(code)) return false
  const year = Number(code.slice(0, 4)), day = Number(code.slice(4, 7))
  const maximum = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000
  if (year < 2000 || year > 2100 || day < 1 || day > maximum || Number(code.slice(7, 9)) > 23 || Number(code.slice(9, 11)) > 59 || Number(code.slice(11, 13)) > 59) return false
  return Date.UTC(year, 0, day) >= Date.parse(`${acquired}T00:00:00Z`)
}

function monthlySchedule(year: number, month: number) {
  if (year < 2000) return []
  const maximum = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000
  const dates = []
  for (let day = year === 2000 ? 49 : 1; day <= maximum; day += 16) {
    const date = new Date(Date.UTC(year, 0, day))
    if (date.getUTCMonth() + 1 === month) dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

export function parseVegetationCsv(text: string, filename: string, selectedLocation: { lat: number; lon: number }, start: number, end: number): ImportedVegetation {
  if (!/^filtered_scaled_250m_16_days_NDVI(?:_landcovermask)?(?: \(\d+\))?\.csv$/i.test(filename)) {
    throw new Error('Choose the ORNL filtered_scaled_250m_16_days_NDVI.csv file, with optional _landcovermask suffix. Raw or statistics CSV files cannot substitute for filtered pixels.')
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1981 || start > end || end > 2100) throw new Error('Choose an ordered analysis period from 1981 to 2100.')
  if (!Number.isFinite(selectedLocation.lat) || Math.abs(selectedLocation.lat) > 90 || !Number.isFinite(selectedLocation.lon) || Math.abs(selectedLocation.lon) > 180) throw new Error('Choose a valid location before importing vegetation data.')
  const parsed = csvRows(text.replace(/^\uFEFF/, ''))
  const acquisitions = new Map<string, { date: string; value: number | null; valid_pixels: number; total_pixels: number }>()
  let footprint: { lat: number; lon: number; samples: number; lines: number; collection: string } | undefined
  for (const [rowIndex, row] of parsed.entries()) {
    const fail = (message: string): never => { throw new Error(`NDVI row ${rowIndex + 1}: ${message}`) }
    if (row.length < 7 || row[1] !== 'MOD13Q1' || row[5] !== band) fail('expected six ORNL MOD13Q1 NDVI metadata fields followed by filtered, scaled pixels.')
    const uid = /^MOD13Q1\.(A\d{7})\.h\d{2}v\d{2}\.(\d{3})\.(\d{13})\.250m_16_days_NDVI$/.exec(row[0])
    if (!uid || uid[1] !== row[2] || uid[3] !== row[4]) fail('the unique row identifier does not match its product, acquisition or processing metadata.')
    const date = acquisitionDate(row[2])
    if (!validProcessingDate(row[4], date)) fail('the processing date is invalid or precedes acquisition.')
    const center = /^Lat([+-]?(?:\d+(?:\.\d*)?|\.\d+))Lon([+-]?(?:\d+(?:\.\d*)?|\.\d+))Samp(\d+)Line(\d+)$/.exec(row[3])
    if (!center) fail('the subset center and pixel rectangle are missing or malformed.')
    const lat = Number(center![1]), lon = Number(center![2]), samples = Number(center![3]), lines = Number(center![4])
    const count = samples * lines
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || samples < 1 || lines < 1 || count > 100000 || row.length !== 6 + count) fail('pixel count must match the declared bounded Samp × Line rectangle.')
    const longitudeDistance = Math.abs(((lon - selectedLocation.lon + 180) % 360 + 360) % 360 - 180)
    if (Math.abs(lat - selectedLocation.lat) > 0.010000001 || longitudeDistance > 0.010000001) fail('the CSV subset center does not match the selected location within 0.01 degrees.')
    if (footprint && (footprint.lat !== lat || footprint.lon !== lon || footprint.samples !== samples || footprint.lines !== lines || footprint.collection !== uid![2])) fail('all acquisitions must use one center, pixel rectangle and collection.')
    footprint ??= { lat, lon, samples, lines, collection: uid![2] }
    if (acquisitions.has(date)) fail('duplicate acquisition dates are not allowed.')
    const pixels = row.slice(6).filter(value => value !== 'F').map(value => {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return fail('pixels must be finite scaled NDVI numbers or the ORNL quality flag F.')
      const number = Number(value)
      if (!Number.isFinite(number) || number < -0.2 || number > 1 || Math.abs(number * 10000 - Math.round(number * 10000)) > 0.00001) fail('NDVI pixels must already be scaled MOD13Q1 values from −0.2 to 1 in 0.0001 steps; raw values are not accepted.')
      return number
    })
    const value = pixels.length >= count / 2 ? pixels.reduce((sum, number) => sum + number, 0) / pixels.length : null
    acquisitions.set(date, { date, value, valid_pixels: pixels.length, total_pixels: count })
  }
  if (!footprint) throw new Error('The NDVI file has no usable subset metadata.')
  const composites = [...acquisitions.values()].filter(row => Number(row.date.slice(0, 4)) >= start && Number(row.date.slice(0, 4)) <= end).sort((a, b) => a.date.localeCompare(b.date))
  if (!composites.length) throw new Error('The NDVI file has no acquisitions in the selected analysis period.')
  const series: ImportedVegetation['series'] = []
  for (let year = start; year <= end; year++) for (let month = 1; month <= 12; month++) {
    const schedule = monthlySchedule(year, month)
    const received = schedule.flatMap(date => acquisitions.has(date) ? [acquisitions.get(date)!] : [])
    const available = received.filter(row => row.value !== null)
    series.push({ date: `${year}-${String(month).padStart(2, '0')}-01`,
      value: schedule.length > 0 && available.length === schedule.length ? available.reduce((sum, row) => sum + row.value!, 0) / available.length : null,
      available_composites: available.length, expected_composites: schedule.length, received_composites: received.length })
  }
  return {
    product: 'MOD13Q1', band, collection: footprint.collection, unit: 'NDVI',
    latitude: footprint.lat, longitude: footprint.lon, requested_latitude: selectedLocation.lat, requested_longitude: selectedLocation.lon,
    start, end, series, composites, samples: footprint.samples, lines: footprint.lines,
    spatial_support: `ORNL requested subset centered at ${footprint.lat}, ${footprint.lon}; ${footprint.samples} × ${footprint.lines} nominal 250 m MODIS pixels on the native sinusoidal grid. This footprint differs from the NASA POWER meteorological grid cell.`,
    source: 'User-provided ORNL MOD13Q1 filtered/scaled NDVI CSV', source_url: documentationUrl, product_url: productUrl,
    filename, imported_at: new Date().toISOString(), data_origin: 'import', warnings: [
      'The imported file is user-provided. Its ORNL metadata, location, pixel values and format were checked, but its origin and prior quality filtering have not been independently authenticated.',
      'F is treated as a pixel rejected by the file provider. A composite needs at least 50% accepted pixels; otherwise its value is missing.',
      'Monthly values are equally weighted means of all scheduled 16-day composite-start values assigned to that calendar month. This is an exploratory monthly proxy, not a day-weighted calendar-month vegetation product.',
      'Every scheduled composite in a month must be present and pass the pixel coverage requirement; incomplete months remain gaps.',
      'NDVI measures vegetation greenness, not crop yield or drought damage. Comparisons with weather link different spatial footprints and do not establish causation.',
      ...(start < 2000 ? ['MOD13Q1 begins in February 2000. Earlier requested months have no expected or available observations.'] : []),
      ...(acquisitions.size !== composites.length ? ['Acquisitions outside the requested period were validated and excluded from the analysis.'] : []),
    ],
  }
}
