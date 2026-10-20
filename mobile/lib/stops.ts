import { projectOnRoute, type LatLng, type PreparedRoute } from '@/lib/navigation';

// "Add a stop" while driving, like Apple Maps: a category (gas, coffee, food…)
// searched along the road ahead, not just around you. No typing needed.
//
// Category search comes from Nominatim (OpenStreetMap's own geocoder), free
// and keyless, which understands phrases like "gas station" as a kind of place
// (Photon matched the words in names instead). Its usage policy allows
// occasional searches like this one, about one a second at most; set
// EXPO_PUBLIC_NOMINATIM_URL to use your own instance.
const BASE_URL = (process.env.EXPO_PUBLIC_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;

export type StopCategory = 'gas' | 'coffee' | 'food' | 'parking' | 'pharmacy';

export const STOP_CATEGORIES: {
  key: StopCategory;
  emoji: string;
  label: string;
  query: string;
  types: string[]; // OSM amenity values that really are this kind of place
}[] = [
  { key: 'gas', emoji: '⛽', label: 'Gas', query: 'gas station', types: ['fuel'] },
  { key: 'coffee', emoji: '☕', label: 'Coffee', query: 'cafe', types: ['cafe'] },
  { key: 'food', emoji: '🍔', label: 'Food', query: 'fast food', types: ['fast_food', 'restaurant'] },
  { key: 'parking', emoji: '🅿️', label: 'Parking', query: 'parking', types: ['parking'] },
  { key: 'pharmacy', emoji: '💊', label: 'Pharmacy', query: 'pharmacy', types: ['pharmacy'] },
];

// How far ahead to look, and how far off the road a stop may be.
export const STOP_LOOKAHEAD_M = 15_000;
export const STOP_MAX_OFF_ROUTE_M = 1_500;
const MAX_RESULTS = 6;

export interface StopResult extends LatLng {
  id: string;
  title: string;
  aheadM: number;
  offRouteM: number;
}

interface NominatimPlace {
  place_id?: number;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  lat?: string;
  lon?: string;
}

// The box around the next stretch of road, padded so places just off it count.
export function searchBox(prepared: PreparedRoute, alongM: number): { west: number; north: number; east: number; south: number } {
  const { coords } = prepared.route;
  const { cum } = prepared;
  let west = Infinity, east = -Infinity, north = -Infinity, south = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const nextInRange = i + 1 < cum.length && cum[i + 1] >= alongM;
    if (!(cum[i] >= alongM || nextInRange) || cum[i] > alongM + STOP_LOOKAHEAD_M) continue;
    west = Math.min(west, coords[i].longitude);
    east = Math.max(east, coords[i].longitude);
    north = Math.max(north, coords[i].latitude);
    south = Math.min(south, coords[i].latitude);
  }
  const pad = 0.015; // ~1.5 km
  return { west: west - pad, north: north + pad, east: east + pad, south: south - pad };
}

// Real places of the right kind, ahead of you and near the route, the ones
// costing the least detour first (a stop 1 km off the road is a 2 km detour).
export function rankStops(
  json: unknown,
  category: StopCategory,
  prepared: PreparedRoute,
  alongM: number,
): StopResult[] {
  if (!Array.isArray(json)) return [];
  const spec = STOP_CATEGORIES.find((c) => c.key === category)!;
  const out: StopResult[] = [];
  const seen = new Set<string>();
  for (const p of json as NominatimPlace[]) {
    if (p.category !== 'amenity' || !p.type || !spec.types.includes(p.type)) continue;
    const latitude = Number(p.lat);
    const longitude = Number(p.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const place = { latitude, longitude };
    const hit = projectOnRoute(place, prepared.route.coords, prepared.cum, alongM);
    if (!hit || hit.offRouteM > STOP_MAX_OFF_ROUTE_M) continue;
    // A place right by the road you've already driven is behind you, even if
    // some stretch ahead also passes within reach of it. (If the route loops
    // back and passes it as closely again, it's ahead after all.)
    const anywhere = projectOnRoute(place, prepared.route.coords, prepared.cum);
    if (anywhere && anywhere.alongM < alongM - 30 && anywhere.offRouteM + 200 < hit.offRouteM) continue;
    // The search starts at the segment you're on, so a place can project a
    // little behind you.
    if (hit.alongM < alongM - 30) continue;
    const id = String(p.place_id ?? `${latitude},${longitude}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: p.name?.trim() || spec.label,
      latitude,
      longitude,
      aheadM: Math.max(0, hit.alongM - alongM),
      offRouteM: hit.offRouteM,
    });
  }
  return out.sort((a, b) => a.aheadM + 2 * a.offRouteM - (b.aheadM + 2 * b.offRouteM)).slice(0, MAX_RESULTS);
}

// [] on any failure: a stop search that comes back empty is better than one
// that throws while someone is driving.
export async function searchStops(
  category: StopCategory,
  prepared: PreparedRoute,
  alongM: number,
  signal?: AbortSignal,
): Promise<StopResult[]> {
  const spec = STOP_CATEGORIES.find((c) => c.key === category);
  if (!spec) return [];
  const box = searchBox(prepared, alongM);
  if (![box.west, box.north, box.east, box.south].every(Number.isFinite)) return [];
  const params = new URLSearchParams({
    q: spec.query,
    format: 'jsonv2',
    viewbox: `${box.west},${box.north},${box.east},${box.south}`,
    bounded: '1',
    limit: '40',
  });
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => timeout.abort());
  try {
    const res = await fetch(`${BASE_URL}/search?${params.toString()}`, { signal: timeout.signal });
    if (!res.ok) return [];
    return rankStops(await res.json(), category, prepared, alongM);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
