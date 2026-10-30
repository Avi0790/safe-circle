import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { formatTimeLeft, isDriving, isLowBattery, speedToMph, timeAgo } from '../lib/format'
import { guestTripSummary, type GuestTripFields } from '../lib/guestTrip'
import { t } from '../lib/i18n'

export interface SharedLocation extends GuestTripFields {
  first_name: string
  latitude: number | null
  longitude: number | null
  speed: number | null
  battery_level: number | null
  recorded_at: string | null
  expires_at: string
}

const REFRESH_MS = 15_000

function Recenter({ position }: { position: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(position, Math.max(map.getZoom(), 15))
  }, [position, map])
  return null
}

// What someone sees when they open a guest link (/track/<token>) — no
// account, no app. Only the latest location and a first name (plus, for a
// link sent from navigation, where they're headed and their ETA); the
// get_shared_location function returns nothing at all for an unknown,
// expired or revoked token, so this page can't tell those apart either.
export function GuestTrack({ token }: { token: string }) {
  const [data, setData] = useState<SharedLocation | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'gone'>('loading')
  // Ticks so "updated 2m ago" and "expires in" stay current between fetches.
  const [, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: rows, error } = await supabase.rpc('get_shared_location', { p_token: token })
      if (cancelled) return
      const row = (rows as SharedLocation[] | null)?.[0]
      if (error || !row) {
        setState('gone')
        return
      }
      setData(row)
      setState('ok')
    }

    load()
    const refresh = setInterval(load, REFRESH_MS)
    const tick = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => {
      cancelled = true
      clearInterval(refresh)
      clearInterval(tick)
    }
  }, [token])

  if (state === 'loading') return <div className="centered">{t('Loading…')}</div>

  if (state === 'gone' || !data) {
    return (
      <div className="centered">
        <h1>{t('This link has ended')}</h1>
        <p className="hint">{t('It has expired or was turned off by the person who shared it.')}</p>
        <p className="credit">{t('Safe Circle — created and developed by Surendra B K')}</p>
      </div>
    )
  }

  return <GuestTrackView data={data} />
}

// The page itself, given what get_shared_location returned.
export function GuestTrackView({ data }: { data: SharedLocation }) {
  const trip = guestTripSummary(data)
  const hasLocation = data.latitude != null && data.longitude != null
  const position: [number, number] | null = hasLocation ? [data.latitude!, data.longitude!] : null
  const mph = speedToMph(data.speed)

  return (
    <div className="guest-track">
      <header className="guest-header">
        <h1>{trip ? trip.title : `${data.first_name}'s live location`}</h1>
        {trip && trip.detail && <p className={trip.arrived ? 'hint' : 'guest-trip'}>{trip.detail}</p>}
        <p className="hint">
          {trip?.arrived ? '' : data.recorded_at ? `Updated ${timeAgo(data.recorded_at)}` : 'No location yet'}
          {isDriving(data.speed) ? ` · 🚗 Driving${mph != null ? ` ${Math.round(mph)} mph` : ''}` : ''}
          {data.battery_level != null && (
            <span className={isLowBattery(data.battery_level) ? 'low-battery' : undefined}>
              {' · '}
              {Math.round(data.battery_level * 100)}% battery
            </span>
          )}
        </p>
        <p className="hint">
          {trip && !trip.arrived ? 'Ends when they arrive' : `Link expires in ${formatTimeLeft(data.expires_at)}`}
        </p>
      </header>

      {position ? (
        <MapContainer center={position} zoom={15} className="guest-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Recenter position={position} />
          <CircleMarker
            center={position}
            radius={11}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#7c3aed', fillOpacity: 1 }}
          />
        </MapContainer>
      ) : (
        <div className="centered">
          <p className="hint">
            {trip?.arrived
              ? `${data.first_name}'s trip is over.`
              : `${data.first_name} hasn't shared a location yet. This page updates on its own.`}
          </p>
        </div>
      )}

      <p className="credit">{t('Safe Circle — created and developed by Surendra B K')}</p>
    </div>
  )
}
