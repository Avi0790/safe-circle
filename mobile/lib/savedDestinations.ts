import AsyncStorage from '@react-native-async-storage/async-storage';
import { haversineMeters } from '@/lib/geo';

// Personal places for Directions ("Home", "Work", "Gym"). They live on this
// phone only, keyed by account: a home address is about the most sensitive
// thing in the app, so it is never uploaded, never shown to a circle, and a
// second person signing in on the same phone doesn't see it. Circle places
// (the `places` table) are a different, shared thing.
const PREFIX = 'safecircle.savedDestinations.v1.';
const keyFor = (userId: string) => `${PREFIX}${userId}`;

export const MAX_SAVED_DESTINATIONS = 20;
export const MAX_NAME_LENGTH = 40;
// Saving the same spot twice under another name is almost always a mistake.
const SAME_SPOT_METERS = 30;
// Quick-save labels, always listed first and holding one place each.
export const PINNED_NAMES = ['Home', 'Work'] as const;

export interface SavedDestination {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function isValid(d: unknown): d is SavedDestination {
  if (typeof d !== 'object' || d === null) return false;
  const v = d as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    v.name.trim() !== '' &&
    typeof v.latitude === 'number' &&
    typeof v.longitude === 'number' &&
    Math.abs(v.latitude) <= 90 &&
    Math.abs(v.longitude) <= 180
  );
}

// Home and Work first, then the rest alphabetically.
export function sortDestinations(list: SavedDestination[]): SavedDestination[] {
  const rank = (d: SavedDestination) => {
    const i = PINNED_NAMES.findIndex((n) => sameName(n, d.name));
    return i === -1 ? PINNED_NAMES.length : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// Whatever is in storage might be old, hand-edited or corrupt; keep only what
// is usable rather than failing the whole screen.
export function parseDestinations(raw: string | null): SavedDestination[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortDestinations(parsed.filter(isValid).slice(0, MAX_SAVED_DESTINATIONS));
  } catch {
    return [];
  }
}

export type AddResult =
  | { ok: true; list: SavedDestination[] }
  | { ok: false; reason: 'name' | 'full' };

// Pure: returns the new list. Saving under a name that already exists moves
// that name to the new spot (so "Home" can be changed), and a place saved
// twice at the same spot under another name is renamed rather than doubled.
export function addDestination(
  list: SavedDestination[],
  place: { name: string; latitude: number; longitude: number },
  newId: string,
): AddResult {
  const name = place.name.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return { ok: false, reason: 'name' };
  const others = list.filter(
    (d) =>
      !sameName(d.name, name) &&
      haversineMeters(d.latitude, d.longitude, place.latitude, place.longitude) >= SAME_SPOT_METERS,
  );
  if (others.length >= MAX_SAVED_DESTINATIONS) return { ok: false, reason: 'full' };
  const entry: SavedDestination = { id: newId, name, latitude: place.latitude, longitude: place.longitude };
  return { ok: true, list: sortDestinations([...others, entry]) };
}

export function removeDestination(list: SavedDestination[], id: string): SavedDestination[] {
  return list.filter((d) => d.id !== id);
}

// The saved place at (about) this spot, if any.
export function savedAt(
  list: SavedDestination[],
  spot: { latitude: number; longitude: number },
): SavedDestination | undefined {
  return list.find((d) => haversineMeters(d.latitude, d.longitude, spot.latitude, spot.longitude) < SAME_SPOT_METERS);
}

export async function loadDestinations(userId: string): Promise<SavedDestination[]> {
  try {
    return parseDestinations(await AsyncStorage.getItem(keyFor(userId)));
  } catch {
    return [];
  }
}

// Returns whether it was written, so the screen doesn't claim "Saved" when
// storage failed.
export async function storeDestinations(userId: string, list: SavedDestination[]): Promise<boolean> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// Account deletion: the places go with the account.
export async function clearDestinations(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Best-effort, like the other local cleanups.
  }
}
