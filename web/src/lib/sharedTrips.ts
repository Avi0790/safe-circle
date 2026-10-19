import { formatClockTime } from './format'

// "Share my ETA" (mobile app, backend migrations ...000057 and ...000059): a
// circle-mate driving or walking somewhere with in-app directions can choose to share the
// destination's NAME and an ETA with the circle. This dashboard only shows it,
// like walks and rides; it never starts or changes one.
export interface SharedTrip {
  id: string
  user_id: string
  circle_id: string
  destination: string
  eta: string
  mode: 'drive' | 'walk'
  status: 'active' | 'arrived' | 'ended' | 'stale'
  started_at: string
  updated_at: string
  profiles: { full_name: string } | null
}

// The server marks a trip stale after 10 minutes without an update; stop
// showing it a little sooner than the next cleanup pass would.
export const TRIP_LIVE_WINDOW_MS = 10 * 60_000

// "arriving in about 12 min (3:41 PM)", counted down against the clock so it
// stays current between the driver's updates.
export function tripEtaText(etaIso: string, nowMs: number = Date.now()): string {
  const minutes = Math.ceil((new Date(etaIso).getTime() - nowMs) / 60_000)
  if (minutes <= 0) return 'arriving now'
  return `arriving in about ${minutes} min (${formatClockTime(etaIso)})`
}

// "🚗 Sam is heading to Mall" / "🚶 Sam is walking to the library".
export function tripHeadline(trip: Pick<SharedTrip, 'mode' | 'destination' | 'profiles'>): string {
  const who = trip.profiles?.full_name ?? 'Someone'
  return trip.mode === 'walk' ? `🚶 ${who} is walking to ${trip.destination}` : `🚗 ${who} is heading to ${trip.destination}`
}

// Other people's trips that are still live.
export function liveTripsOfOthers(
  trips: SharedTrip[],
  myUserId: string | undefined,
  nowMs: number = Date.now(),
): SharedTrip[] {
  return trips.filter(
    (t) =>
      t.status === 'active' &&
      t.user_id !== myUserId &&
      nowMs - new Date(t.updated_at).getTime() < TRIP_LIVE_WINDOW_MS,
  )
}
