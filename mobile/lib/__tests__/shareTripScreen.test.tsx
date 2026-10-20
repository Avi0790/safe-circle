import React from 'react';
import { Alert, Share, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// The Share a trip screen with the real screen and real trip rules; only the
// edges are faked: the server (rpc), the live trips feed, circle/auth context,
// and the stored sharing window.
const mockRpc = jest.fn();
const mockRefresh = jest.fn(async () => {});
const mockTrips: { current: unknown[] } = { current: [] };
const mockCircle: { current: null | { id: string; name: string } } = { current: { id: 'c1', name: 'Family' } };
const mockShareUntil: { current: Date | null } = { current: null };
// Live links the server holds for my trip (share_links rows).
const mockLinks: { current: { id: string; expires_at: string }[] } = { current: [] };
const mockTracking = { active: true, start: jest.fn(async () => ({ ok: true as const, backgroundGranted: true })) };

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/contexts/CircleContext', () => ({
  useCircles: () => ({ circles: [{ id: 'c1', name: 'Family' }], selectedCircle: mockCircle.current }),
}));
jest.mock('@/hooks/useActiveTrips', () => ({ useActiveTrips: () => ({ trips: mockTrips.current, refresh: mockRefresh }) }));
jest.mock('@/lib/locationTracking', () => ({
  getShareUntil: async () => mockShareUntil.current,
  setShareUntil: async () => {},
  isTrackingActive: async () => mockTracking.active,
  isBackgroundTaskActive: async () => true,
  startBackgroundTracking: () => mockTracking.start(),
  stopBackgroundTracking: async () => {},
}));
jest.mock('@/lib/supabase', () => {
  const q: any = new Proxy({}, {
    get: (_t, prop) =>
      prop === 'then'
        ? (resolve: (v: unknown) => void) => resolve({ data: mockLinks.current, error: null })
        : () => q,
  });
  return { supabase: { rpc: (...a: unknown[]) => mockRpc(...a), from: () => q } };
});

import ShareTripScreen from '../../app/(app)/share-trip';

function text(node: any): string {
  if (typeof node === 'string') return node;
  return (node?.children ?? []).map(text).join('');
}
const allText = (r: ReactTestRenderer) => text(r.toJSON() as any);

function press(r: ReactTestRenderer, label: string) {
  const hit = r.root.findAll(
    (n) =>
      typeof n.props.onPress === 'function' &&
      (text({ children: n.children }).includes(label) || n.props.accessibilityLabel === label),
  );
  expect(hit.length).toBeGreaterThan(0);
  return act(async () => {
    hit[0].props.onPress();
  });
}

async function mount(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<ShareTripScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

const inputs = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === TextInput);
const calls = (name: string) => mockRpc.mock.calls.filter((c) => c[0] === name);

const myTrip = (over: Record<string, unknown> = {}) => ({
  id: 'trip-1', user_id: 'me', circle_id: 'c1', destination: 'Denver', mode: 'flight', status: 'active',
  eta: new Date(Date.now() + 2 * 3_600_000).toISOString(), started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(), profiles: { full_name: 'Me' }, ...over,
});

beforeEach(() => {
  jest.useFakeTimers();
  mockRpc.mockReset();
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'create_trip_share_link') {
      mockLinks.current = [{ id: 'link-1', expires_at: new Date(Date.now() + 3 * 3_600_000).toISOString() }];
      return { data: [{ id: 'link-1', token: 'tok123' }], error: null };
    }
    if (name === 'finish_trip_share_link') mockLinks.current = [];
    return { data: 'trip-1', error: null };
  });
  mockLinks.current = [];
  mockTracking.active = true;
  mockTracking.start.mockClear();
  mockRefresh.mockClear();
  mockTrips.current = [];
  mockCircle.current = { id: 'c1', name: 'Family' };
  mockShareUntil.current = null;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Share a trip screen', () => {
  it('shares a bus with the circle: destination, ETA and kind, nothing else', async () => {
    const r = await mount();
    expect(allText(r)).toContain('Family');
    expect(allText(r)).toContain('not a route');
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('  Campus ');
    });
    await press(r, 'Share trip');

    const start = calls('start_shared_trip');
    expect(start).toHaveLength(1);
    expect(start[0][1]).toMatchObject({ p_circle_id: 'c1', p_destination: 'Campus', p_mode: 'bus' });
    expect(Object.keys(start[0][1]).sort()).toEqual(['p_circle_id', 'p_destination', 'p_eta', 'p_mode']);
    // default for a bus is 30 minutes
    const etaMin = (new Date(start[0][1].p_eta).getTime() - Date.now()) / 60_000;
    expect(etaMin).toBeGreaterThan(29);
    expect(etaMin).toBeLessThan(31);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('a flight defaults to 2 hours, steps by 15 minutes, and explains the airplane-mode wait', async () => {
    const r = await mount();
    await press(r, 'Flight');
    expect(allText(r)).toContain('Landing in');
    expect(allText(r)).toContain('2 h');
    expect(allText(r)).toContain("can't send updates");
    await press(r, 'Later');
    expect(allText(r)).toContain('2 h 15 min');
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('Denver');
    });
    await press(r, 'Share trip');
    const start = calls('start_shared_trip')[0][1];
    expect(start).toMatchObject({ p_destination: 'Denver', p_mode: 'flight' });
    expect((new Date(start.p_eta).getTime() - Date.now()) / 60_000).toBeGreaterThan(134);
  });

  it('picks a preset', async () => {
    const r = await mount();
    await press(r, 'Train');
    await press(r, '3 h');
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('Chicago');
    });
    await press(r, 'Share trip');
    expect(calls('start_shared_trip')[0][1]).toMatchObject({ p_mode: 'train' });
    expect((new Date(calls('start_shared_trip')[0][1].p_eta).getTime() - Date.now()) / 60_000).toBeGreaterThan(179);
  });

  it('will not share without a destination', async () => {
    const r = await mount();
    await press(r, 'Share trip');
    expect(calls('start_shared_trip')).toHaveLength(0);
    expect(allText(r)).toContain('Say where you are going');
  });

  it("shows the server's refusal", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Not a member of this circle.' } });
    const r = await mount();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('Campus');
    });
    await press(r, 'Share trip');
    expect(allText(r)).toContain('Not a member of this circle.');
  });

  it('needs a circle', async () => {
    mockCircle.current = null;
    const r = await mount();
    expect(allText(r)).toContain('Join or create a circle first');
    expect(inputs(r)).toHaveLength(0);
  });

  it('warns when a sharing window has ended, since the circle would not see the trip', async () => {
    mockShareUntil.current = new Date(Date.now() - 60_000);
    const r = await mount();
    expect(allText(r)).toContain('Your sharing window has ended');
  });

  describe('with a trip already being shared', () => {
    it('shows it instead of the form, and says what the circle sees', async () => {
      mockTrips.current = [myTrip()];
      const r = await mount();
      expect(allText(r)).toContain('✈️ Flight to Denver');
      expect(allText(r)).toContain('Family can see');
      expect(allText(r)).toMatch(/landing in about 2 h \(/);
      expect(inputs(r)).toHaveLength(0);
    });

    it("is not fooled by someone else's trip, or a drive of mine", async () => {
      mockTrips.current = [myTrip({ user_id: 'them' }), myTrip({ id: 'd', mode: 'drive' })];
      const r = await mount();
      expect(inputs(r)).toHaveLength(1); // the form
    });

    it('I\'ve arrived tells the server it was a real arrival', async () => {
      mockTrips.current = [myTrip()];
      const r = await mount();
      await press(r, "I've arrived");
      expect(calls('end_shared_trip')[0][1]).toEqual({ p_trip: 'trip-1', p_arrived: true });
    });

    it('Stop sharing ends it quietly', async () => {
      mockTrips.current = [myTrip()];
      const r = await mount();
      await press(r, 'Stop sharing');
      expect(calls('end_shared_trip')[0][1]).toEqual({ p_trip: 'trip-1', p_arrived: false });
    });

    it('Running late moves the ETA 15 minutes later', async () => {
      const eta = Date.now() + 2 * 3_600_000;
      mockTrips.current = [myTrip({ eta: new Date(eta).toISOString() })];
      const r = await mount();
      await press(r, 'Running late');
      const update = calls('update_shared_trip')[0][1];
      expect(update.p_trip).toBe('trip-1');
      expect(new Date(update.p_eta).getTime()).toBe(eta + 15 * 60_000);
    });

    it('Running late on a trip already past its time counts from now, not from the past', async () => {
      mockTrips.current = [myTrip({ eta: new Date(Date.now() - 10 * 60_000).toISOString() })];
      const r = await mount();
      await press(r, 'Running late');
      const t = new Date(calls('update_shared_trip')[0][1].p_eta).getTime();
      expect(t).toBeGreaterThan(Date.now() + 14 * 60_000);
      expect(t).toBeLessThan(Date.now() + 16 * 60_000);
    });
  });

  describe('Share ETA with anyone', () => {
    async function choose(r: ReactTestRenderer, option: string) {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      await press(r, 'Share ETA with anyone');
      const [title, , buttons] = alert.mock.calls[0] as [string, string, { text: string; onPress?: () => Promise<void> }[]];
      expect(title).toBe('Share your ETA');
      await act(async () => {
        await buttons.find((b) => b.text === option)!.onPress!();
      });
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }
      alert.mockRestore();
    }

    it('is offered once a trip is up, not before', async () => {
      let r = await mount();
      expect(allText(r)).not.toContain('Share ETA with anyone');
      mockTrips.current = [myTrip()];
      r = await mount();
      expect(allText(r)).toContain('Share ETA with anyone');
    });

    it('just the ETA: a message, nothing sent to the server', async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
      mockTrips.current = [myTrip()];
      const r = await mount();
      await choose(r, 'Just the ETA as a message');
      expect((share.mock.calls[0][0] as { message: string }).message).toMatch(/^I'm flying to Denver, landing around \d{1,2}:\d{2}/);
      expect(calls('create_trip_share_link')).toHaveLength(0);
      share.mockRestore();
    });

    it('live link: tied to this trip, sent through the share sheet, and shown as on', async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
      mockTrips.current = [myTrip()];
      const r = await mount();
      await choose(r, 'Live link (until I arrive)');
      expect(calls('create_trip_share_link')[0][1]).toMatchObject({ p_destination: 'Denver', p_mode: 'flight', p_trip: 'trip-1' });
      expect((share.mock.calls[0][0] as { message: string }).message).toMatch(
        /landing around .*\. Follow along live until I get there: http:\/\/localhost:5173\/track\/tok123$/,
      );
      expect(allText(r)).toContain('A live link is out for this trip');
      expect(allText(r)).not.toContain('Share ETA with anyone');
      share.mockRestore();
    });

    it('the link can be stopped on its own, leaving the trip shared with the circle', async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
      mockTrips.current = [myTrip()];
      mockLinks.current = [{ id: 'link-1', expires_at: new Date(Date.now() + 3_600_000).toISOString() }];
      const r = await mount();
      expect(allText(r)).toContain('A live link is out for this trip'); // found on the server, after coming back to the screen
      await press(r, 'Stop the live link');
      expect(calls('finish_trip_share_link')).toEqual([['finish_trip_share_link', { p_id: 'link-1', p_arrived: false }]]);
      expect(calls('end_shared_trip')).toHaveLength(0);
      expect(allText(r)).toContain('Share ETA with anyone');
      share.mockRestore();
    });

    it("arriving ends the trip; the server takes the link with it, so the app doesn't have to", async () => {
      mockTrips.current = [myTrip()];
      mockLinks.current = [{ id: 'link-1', expires_at: new Date(Date.now() + 3_600_000).toISOString() }];
      const r = await mount();
      await press(r, "I've arrived");
      expect(calls('end_shared_trip')[0][1]).toEqual({ p_trip: 'trip-1', p_arrived: true });
      expect(calls('finish_trip_share_link')).toHaveLength(0);
    });

    it('turns sharing on for the trip if it was off, never for more than a day', async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
      mockTracking.active = false;
      mockTrips.current = [myTrip({ eta: new Date(Date.now() + 30 * 3_600_000).toISOString() })]; // a long flight
      const r = await mount();
      await choose(r, 'Live link (until I arrive)');
      expect(mockTracking.start).toHaveBeenCalled();
      expect(calls('set_share_window')[0][1].p_minutes).toBeLessThanOrEqual(1440);
      expect(calls('create_trip_share_link')).toHaveLength(1);
      share.mockRestore();
    });

    it("says why when the link can't be made", async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
      mockTrips.current = [myTrip()];
      const r = await mount();
      mockRpc.mockImplementation(async () => ({ data: null, error: { message: 'You already have 5 active links. Revoke one first.' } }));
      await choose(r, 'Live link (until I arrive)');
      expect(allText(r)).toContain('You already have 5 active links. Revoke one first.');
      expect(share).not.toHaveBeenCalled();
      share.mockRestore();
    });
  });
});
