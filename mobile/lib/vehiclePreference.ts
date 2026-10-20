import AsyncStorage from '@react-native-async-storage/async-storage';

// What marks you on the map while navigating, instead of the blue dot, like
// Google Maps' and Waze's vehicle icons. Per device.
export type VehicleStyle = 'arrow' | 'sedan' | 'suv' | 'pickup';
export type VehicleColor = 'blue' | 'red' | 'black' | 'white' | 'silver';

export interface VehiclePreference {
  style: VehicleStyle;
  color: VehicleColor;
}

export const VEHICLE_STYLES: { style: VehicleStyle; label: string }[] = [
  { style: 'arrow', label: 'Arrow' },
  { style: 'sedan', label: 'Car' },
  { style: 'suv', label: 'SUV' },
  { style: 'pickup', label: 'Pickup' },
];

export const VEHICLE_COLORS: { color: VehicleColor; hex: string; label: string }[] = [
  { color: 'blue', hex: '#2563eb', label: 'Blue' },
  { color: 'red', hex: '#dc2626', label: 'Red' },
  { color: 'black', hex: '#111827', label: 'Black' },
  { color: 'white', hex: '#f8fafc', label: 'White' },
  { color: 'silver', hex: '#9ca3af', label: 'Silver' },
];

export const DEFAULT_VEHICLE: VehiclePreference = { style: 'arrow', color: 'blue' };

const KEY = 'safecircle.vehicle.v1';

export function parseVehicle(raw: string | null): VehiclePreference {
  try {
    const v = JSON.parse(raw ?? '') as Partial<VehiclePreference>;
    const style = VEHICLE_STYLES.some((s) => s.style === v.style) ? (v.style as VehicleStyle) : DEFAULT_VEHICLE.style;
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

export const vehicleHex = (color: VehicleColor) => VEHICLE_COLORS.find((c) => c.color === color)?.hex ?? '#2563eb';

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
