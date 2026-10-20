import { MapContainer, TileLayer, LayersControl, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet'
import { useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatestLocation, MapPin, MemberWithLocation, Place } from '../lib/types'
import { formatTimeLeft, isDriving, isLowBattery, speedToMph, timeAgo } from '../lib/format'
import { getAvatarColor, getInitials, isSafeAvatarUrl } from '../lib/avatar'
import { placeIcon } from '../lib/places'
import { reportDetails, reportInfo, type RoadReport } from '../lib/roadReports'

// Vite bundles Leaflet's default marker images at hashed URLs, which breaks
// the library's hardcoded relative paths. Point at the CDN copies instead.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const DEFAULT_CENTER: [number, number] = [37.7749, -122.4194]

// L.divIcon's `html` is injected as raw innerHTML, not escaped by Leaflet —
// and full_name is fully user-controlled (editable in Settings), so this
// guards against a stored-XSS marker via a name like "<img src=x onerror=...>".
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function avatarIcon(id: string, name: string, avatarUrl: string | null): L.DivIcon {
  const color = getAvatarColor(id)
  const initials = escapeHtml(getInitials(name))
  // A photo that fails to load hides itself, revealing the initials beneath.
  const photo = isSafeAvatarUrl(avatarUrl)
    ? `<img src="${escapeHtml(avatarUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:999px" onerror="this.remove()">`
    : ''
  return L.divIcon({
    className: 'map-avatar-marker',
    html: `<div class="map-avatar-ring"><div class="avatar" style="position:relative;overflow:hidden;width:32px;height:32px;font-size:13px;background-color:${color}">${initials}${photo}</div></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  })
}

function pinIcon(emoji: string): L.DivIcon {
  return L.divIcon({
    className: 'map-pin-marker',
    html: `<div class="map-pin-ring">${escapeHtml(emoji)}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function reportIcon(emoji: string): L.DivIcon {
  return L.divIcon({
    className: 'map-pin-marker',
    html: `<div class="map-report-ring">${escapeHtml(emoji)}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

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
  presenceByPlace = {},
  pins = [],
  reports = [],
  myUserId,
}: {
  members: MemberWithLocation[]
  places?: Place[]
  history?: LatestLocation[]
  presenceByPlace?: Record<string, string[]>
  pins?: MapPin[]
  // already narrowed to the selected circle (lib/roadReports.ts)
  reports?: RoadReport[]
  myUserId?: string
}) {
  const located = members.filter((m) => m.location)

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={12} className="map-container">
      {/* Esri's World Imagery is free and keyless, same as OpenStreetMap's
          tiles — no Google Maps billing account needed for satellite view. */}
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Streets">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite">
          <TileLayer
            attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </LayersControl.BaseLayer>
      </LayersControl>
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
          <Popup>
            <strong>
              {placeIcon(place.name)} {place.name}
            </strong>
            {(presenceByPlace[place.id]?.length ?? 0) > 0 && (
              <>
                <br />
                Here now: {presenceByPlace[place.id].join(', ')}
              </>
            )}
          </Popup>
        </Circle>
      ))}
      {pins.map((pin) => (
        <Marker key={pin.id} position={[pin.latitude, pin.longitude]} icon={pinIcon(pin.emoji)}>
          <Popup>
            <strong>
              {pin.emoji} {pin.label}
            </strong>
            <br />
            Dropped by {pin.profiles?.full_name ?? 'someone'} · expires in{' '}
            {formatTimeLeft(pin.expires_at)}
          </Popup>
        </Marker>
      ))}
      {reports.map((report) => {
        const { title, body } = reportDetails(report, myUserId)
        return (
          <Marker key={report.id} position={[report.latitude, report.longitude]} icon={reportIcon(reportInfo(report.kind).emoji)}>
            <Popup>
              <strong>{title}</strong>
              <br />
              {body}
            </Popup>
          </Marker>
        )
      })}
      {located.map((member) => (
        <Marker
          key={member.id}
          position={[member.location!.latitude, member.location!.longitude]}
          icon={avatarIcon(member.id, member.full_name, member.avatar_url)}
        >
          <Popup>
            <strong>{member.full_name}</strong>
            <br />
            {isDriving(member.location!.speed) ? (
              <>
                🚗 Driving
                {speedToMph(member.location!.speed) != null
                  ? ` ${Math.round(speedToMph(member.location!.speed)!)} mph`
                  : ''}
              </>
            ) : (
              `Updated ${timeAgo(member.location!.recorded_at)}`
            )}
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
