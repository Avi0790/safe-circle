import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet'
import { useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatestLocation, MemberWithLocation, Place } from '../lib/types'
import { isLowBattery, timeAgo } from '../lib/format'

// Vite bundles Leaflet's default marker images at hashed URLs, which breaks
// the library's hardcoded relative paths. Point at the CDN copies instead.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const DEFAULT_CENTER: [number, number] = [37.7749, -122.4194]

function FitToMembers({ members }: { members: MemberWithLocation[] }) {
  const map = useMap()

  useEffect(() => {
    const withLocation = members.filter((m) => m.location)
    if (withLocation.length === 0) return
    const bounds = L.latLngBounds(
      withLocation.map((m) => [m.location!.latitude, m.location!.longitude] as [number, number]),
    )
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
  }, [members, map])

  return null
}

// Rendered after FitToMembers, so its effect runs after and wins whenever a
// trail is showing — same "mount order = effect order" trick, deliberately
// relied on rather than adding a separate priority flag for one screen.
function FitToHistory({ history }: { history: LatestLocation[] }) {
  const map = useMap()

  useEffect(() => {
    if (history.length === 0) return
    const bounds = L.latLngBounds(history.map((p) => [p.latitude, p.longitude] as [number, number]))
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 })
  }, [history, map])

  return null
}


export function MapView({
  members,
  places = [],
  history = [],
}: {
  members: MemberWithLocation[]
  places?: Place[]
  history?: LatestLocation[]
}) {
  const located = members.filter((m) => m.location)

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={12} className="map-container">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToMembers members={members} />
      <FitToHistory history={history} />
      {history.length > 1 && (
        <Polyline
          positions={history.map((p) => [p.latitude, p.longitude] as [number, number])}
          pathOptions={{ color: '#7c3aed', weight: 3 }}
        />
      )}
      {history.length > 0 && (
        <Marker position={[history[0].latitude, history[0].longitude]}>
          <Popup>Oldest · {timeAgo(history[0].recorded_at)}</Popup>
        </Marker>
      )}
      {history.length > 1 && (
        <Marker position={[history[history.length - 1].latitude, history[history.length - 1].longitude]}>
          <Popup>Most recent · {timeAgo(history[history.length - 1].recorded_at)}</Popup>
        </Marker>
      )}
      {places.map((place) => (
        <Circle
          key={place.id}
          center={[place.latitude, place.longitude]}
          radius={place.radius_meters}
          pathOptions={{ color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.1 }}
        >
          <Popup>{place.name}</Popup>
        </Circle>
      ))}
      {located.map((member) => (
        <Marker
          key={member.id}
          position={[member.location!.latitude, member.location!.longitude]}
        >
          <Popup>
            <strong>{member.full_name}</strong>
            <br />
            Updated {timeAgo(member.location!.recorded_at)}
            {member.location!.battery_level != null && (
              <>
                <br />
                <span className={isLowBattery(member.location!.battery_level) ? 'low-battery' : undefined}>
                  Battery {Math.round(member.location!.battery_level * 100)}%
                  {isLowBattery(member.location!.battery_level) ? ' ⚠️' : ''}
                </span>
              </>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
