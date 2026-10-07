import AsyncStorage from '@react-native-async-storage/async-storage';
import { cancelCheckinReminder, scheduleCheckinReminder } from '@/lib/checkinReminder';
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

// checkinMinutes turns on lone-worker check-ins for this shift: miss one and
// the people who oversee you are alerted (migration ...000053).
export async function clockInTo(
  orgId: string,
  userId: string,
  checkinMinutes: number | null = null,
): Promise<ClockInResult> {
  const alreadySharing = await isTrackingActive();

  const sharing = await ensureSharingFor(MAX_SHIFT_MINUTES);
  if (!sharing.ok) return { ok: false, reason: sharing.reason };
  const startedByClockIn = !alreadySharing;

  const { error } = await supabase.rpc('clock_in', { p_org: orgId, p_checkin_minutes: checkinMinutes });
  if (error) {
    // Don't leave sharing running for a shift that never started.
    if (startedByClockIn) await stopSharing();
    return { ok: false, reason: error.message };
  }

  await setStartedSharing(userId, startedByClockIn);
  if (checkinMinutes != null) {
    await scheduleCheckinReminder(new Date(Date.now() + checkinMinutes * 60_000));
  }
  return { ok: true, background: await isBackgroundTaskActive() };
}

export type ClockOutResult = { ok: true } | { ok: false; reason: string };

// Sharing is stopped first, on the phone, so it ends even with no signal;
// only then is the clock-out recorded. If that call fails the shift stays
// open on the server (it closes itself after 14 hours) but nothing new is
// being sent.
export async function clockOutOf(userId: string): Promise<ClockOutResult> {
  await cancelCheckinReminder();
  if (await getStartedSharing(userId)) {
    await stopSharing();
    await setStartedSharing(userId, false);
  }

  const { error } = await supabase.rpc('clock_out');
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export type CheckInResult = { ok: true; nextDue: string } | { ok: false; reason: string };

// "I'm OK": starts the next interval, resolves any alert a missed check-in
// raised, and moves the on-device reminder to match.
export async function checkInNow(): Promise<CheckInResult> {
  const { data, error } = await supabase.rpc('shift_check_in');
  if (error) return { ok: false, reason: error.message };
  const nextDue = data as string;
  await scheduleCheckinReminder(new Date(nextDue));
  return { ok: true, nextDue };
}
