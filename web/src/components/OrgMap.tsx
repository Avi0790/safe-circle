import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LiveWorker, TrackPoint } from '../lib/crew'
import { hasPosition, workerFlags } from '../lib/crew'
import { getAvatarColor, getInitials } from '../lib/avatar'
import { escapeHtml } from '../lib/html'
import { timeAgo } from '../lib/format'

const DEFAULT_CENTER: [number, number] = [39.5, -98.35]

function workerIcon(w: LiveWorker, selected: boolean, stale: boolean): L.DivIcon {
  const ring = stale ? 'var(--stale)' : selected ? 'var(--accent)' : '#fff'
  return L.divIcon({
    className: 'map-avatar-marker',
    html: `<div class="map-avatar-ring" style="border-color:${ring}"><div class="avatar" style="width:32px;height:32px;font-size:13px;background-color:${getAvatarColor(w.user_id)}">${escapeHtml(getInitials(w.full_name))}</div></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  })
}

// Frames everyone once when positions first arrive, and the selected
// worker's path when one is chosen — but not on every 30-second refresh,
// which would yank the map away from wherever someone had panned to.
function Framing({ workers, track, selectedId }: { workers: LiveWorker[]; track: TrackPoint[]; selectedId: string | null }) {
  const map = useMap()
  const framedAll = useRef(false)
  const framedFor = useRef<string | null>(null)

  useEffect(() => {
    if (selectedId && track.length > 0 && framedFor.current !== selectedId) {
      framedFor.current = selectedId
      map.fitBounds(L.latLngBounds(track.map((p) => [p.latitude, p.longitude] as [number, number])), {
        padding: [60, 60],
        maxZoom: 16,
      })
      return
    }
    if (!selectedId) framedFor.current = null
    const placed = workers.filter(hasPosition)
    if (!framedAll.current && placed.length > 0) {
      framedAll.current = true
      map.fitBounds(L.latLngBounds(placed.map((w) => [w.latitude, w.longitude] as [number, number])), {
        padding: [60, 60],
        maxZoom: 15,
      })
    }
  }, [workers, track, selectedId, map])

  return null
}

export function OrgMap({
  workers,
  selectedId,
  track,
  onSelect,
}: {
  workers: LiveWorker[]
  selectedId: string | null
  track: TrackPoint[]
  onSelect: (id: string) => void
}) {
  const placed = workers.filter(hasPosition)

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={4} className="org-map" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Framing workers={workers} track={track} selectedId={selectedId} />
      {track.length > 1 && (
        <Polyline positions={track.map((p) => [p.latitude, p.longitude] as [number, number])} color="#7c3aed" weight={3} />
      )}
      {placed.map((w) => {
        const flags = workerFlags(w)
        return (
          <Marker
            key={w.user_id}
            position={[w.latitude, w.longitude]}
            icon={workerIcon(w, w.user_id === selectedId, flags.stale)}
            eventHandlers={{ click: () => onSelect(w.user_id) }}
          >
            <Popup>
              <strong>{w.full_name}</strong>
              <br />
              {w.recorded_at ? `Updated ${timeAgo(w.recorded_at)}` : 'No location yet'}
              {flags.stale ? ' — may be offline' : ''}
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
