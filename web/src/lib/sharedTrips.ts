import { formatClockTime } from './format'

// "Share my ETA" (mobile app, backend migrations ...000057, ...000059 and
// ...000060): a circle-mate can share where they're headed and when they
// expect to arrive. Drives and walks are tracked live by the app's
// directions; buses, trains and flights are entered by hand and nothing
// reports in while they're under way. Only the destination's NAME and an ETA
// are shared. This dashboard only shows trips, like walks and rides; it never
// starts or changes one.
export type ManualMode = 'bus' | 'train' | 'flight'
export type TripMode = 'drive' | 'walk' | ManualMode

export interface SharedTrip {
  id: string
  user_id: string
  circle_id: string
  destination: string
  eta: string
  mode: TripMode
  status: 'active' | 'arrived' | 'ended' | 'stale'
  started_at: string
  updated_at: string
  profiles: { full_name: string } | null
}

// The server marks a drive or walk stale after 10 minutes without an update;
// stop showing it a little sooner than the next cleanup pass would.
export const TRIP_LIVE_WINDOW_MS = 10 * 60_000

// How long after its ETA a bus, train or flight stays up, for delays. Mirrors
// manual_trip_grace() in the backend and the mobile app's copy.
const MANUAL_GRACE_MS: Record<ManualMode, number> = {
  bus: 30 * 60_000,
  train: 45 * 60_000,
  flight: 2 * 3_600_000,
}

export const isManualMode = (m: TripMode): m is ManualMode => m === 'bus' || m === 'train' || m === 'flight'

// "25 min", "1 h 45 min", "2 h".
export function formatTripDuration(minutes: number): string {
  if (minutes < 90) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// "arriving in about 12 min (3:41 PM)", counted down against the clock so it
// stays current between updates. A flight is "landing"; a late bus or flight
// "was due at", since it isn't nearly there the way a late drive is.
export function tripEtaText(etaIso: string, nowMs: number = Date.now(), mode: TripMode = 'drive'): string {
  const minutes = Math.ceil((new Date(etaIso).getTime() - nowMs) / 60_000)
  if (minutes <= 0) return isManualMode(mode) ? `was due at ${formatClockTime(etaIso)}` : 'arriving now'
  return `${mode === 'flight' ? 'landing' : 'arriving'} in about ${formatTripDuration(minutes)} (${formatClockTime(etaIso)})`
}

export function tripHeadline(trip: Pick<SharedTrip, 'mode' | 'destination' | 'profiles'>): string {
  const who = trip.profiles?.full_name ?? 'Someone'
  switch (trip.mode) {
    case 'walk':
      return `🚶 ${who} is walking to ${trip.destination}`
    case 'bus':
      return `🚌 ${who} is on the bus to ${trip.destination}`
    case 'train':
      return `🚆 ${who} is on the train to ${trip.destination}`
    case 'flight':
      return `✈️ ${who} is flying to ${trip.destination}`
    default:
      return `🚗 ${who} is heading to ${trip.destination}`
  }
}

// A drive or walk must have reported in within 10 minutes; a bus, train or
// flight is live until its ETA plus the grace for delays.
export function isTripLive(t: SharedTrip, nowMs: number = Date.now()): boolean {
  if (t.status !== 'active') return false
  if (isManualMode(t.mode)) return nowMs < new Date(t.eta).getTime() + MANUAL_GRACE_MS[t.mode]
  return nowMs - new Date(t.updated_at).getTime() < TRIP_LIVE_WINDOW_MS
}

// Other people's trips that are still live.
export function liveTripsOfOthers(
  trips: SharedTrip[],
  myUserId: string | undefined,
  nowMs: number = Date.now(),
): SharedTrip[] {
  return trips.filter((t) => t.user_id !== myUserId && isTripLive(t, nowMs))
}
