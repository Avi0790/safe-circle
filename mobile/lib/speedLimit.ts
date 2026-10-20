import type { LatLng } from '@/lib/navigation';

// The posted speed limit of the road you're on, for the sign beside your
// speed while navigating (like Google Maps). It comes from OpenStreetMap's
// `maxspeed` tag through Nominatim (OpenStreetMap's own geocoder, free and
// keyless): we only ever show a limit someone actually mapped. Where the road
// has none (common outside cities and highways in the US) there is no sign;
// a guessed limit on an official-looking sign would be worse than none.
//
// Nominatim's usage policy allows about one request a second at most; the
// Directions screen asks far less (see shouldLookUpLimit) and caches each road.
const BASE_URL = (process.env.EXPO_PUBLIC_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const TIMEOUT_MS = 8_000;

export const LIMIT_LOOKUP_EVERY_MS = 30_000;

export interface RoadLimit {
  // the OpenStreetMap road (way) the position matched, to cache by
  roadId: string | null;
  mph: number | null;
}

// OSM writes limits as "35 mph", "50" (km/h), "50 km/h", "none", "signals",
// "US:urban"...; only real numbers count. Shown in mph, km/h rounded to 5.
export function parseMaxspeed(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const first = raw.split(';')[0].trim().toLowerCase();
  const m = first.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 200) return null;
  if (m[2] === 'mph') return Math.round(value);
  return Math.round((value * 0.621371) / 5) * 5;
}

// Ask again only when it's been a while, or the route has moved on to a new
// road (a new step), and never while a lookup is still out.
export function shouldLookUpLimit(
  lastAt: number | null,
  lastStep: number | null,
  step: number,
  now: number,
  inFlight: boolean,
): boolean {
  if (inFlight) return false;
  if (lastAt == null || lastStep == null) return true;
  return step !== lastStep || now - lastAt >= LIMIT_LOOKUP_EVERY_MS;
}

// Over the limit, with a little slack for the speedometer and GPS.
export const isOverLimit = (mph: number | null, limit: number | null) => mph != null && limit != null && mph > limit + 2;

export async function lookUpSpeedLimit(at: LatLng, signal?: AbortSignal): Promise<RoadLimit> {
  const params = new URLSearchParams({
    lat: String(at.latitude),
    lon: String(at.longitude),
    zoom: '17', // roads
    format: 'jsonv2',
    extratags: '1',
  });
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => timeout.abort());
  try {
    const res = await fetch(`${BASE_URL}/reverse?${params.toString()}`, { signal: timeout.signal });
    if (!res.ok) return { roadId: null, mph: null };
    const d = (await res.json()) as { osm_type?: string; osm_id?: number; category?: string; extratags?: Record<string, string> | null };
    if (d.category !== 'highway') return { roadId: null, mph: null };
    return {
      roadId: d.osm_id != null ? `${d.osm_type ?? 'way'}${d.osm_id}` : null,
      mph: parseMaxspeed(d.extratags?.maxspeed),
    };
  } catch {
    return { roadId: null, mph: null };
  } finally {
    clearTimeout(timer);
  }
}
