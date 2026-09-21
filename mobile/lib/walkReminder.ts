import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// A local notification a couple of minutes before a walk's timer runs out —
// "tap I'm safe or your circle will be alerted". Purely on-device (no
// backend), so it fires even with no signal, which is exactly when a walk
// is most likely to run long.
const REMINDER_ID = 'safecircle-walk-reminder';
const WARN_BEFORE_MS = 2 * 60_000;

export async function scheduleWalkReminder(expectedBy: Date): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const fireAt = expectedBy.getTime() - WARN_BEFORE_MS;
    if (fireAt <= Date.now()) return;

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    // Same identifier replaces any earlier reminder (extending a walk).
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: '⏰ Your walk timer ends in 2 minutes',
        body: 'Open Safe Circle and tap "I\'m safe", or your circle will be alerted.',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(fireAt) },
    });
  } catch (err) {
    // A missing reminder must never stop a walk from starting.
    console.warn('[walkReminder] could not schedule:', err);
  }
}

export async function cancelWalkReminder(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {
    // Nothing scheduled — fine.
  }
}
