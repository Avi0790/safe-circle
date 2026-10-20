import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// The Map tab end to end: the real screen, its hooks, banners and markers.
// Only the edges are faked: the server (per-table data, rpc, realtime), the
// signed-in user and selected circle, the shared members provider, GPS, and
// the native map view (rendered as plain views so markers can be inspected).

const mockTables: Record<string, unknown[]> = {};
const mockFromCalls: string[] = [];
const mockRealtime: { table: string; cb: () => void }[] = [];
const mockRpc = jest.fn(async (..._a: unknown[]) => ({ data: null, error: null }));
const mockMembers: { current: unknown[] } = { current: [] };
const mockPermission: { current: 'granted' | 'denied' } = { current: 'granted' };
const mockFit = jest.fn();

jest.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    const q: any = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve({ data: mockTables[table] ?? [], error: null });
          }
          return () => q;
        },
      },
    );
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        mockFromCalls.push(table);
        return query(table);
      },
      rpc: (...a: unknown[]) => mockRpc(...a),
      channel: () => {
        const ch: any = {
          on: (_e: string, filter: { table: string }, cb: () => void) => {
            mockRealtime.push({ table: filter.table, cb });
            return ch;
          },
          subscribe: () => ch,
        };
        return ch;
      },
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/contexts/CircleContext', () => ({
  useCircles: () => ({ selectedCircleId: 'c1', selectedCircle: { id: 'c1', name: 'Family' }, circles: [{ id: 'c1', name: 'Family' }] }),
}));
jest.mock('@/contexts/CircleMembersContext', () => ({
  useCircleMembersContext: () => ({ members: mockMembers.current, isLoading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: async () => ({ status: mockPermission.current }),
  requestForegroundPermissionsAsync: async () => ({ status: mockPermission.current }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 35.8423, longitude: -90.7043 } }),
}));
jest.mock('react-native-maps', () => {
  const R = require('react');
  const { View } = require('react-native');
  const MapView = R.forwardRef((p: any, ref: any) => {
    R.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFit }));
    return R.createElement(View, { testID: 'map', ...p });
  });
  const Marker = (p: any) => R.createElement(View, { ...p, testID: 'marker' });
  return { __esModule: true, default: MapView, Marker, PROVIDER_DEFAULT: 'default' };
});

import MapTab from '../../app/(app)/(tabs)/index';

function text(node: any): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  return (node?.children ?? []).map(text).join('');
}
const allText = (r: ReactTestRenderer) => text(r.toJSON());
const markers = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'marker' && typeof n.type !== 'string');
const markerTitles = (r: ReactTestRenderer) => markers(r).map((m) => m.props.title as string);
const map = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'map' && n.props.initialRegion)[0];

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<MapTab />);
  });
  await flush();
  return r;
}

const t = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

const member = (id: string, name: string, at: [number, number] | null) => ({
  id, full_name: name, avatar_url: null, share_until: null, status_emoji: null, status_text: null,
  status_expires_at: null, phone_number: null,
  location: at
    ? { id: 1, user_id: id, latitude: at[0], longitude: at[1], accuracy: 10, battery_level: 0.8, speed: 0, recorded_at: t(-1) }
    : null,
});

const report = (id: string, reporter: string, kind: string, expiresIn = 50) => ({
  id, reporter_id: reporter, kind, latitude: 35.83, longitude: -90.7,
  created_at: t(-10), expires_at: t(expiresIn), profiles: { full_name: reporter === 'me' ? 'Me' : 'Sam' },
});

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockFromCalls.length = 0;
  mockRealtime.length = 0;
  mockRpc.mockClear();
  mockFit.mockClear();
  mockPermission.current = 'granted';
  mockMembers.current = [member('me', 'Me', [35.84, -90.70]), member('sam', 'Sam', [35.85, -90.69]), member('kim', 'Kim', null)];
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Map tab', () => {
  it('opens on your position, then fits everyone who has a location', async () => {
    const r = await mount();
    expect(map(r).props.initialRegion).toMatchObject({ latitude: 35.8423, longitude: -90.7043 });
    // Kim has no location yet, so only two people are on the map
    expect(markerTitles(r)).toEqual(['Me', 'Sam']);
    // members were known (cached) before the GPS fix; the map still frames them once it's up
    expect(mockFit).toHaveBeenCalledWith(
      [
        { latitude: 35.84, longitude: -90.7 },
        { latitude: 35.85, longitude: -90.69 },
      ],
      expect.objectContaining({ animated: true }),
    );
  });

  it("also fits when people's locations arrive after the map is up", async () => {
    mockMembers.current = [];
    const r = await mount();
    expect(mockFit).not.toHaveBeenCalled();
    mockMembers.current = [member('sam', 'Sam', [35.85, -90.69])];
    await act(async () => r.update(<MapTab />));
    expect(mockFit).toHaveBeenCalledTimes(1);
    expect(markerTitles(r)).toEqual(['Sam']);
  });

  it("shows this circle's pins", async () => {
    mockTables.map_pins = [
      { id: 'p1', circle_id: 'c1', created_by: 'sam', emoji: '🍕', label: 'Dinner here', latitude: 35.84, longitude: -90.7,
        expires_at: t(60), created_at: t(-5), profiles: { full_name: 'Sam' } },
    ];
    const r = await mount();
    expect(markerTitles(r)).toContain('Dinner here');
    expect(mockFromCalls).toContain('map_pins');
  });

  describe('road reports', () => {
    it("shows reports from this circle's members and mine, not from other circles", async () => {
      mockTables.road_reports = [report('r1', 'sam', 'crash'), report('r2', 'me', 'speed_check'), report('r3', 'pat', 'hazard')];
      const r = await mount();
      const titles = markerTitles(r);
      expect(titles).toContain('Crash reported');
      expect(titles).toContain('Speed check reported');
      expect(titles).not.toContain('Hazard reported'); // Pat isn't in this circle
      expect(allText(r)).toContain('💥');
    });

    it('tapping one says who and when; your own can be taken back, and the map reloads', async () => {
      mockTables.road_reports = [report('r2', 'me', 'closure', 150)];
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const r = await mount();
      const m = markers(r).find((x) => x.props.title === 'Road closed reported')!;
      await act(async () => m.props.onPress());
      const [title, body, buttons] = alert.mock.calls[0] as [string, string, { text: string; onPress?: () => Promise<void> }[]];
      expect(title).toBe('🚧 Road closed reported');
      expect(body).toMatch(/^By you · 10m ago · clears in 2 h 30 min$/);

      mockTables.road_reports = [];
      const loadsBefore = mockFromCalls.filter((x) => x === 'road_reports').length;
      await act(async () => {
        await buttons.find((b) => b.text === 'Take back report')!.onPress!();
      });
      await flush();
      expect(mockRpc).toHaveBeenCalledWith('clear_road_report', { p_id: 'r2' });
      expect(mockFromCalls.filter((x) => x === 'road_reports').length).toBeGreaterThan(loadsBefore);
      expect(markerTitles(r)).not.toContain('Road closed reported');
      alert.mockRestore();
    });

    it("someone else's report offers nothing to change", async () => {
      mockTables.road_reports = [report('r1', 'sam', 'crash')];
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const r = await mount();
      await act(async () => markers(r).find((x) => x.props.title === 'Crash reported')!.props.onPress());
      const buttons = alert.mock.calls[0][2] as { text: string }[];
      expect(buttons.map((b) => b.text)).toEqual(['OK']);
      expect((alert.mock.calls[0][1] as string)).toMatch(/^By Sam · /);
      alert.mockRestore();
    });

    it('a new report arrives live', async () => {
      const r = await mount();
      expect(markerTitles(r)).not.toContain('Hazard reported');
      mockTables.road_reports = [report('r9', 'sam', 'hazard')];
      const live = mockRealtime.filter((x) => x.table === 'road_reports');
      expect(live.length).toBeGreaterThan(0);
      await act(async () => live.forEach((x) => x.cb()));
      await flush();
      expect(markerTitles(r)).toContain('Hazard reported');
    });

    it('drops a report when it expires, even with no change on the server', async () => {
      mockTables.road_reports = [report('r1', 'sam', 'crash', 0.5)]; // 30 seconds left
      const r = await mount();
      expect(markerTitles(r)).toContain('Crash reported');
      await act(async () => {
        jest.advanceTimersByTime(61_000);
      });
      expect(markerTitles(r)).not.toContain('Crash reported');
    });
  });

  it('with location off, explains why and still opens the map', async () => {
    mockPermission.current = 'denied';
    const r = await mount();
    expect(allText(r)).toContain('Location access is off');
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(map(r).props.initialRegion).toMatchObject({ latitude: 37.7749, longitude: -122.4194 });
    expect(markerTitles(r)).toEqual(['Me', 'Sam']);
  });

  it('remembers the satellite view', async () => {
    const r = await mount();
    const btn = r.root.findAll((n) => n.props.accessibilityLabel === 'Switch to satellite map' && typeof n.props.onPress === 'function')[0];
    await act(async () => btn.props.onPress());
    expect(map(r).props.mapType).toBe('hybrid');
    expect(await AsyncStorage.getItem('safecircle.mapType.v1')).toBe('hybrid');
  });
});
