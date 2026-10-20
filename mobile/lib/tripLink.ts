import { formatClockTime } from '@/lib/format';
import { buildTrackUrl, getWebBaseUrl } from '@/lib/shareLink';
import type { TripMode } from '@/lib/sharedTrips';
import { supabase } from '@/lib/supabase';

// "Share ETA with anyone" (backend migration ...000062): a guest link that
// also carries the trip, for someone who doesn't have Safe Circle. They see
// where you're headed, your ETA and your live position in a browser; when you
// arrive the page says so and stops showing where you are, and if you stop
// navigating the link ends. Or just send the ETA as a message, no link.

export type CreateTripLinkResult = { ok: true; id: string; url: string } | { ok: false; error: string };

// With a tripId (a bus, train or flight from Share a trip) the link follows
// that trip on the server (migration ...000063): running late, arriving and
// stopping all carry over to the link without the app having to be open.
export async function createTripLink(
  destination: string,
  etaMs: number,
  mode: TripMode,
  tripId?: string,
): Promise<CreateTripLinkResult> {
  const { data, error } = await supabase.rpc('create_trip_share_link', {
    p_destination: destination,
    p_eta: new Date(etaMs).toISOString(),
    p_mode: mode,
    ...(tripId ? { p_trip: tripId } : {}),
  });
  const row = (data as { id: string; token: string }[] | null)?.[0];
  if (error || !row) return { ok: false, error: error?.message ?? "Couldn't create the link." };
  // The token exists only in this response; the server keeps a hash.
  return { ok: true, id: row.id, url: buildTrackUrl(getWebBaseUrl(), row.token) };
}

// Best effort, like the circle's shared trip: a lost ETA update must never
// interrupt navigation.
export async function updateTripLink(id: string, etaMs: number): Promise<void> {
  await supabase.rpc('update_trip_share_link', { p_id: id, p_eta: new Date(etaMs).toISOString() }).then(
    () => {},
    () => {},
  );
}

export async function finishTripLink(id: string, arrived: boolean): Promise<void> {
  await supabase.rpc('finish_trip_share_link', { p_id: id, p_arrived: arrived }).then(
    () => {},
    () => {},
  );
}

const VERB: Record<TripMode, string> = {
  drive: "I'm on my way to",
  walk: "I'm walking to",
  bus: "I'm on the bus to",
  train: "I'm on the train to",
  flight: "I'm flying to",
};

// "I'm on my way to Walmart, arriving around 3:41 PM. Follow along live
// until I get there: https://…"
export function tripShareMessage(destination: string, etaMs: number, mode: TripMode, url?: string): string {
  const arrive = `${mode === 'flight' ? 'landing' : 'arriving'} around ${formatClockTime(new Date(etaMs).toISOString())}`;
  const base = `${VERB[mode]} ${destination}, ${arrive}.`;
  return url ? `${base} Follow along live until I get there: ${url}` : base;
}
