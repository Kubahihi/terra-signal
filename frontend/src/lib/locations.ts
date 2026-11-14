export type Location = { id?: string; name: string; lat: number; lon: number }

export const exampleLocations: Location[] = [
  { id: 'prague', name: 'Prague, Czechia', lat: 50.0755, lon: 14.4378 },
  { id: 'medicine-hat', name: 'Medicine Hat, Canada', lat: 50.0405, lon: -110.6765 },
]

export function coordinates(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`
}

export function locationAt(lat: number, lon: number): Location {
  const latitude = Number(lat.toFixed(4))
  const longitude = Number(((lon + 180) % 360 + 360) % 360 - 180)
  const roundedLon = Number(longitude.toFixed(4))
  return exampleLocations.find(place => Math.abs(place.lat - latitude) < 0.00005 && Math.abs(place.lon - roundedLon) < 0.00005)
    ?? { name: 'Selected map point', lat: latitude, lon: roundedLon }
}
