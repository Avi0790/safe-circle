import { tripEtaText, tripHeadline, type TripMode } from './sharedTrips'

// What a guest link carries when it was sent from navigation ("Share ETA with
// anyone", backend migration ...000062): where they're headed and when.
export interface GuestTripFields {
  first_name: string
  trip_destination: string | null
  trip_eta: string | null
  trip_mode: string | null
  trip_status: 'active' | 'arrived' | null
}

const MODES: TripMode[] = ['drive', 'walk', 'bus', 'train', 'flight']

// The page's heading and subheading: "🚗 Alex is heading to Walmart" /
// "arriving in about 12 min (3:41 PM)", or "✅ Alex arrived at Walmart" once
// they're there. null for an ordinary guest link with no trip.
export function guestTripSummary(row: GuestTripFields, nowMs: number = Date.now()): { title: string; detail: string; arrived: boolean } | null {
  if (!row.trip_destination || !row.trip_status) return null
  if (row.trip_status === 'arrived') {
    return {
      title: `✅ ${row.first_name} arrived at ${row.trip_destination}`,
      detail: 'They got there, so this link no longer shows where they are.',
      arrived: true,
    }
  }
  const mode = MODES.includes(row.trip_mode as TripMode) ? (row.trip_mode as TripMode) : 'drive'
  return {
    title: tripHeadline({ mode, destination: row.trip_destination, profiles: { full_name: row.first_name } }),
    detail: row.trip_eta ? tripEtaText(row.trip_eta, nowMs, mode) : '',
    arrived: false,
  }
}
