import { formatClockTime } from '@/lib/format';
import type { TravelMode } from '@/lib/navigation';
import { supabase } from '@/lib/supabase';

// "Share my ETA": while driving or walking with in-app directions, a person can let their
// circle see where they're headed and when they expect to arrive (backend:
// migration ...000057). Only the destination's NAME, an ETA and the status are
// shared: not the route, and not the destination's coordinates.

// Drives and walks are tracked live by the Directions screen. Buses, trains
// and flights are manual: the person says where and when, and nothing in the
// app reports in again (a phone in airplane mode can't).
export type ManualMode = 'bus' | 'train' | 'flight';
export type TripMode = TravelMode | ManualMode;

export const MANUAL_MODES: ManualMode[] = ['bus', 'train', 'flight'];
export const isManualMode = (m: TripMode): m is ManualMode => (MANUAL_MODES as string[]).includes(m);

// How long after its ETA a manual trip stays up, for delays. Mirrors
// manual_trip_grace() in backend migration ...000060.
const MANUAL_GRACE_MS: Record<ManualMode, number> = {
  bus: 30 * 60_000,
  train: 45 * 60_000,
  flight: 2 * 3_600_000,
};

export interface SharedTrip {
  id: string;
  user_id: string;
  circle_id: string;
  destination: string;
  eta: string;
  mode: TripMode;
  status: 'active' | 'arrived' | 'ended' | 'stale';
  started_at: string;
  updated_at: string;
  profiles: { full_name: string } | null;
}

// The server marks a trip stale after 10 minutes without an update; the app
// also stops showing it a little sooner so a dead phone doesn't linger on
// screen while waiting for the next cleanup pass.
export const TRIP_LIVE_WINDOW_MS = 10 * 60_000;

// How often our own phone reports. The server ignores updates closer than 15 s.
export const ETA_MIN_INTERVAL_MS = 60_000;
export const ETA_CHANGE_MS = 60_000;
export const ETA_HEARTBEAT_MS = 4 * 60_000;

// Send a fresh ETA when it has moved by a minute or more (and it's been a
// minute since the last one), or as a heartbeat every few minutes so a steady
// ETA doesn't look like a phone that has gone quiet.
export function shouldSendEtaUpdate(
  lastSentAtMs: number | null,
  lastEtaMs: number | null,
  nowMs: number,
  etaMs: number,
): boolean {
  if (lastSentAtMs == null || lastEtaMs == null) return false; // the start call already carried the first ETA
  const sinceSent = nowMs - lastSentAtMs;
  if (sinceSent < ETA_MIN_INTERVAL_MS) return false;
  return Math.abs(etaMs - lastEtaMs) >= ETA_CHANGE_MS || sinceSent >= ETA_HEARTBEAT_MS;
}

// "arriving in about 12 min (3:41 PM)", from the ETA the driver's phone last
// reported. Recomputed against the clock, so it keeps counting down between
// updates instead of showing a stale number.
export function tripEtaText(etaIso: string, nowMs: number = Date.now(), mode: TripMode = 'drive'): string {
  const minutes = Math.ceil((new Date(etaIso).getTime() - nowMs) / 60_000);
  if (minutes <= 0) {
    // A drive is nearly there; a late bus or flight is just late.
    return isManualMode(mode) ? `was due at ${formatClockTime(etaIso)}` : 'arriving now';
  }
  const verb = mode === 'flight' ? 'landing' : 'arriving';
  return `${verb} in about ${formatTripDuration(minutes)} (${formatClockTime(etaIso)})`;
}

// Is this trip still worth showing? A drive or walk must have reported in
// within the last 10 minutes. A bus, train or flight is live until its ETA
// plus a grace period: nothing reports in while it's under way.
export function isTripLive(t: SharedTrip, nowMs: number = Date.now()): boolean {
  if (t.status !== 'active') return false;
  if (isManualMode(t.mode)) return nowMs < new Date(t.eta).getTime() + MANUAL_GRACE_MS[t.mode];
  return nowMs - new Date(t.updated_at).getTime() < TRIP_LIVE_WINDOW_MS;
}

// Other people's trips that are still live.
export function liveTripsOfOthers(trips: SharedTrip[], myUserId: string | undefined, nowMs: number = Date.now()): SharedTrip[] {
  return trips.filter((t) => t.user_id !== myUserId && isTripLive(t, nowMs));
}

// Bus, train or flight trips of mine that are still up.
export function myManualTrips(trips: SharedTrip[], myUserId: string | undefined, nowMs: number = Date.now()): SharedTrip[] {
  return trips.filter((t) => t.user_id === myUserId && isManualMode(t.mode) && isTripLive(t, nowMs));
}

// How far ahead a trip may end, a little inside the server's limit (24 hours,
// 48 for a flight) so a slightly fast phone clock can't be refused.
export function maxTripMinutes(mode: TripMode): number {
  return (mode === 'flight' ? 48 : 24) * 60 - 5;
}

// Quick picks for "arriving in", per kind of trip, and the stepper around them.
export const TRIP_PRESET_MINUTES: Record<ManualMode, number[]> = {
  bus: [15, 30, 45, 60],
  train: [30, 60, 120, 180],
  flight: [60, 120, 180, 300],
};
export const defaultTripMinutes = (mode: ManualMode): number => TRIP_PRESET_MINUTES[mode][1];

// One tap of + or - : 5 minutes for a bus or train, 15 for a flight.
export function stepTripMinutes(mode: ManualMode, minutes: number, direction: 1 | -1): number {
  const step = mode === 'flight' ? 15 : 5;
  return Math.min(maxTripMinutes(mode), Math.max(5, minutes + direction * step));
}

// "25 min", "1 h 45 min", "2 h".
export function formatTripDuration(minutes: number): string {
  if (minutes < 90) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export type StartTripResult = { ok: true; id: string } | { ok: false; error: string };

// "🚗 Sam is heading to Walmart", "🚶 Sam is walking to the library",
// "🚌 Sam is on the bus to Campus", "✈️ Sam is flying to Denver".
export function tripHeadline(trip: Pick<SharedTrip, 'mode' | 'destination' | 'profiles'>): string {
  const who = trip.profiles?.full_name ?? 'Someone';
  switch (trip.mode) {
    case 'walk':
      return `🚶 ${who} is walking to ${trip.destination}`;
    case 'bus':
      return `🚌 ${who} is on the bus to ${trip.destination}`;
    case 'train':
      return `🚆 ${who} is on the train to ${trip.destination}`;
    case 'flight':
      return `✈️ ${who} is flying to ${trip.destination}`;
    default:
      return `🚗 ${who} is heading to ${trip.destination}`;
  }
}

export async function startSharedTrip(
  circleId: string,
  destination: string,
  etaMs: number,
  mode: TripMode = 'drive',
): Promise<StartTripResult> {
  const { data, error } = await supabase.rpc('start_shared_trip', {
    p_circle_id: circleId,
    p_destination: destination,
    p_eta: new Date(etaMs).toISOString(),
    p_mode: mode,
  });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not share the trip.' };
  return { ok: true, id: data as string };
}

// Best effort by design: losing one ETA update must never interrupt a drive.
export async function updateSharedTrip(id: string, etaMs: number): Promise<void> {
  await supabase.rpc('update_shared_trip', { p_trip: id, p_eta: new Date(etaMs).toISOString() }).then(
    () => {},
    () => {},
  );
}

export async function endSharedTrip(id: string, arrived: boolean): Promise<void> {
  await supabase.rpc('end_shared_trip', { p_trip: id, p_arrived: arrived }).then(
    () => {},
    () => {},
  );
}
