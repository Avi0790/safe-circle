import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MemberWithLocation } from '../lib/types'
import { timeAgo } from '../lib/format'

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


export function MapView({ members }: { members: MemberWithLocation[] }) {
  const located = members.filter((m) => m.location)

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={12} className="map-container">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToMembers members={members} />
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
                Battery {Math.round(member.location!.battery_level * 100)}%
              </>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
