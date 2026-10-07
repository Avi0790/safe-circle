jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import { CHECKIN_WARN_BEFORE_MS, reminderTime } from '../checkinReminder';

describe('reminderTime', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');

  it('reminds 5 minutes before the check-in is due', () => {
    const due = new Date(now + 30 * 60_000);
    expect(reminderTime(due, now)!.getTime()).toBe(due.getTime() - CHECKIN_WARN_BEFORE_MS);
  });

  it('never schedules in the past: a short interval reminds a minute from now', () => {
    const due = new Date(now + 3 * 60_000);
    expect(reminderTime(due, now)!.getTime()).toBe(now + 60_000);
  });

  it('skips the reminder when there is no room before the due time', () => {
    expect(reminderTime(new Date(now + 30_000), now)).toBeNull();
  });
});
