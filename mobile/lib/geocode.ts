import type { LatLng } from '@/lib/navigation';

// Free place search over OpenStreetMap data (Photon). No key. The public
// instance is a fair-use service: searches are debounced by the caller and the
// result list is small. Set EXPO_PUBLIC_GEOCODER_URL to use your own.
const BASE_URL = (process.env.EXPO_PUBLIC_GEOCODER_URL ?? 'https://photon.komoot.io').replace(/\/$/, '');
const TIMEOUT_MS = 8_000;
export const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 100;

export interface PlaceResult {
  id: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    state?: string;
    postcode?: string;
  };
}

const join = (parts: (string | undefined)[], sep: string) =>
  parts.filter((p): p is string => !!p && p.trim() !== '').join(sep);

export function parsePhotonResults(json: unknown): PlaceResult[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!coords || coords.length < 2) continue;
    const street = join([p.housenumber, p.street], ' ');
    const title = p.name ?? (street || p.city || '');
    if (!title) continue;
    // With a place name, the street is context; without one, it IS the title.
    const subtitle = join([p.name ? street : undefined, p.city ?? p.district, p.state], ', ');
    const id = p.osm_id ? `${p.osm_type ?? 'x'}${p.osm_id}` : `${coords[1]},${coords[0]}`;
    const dedupe = `${title}|${subtitle}`;
    if (seen.has(id) || seen.has(dedupe)) continue;
    seen.add(id);
    seen.add(dedupe);
    out.push({ id, title, subtitle, latitude: coords[1], longitude: coords[0] });
  }
  return out;
}

// Returns [] for a too-short query and on any failure: a search box that
// shows "no results" is better than one that throws mid-drive.
export async function searchPlaces(query: string, near?: LatLng, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const params = new URLSearchParams({ q, limit: '6', lang: 'en' });
  if (near) {
    params.set('lat', String(near.latitude));
    params.set('lon', String(near.longitude));
  }
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => timeout.abort());
  try {
    const res = await fetch(`${BASE_URL}/api/?${params.toString()}`, { signal: timeout.signal });
    if (!res.ok) return [];
    return parsePhotonResults(await res.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
