import type { LatLng, TravelMode } from '@/lib/navigation';

// A fallback when our own routing isn't reachable (or someone just prefers it):
// hand the destination to the phone's maps app, which does its own
// turn-by-turn. Apple Maps on iOS, the Android navigation intent elsewhere.
export function externalMapsUrl(dest: LatLng, platform: string, mode: TravelMode | 'transit' = 'drive'): string {
  const { latitude, longitude } = dest;
  if (mode === 'transit') {
    // Bus and train routes need schedule data we don't have, so hand over to
    // the phone's own Maps app. google.navigation: has no transit option, so
    // Android uses Google Maps' universal link (opens the app when installed).
    return platform === 'ios'
      ? `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=r`
      : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=transit`;
  }
  return platform === 'ios'
    ? `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=${mode === 'walk' ? 'w' : 'd'}`
    : `google.navigation:q=${latitude},${longitude}${mode === 'walk' ? '&mode=w' : ''}`;
}
