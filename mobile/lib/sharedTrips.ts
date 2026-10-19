import { formatClockTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

// "Share my ETA": while driving with in-app directions, a person can let their
// circle see where they're headed and when they expect to arrive (backend:
// migration ...000057). Only the destination's NAME, an ETA and the status are
// shared: not the route, and not the destination's coordinates.

export interface SharedTrip {
  id: string;
  user_id: string;
  circle_id: string;
  destination: string;
  eta: string;
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
export function tripEtaText(etaIso: string, nowMs: number = Date.now()): string {
  const minutes = Math.ceil((new Date(etaIso).getTime() - nowMs) / 60_000);
  if (minutes <= 0) return 'arriving now';
  return `arriving in about ${minutes} min (${formatClockTime(etaIso)})`;
}

// Other people's trips that are still live.
export function liveTripsOfOthers(trips: SharedTrip[], myUserId: string | undefined, nowMs: number = Date.now()): SharedTrip[] {
  return trips.filter(
    (t) =>
      t.status === 'active' &&
      t.user_id !== myUserId &&
      nowMs - new Date(t.updated_at).getTime() < TRIP_LIVE_WINDOW_MS,
  );
}

export type StartTripResult = { ok: true; id: string } | { ok: false; error: string };

export async function startSharedTrip(circleId: string, destination: string, etaMs: number): Promise<StartTripResult> {
  const { data, error } = await supabase.rpc('start_shared_trip', {
    p_circle_id: circleId,
    p_destination: destination,
    p_eta: new Date(etaMs).toISOString(),
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
