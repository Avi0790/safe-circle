import type { LatLng, TravelMode } from '@/lib/navigation';

// A fallback when our own routing isn't reachable (or someone just prefers it):
// hand the destination to the phone's maps app, which does its own
// turn-by-turn. Apple Maps on iOS, the Android navigation intent elsewhere.
export function externalMapsUrl(dest: LatLng, platform: string, mode: TravelMode = 'drive'): string {
  const { latitude, longitude } = dest;
  return platform === 'ios'
    ? `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=${mode === 'walk' ? 'w' : 'd'}`
    : `google.navigation:q=${latitude},${longitude}${mode === 'walk' ? '&mode=w' : ''}`;
}
