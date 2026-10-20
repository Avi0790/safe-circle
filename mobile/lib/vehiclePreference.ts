import AsyncStorage from '@react-native-async-storage/async-storage';

// What marks you on the map while navigating, instead of the blue dot, like
// Google Maps' and Waze's vehicle icons. Per device.
export type VehicleStyle = 'arrow' | 'sports' | 'compact' | 'classic' | 'race' | 'sedan' | 'offroad';
export type VehicleColor = 'white' | 'black' | 'silver' | 'red' | 'blue' | 'yellow' | 'green' | 'purple';

export interface VehiclePreference {
  style: VehicleStyle;
  color: VehicleColor;
}

// The driving avatars, in carousel order (like Google Maps' "Choose driving
// avatar"). Drawn in components/VehicleIcon.tsx (map, top-down) and
// components/AvatarArt.tsx (picker, three-quarter view).
export const VEHICLE_STYLES: { style: VehicleStyle; label: string }[] = [
  { style: 'arrow', label: 'Navigation arrow' },
  { style: 'sports', label: 'Sports car' },
  { style: 'compact', label: 'Compact' },
  { style: 'classic', label: 'Classic' },
  { style: 'race', label: 'Race car' },
  { style: 'sedan', label: 'Sedan' },
  { style: 'offroad', label: 'Off-road' },
];

export const VEHICLE_COLORS: { color: VehicleColor; hex: string; label: string }[] = [
  { color: 'white', hex: '#f5f7fa', label: 'Polar white' },
  { color: 'black', hex: '#1a1a1d', label: 'Night black' },
  { color: 'silver', hex: '#78909c', label: 'Slate grey' },
  { color: 'red', hex: '#f04452', label: 'Coral red' },
  { color: 'blue', hex: '#1a8cff', label: 'Ocean blue' },
  { color: 'yellow', hex: '#ffcc00', label: 'Sunshine yellow' },
  { color: 'green', hex: '#0f8291', label: 'Deep teal' },
  { color: 'purple', hex: '#b13fc0', label: 'Orchid' },
];

// Avatars from before this set was redrawn map onto their nearest new one.
const OLD_STYLES: Record<string, VehicleStyle> = { suv: 'offroad', pickup: 'offroad', neon: 'sports', moto: 'compact' };

export const DEFAULT_VEHICLE: VehiclePreference = { style: 'arrow', color: 'blue' };

const KEY = 'safecircle.vehicle.v1';

export function parseVehicle(raw: string | null): VehiclePreference {
  try {
    const v = JSON.parse(raw ?? '') as Partial<VehiclePreference>;
    const named = typeof v.style === 'string' ? (OLD_STYLES[v.style] ?? v.style) : undefined;
    const style = VEHICLE_STYLES.some((s) => s.style === named) ? (named as VehicleStyle) : DEFAULT_VEHICLE.style;
    const color = VEHICLE_COLORS.some((c) => c.color === v.color) ? (v.color as VehicleColor) : DEFAULT_VEHICLE.color;
    return { style, color };
  } catch {
    return DEFAULT_VEHICLE;
  }
}

export async function getVehicle(): Promise<VehiclePreference> {
  try {
    return parseVehicle(await AsyncStorage.getItem(KEY));
  } catch {
    return DEFAULT_VEHICLE;
  }
}

export async function setVehicle(v: VehiclePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Losing the choice just means the arrow next time.
  }
}

export const vehicleHex = (color: VehicleColor) => VEHICLE_COLORS.find((c) => c.color === color)?.hex ?? '#1a8cff';
export const vehicleColorName = (color: VehicleColor) => VEHICLE_COLORS.find((c) => c.color === color)?.label ?? '';
export const vehicleStyleName = (style: VehicleStyle) => VEHICLE_STYLES.find((s) => s.style === style)?.label ?? '';

// A lighter (amount > 0) or darker (amount < 0) version of a colour, for the
// shading that makes the drawn avatars look solid.
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// Which way you're facing, in degrees from north: the GPS heading while
// moving, otherwise the direction between your last two positions, otherwise
// whatever it was. A stopped car keeps pointing the way it was going instead
// of spinning to north.
export function nextHeading(
  previous: number,
  fix: { heading: number | null; speed: number | null; latitude: number; longitude: number },
  prev: { latitude: number; longitude: number } | null,
): number {
  const moving = (fix.speed ?? 0) >= 1;
  if (moving && fix.heading != null && fix.heading >= 0) return fix.heading % 360;
  if (moving && prev) {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLon = toRad(fix.longitude - prev.longitude);
    const y = Math.sin(dLon) * Math.cos(toRad(fix.latitude));
    const x =
      Math.cos(toRad(prev.latitude)) * Math.sin(toRad(fix.latitude)) -
      Math.sin(toRad(prev.latitude)) * Math.cos(toRad(fix.latitude)) * Math.cos(dLon);
    if (x !== 0 || y !== 0) return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  return previous;
}
