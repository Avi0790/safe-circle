import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MemberWithLocation } from '@/lib/types';

// The last-seen member list for a circle, kept on the device so the map and
// Members tab can draw immediately on launch and refresh behind it, instead
// of showing a spinner until two network round trips finish (what makes an
// app like Life360 feel instant). Scoped per signed-in user, capped in age,
// and wiped on sign-out — this is other people's location data sitting on
// disk, so it must never outlive the session that was allowed to see it.
const PREFIX = 'safecircle.membersCache.v1.';
export const MEMBERS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Entry {
  savedAt: number;
  members: MemberWithLocation[];
}

const keyFor = (userId: string, circleId: string) => `${PREFIX}${userId}.${circleId}`;

export async function loadCachedMembers(
  userId: string,
  circleId: string,
  now = Date.now(),
): Promise<MemberWithLocation[] | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, circleId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (!Array.isArray(entry.members) || now - entry.savedAt > MEMBERS_CACHE_MAX_AGE_MS) return null;
    return entry.members;
  } catch {
    return null;
  }
}

export async function saveCachedMembers(
  userId: string,
  circleId: string,
  members: MemberWithLocation[],
  now = Date.now(),
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId, circleId), JSON.stringify({ savedAt: now, members } satisfies Entry));
  } catch {
    // A cache that can't be written just means the next launch shows a
    // spinner — never worth surfacing.
  }
}

export async function clearMembersCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length > 0) await AsyncStorage.multiRemove(ours);
  } catch {
    // Best-effort, same as sign-out's push-token cleanup.
  }
}
