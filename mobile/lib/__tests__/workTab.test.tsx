import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from 'react-test-renderer';
import { fake } from '../../test-support/fakeSupabase';
import { allText, pressables, press, render, tapAlertButton, unmountAll } from '../../test-support/render';

// The Work tab with the real account provider, clock-in logic and sharing
// window; the server's idea of your organizations changes as you clock in and
// out. Only the server, the signed-in user, background location tracking and
// the phone's reminder notifications are faked.
const mockPush = jest.fn();
const mockTracking = {
  active: false,
  background: true,
  start: jest.fn(async () => ({ ok: true as const, backgroundGranted: true })),
  stop: jest.fn(async () => {}),
};
const mockReminders = { schedule: jest.fn(async () => {}), cancel: jest.fn(async () => {}) };

jest.mock('@/lib/supabase', () => require('../../test-support/fakeSupabase'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
const mockSession = { user: { id: 'me' } };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/lib/locationTracking', () => ({
  isTrackingActive: async () => mockTracking.active,
  isBackgroundTaskActive: async () => mockTracking.background,
  startBackgroundTracking: () => mockTracking.start(),
  stopBackgroundTracking: () => mockTracking.stop(),
  getShareUntil: async () => null,
  setShareUntil: async () => {},
}));
const mockSiteReminders = { on: false, set: jest.fn(async (on: boolean) => ({ ok: true as const, sites: on ? 3 : 0 })) };
jest.mock('@/lib/jobSiteReminders', () => ({
  jobSiteRemindersOn: async () => mockSiteReminders.on,
  setJobSiteReminders: (on: boolean) => mockSiteReminders.set(on),
  rememberOnShift: async () => {},
  syncJobSiteReminders: async () => {},
}));
jest.mock('@/lib/checkinReminder', () => ({
  scheduleCheckinReminder: (d: Date) => (mockReminders.schedule as any)(d),
  cancelCheckinReminder: () => mockReminders.cancel(),
}));

import { AccountProvider } from '@/contexts/AccountContext';
import WorkScreen from '../../app/(app)/(tabs)/work';

const iso = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

const org = (over: Record<string, unknown> = {}) => ({
  org_id: 'o1', name: 'Acme Roofing', type: 'construction', role: 'worker', status: 'active',
  consented_at: iso(-1000), on_shift: false, shift_started_at: null, needs_reconsent: false,
  checkin_minutes: null, next_checkin_due: null,
  plan_state: 'trial', trial_ends_at: iso(14 * 24 * 60), grace_ends_at: null, seat_limit: null, seats_used: null, ...over,
});

// The server: my_orgs reflects whether you're clocked in.
let onShift = false;
let orgsOverride: unknown[] | null = null;
function server() {
  fake.rpcHandlers.my_orgs = () => ({
    data: orgsOverride ?? [org(onShift ? { on_shift: true, shift_started_at: iso(-90) } : {})],
  });
  fake.rpcHandlers.clock_in = () => {
    onShift = true;
    return { data: null };
  };
  fake.rpcHandlers.clock_out = () => {
    onShift = false;
    return { data: null };
  };
  fake.rpcResults.org_my_views = {
    data: [{ viewer_name: 'Max Lead', viewer_role: 'manager', action: 'viewed_live', created_at: iso(-5) }],
  };
}

const screen = () => render(<AccountProvider><WorkScreen /></AccountProvider>);

beforeEach(async () => {
  fake.reset();
  await AsyncStorage.clear();
  onShift = false;
  orgsOverride = null;
  server();
  mockPush.mockReset();
  mockTracking.active = false;
  mockTracking.background = true;
  mockTracking.start.mockClear();
  mockTracking.start.mockImplementation(async () => ({ ok: true as const, backgroundGranted: true }));
  mockTracking.stop.mockClear();
  mockReminders.schedule.mockClear();
  mockReminders.cancel.mockClear();
});
afterEach(unmountAll);

describe('Work tab: a worker', () => {
  it('off shift: says nobody can see you, and lists who has looked', async () => {
    const r = await screen();
    const t = allText(r);
    expect(t).toContain('Acme Roofing');
    expect(t).toContain('You are a worker');
    expect(t).toContain('⚪ Off shift');
    expect(t).toContain('Nobody at work can see your location.');
    expect(t).toContain('Max Lead (manager)');
    expect(t).toContain('looked at your live location · 5m ago');
    expect(fake.rpcsOf('org_my_views')).toEqual([{ p_org: 'o1', p_limit: 10 }]);
  });

  it('clocks in with hourly check-ins: explains first, starts sharing, then shows the shift', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await screen();
    await press(r, 'Every hour');
    await press(r, 'Clock in');
    const [title, body] = alert.mock.calls[0] as [string, string];
    expect(title).toBe('Clock in to Acme Roofing?');
    expect(body).toContain("If you miss a check-in (every 60 min), they're alerted with your last location.");
    expect(fake.rpcsOf('clock_in')).toHaveLength(0); // nothing until confirmed

    await tapAlertButton(alert, 'Clock in');
    expect(mockTracking.start).toHaveBeenCalled(); // sharing starts so managers aren't looking at an empty map
    expect(fake.rpcsOf('clock_in')).toEqual([{ p_org: 'o1', p_checkin_minutes: 60 }]);
    expect(mockReminders.schedule).toHaveBeenCalled();
    const t = allText(r);
    expect(t).toContain('🟢 On shift');
    expect(t).toContain('Your admins and managers can see your location until you clock out.');
    expect(t).toMatch(/this shift ends by itself at/);
    alert.mockRestore();
  });

  it('warns when location can only be sent while the app is open', async () => {
    mockTracking.start.mockImplementation(async () => ({ ok: true as const, backgroundGranted: false }));
    mockTracking.background = false;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await screen();
    await press(r, 'Clock in');
    await tapAlertButton(alert, 'Clock in');
    expect(allText(r)).toContain('Keep it open during your shift.');
    alert.mockRestore();
  });

  it('if the server refuses the clock-in, stops the sharing it started and says why', async () => {
    fake.rpcHandlers.clock_in = () => ({ error: { message: 'Accept the disclosure first.' } });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await screen();
    await press(r, 'Clock in');
    await tapAlertButton(alert, 'Clock in');
    expect(mockTracking.stop).toHaveBeenCalled();
    expect(allText(r)).toContain('Accept the disclosure first.');
    expect(allText(r)).toContain('⚪ Off shift');
    alert.mockRestore();
  });

  it('clocks out: stops the sharing clock-in started, cancels reminders, back off shift', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await screen();
    await press(r, 'Clock in');
    await tapAlertButton(alert, 'Clock in');
    await press(r, 'Clock out');
    expect(fake.rpcsOf('clock_out')).toHaveLength(1);
    expect(mockReminders.cancel).toHaveBeenCalled();
    expect(mockTracking.stop).toHaveBeenCalled();
    expect(allText(r)).toContain('⚪ Off shift');
    alert.mockRestore();
  });

  it("leaves someone's own always-on sharing running at clock-out", async () => {
    mockTracking.active = true; // they were already sharing before the shift
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await screen();
    await press(r, 'Clock in');
    await tapAlertButton(alert, 'Clock in');
    await press(r, 'Clock out');
    expect(mockTracking.stop).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('a failed clock-out says sharing has stopped but the clock-out still needs recording', async () => {
    onShift = true;
    fake.rpcHandlers.clock_out = () => ({ error: { message: 'Network request failed' } });
    const r = await screen();
    await press(r, 'Clock out');
    expect(allText(r)).toContain("Your location has stopped sending, but we couldn't record your clock-out (Network request failed)");
  });

  it("an overdue check-in asks for I'm OK, which tells the server and re-arms the reminder", async () => {
    orgsOverride = [org({ on_shift: true, shift_started_at: iso(-120), checkin_minutes: 30, next_checkin_due: iso(-2) })];
    fake.rpcResults.shift_check_in = { data: iso(30) };
    const r = await screen();
    expect(allText(r)).toContain("Check-in overdue — tap I'm OK now.");
    await press(r, "I'm OK");
    expect(fake.rpcsOf('shift_check_in')).toHaveLength(1);
    expect(mockReminders.schedule).toHaveBeenCalled();
  });

  it('after the disclosure changes, must accept again before clocking in', async () => {
    orgsOverride = [org({ needs_reconsent: true })];
    const r = await screen();
    expect(allText(r)).toContain('What Acme Roofing can see about you has changed.');
    expect(pressables(r, 'Clock in')).toHaveLength(0);
    orgsOverride = null;
    await press(r, 'I understand — keep working here');
    expect(fake.rpcsOf('accept_org_consent')).toEqual([{ p_org: 'o1' }]);
    expect(pressables(r, 'Clock in').length).toBeGreaterThan(0);
  });

  it('cannot clock in to a second job while on shift at another', async () => {
    orgsOverride = [org({ org_id: 'o1', on_shift: true, shift_started_at: iso(-30) }), org({ org_id: 'o2', name: 'Beta Builders' })];
    const r = await screen();
    expect(allText(r)).toContain('Clock out of your other job first');
    expect(pressables(r, 'Clock out of your other job first')).toHaveLength(0); // disabled
  });
});

describe('Work tab: managers and admins', () => {
  it('a manager gets the crew view, not admin tools', async () => {
    orgsOverride = [org({ role: 'manager' })];
    const r = await screen();
    expect(allText(r)).toContain('See the workers on the teams you lead who are clocked in.');
    await press(r, 'Open crew view');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/crew', params: { orgId: 'o1', orgName: 'Acme Roofing' } });
    expect(pressables(r, 'Manage people & teams')).toHaveLength(0);
    expect(allText(r)).not.toContain('Invite your crew');
    expect(fake.rpcsOf('org_my_views')).toHaveLength(0); // only workers have a "who looked at me" list
  });

  it('an admin can manage people and make an invite code', async () => {
    orgsOverride = [org({ role: 'admin' })];
    fake.rpcResults.regenerate_org_invite_code = { data: 'K7Q2-PX9M' };
    const r = await screen();
    expect(allText(r)).toContain('You are an admin');
    await press(r, 'Manage people & teams');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/crew-manage', params: { orgId: 'o1', orgName: 'Acme Roofing' } });
    await press(r, 'Get a new invite code');
    expect(fake.rpcsOf('regenerate_org_invite_code')).toEqual([{ p_org: 'o1' }]);
    expect(allText(r)).toContain('K7Q2-PX9M');
  });

  it('managers and admins open timesheets; workers have none', async () => {
    orgsOverride = [org({ role: 'manager' })];
    const r = await screen();
    await press(r, 'Timesheets');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/timesheets', params: { orgId: 'o1', orgName: 'Acme Roofing' } });
    orgsOverride = null;
    const w = await screen();
    expect(pressables(w, 'Timesheets')).toHaveLength(0);
  });

  it('owners and admins reach organization settings; managers do not', async () => {
    orgsOverride = [org({ role: 'admin' })];
    const r = await screen();
    await press(r, 'Organization settings');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/org-settings', params: { orgId: 'o1' } });
    orgsOverride = [org({ role: 'manager' })];
    const m = await screen();
    expect(pressables(m, 'Organization settings')).toHaveLength(0);
  });

  it('managers open job sites', async () => {
    orgsOverride = [org({ role: 'manager' })];
    const r = await screen();
    await press(r, 'Job sites');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/job-sites', params: { orgId: 'o1' } });
  });

  it('an owner is described as an owner', async () => {
    orgsOverride = [org({ role: 'owner' })];
    const r = await screen();
    expect(allText(r)).toContain('You are an owner');
  });
});

describe('Work tab: the plan (demo billing)', () => {
  it('a worker on an ended plan is told why, cannot clock in, and still has SOS', async () => {
    orgsOverride = [org({ plan_state: 'ended' })];
    const r = await screen();
    const t = allText(r);
    expect(t).toContain("Acme Roofing's plan has ended, so you can't start a new shift.");
    expect(t).toContain('SOS still works');
    expect(pressables(r, 'Clock in')).toHaveLength(0);
    expect(pressables(r, 'SOS').length).toBeGreaterThan(0);
  });

  it('a worker on a running shift can still clock out after the plan ends', async () => {
    orgsOverride = [org({ plan_state: 'ended', on_shift: true, shift_started_at: iso(-30) })];
    const r = await screen();
    expect(pressables(r, 'Clock out')).toHaveLength(1);
  });

  it('the owner sees the trial and pays for seats', async () => {
    orgsOverride = [org({ role: 'owner', seat_limit: 10, seats_used: 3 })];
    fake.rpcHandlers.org_demo_billing = () => {
      orgsOverride = [org({ role: 'owner', plan_state: 'active', seat_limit: 25, seats_used: 3 })];
      return {};
    };
    const r = await screen();
    expect(allText(r)).toContain('Free trial · 14 days left');
    expect(allText(r)).toContain('3 of 10 worker seats used');
    expect(allText(r)).toContain('no real money moves');
    await press(r, 'Pay for 25 seats (demo)');
    expect(fake.rpcsOf('org_demo_billing')).toEqual([{ p_org: 'o1', p_action: 'activate', p_seats: 25 }]);
    expect(allText(r)).toContain('Plan active');
    expect(allText(r)).toContain('3 of 25 worker seats used');
  });

  it('the owner can simulate a failed payment, and canceling asks first', async () => {
    orgsOverride = [org({ role: 'owner', plan_state: 'active', seat_limit: 5, seats_used: 1 })];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await screen();
    await press(r, 'Simulate a failed payment (demo)');
    expect(fake.rpcsOf('org_demo_billing')).toEqual([{ p_org: 'o1', p_action: 'payment_failed', p_seats: null }]);
    await press(r, 'Cancel plan');
    expect(fake.rpcsOf('org_demo_billing')).toHaveLength(1); // not until confirmed
    await tapAlertButton(alert, 'Cancel plan');
    expect(fake.rpcsOf('org_demo_billing')[1]).toEqual({ p_org: 'o1', p_action: 'cancel', p_seats: null });
    alert.mockRestore();
  });

  it('says why the server refused a plan change', async () => {
    orgsOverride = [org({ role: 'owner', seat_limit: 10, seats_used: 0 })];
    fake.rpcResults.org_demo_billing = { error: { message: 'Only the owner can change the plan.' } };
    const r = await screen();
    await press(r, 'Pay for 5 seats (demo)');
    expect(allText(r)).toContain('Only the owner can change the plan.');
  });

  it('before the server has plans, shows no plan card', async () => {
    orgsOverride = [org({ role: 'owner', plan_state: undefined })];
    const r = await screen();
    expect(allText(r)).not.toContain('Plan ended');
    expect(pressables(r, 'Pay for 5 seats (demo)')).toHaveLength(0);
  });

  it('an admin sees the plan but cannot change it, and is warned when seats are full', async () => {
    orgsOverride = [org({ role: 'admin', plan_state: 'active', seat_limit: 5, seats_used: 5 })];
    const r = await screen();
    const t = allText(r);
    expect(t).toContain('Plan active');
    expect(t).toContain('Only the owner can change the plan.');
    expect(t).toContain('Every seat is taken.');
    expect(pressables(r, 'Pay for 5 seats (demo)')).toHaveLength(0);
  });
});

describe('Work tab: job site reminders', () => {
  beforeEach(() => {
    mockSiteReminders.on = false;
    mockSiteReminders.set.mockClear();
  });

  it('a worker can turn them on, and is told nobody at work learns where they were', async () => {
    const r = await screen();
    expect(allText(r)).toContain('Only your phone knows: nobody at work is told you were there.');
    const sw = r.root.findAll((n) => n.props.accessibilityLabel === 'Job site reminders' && typeof n.props.onValueChange === 'function')[0];
    expect(sw.props.value).toBe(false);
    await act(async () => {
      await sw.props.onValueChange(true);
    });
    expect(mockSiteReminders.set).toHaveBeenCalledWith(true);
    expect(allText(r)).toContain('On. Watching 3 job sites.');
  });

  it('says why when they can\'t be turned on', async () => {
    mockSiteReminders.set.mockResolvedValueOnce({ ok: false, reason: 'Reminders need location set to "Always" for Safe Circle in Settings.' } as never);
    const r = await screen();
    const sw = r.root.findAll((n) => n.props.accessibilityLabel === 'Job site reminders' && typeof n.props.onValueChange === 'function')[0];
    await act(async () => {
      await sw.props.onValueChange(true);
    });
    expect(allText(r)).toContain('location set to "Always"');
  });

  it('owners and managers who never clock in don\'t get the switch', async () => {
    orgsOverride = [org({ role: 'owner' })];
    const r = await screen();
    expect(allText(r)).not.toContain('Job site reminders');
  });
});
