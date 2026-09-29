import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MapType } from 'react-native-maps';

// A per-device preference (like shake-to-SOS) — which map style to show,
// not something that needs to sync across the circle. Apple Maps (iOS) and
// Google Maps (Android) both include satellite imagery for free through
// react-native-maps' built-in mapType prop, so this needs no API key or
// paid tier, unlike a lot of "satellite map" integrations.
const MAP_TYPE_KEY = 'safecircle.mapType.v1';

// 'hybrid' rather than plain 'satellite' — it keeps road/place labels drawn
// over the imagery, which matters for a map whose whole point is knowing
// where someone is relative to named streets and places.
export const SATELLITE_MAP_TYPE: MapType = 'hybrid';
export const STANDARD_MAP_TYPE: MapType = 'standard';

export async function getMapType(): Promise<MapType> {
  const stored = await AsyncStorage.getItem(MAP_TYPE_KEY);
  return stored === SATELLITE_MAP_TYPE ? SATELLITE_MAP_TYPE : STANDARD_MAP_TYPE;
}

export async function setMapType(type: MapType): Promise<void> {
  await AsyncStorage.setItem(MAP_TYPE_KEY, type);
}
