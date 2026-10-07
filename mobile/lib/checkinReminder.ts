import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// A local notification shortly before a scheduled check-in is due — "tap I'm
// OK or your managers will be alerted". On-device only, so it fires with no
// signal, which is when a lone worker most needs it. One fixed identifier, so
// each new check-in replaces the previous reminder.
const REMINDER_ID = 'safecircle-checkin-reminder';
export const CHECKIN_WARN_BEFORE_MS = 5 * 60_000;

// When the reminder should fire: 5 minutes before due, but never in the past
// (a very short interval just reminds a minute from now).
export function reminderTime(dueAt: Date, now = Date.now()): Date | null {
  const target = dueAt.getTime() - CHECKIN_WARN_BEFORE_MS;
  const fireAt = Math.max(target, now + 60_000);
  return fireAt >= dueAt.getTime() ? null : new Date(fireAt);
}

export async function scheduleCheckinReminder(dueAt: Date): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const fireAt = reminderTime(dueAt);
    if (!fireAt) return;

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: '⏱️ Check-in due soon',
        body: 'Open Safe Circle and tap "I\'m OK", or your managers will be alerted.',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
  } catch (err) {
    // A missing reminder must never stop a shift from starting.
    console.warn('[checkinReminder] could not schedule:', err);
  }
}

export async function cancelCheckinReminder(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {
    // Nothing scheduled — fine.
  }
}
