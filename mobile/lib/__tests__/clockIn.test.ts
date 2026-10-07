const mockRpc = jest.fn();
const mockIsTracking = jest.fn();
const mockIsBackground = jest.fn();
const mockEnsure = jest.fn();
const mockStop = jest.fn();
const mockSchedule = jest.fn();
const mockCancel = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock('@/lib/locationTracking', () => ({
  isTrackingActive: () => mockIsTracking(),
  isBackgroundTaskActive: () => mockIsBackground(),
}));
jest.mock('@/lib/checkinReminder', () => ({
  scheduleCheckinReminder: (...args: unknown[]) => mockSchedule(...args),
  cancelCheckinReminder: () => mockCancel(),
}));
jest.mock('@/lib/sharingWindow', () => ({
  ensureSharingFor: (...args: unknown[]) => mockEnsure(...args),
  stopSharing: () => mockStop(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkInNow, clockInTo, clockOutOf } from '../clockIn';
import { describeOrgAudit, formatShiftElapsed, MAX_SHIFT_MINUTES, shiftAutoEndsAt } from '../shift';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockEnsure.mockResolvedValue({ ok: true });
  mockStop.mockResolvedValue(undefined);
  mockIsBackground.mockResolvedValue(false);
  mockRpc.mockResolvedValue({ error: null });
  mockSchedule.mockResolvedValue(undefined);
  mockCancel.mockResolvedValue(undefined);
});

describe('clockInTo', () => {
  it('starts sharing for a full shift, then records the clock-in', async () => {
    mockIsTracking.mockResolvedValue(false);
    const result = await clockInTo('org1', 'u1');
    expect(result).toEqual({ ok: true, background: false });
    expect(mockEnsure).toHaveBeenCalledWith(MAX_SHIFT_MINUTES);
    expect(mockRpc).toHaveBeenCalledWith('clock_in', { p_org: 'org1', p_checkin_minutes: null });
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('does not clock in if sharing could not start', async () => {
    mockIsTracking.mockResolvedValue(false);
    mockEnsure.mockResolvedValue({ ok: false, reason: 'Location permission denied.' });
    const result = await clockInTo('org1', 'u1');
    expect(result).toEqual({ ok: false, reason: 'Location permission denied.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('stops sharing again if the clock-in is rejected and clock-in had started it', async () => {
    mockIsTracking.mockResolvedValue(false);
    mockRpc.mockResolvedValue({ error: { message: 'You are already clocked in.' } });
    const result = await clockInTo('org1', 'u1');
    expect(result).toEqual({ ok: false, reason: 'You are already clocked in.' });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('leaves existing sharing running if the clock-in is rejected', async () => {
    mockIsTracking.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ error: { message: 'nope' } });
    await clockInTo('org1', 'u1');
    expect(mockStop).not.toHaveBeenCalled();
  });
});

describe('check-ins', () => {
  it('passes the interval to the server and schedules an on-device reminder', async () => {
    mockIsTracking.mockResolvedValue(false);
    await clockInTo('org1', 'u1', 30);
    expect(mockRpc).toHaveBeenCalledWith('clock_in', { p_org: 'org1', p_checkin_minutes: 30 });
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const due = mockSchedule.mock.calls[0][0] as Date;
    expect(Math.round((due.getTime() - Date.now()) / 60000)).toBe(30);
  });

  it('does not schedule a reminder if the clock-in is refused', async () => {
    mockIsTracking.mockResolvedValue(false);
    mockRpc.mockResolvedValue({ error: { message: 'nope' } });
    await clockInTo('org1', 'u1', 30);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('cancels the reminder at clock-out', async () => {
    await clockOutOf('u1');
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('"I\'m OK" records the check-in and moves the reminder to the next due time', async () => {
    const nextDue = new Date(Date.now() + 30 * 60000).toISOString();
    mockRpc.mockResolvedValue({ data: nextDue, error: null });
    const result = await checkInNow();
    expect(result).toEqual({ ok: true, nextDue });
    expect(mockRpc).toHaveBeenCalledWith('shift_check_in');
    expect((mockSchedule.mock.calls[0][0] as Date).toISOString()).toBe(nextDue);
  });

  it('reports a refused check-in without touching the reminder', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'No check-ins are set for this shift.' } });
    const result = await checkInNow();
    expect(result).toEqual({ ok: false, reason: 'No check-ins are set for this shift.' });
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('clockOutOf', () => {
  it('stops sharing at clock-out when clock-in had started it, before recording it', async () => {
    mockIsTracking.mockResolvedValue(false);
    await clockInTo('org1', 'u1');
    const order: string[] = [];
    mockStop.mockImplementation(async () => void order.push('stop'));
    mockRpc.mockImplementation(async (name: string) => {
      order.push(name);
      return { error: null };
    });
    const result = await clockOutOf('u1');
    expect(result).toEqual({ ok: true });
    expect(order).toEqual(['stop', 'clock_out']);
  });

  it('keeps the worker’s own sharing running if they were already sharing at clock-in', async () => {
    mockIsTracking.mockResolvedValue(true);
    await clockInTo('org1', 'u1');
    await clockOutOf('u1');
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenLastCalledWith('clock_out');
  });

  it('still stops sharing when the clock-out call fails, and says so', async () => {
    mockIsTracking.mockResolvedValue(false);
    await clockInTo('org1', 'u1');
    mockRpc.mockResolvedValue({ error: { message: 'offline' } });
    const result = await clockOutOf('u1');
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, reason: 'offline' });
  });
});

describe('shift helpers', () => {
  const start = '2026-10-06T08:00:00Z';
  const at = (minutes: number) => new Date(start).getTime() + minutes * 60000;

  it('formats elapsed time', () => {
    expect(formatShiftElapsed(start, at(0))).toBe('less than a minute');
    expect(formatShiftElapsed(start, at(40))).toBe('40 min');
    expect(formatShiftElapsed(start, at(120))).toBe('2 h');
    expect(formatShiftElapsed(start, at(125))).toBe('2 h 5 min');
  });

  it('puts the automatic end 14 hours after the start', () => {
    expect(shiftAutoEndsAt(start)).toBe('2026-10-06T22:00:00.000Z');
  });

  it('describes each audit action in plain words', () => {
    expect(describeOrgAudit('viewed_live')).toMatch(/live location/);
    expect(describeOrgAudit('viewed_track')).toMatch(/shift track/);
    expect(describeOrgAudit('something_new')).toMatch(/looked at/);
  });
});
