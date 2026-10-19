import { instructionText, type LatLng, type Route, type RouteStep, type TravelMode } from '@/lib/navigation';

// Free, keyless routing from OpenStreetMap data (OSRM). The default is the
// community demo server, which is fine for a capstone but is not meant for
// production traffic: point EXPO_PUBLIC_OSRM_URL at your own OSRM or Valhalla
// instance (or a paid provider with an OSRM-compatible API) before real use.
const BASE_URL = (process.env.EXPO_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/$/, '');
// The demo server above only knows cars (it answers a walking request with a
// car route), so walking uses the FOSSGIS foot-profile server, also free and
// also fair-use. Override with EXPO_PUBLIC_OSRM_FOOT_URL.
const FOOT_BASE_URL = (process.env.EXPO_PUBLIC_OSRM_FOOT_URL ?? 'https://routing.openstreetmap.de/routed-foot').replace(
  /\/$/,
  '',
);
const TIMEOUT_MS = 12_000;

export class RoutingError extends Error {
  constructor(
    public kind: 'network' | 'no-route' | 'bad-response',
    message: string,
  ) {
    super(message);
  }
}

interface OsrmStep {
  distance: number;
  name?: string;
  maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number };
}

// The shape of an OSRM /route response (verified against the live service):
// routes[0].geometry.coordinates is [lon, lat] pairs, and each leg's steps
// carry the manoeuvre and the length of road that follows it.
export function parseOsrmRoute(json: unknown, mode: TravelMode = 'drive'): Route {
  const data = json as { code?: string; routes?: any[] } | null;
  if (!data || data.code !== 'Ok' || !data.routes?.length) {
    throw new RoutingError('no-route', `Couldn't find a ${mode === 'walk' ? 'walking' : 'driving'} route there.`);
  }
  const r = data.routes[0];
  const raw = r?.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2 || typeof r.distance !== 'number' || typeof r.duration !== 'number') {
    throw new RoutingError('bad-response', 'The route service sent something unexpected.');
  }
  const coords: LatLng[] = raw.map(([lon, lat]: [number, number]) => ({ latitude: lat, longitude: lon }));
  const steps: RouteStep[] = (r.legs ?? []).flatMap((leg: { steps?: OsrmStep[] }) =>
    (leg.steps ?? []).map((s) => {
      const base = {
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        name: s.name ?? '',
        exit: s.maneuver.exit,
      };
      return {
        ...base,
        distanceM: s.distance,
        location: { latitude: s.maneuver.location[1], longitude: s.maneuver.location[0] },
        instruction: instructionText(base),
      };
    }),
  );
  if (steps.length === 0) {
    throw new RoutingError('bad-response', 'The route service sent no directions.');
  }
  return { distanceM: r.distance, durationS: r.duration, coords, steps };
}

export async function fetchRoute(
  from: LatLng,
  to: LatLng,
  signal?: AbortSignal,
  mode: TravelMode = 'drive',
): Promise<Route> {
  const url =
    `${mode === 'walk' ? FOOT_BASE_URL : BASE_URL}/route/v1/${mode === 'walk' ? 'foot' : 'driving'}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
    '?overview=full&geometries=geojson&steps=true&alternatives=false';

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => timeout.abort());
  try {
    const res = await fetch(url, { signal: timeout.signal });
    // OSRM reports "no route" as a 200 with code NoRoute, or a 400 with the same body.
    const body = await res.json().catch(() => null);
    return parseOsrmRoute(body, mode);
  } catch (err) {
    if (err instanceof RoutingError) throw err;
    throw new RoutingError('network', "Couldn't reach the route service. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
}
