export type Location = { id?: string; name: string; lat: number; lon: number }

export const exampleLocations: Location[] = [
  { id: 'prague', name: 'Prague, Czechia', lat: 50.0755, lon: 14.4378 },
  { id: 'medicine-hat', name: 'Medicine Hat, Canada', lat: 50.0405, lon: -110.6765 },
  { id: 'brno', name: 'Brno, Czechia', lat: 49.1951, lon: 16.6068 },
  { id: 'ostrava', name: 'Ostrava, Czechia', lat: 49.8209, lon: 18.2625 },
  { id: 'berlin', name: 'Berlin, Germany', lat: 52.52, lon: 13.405 },
  { id: 'london', name: 'London, United Kingdom', lat: 51.5074, lon: -0.1278 },
  { id: 'athens', name: 'Athens, Greece', lat: 37.9838, lon: 23.7275 },
  { id: 'phoenix', name: 'Phoenix, USA', lat: 33.4484, lon: -112.074 },
  { id: 'sydney', name: 'Sydney, Australia', lat: -33.8688, lon: 151.2093 },
  { id: 'nairobi', name: 'Nairobi, Kenya', lat: -1.2921, lon: 36.8219 },
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
