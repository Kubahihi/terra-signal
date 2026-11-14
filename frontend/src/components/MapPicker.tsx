import { useEffect, useId, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { locationAt, type Location } from '../lib/locations'
import Icon from './Icon'
import './MapPicker.css'

export default function MapPicker({ location, onSelect, comparisonLocation, onComparisonSelect, activePoint = 'a', visible = true }: {
  location: Location; onSelect: (location: Location) => void
  comparisonLocation?: Location; onComparisonSelect?: (location: Location) => void; activePoint?: 'a' | 'b'
  visible?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const comparisonMarkerRef = useRef<L.Marker | null>(null)
  const initial = useRef(location)
  const selectRef = useRef(onSelect)
  const primarySelectRef = useRef(onSelect)
  const comparisonSelectRef = useRef(onComparisonSelect)
  const selectionTimer = useRef<number | undefined>(undefined)
  const [tileError, setTileError] = useState(false)
  const [zoom, setZoom] = useState(4)
  const [expanded, setExpanded] = useState(false)
  const instructionId = useId()
  primarySelectRef.current = onSelect
  comparisonSelectRef.current = onComparisonSelect
  selectRef.current = activePoint === 'b' && comparisonLocation && onComparisonSelect ? onComparisonSelect : onSelect

  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, {
      center: [initial.current.lat, initial.current.lon], zoom: 4, minZoom: 2, maxZoom: 13,
      zoomControl: false, worldCopyJump: true, scrollWheelZoom: true,
      wheelPxPerZoomLevel: 100, wheelDebounceTime: 60,
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
    // Give a double-click time to become a zoom gesture instead of moving a pin.
    const cancelSelection = () => window.clearTimeout(selectionTimer.current)
    map.on('click', (event: L.LeafletMouseEvent) => {
      cancelSelection()
      if (event.originalEvent.detail > 1) return
      const point = event.latlng
      const select = selectRef.current
      selectionTimer.current = window.setTimeout(() => select(locationAt(Math.max(-90, Math.min(90, point.lat)), point.lng)), 300)
    })
    map.on('dblclick dragstart zoomstart', cancelSelection)
    map.on('zoomend', () => setZoom(map.getZoom()))
    let resizeFrame = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || !entry.contentRect.width || !entry.contentRect.height) return
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    })
    observer.observe(container.current)
    return () => { cancelSelection(); window.cancelAnimationFrame(resizeFrame); observer.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; comparisonMarkerRef.current = null }
  }, [])

  useEffect(() => {
    if (!visible) {
      window.clearTimeout(selectionTimer.current)
      setExpanded(false)
      return
    }
    const frame = window.requestAnimationFrame(() => mapRef.current?.invalidateSize({ animate: false }))
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    expandButton.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); return }
      if (event.key !== 'Tab') return
      const controls = stage.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
      expandButton.current?.focus({ preventScroll: true })
    }
  }, [expanded])

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

  return <div ref={stage} className={`map-stage interactive-map${expanded ? ' map-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label={expanded ? 'Expanded location map' : undefined}>
    <div ref={container} className="location-map" role="region" aria-describedby={instructionId} aria-label={`Interactive location map. Click to select point ${comparisonLocation && activePoint === 'b' ? 'B' : 'A'}, or enter coordinates below.`} />
    <div className="map-tools">
      <button ref={expandButton} type="button" className="map-tool" aria-label={expanded ? 'Close expanded map' : 'Expand map'} title={expanded ? 'Close map (Esc)' : 'Expand map'} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={expanded ? 'M6 6l12 12M6 18 18 6' : 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5'} /></svg></button>
      <button type="button" className="map-tool" aria-label="Center map on selected point" title="Center on selected point" onClick={() => { const point = comparisonLocation && activePoint === 'b' ? comparisonLocation : location; mapRef.current?.setView([point.lat, point.lon], 5, { animate: false }) }}><Icon name="target" /></button>{comparisonLocation && <button type="button" className="map-tool" aria-label="Show both comparison points" title="Show both points" onClick={() => mapRef.current?.fitBounds([[location.lat, location.lon], [comparisonLocation.lat, comparisonLocation.lon]], { padding: [45, 45], maxZoom: 7, animate: false })}><Icon name="pin" /></button>}<button type="button" className="map-tool" aria-label="Show world map" title="Show world map" onClick={() => mapRef.current?.setView([25, 0], 2, { animate: false })}><Icon name="globe" /></button>
    </div>
    <div className="map-instruction map-interactive-instruction" id={instructionId}><Icon name="pin" /><div><span>{comparisonLocation ? `Click to move point ${activePoint.toUpperCase()}` : 'Click to explore a location'}</span><small><span className="map-desktop-hint">Scroll to zoom · Drag to pan · Double-click to zoom</span><span className="map-touch-hint">Pinch to zoom · Drag to pan · Tap to select</span></small></div></div>
    <output className="map-zoom-readout" aria-label="Map zoom level" aria-live="polite">Zoom {zoom}</output>
    {tileError && <p className="map-unavailable" role="status">Some map tiles are unavailable. You can still select a point or enter coordinates below.</p>}
  </div>
}
