import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackgroundTaskActive, isTrackingActive } from '@/lib/locationTracking';
import { MAX_SHIFT_MINUTES } from '@/lib/shift';
import { ensureSharingFor, stopSharing } from '@/lib/sharingWindow';
import { supabase } from '@/lib/supabase';

// Clocking in has to start sharing, or a manager would see an empty map. But
// it must only stop sharing again at clock-out if clocking in is what
// started it — otherwise someone's own always-on sharing would be switched
// off by the end of a shift. This remembers which, per account.
const key = (userId: string) => `safecircle.clockIn.startedSharing.${userId}`;

async function setStartedSharing(userId: string, value: boolean): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(key(userId), '1');
    else await AsyncStorage.removeItem(key(userId));
  } catch {
    // A failed write only means we may not stop sharing at clock-out.
  }
}

async function getStartedSharing(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(userId))) === '1';
  } catch {
    return false;
  }
}

export type ClockInResult =
  | { ok: true; background: boolean }
  | { ok: false; reason: string };

export async function clockInTo(orgId: string, userId: string): Promise<ClockInResult> {
  const alreadySharing = await isTrackingActive();

  const sharing = await ensureSharingFor(MAX_SHIFT_MINUTES);
  if (!sharing.ok) return { ok: false, reason: sharing.reason };
  const startedByClockIn = !alreadySharing;

  const { error } = await supabase.rpc('clock_in', { p_org: orgId });
  if (error) {
    // Don't leave sharing running for a shift that never started.
    if (startedByClockIn) await stopSharing();
    return { ok: false, reason: error.message };
  }

  await setStartedSharing(userId, startedByClockIn);
  return { ok: true, background: await isBackgroundTaskActive() };
}

export type ClockOutResult = { ok: true } | { ok: false; reason: string };

// Sharing is stopped first, on the phone, so it ends even with no signal;
// only then is the clock-out recorded. If that call fails the shift stays
// open on the server (it closes itself after 14 hours) but nothing new is
// being sent.
export async function clockOutOf(userId: string): Promise<ClockOutResult> {
  if (await getStartedSharing(userId)) {
    await stopSharing();
    await setStartedSharing(userId, false);
  }

  const { error } = await supabase.rpc('clock_out');
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
