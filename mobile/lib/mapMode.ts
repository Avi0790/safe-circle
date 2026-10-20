import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MapType } from 'react-native-maps';

// Map modes, like Apple Maps' "Map Modes" sheet: Explore, Driving,
// Satellite, and 3D Flyover (Apple's photo-realistic 3D, iOS only; Android's
// Google Maps has Terrain there instead). Satellite and Flyover can show or
// hide labels; traffic can be turned on in any mode and is always on in
// Driving. Apple's Transit mode isn't available to apps through
// react-native-maps, so it isn't offered. Per device.
export type MapMode = 'explore' | 'driving' | 'satellite' | 'flyover';

export interface MapModePreference {
  mode: MapMode;
  labels: boolean;
  traffic: boolean;
}

export const DEFAULT_MAP_MODE: MapModePreference = { mode: 'explore', labels: true, traffic: false };

export function mapModeOptions(platform: string): { mode: MapMode; label: string }[] {
  return [
    { mode: 'explore', label: 'Explore' },
    { mode: 'driving', label: 'Driving' },
    { mode: 'satellite', label: 'Satellite' },
    { mode: 'flyover', label: platform === 'ios' ? '3D Flyover' : 'Terrain' },
  ];
}

export interface MapViewModeProps {
  mapType: MapType;
  showsTraffic: boolean;
  showsPointsOfInterest: boolean;
  showsBuildings: boolean;
}

// What a mode means for the MapView.
export function mapViewProps(p: MapModePreference, platform: string): MapViewModeProps {
  const ios = platform === 'ios';
  switch (p.mode) {
    case 'driving':
      // calmer colours so the road and traffic stand out, no shop pins
      return { mapType: ios ? 'mutedStandard' : 'standard', showsTraffic: true, showsPointsOfInterest: false, showsBuildings: true };
    case 'satellite':
      return { mapType: p.labels ? 'hybrid' : 'satellite', showsTraffic: p.traffic, showsPointsOfInterest: p.labels, showsBuildings: true };
    case 'flyover':
      return {
        mapType: ios ? (p.labels ? 'hybridFlyover' : 'satelliteFlyover') : 'terrain',
        showsTraffic: p.traffic,
        showsPointsOfInterest: p.labels,
        showsBuildings: true,
      };
    default:
      return { mapType: 'standard', showsTraffic: p.traffic, showsPointsOfInterest: true, showsBuildings: true };
  }
}

// Which switches apply in a mode.
export const modeHasLabelsSwitch = (mode: MapMode) => mode === 'satellite' || mode === 'flyover';
export const modeHasTrafficSwitch = (mode: MapMode) => mode !== 'driving';

const KEY = 'safecircle.mapMode.v1';
// Before map modes there was just a satellite toggle (lib/mapTypePreference.ts).
const OLD_KEY = 'safecircle.mapType.v1';

export function parseMapMode(raw: string | null): MapModePreference | null {
  try {
    const v = JSON.parse(raw ?? '') as Partial<MapModePreference>;
    if (!v || !['explore', 'driving', 'satellite', 'flyover'].includes(v.mode as string)) return null;
    return { mode: v.mode as MapMode, labels: v.labels !== false, traffic: v.traffic === true };
  } catch {
    return null;
  }
}

export async function getMapMode(): Promise<MapModePreference> {
  try {
    const saved = parseMapMode(await AsyncStorage.getItem(KEY));
    if (saved) return saved;
    if ((await AsyncStorage.getItem(OLD_KEY)) === 'hybrid') return { ...DEFAULT_MAP_MODE, mode: 'satellite' };
    return DEFAULT_MAP_MODE;
  } catch {
    return DEFAULT_MAP_MODE;
  }
}

export async function setMapMode(p: MapModePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Losing the choice just means Explore next time.
  }
}
