// Client-side mirror of the backend's haversine_meters() SQL function
// (backend/supabase/migrations/...000006_push_and_geofencing.sql) — same
// formula, used here to show "how far away" distances (Life360-style) in
// the UI rather than for the geofence-transition logic that lives
// server-side.
const EARTH_RADIUS_METERS = 6371000;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.asin(Math.sqrt(a));
}

export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

export function formatDistanceMiles(meters: number): string {
  const miles = metersToMiles(meters);
  if (miles < 0.1) return 'nearby';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
