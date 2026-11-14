import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { locationAt, type Location } from '../lib/locations'
import Icon from './Icon'

export default function MapPicker({ location, onSelect, comparisonLocation, onComparisonSelect, activePoint = 'a' }: {
  location: Location; onSelect: (location: Location) => void
  comparisonLocation?: Location; onComparisonSelect?: (location: Location) => void; activePoint?: 'a' | 'b'
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const comparisonMarkerRef = useRef<L.Marker | null>(null)
  const initial = useRef(location)
  const selectRef = useRef(onSelect)
  const primarySelectRef = useRef(onSelect)
  const comparisonSelectRef = useRef(onComparisonSelect)
  const [tileError, setTileError] = useState(false)
  primarySelectRef.current = onSelect
  comparisonSelectRef.current = onComparisonSelect
  selectRef.current = activePoint === 'b' && comparisonLocation && onComparisonSelect ? onComparisonSelect : onSelect

  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, {
      center: [initial.current.lat, initial.current.lon], zoom: 4, minZoom: 2, maxZoom: 13,
      zoomControl: false, worldCopyJump: true, scrollWheelZoom: false,
    })
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map)
    map.attributionControl.setPrefix('<a href="https://leafletjs.com/" target="_blank" rel="noreferrer">Leaflet</a>')
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      className: 'base-map-tiles',
    }).addTo(map)
    tiles.on('tileerror', () => setTileError(true))
    tiles.on('tileload', () => setTileError(false))
    const marker = L.marker([initial.current.lat, initial.current.lon], {
      icon: L.divIcon({ className: 'selected-marker', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
      draggable: true, title: 'Point A. Drag to move.', alt: 'Point A. Drag to move.',
    }).addTo(map)
    markerRef.current = marker
    marker.on('dragend', () => { const point = marker.getLatLng(); primarySelectRef.current(locationAt(Math.max(-90, Math.min(90, point.lat)), point.lng)) })
    map.on('click', (event: L.LeafletMouseEvent) => selectRef.current(locationAt(Math.max(-90, Math.min(90, event.latlng.lat)), event.latlng.lng)))
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container.current)
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; comparisonMarkerRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    markerRef.current?.setLatLng([location.lat, location.lon])
    if (map && !map.getBounds().pad(-0.15).contains([location.lat, location.lon])) {
      map.setView([location.lat, location.lon], Math.max(3, Math.min(map.getZoom(), 5)), { animate: false })
    }
  }, [location.lat, location.lon])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current?.setIcon(L.divIcon({ className: `selected-marker${comparisonLocation ? ' labelled-marker' : ''}`, html: `<span>${comparisonLocation ? 'A' : ''}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }))
    if (!comparisonLocation) { comparisonMarkerRef.current?.remove(); comparisonMarkerRef.current = null; return }
    if (!comparisonMarkerRef.current) {
      const marker = L.marker([comparisonLocation.lat, comparisonLocation.lon], {
        icon: L.divIcon({ className: 'selected-marker comparison-marker labelled-marker', html: '<span>B</span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
        draggable: true, title: 'Point B. Drag to move.', alt: 'Point B. Drag to move.',
      }).addTo(map)
      marker.on('dragend', () => { const point = marker.getLatLng(); comparisonSelectRef.current?.(locationAt(Math.max(-90, Math.min(90, point.lat)), point.lng)) })
      comparisonMarkerRef.current = marker
    }
    comparisonMarkerRef.current.setLatLng([comparisonLocation.lat, comparisonLocation.lon])
  }, [comparisonLocation?.lat, comparisonLocation?.lon])

  return <div className="map-stage">
    <div ref={container} className="location-map" role="region" aria-label={`Interactive location map. Click to select point ${comparisonLocation && activePoint === 'b' ? 'B' : 'A'}, or enter coordinates below.`} />
    <div className="map-tools"><button type="button" className="map-tool" aria-label="Center map on selected point" title="Center on selected point" onClick={() => { const point = comparisonLocation && activePoint === 'b' ? comparisonLocation : location; mapRef.current?.setView([point.lat, point.lon], 5, { animate: false }) }}><Icon name="target" /></button>{comparisonLocation && <button type="button" className="map-tool" aria-label="Show both comparison points" title="Show both points" onClick={() => mapRef.current?.fitBounds([[location.lat, location.lon], [comparisonLocation.lat, comparisonLocation.lon]], { padding: [45, 45], maxZoom: 7, animate: false })}><Icon name="pin" /></button>}<button type="button" className="map-tool" aria-label="Show world map" title="Show world map" onClick={() => mapRef.current?.setView([25, 0], 2, { animate: false })}><Icon name="globe" /></button></div>
    <div className="map-instruction"><Icon name="pin" /><span>{comparisonLocation ? `Click to move point ${activePoint.toUpperCase()}` : 'Click to explore a location'}</span></div>
    {tileError && <p className="map-unavailable" role="status">Some map tiles are unavailable. You can still select a point or enter coordinates below.</p>}
  </div>
}
