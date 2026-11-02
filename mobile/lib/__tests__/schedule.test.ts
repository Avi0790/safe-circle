jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

import * as Notifications from 'expo-notifications';
import {
  nextShift,
  planVsActual,
  REMIND_BEFORE_MS,
  shiftReminders,
  shiftTimes,
  startTimes,
  statusInfo,
  syncShiftReminders,
  upcomingDays,
  type ScheduleRow,
} from '../schedule';

const now = Date.parse('2026-11-02T12:00:00Z');
const at = (h: number) => new Date(now + h * 3_600_000).toISOString();

function row(over: Partial<ScheduleRow>): ScheduleRow {
  return {
    id: 's1',
    user_id: 'w1',
    worker_name: 'Wendy',
    starts_at: at(-10),
    ends_at: at(-2),
    job_site: null,
    note: null,
    clocked_in_at: null,
    clocked_out_at: null,
    status: 'upcoming',
    ...over,
  };
}

describe('planVsActual', () => {
  it('adds up planned and worked hours and counts late and missed shifts', () => {
    const totals = planVsActual(
      [
        row({ id: 'a', status: 'worked', clocked_in_at: at(-10), clocked_out_at: at(-2) }),
        row({ id: 'b', status: 'late', starts_at: at(-34), ends_at: at(-26), clocked_in_at: at(-33.5), clocked_out_at: at(-26) }),
        row({ id: 'c', status: 'missed', starts_at: at(-58), ends_at: at(-50) }),
      ],
      now,
    );
    expect(totals).toEqual({ plannedMinutes: 24 * 60, workedMinutes: 8 * 60 + 7.5 * 60, late: 1, missed: 1, shifts: 3 });
  });

  it('counts a shift still going up to now', () => {
    expect(planVsActual([row({ starts_at: at(-2), ends_at: at(6), clocked_in_at: at(-2), status: 'on_time' })], now).workedMinutes).toBe(120);
  });
});

describe('nextShift', () => {
  it('is the earliest one that has not ended, even if it has begun', () => {
    const rows = [row({ id: 'later', starts_at: at(30), ends_at: at(38) }), row({ id: 'now', starts_at: at(-1), ends_at: at(7) }), row({ id: 'past' })];
    expect(nextShift(rows, now)?.id).toBe('now');
    expect(nextShift([row({})], now)).toBeNull();
  });
});

describe('shiftReminders', () => {
  it('reminds half an hour before each shift', () => {
    const [r] = shiftReminders([row({ id: 'x', starts_at: at(20), ends_at: at(28), job_site: 'Depot' })], 'Crew', now);
    expect(r.identifier).toBe('safecircle-shift-x');
    expect(r.fireAt.getTime()).toBe(Date.parse(at(20)) - REMIND_BEFORE_MS);
    expect(r.body).toContain('Crew · Depot');
  });

  it('a shift starting within the half hour is reminded in a minute', () => {
    const [r] = shiftReminders([row({ starts_at: at(0.25), ends_at: at(8) })], 'Crew', now);
    expect(r.fireAt.getTime()).toBe(now + 60_000);
  });

  it('skips shifts already started and ones more than two weeks away', () => {
    expect(shiftReminders([row({ starts_at: at(-1), ends_at: at(7) }), row({ starts_at: at(24 * 15), ends_at: at(24 * 15 + 8) })], 'Crew', now)).toEqual([]);
  });
});

describe('syncShiftReminders', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels reminders for shifts that are gone and schedules the rest', async () => {
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      { identifier: 'safecircle-shift-old' },
      { identifier: 'safecircle-shift-x' },
      { identifier: 'safecircle-checkin-reminder' },
    ]);
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    const reminders = shiftReminders([row({ id: 'x', starts_at: at(20), ends_at: at(28) })], 'Crew', now);
    await syncShiftReminders(reminders);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('safecircle-shift-old');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'safecircle-shift-x', trigger: { type: 'date', date: reminders[0].fireAt } }),
    );
  });

  it('asks for nothing when there is nothing to remind', async () => {
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);
    await syncShiftReminders([]);
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('planning helpers', () => {
  it('builds a shift from a day, a start time and a length', () => {
    const { starts, ends } = shiftTimes(new Date(2026, 10, 3), 7, 30, 8);
    expect(starts.getHours()).toBe(7);
    expect(starts.getMinutes()).toBe(30);
    expect(ends.getTime() - starts.getTime()).toBe(8 * 3_600_000);
  });

  it('offers half-hour starts from 5 AM to 10:30 PM and the next two weeks', () => {
    const times = startTimes();
    expect(times[0]).toEqual({ hour: 5, minute: 0 });
    expect(times[times.length - 1]).toEqual({ hour: 22, minute: 30 });
    const days = upcomingDays(new Date(2026, 10, 2, 15));
    expect(days).toHaveLength(14);
    expect(days[0].getHours()).toBe(0);
  });

  it('names every status, and treats an unknown one as upcoming', () => {
    expect(statusInfo('missed').tone).toBe('danger');
    expect(statusInfo('nonsense').label).toBe('Upcoming');
  });
});
