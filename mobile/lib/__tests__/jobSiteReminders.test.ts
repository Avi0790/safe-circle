import AsyncStorage from '@react-native-async-storage/async-storage';
import { fake } from '../../test-support/fakeSupabase';

// Job-site reminders: what the phone watches, when it reminds, and that it
// never tells the server about an arrival. The OS (location, geofencing,
// notifications, background tasks) is faked; so is the server.
const mockLocation = {
  fg: 'granted',
  bg: 'granted',
  started: false,
  start: jest.fn(async (_task: string, regions: unknown[]) => {
    mockLocation.started = true;
    mockLocation.regions = regions;
  }),
  stop: jest.fn(async () => {
    mockLocation.started = false;
  }),
  regions: [] as unknown[],
};
const mockNotify = { status: 'granted', schedule: jest.fn(async (_req: unknown) => 'id') };

jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-location', () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  requestForegroundPermissionsAsync: async () => ({ status: mockLocation.fg }),
  requestBackgroundPermissionsAsync: async () => ({ status: mockLocation.bg }),
  startGeofencingAsync: (t: string, r: unknown[]) => mockLocation.start(t, r),
  stopGeofencingAsync: () => mockLocation.stop(),
  hasStartedGeofencingAsync: async () => mockLocation.started,
}));
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: async () => ({ status: mockNotify.status }),
  scheduleNotificationAsync: (req: unknown) => mockNotify.schedule(req),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

import * as TaskManager from 'expo-task-manager';
import {
  handleRegionEvent,
  JOB_SITE_TASK,
  jobSiteRemindersOn,
  regionsFor,
  rememberOnShift,
  REMIND_COOLDOWN_MS,
  setJobSiteReminders,
  shouldRemind,
  syncJobSiteReminders,
  type JobSite,
} from '@/lib/jobSiteReminders';

const site = (id: string, over: Partial<JobSite> = {}): JobSite => ({
  id, org_id: 'o1', org_name: 'Riverside', name: `Site ${id}`, latitude: 35.84, longitude: -90.7, radius_m: 150, ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  fake.reset();
  mockLocation.fg = 'granted';
  mockLocation.bg = 'granted';
  mockLocation.started = false;
  mockLocation.regions = [];
  mockLocation.start.mockClear();
  mockLocation.stop.mockClear();
  mockNotify.status = 'granted';
  mockNotify.schedule.mockClear();
  fake.rpcResults.my_job_sites = { data: [site('a', { name: 'Main St yard' }), site('b')] };
});

describe('what the phone watches', () => {
  it('one region per site, entering only, at most 20', () => {
    const regions = regionsFor(Array.from({ length: 25 }, (_, i) => site(String(i))));
    expect(regions).toHaveLength(20);
    expect(regions[0]).toEqual({ identifier: '0', latitude: 35.84, longitude: -90.7, radius: 150, notifyOnEnter: true, notifyOnExit: false });
  });

  it('reminds when off shift, once per site per 6 hours', () => {
    const now = 1_000_000_000;
    expect(shouldRemind('a', false, {}, now)).toBe(true);
    expect(shouldRemind('a', true, {}, now)).toBe(false);
    expect(shouldRemind('a', false, { a: now - 1000 }, now)).toBe(false);
    expect(shouldRemind('a', false, { a: now - REMIND_COOLDOWN_MS }, now)).toBe(true);
    expect(shouldRemind('b', false, { a: now }, now)).toBe(true);
  });
});

describe('turning reminders on and off', () => {
  it('asks for Always location and notifications, then watches the sites', async () => {
    expect(await setJobSiteReminders(true)).toEqual({ ok: true, sites: 2 });
    expect(mockLocation.start).toHaveBeenCalledWith(JOB_SITE_TASK, expect.any(Array));
    expect(mockLocation.regions).toHaveLength(2);
    expect(await jobSiteRemindersOn()).toBe(true);
  });

  it('says why when location is only "While using"', async () => {
    mockLocation.bg = 'denied';
    expect(await setJobSiteReminders(true)).toEqual({ ok: false, reason: expect.stringContaining('"Always"') });
    expect(mockLocation.start).not.toHaveBeenCalled();
    expect(await jobSiteRemindersOn()).toBe(false);
  });

  it('says why when notifications are off', async () => {
    mockNotify.status = 'denied';
    expect(await setJobSiteReminders(true)).toEqual({ ok: false, reason: 'Notifications are off for Safe Circle.' });
  });

  it('with no sites yet, stays on but watches nothing', async () => {
    fake.rpcResults.my_job_sites = { data: [] };
    expect(await setJobSiteReminders(true)).toEqual({ ok: true, sites: 0 });
    expect(mockLocation.start).not.toHaveBeenCalled();
  });

  it('turning off stops watching and forgets the sites', async () => {
    await setJobSiteReminders(true);
    expect(await setJobSiteReminders(false)).toEqual({ ok: true, sites: 0 });
    expect(mockLocation.stop).toHaveBeenCalled();
    expect(await jobSiteRemindersOn()).toBe(false);
    expect(await handleRegionEvent(1, { identifier: 'a' })).toBe(false); // nothing left to remind about
  });

  it('a refresh re-reads the sites only if reminders are on', async () => {
    await syncJobSiteReminders();
    expect(fake.rpcsOf('my_job_sites')).toHaveLength(0);
    await setJobSiteReminders(true);
    fake.rpcResults.my_job_sites = { data: [] }; // the plan ended, or the sites were removed
    await syncJobSiteReminders();
    expect(mockLocation.stop).toHaveBeenCalled();
  });
});

describe('arriving at a site', () => {
  beforeEach(async () => {
    await setJobSiteReminders(true);
  });

  it('off shift: a local notification naming the site and organization, then not again for a while', async () => {
    await rememberOnShift(false);
    expect(await handleRegionEvent(1, { identifier: 'a' }, 1_000_000)).toBe(true);
    expect(mockNotify.schedule).toHaveBeenCalledWith({
      content: {
        title: "📍 You're at Main St yard",
        body: "You're not clocked in to Riverside. Open Safe Circle to clock in.",
        data: { type: 'job_site', siteId: 'a' },
      },
      trigger: null,
    });
    expect(await handleRegionEvent(1, { identifier: 'a' }, 1_000_000 + 60_000)).toBe(false);
    expect(mockNotify.schedule).toHaveBeenCalledTimes(1);
  });

  it('on shift, leaving, or an unknown region: nothing', async () => {
    await rememberOnShift(true);
    expect(await handleRegionEvent(1, { identifier: 'a' })).toBe(false);
    await rememberOnShift(false);
    expect(await handleRegionEvent(2, { identifier: 'a' })).toBe(false);
    expect(await handleRegionEvent(1, { identifier: 'zzz' })).toBe(false);
    expect(mockNotify.schedule).not.toHaveBeenCalled();
  });

  it('the background task does the same, and never contacts the server', async () => {
    const before = fake.rpcCalls.length + fake.queries.length;
    // the task the module registered at load
    const [, task] = (TaskManager.defineTask as jest.Mock).mock.calls.find(([name]) => name === JOB_SITE_TASK);
    await task({ data: { eventType: 1, region: { identifier: 'b' } } });
    expect(mockNotify.schedule).toHaveBeenCalledTimes(1);
    expect(fake.rpcCalls.length + fake.queries.length).toBe(before);
  });
});
