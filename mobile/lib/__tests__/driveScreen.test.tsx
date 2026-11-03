import React from 'react';
import { Alert, Animated, Linking, Share, Switch, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Speech from 'expo-speech';
import osrmFixture from './fixtures/osrm-jonesboro.json';
import footFixture from './fixtures/osrm-foot-jonesboro.json';
import withStopFixture from './fixtures/osrm-with-stop.json';
import nominatimGas from './fixtures/nominatim-gas.json';
import lanesFixture from './fixtures/osrm-lanes-jonesboro.json';
import photonFixture from './fixtures/photon-walmart.json';

// The Drive screen end to end: real screen, real navigation and routing code,
// real captured route. Only the device edges are faked: GPS (driven by the
// test), speech, the map view, and the network (serving the captured responses).

// Several tests replay a whole drive or walk one GPS fix at a time (~640
// screen updates for the 5-mile route). That's about a second on an idle Mac,
// but 3–4 times longer while the full suite or a build runs alongside, which
// crossed Jest's 5 s default. A test that times out also keeps feeding GPS
// fixes into the next test's watchers, so a few quick tests failed behind it.
// 30 s still catches a test that is genuinely stuck.
jest.setTimeout(30_000);

const mockWatchers: { cb: (loc: unknown) => void; removed: boolean }[] = [];
const mockStart = { latitude: 35.8423, longitude: -90.7043 };
const mockFetch = jest.fn();
const mockRpc = jest.fn();
const mockPush = jest.fn();
const mockAnimate = jest.fn();
const mockCamera: { current: { heading: number; pitch: number } } = { current: { heading: 0, pitch: 0 } };
const mockFit = jest.fn();
const mockReports: { current: unknown[] } = { current: [] };
// What Nominatim's reverse lookup says about the road you're on (speed limits).
const mockRoad: { current: Record<string, unknown> } = { current: { category: 'highway', osm_type: 'way', osm_id: 1, extratags: {} } };
const mockUser: { current: null | string } = { current: null };
const mockCircle: { current: null | { id: string; name: string } } = { current: null };

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@/contexts/CircleContext', () => ({ useCircles: () => ({ selectedCircle: mockCircle.current }) }));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: mockUser.current ? { user: { id: mockUser.current } } : null }),
}));
jest.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void) =>
      resolve({ data: table === 'road_reports' ? mockReports.current : [], error: null });
    return q;
  };
  const channel: Record<string, unknown> = {};
  channel.on = () => channel;
  channel.subscribe = () => channel;
  return {
    supabase: {
      rpc: (...a: unknown[]) => mockRpc(...a),
      from: (table: string) => query(table),
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
// A live ETA link needs location sharing on; the device side of that is faked.
const mockTracking = { active: true, start: jest.fn(async () => ({ ok: true as const, backgroundGranted: true })) };
jest.mock('@/lib/locationTracking', () => ({
  isTrackingActive: async () => mockTracking.active,
  isBackgroundTaskActive: async () => true,
  getShareUntil: async () => null,
  setShareUntil: async () => {},
  startBackgroundTracking: () => mockTracking.start(),
  stopBackgroundTracking: async () => {},
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(), deactivateKeepAwake: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, BestForNavigation: 6 },
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async () => ({ coords: { ...mockStart, speed: 0, heading: 0 }, timestamp: 1_000 }),
  watchPositionAsync: async (_opts: unknown, cb: (loc: unknown) => void) => {
    const w = { cb, removed: false };
    mockWatchers.push(w);
    return { remove: () => void (w.removed = true) };
  },
}));
jest.mock('react-native-maps', () => {
  const R = require('react');
  const { View } = require('react-native');
  const MapView = R.forwardRef(
    (p: { children?: unknown; showsUserLocation?: boolean; onMapReady?: () => void; onRegionChangeComplete?: () => void }, ref: React.Ref<unknown>) => {
    R.useImperativeHandle(ref, () => ({ animateCamera: mockAnimate, fitToCoordinates: mockFit, getCamera: async () => mockCamera.current }));
    // A real map reports when it's ready; the screen waits for that before moving the camera.
    R.useEffect(() => {
      p.onMapReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Rendered (not null) so the vehicle marker and the map's props can be checked.
    return R.createElement(View, { testID: 'map', showsUserLocation: p.showsUserLocation, onRegionChangeComplete: p.onRegionChangeComplete }, p.children);
  },
  );
  const Marker = (p: Record<string, unknown>) => R.createElement(View, { ...p, testID: 'marker' });
  // The animated marker and region the vehicle glides with: here the region
  // just records each move (to, and over how long) and jumps there.
  class AnimatedRegion {
    latitude: number;
    longitude: number;
    moves: { latitude: number; longitude: number; duration: number }[] = [];
    constructor(r: { latitude: number; longitude: number }) {
      this.latitude = r.latitude;
      this.longitude = r.longitude;
    }
    stopAnimation(cb?: () => void) {
      cb?.();
    }
    timing(cfg: { latitude: number; longitude: number; duration: number }) {
      return {
        start: (cb?: () => void) => {
          this.moves.push({ latitude: cfg.latitude, longitude: cfg.longitude, duration: cfg.duration });
          this.latitude = cfg.latitude;
          this.longitude = cfg.longitude;
          cb?.();
        },
      };
    }
  }
  return { __esModule: true, default: MapView, Marker, MarkerAnimated: Marker, AnimatedRegion, Polyline: () => null, PROVIDER_DEFAULT: 'default' };
});

import DriveScreen from '../../app/(app)/drive';

const vertices = osrmFixture.routes[0].geometry.coordinates; // [lon, lat]

// A phone reports about once a second: ~13 m apart at 30 mph. The route's own
// vertices can be hundreds of metres apart on a straight road, so interpolate
// to the density a real drive produces instead of feeding the screen vertices.
function densify(points: number[][], stepM: number): number[][] {
  const out: number[][] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [lon0, lat0] = points[i - 1];
    const [lon1, lat1] = points[i];
    const dy = (lat1 - lat0) * 110540;
    const dx = (lon1 - lon0) * Math.cos((lat0 * Math.PI) / 180) * 111320;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / stepM));
    for (let k = 1; k <= n; k++) out.push([lon0 + ((lon1 - lon0) * k) / n, lat0 + ((lat1 - lat0) * k) / n]);
  }
  return out;
}
const route = densify(vertices, 13);

function text(node: any): string {
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(text).join('');
}
const allText = (r: ReactTestRenderer) => text(r.toJSON() as any);
const spoken = () => (Speech.speak as jest.Mock).mock.calls.map((c) => c[0] as string);

async function emit(lon: number, lat: number, speed: number, t: number) {
  await act(async () => {
    mockWatchers.filter((w) => !w.removed).forEach((w) =>
      w.cb({ coords: { latitude: lat, longitude: lon, speed, heading: 90 }, timestamp: t }),
    );
  });
}

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

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
  mockWatchers.length = 0;
  mockFetch.mockReset();
  mockRpc.mockReset();
  mockPush.mockReset();
  mockAnimate.mockClear();
  mockFit.mockClear();
  mockReports.current = [];
  mockRoad.current = { category: 'highway', osm_type: 'way', osm_id: 1, extratags: {} };
  mockTracking.active = true;
  mockTracking.start.mockClear();
  mockRpc.mockImplementation(async (name: string) => ({
    data:
      name === 'start_shared_trip'
        ? 'trip-1'
        : name === 'report_road_incident'
          ? 'rep-1'
          : name === 'create_trip_share_link'
            ? [{ id: 'link-1', token: 'tok123' }]
            : null,
    error: null,
  }));
  mockCircle.current = null;
  mockUser.current = null;
  (Speech.speak as jest.Mock).mockClear();
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes('/reverse?')
        ? mockRoad.current
        : String(url).includes('nominatim')
        ? nominatimGas
        : String(url).includes('/route/v1/driving')
        ? // three points (start;stop;destination) means a route via a stop
          (String(url).split('?')[0].match(/;/g) ?? []).length === 2
          ? withStopFixture
          : osrmFixture
        : String(url).includes('/route/v1/foot')
          ? footFixture
          : photonFixture,
  }));
  (global as any).fetch = mockFetch;
});
afterEach(() => {
  jest.useRealTimers();
});

async function mountAndPlan(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<DriveScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

async function search(r: ReactTestRenderer, q: string) {
  await act(async () => {
    r.root.findByType(TextInput).props.onChangeText(q);
  });
  await act(async () => {
    jest.advanceTimersByTime(700); // past the debounce
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Drive screen', () => {
  it('searches, plans a route, and shows its length and time', async () => {
    const r = await mountAndPlan();
    expect(allText(r)).toContain('Where to?');
    await search(r, 'walmart');
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('photon'))).toBe(true);
    expect(allText(r)).toContain('Walmart Supercenter');
    expect(allText(r)).toContain('1815 East Highland Drive');

    await press(r, 'Walmart Supercenter');
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/route/v1/driving'))).toBe(true);
    // 8.3 km is 5.2 mi; 651 s is 11 min
    expect(allText(r)).toMatch(/11 min · 5\.2 mi · arrive/);
    expect(allText(r)).toContain('Start');
    expect(allText(r)).toContain('Open in Maps app instead');
  });

  it('will not take a destination while the vehicle is moving', async () => {
    const r = await mountAndPlan();
    await emit(mockStart.longitude, mockStart.latitude, 13, 2_000); // ~29 mph
    await emit(mockStart.longitude, mockStart.latitude, 13, 3_000);
    expect(allText(r)).toContain("You're moving");
    expect(r.root.findByType(TextInput).props.editable).toBe(false);
  });

  it('drives the whole route: live speed, spoken turns, arrival', async () => {
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve(); // let the full-rate watcher register
    });
    expect(spoken()[0]).toMatch(/^Starting route\. Head/);

    let sawSpeed = false;
    for (let i = 0; i < route.length; i++) {
      const [lon, lat] = route[i];
      await emit(lon, lat, 13.4, 10_000 + i * 1_000); // 30 mph
      if (i === 120) {
        sawSpeed = allText(r).includes('30mph');
        expect(allText(r)).toContain('arrive');
        expect(allText(r)).toMatch(/Turn|Head|Continue|Merge|Bear|Keep/); // a real instruction is on screen
      }
    }
    expect(sawSpeed).toBe(true);
    expect(spoken().some((s) => s.startsWith('In a quarter mile'))).toBe(true);
    expect(spoken()[spoken().length - 1]).toBe('You have arrived at your destination.');
    expect(allText(r)).toContain("You've arrived");
    // nothing was announced twice
    const lines = spoken();
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('reroutes when the driver leaves the route', async () => {
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    for (let i = 0; i < 20; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    const [offLon, offLat] = [route[20][0], route[20][1] + 0.0027]; // ~300 m north: nowhere near the route
    const before = mockFetch.mock.calls.filter((c) => String(c[0]).includes('/route/v1/driving')).length;
    // ~150 m north of the route, repeatedly
    for (let i = 0; i < 4; i++) {
      await emit(offLon, offLat, 13, 40_000 + i * 1_000);
    }
    await act(async () => {
      await Promise.resolve();
    });
    const after = mockFetch.mock.calls.filter((c) => String(c[0]).includes('/route/v1/driving')).length;
    expect(after).toBe(before + 1);
    expect(spoken()).toContain('Rerouting.');
  });

  it('can end navigation and go back to choosing a place', async () => {
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    await press(r, 'End navigation'); // the Exit button
    expect(allText(r)).toContain('Where to?');
  });
});

describe('Drive screen: sharing the trip with the circle', () => {
  const calls = (name: string) => mockRpc.mock.calls.filter((c) => c[0] === name);

  async function toPreview(r: ReactTestRenderer) {
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
  }

  it('offers sharing only when a circle is selected, and starts switched off', async () => {
    let r = await mountAndPlan();
    await toPreview(r);
    expect(allText(r)).not.toContain('Share this trip');

    mockCircle.current = { id: 'c1', name: 'Family' };
    r = await mountAndPlan();
    await toPreview(r);
    expect(allText(r)).toContain('Share this trip with Family');
    expect(allText(r)).toContain('Not your route');
    expect(r.root.findByType(Switch).props.value).toBe(false);
  });

  it('tells the server nothing about a trip unless the switch is on', async () => {
    mockCircle.current = { id: 'c1', name: 'Family' };
    const r = await mountAndPlan();
    await toPreview(r);
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls('start_shared_trip')).toHaveLength(0);
    expect(allText(r)).not.toContain('Sharing this trip');
  });

  it('shares the trip, keeps the ETA fresh, and announces the arrival', async () => {
    mockCircle.current = { id: 'c1', name: 'Family' };
    const r = await mountAndPlan();
    await toPreview(r);
    await act(async () => {
      r.root.findByType(Switch).props.onValueChange(true);
    });
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });

    const start = calls('start_shared_trip');
    expect(start).toHaveLength(1);
    expect(start[0][1]).toMatchObject({ p_circle_id: 'c1', p_destination: 'Walmart Supercenter' });
    // only a name and an ETA go up: no coordinates, no route
    expect(Object.keys(start[0][1]).sort()).toEqual(['p_circle_id', 'p_destination', 'p_eta', 'p_mode']);
    expect(start[0][1].p_mode).toBe('drive');
    expect(allText(r)).toContain('Sharing this trip with Family');

    for (let i = 0; i < 40; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    expect(calls('update_shared_trip')).toHaveLength(0); // too soon since the start

    await act(async () => {
      jest.advanceTimersByTime(180_000); // three minutes pass; the ETA has slipped
    });
    await emit(route[41][0], route[41][1], 13, 60_000);
    expect(calls('update_shared_trip')).toHaveLength(1);
    expect(calls('update_shared_trip')[0][1].p_trip).toBe('trip-1');

    for (let i = 42; i < route.length; i++) await emit(route[i][0], route[i][1], 13, 61_000 + i * 1_000);
    expect(calls('end_shared_trip')).toHaveLength(1);
    expect(calls('end_shared_trip')[0][1]).toEqual({ p_trip: 'trip-1', p_arrived: true });
    expect(allText(r)).toContain("You've arrived");
  });

  it('stopping navigation ends the shared trip without announcing an arrival', async () => {
    mockCircle.current = { id: 'c1', name: 'Family' };
    const r = await mountAndPlan();
    await toPreview(r);
    await act(async () => {
      r.root.findByType(Switch).props.onValueChange(true);
    });
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    await press(r, 'End navigation'); // the Exit button
    expect(calls('end_shared_trip')).toHaveLength(1);
    expect(calls('end_shared_trip')[0][1]).toEqual({ p_trip: 'trip-1', p_arrived: false });
  });

  it('still navigates, and says so, when the trip could not be shared', async () => {
    mockCircle.current = { id: 'c1', name: 'Family' };
    mockRpc.mockImplementation(async () => ({ data: null, error: { message: 'offline' } }));
    const r = await mountAndPlan();
    await toPreview(r);
    await act(async () => {
      r.root.findByType(Switch).props.onValueChange(true);
    });
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    expect(allText(r)).toContain("Couldn't share this trip");
    expect(allText(r)).toContain('mph'); // directions carry on
    expect(allText(r)).not.toContain('Sharing this trip');
  });

  describe('saved destinations', () => {
    it('saves a place as Home on this phone, then lists it first next time', async () => {
      mockUser.current = 'u1';
      let r = await mountAndPlan();
      await search(r, 'walmart');
      await press(r, 'Walmart Supercenter');
      expect(allText(r)).toContain('Save this place on this phone');
      await press(r, 'Home');
      expect(allText(r)).toContain('Saved as Home on this phone');
      expect(await AsyncStorage.getItem('safecircle.savedDestinations.v1.u1')).toContain('"Home"');

      // A fresh visit to the plan screen shows it before any search.
      await act(async () => r.unmount());
      r = await mountAndPlan();
      expect(allText(r)).toContain('My places');
      expect(allText(r)).toContain('Saved on this phone');
      mockFetch.mockClear();
      await press(r, 'Home');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/route/v1/driving'))).toBe(true);
      expect(allText(r)).toMatch(/min · .* mi · arrive/);
    });

    it("never shows one account's places to another on the same phone", async () => {
      await AsyncStorage.setItem(
        'safecircle.savedDestinations.v1.u1',
        JSON.stringify([{ id: 'a', name: 'Secret Home', latitude: 35.9, longitude: -90.7 }]),
      );
      mockUser.current = 'u2';
      const r = await mountAndPlan();
      expect(allText(r)).not.toContain('Secret Home');
    });

    it('removes a place after confirming', async () => {
      await AsyncStorage.setItem(
        'safecircle.savedDestinations.v1.u1',
        JSON.stringify([{ id: 'a', name: 'Gym', latitude: 35.9, longitude: -90.7 }]),
      );
      mockUser.current = 'u1';
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const r = await mountAndPlan();
      expect(allText(r)).toContain('Gym');
      await press(r, 'Remove');
      expect(alert).toHaveBeenCalled();
      const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
      await act(async () => {
        await buttons.find((b) => b.text === 'Remove')?.onPress?.();
      });
      expect(allText(r)).not.toContain('Gym');
      expect(await AsyncStorage.getItem('safecircle.savedDestinations.v1.u1')).toBe('[]');
      alert.mockRestore();
    });

    it('offers no saving when signed out of the session', async () => {
      const r = await mountAndPlan();
      await search(r, 'walmart');
      await press(r, 'Walmart Supercenter');
      expect(allText(r)).not.toContain('Save this place');
    });
  });
});

describe('Drive screen: walking', () => {
  const calls = (name: string) => mockRpc.mock.calls.filter((c) => c[0] === name);
  const walkRoute = densify(footFixture.routes[0].geometry.coordinates, 10);
  const footCalls = () => mockFetch.mock.calls.filter((c) => String(c[0]).includes('/route/v1/foot'));

  it('asks the walking router, not the car router, and says so', async () => {
    const r = await mountAndPlan();
    await press(r, 'Walk');
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    expect(footCalls()).toHaveLength(1);
    expect(String(footCalls()[0][0])).toContain('routed-foot/route/v1/foot/');
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/route/v1/driving'))).toBe(false);
    // 7.6 km on foot is 101 min, nothing like the 11 minutes by car
    expect(allText(r)).toMatch(/1 h 41 min · 4\.7 mi/);
    expect(allText(r)).toContain('Walking routes come from OpenStreetMap');
  });

  it('remembers Walk for next time', async () => {
    let r = await mountAndPlan();
    expect(r.root.findAll((n) => n.props.accessibilityState?.selected === true && text({ children: n.children }).includes('Drive')).length).toBeGreaterThan(0);
    await press(r, 'Walk');
    await act(async () => r.unmount());
    r = await mountAndPlan();
    expect(r.root.findAll((n) => n.props.accessibilityState?.selected === true && text({ children: n.children }).includes('Walk')).length).toBeGreaterThan(0);
  });

  it('does not lock the search box at a jogging pace', async () => {
    const r = await mountAndPlan();
    await press(r, 'Walk');
    await emit(mockStart.longitude, mockStart.latitude, 3.5, 2_000); // ~8 mph
    await emit(mockStart.longitude, mockStart.latitude, 3.5, 3_000);
    expect(allText(r)).not.toContain("You're moving");
    expect(r.root.findByType(TextInput).props.editable).toBe(true);
  });

  it('walks the whole route: pace to a decimal, turns in feet, arrival, and a shared walk', async () => {
    mockCircle.current = { id: 'c1', name: 'Family' };
    const r = await mountAndPlan();
    await press(r, 'Walk');
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await act(async () => {
      r.root.findByType(Switch).props.onValueChange(true);
    });
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    expect(spoken()[0]).toMatch(/^Starting route\. Head/);
    expect(calls('start_shared_trip')[0][1]).toMatchObject({ p_destination: 'Walmart Supercenter', p_mode: 'walk' });

    let sawPace = false;
    for (let i = 0; i < walkRoute.length; i++) {
      const [lon, lat] = walkRoute[i];
      await emit(lon, lat, 1.4, 10_000 + i * 7_000); // 1.4 m/s = 3.1 mph; 10 m apart
      if (i === 60) sawPace = /3\.1/.test(allText(r)) && allText(r).includes('mph');
    }
    expect(sawPace).toBe(true);
    expect(spoken().some((t) => /^In \d+ ft, /.test(t))).toBe(true);
    expect(spoken().some((t) => t.includes('quarter mile'))).toBe(false);
    expect(spoken()[spoken().length - 1]).toBe('You have arrived at your destination.');
    expect(allText(r)).toContain("You've arrived");
    expect(calls('end_shared_trip')[0][1]).toEqual({ p_trip: 'trip-1', p_arrived: true });
  });

  it('reroutes with the walking router when a walker leaves the route', async () => {
    const r = await mountAndPlan();
    await press(r, 'Walk');
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    for (let i = 0; i < 10; i++) await emit(walkRoute[i][0], walkRoute[i][1], 1.4, 10_000 + i * 7_000);
    const before = footCalls().length;
    // ~200 m north of the route, several fixes in a row
    for (let k = 0; k < 4; k++) await emit(walkRoute[10][0], walkRoute[10][1] + 0.0018, 1.4, 90_000 + k * 7_000);
    await act(async () => {
      await Promise.resolve();
    });
    expect(footCalls().length).toBe(before + 1);
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/route/v1/driving'))).toBe(false);
  });
});

describe('Drive screen: transit', () => {
  it('opens the Maps app with transit directions, and does not plan a route itself', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const r = await mountAndPlan();
    await press(r, 'Transit');
    expect(allText(r)).toContain("doesn't plan bus or train routes");
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toMatch(/^http:\/\/maps\.apple\.com\/\?daddr=[-\d.]+,[-\d.]+&dirflg=r$/);
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/route/v1/'))).toBe(false);
    expect(allText(r)).toContain('Where to?'); // still on the plan screen
    open.mockRestore();
  });

  it('does not lock the search box on a moving bus (you are a passenger)', async () => {
    const r = await mountAndPlan();
    await press(r, 'Transit');
    await emit(mockStart.longitude, mockStart.latitude, 13, 2_000);
    await emit(mockStart.longitude, mockStart.latitude, 13, 3_000);
    expect(allText(r)).not.toContain("You're moving");
    expect(r.root.findByType(TextInput).props.editable).toBe(true);
  });

  it('remembers Transit, and still locks typing in Drive', async () => {
    let r = await mountAndPlan();
    await press(r, 'Transit');
    await act(async () => r.unmount());
    r = await mountAndPlan();
    expect(r.root.findAll((n) => n.props.accessibilityState?.selected === true && text({ children: n.children }).includes('Transit')).length).toBeGreaterThan(0);
    await press(r, 'Drive');
    await emit(mockStart.longitude, mockStart.latitude, 13, 2_000);
    await emit(mockStart.longitude, mockStart.latitude, 13, 3_000);
    expect(allText(r)).toContain("You're moving");
  });

  it('links to sharing a bus, train or flight trip', async () => {
    const r = await mountAndPlan();
    await press(r, 'On a bus, train or flight?');
    expect(mockPush).toHaveBeenCalledWith('/share-trip');
  });
});

describe('Drive screen: options while driving (audio, Share ETA, report, add a stop)', () => {
  const calls = (name: string) => mockRpc.mock.calls.filter((c) => c[0] === name);
  const stopRoute = densify(withStopFixture.routes[0].geometry.coordinates, 13);

  async function startDrive(): Promise<ReactTestRenderer> {
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    await emit(route[0][0], route[0][1], 13, 9_000); // a first fix on the route
    return r;
  }

  async function openOptions(r: ReactTestRenderer) {
    await press(r, 'More options');
  }

  it('has audio, Share ETA, report an incident, add a stop and end route', async () => {
    mockCircle.current = { id: 'c1', name: 'Family' };
    const r = await startDrive();
    expect(allText(r)).not.toContain('Report an incident');
    await openOptions(r);
    const t = allText(r);
    for (const want of ['Audio', 'All voice', 'Alerts only', 'No voice', 'Share ETA with Family', 'Report an incident', 'Crash', 'Hazard', 'Speed check', 'Road closed', 'Add a stop', 'End route']) {
      expect(t).toContain(want);
    }
    await press(r, 'Done');
    expect(allText(r)).not.toContain('Report an incident');
  });

  it('offers no circle Share ETA without a circle, but still sharing with anyone', async () => {
    const r = await startDrive();
    await openOptions(r);
    expect(allText(r)).not.toContain('Share ETA with Family');
    expect(allText(r)).toContain('Share ETA with anyone');
  });

  describe('audio', () => {
    it('Alerts only drops turn-by-turn but still warns about a crash ahead, once', async () => {
      const crashAt = route[300];
      mockReports.current = [
        { id: 'rep-x', reporter_id: 'someone', kind: 'crash', latitude: crashAt[1], longitude: crashAt[0],
          created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString() },
      ];
      const r = await startDrive();
      await openOptions(r);
      await press(r, 'Alerts only');
      expect(await AsyncStorage.getItem('safecircle.voiceMode.v1')).toBe('alerts');
      await press(r, 'Done');
      (Speech.speak as jest.Mock).mockClear();

      let sawBanner = false;
      for (let i = 1; i < 330; i++) {
        await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
        if (/💥 Crash reported .* ahead/.test(allText(r))) sawBanner = true;
      }
      expect(spoken().filter((s) => s === 'Crash reported ahead.')).toHaveLength(1);
      expect(spoken().filter((s) => s !== 'Crash reported ahead.')).toEqual([]); // no "In a quarter mile…"
      expect(sawBanner).toBe(true);
    });

    it('All voice speaks turns and the alert', async () => {
      const crashAt = route[300];
      mockReports.current = [
        { id: 'rep-x', reporter_id: 'someone', kind: 'hazard', latitude: crashAt[1], longitude: crashAt[0],
          created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString() },
      ];
      const r = await startDrive();
      for (let i = 1; i < 330; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
      expect(spoken()).toContain('Hazard reported ahead.');
      expect(spoken().some((s) => s.startsWith('In a quarter mile'))).toBe(true);
      void r;
    });

    it("never warns you about your own report", async () => {
      mockUser.current = 'me';
      const at = route[300];
      mockReports.current = [
        { id: 'mine', reporter_id: 'me', kind: 'crash', latitude: at[1], longitude: at[0],
          created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString() },
      ];
      await startDrive();
      for (let i = 1; i < 330; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
      expect(spoken()).not.toContain('Crash reported ahead.');
    });

    it('the speaker button mutes, and unmuting goes back to the level you had', async () => {
      const r = await startDrive();
      await openOptions(r);
      await press(r, 'Alerts only');
      await press(r, 'Done');
      await press(r, 'Mute voice');
      expect(await AsyncStorage.getItem('safecircle.voiceMode.v1')).toBe('off');
      await press(r, 'Unmute voice');
      expect(await AsyncStorage.getItem('safecircle.voiceMode.v1')).toBe('alerts');
    });

    it('No voice says nothing at all, not even arriving', async () => {
      const r = await startDrive();
      await openOptions(r);
      await press(r, 'No voice');
      await press(r, 'Done');
      (Speech.speak as jest.Mock).mockClear();
      for (let i = 1; i < route.length; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
      expect(allText(r)).toContain("You've arrived");
      expect(spoken()).toEqual([]);
    });
  });

  describe('report an incident', () => {
    it('reports where you are with one tap, thanks you, and closes the card', async () => {
      const r = await startDrive();
      await openOptions(r);
      await press(r, 'Report Crash');
      const call = calls('report_road_incident');
      expect(call).toHaveLength(1);
      expect(call[0][1]).toEqual({ p_kind: 'crash', p_latitude: route[0][1], p_longitude: route[0][0] });
      expect(allText(r)).toContain('Crash reported. Thanks.');
      expect(allText(r)).not.toContain('Report an incident');
    });

    it("shows the server's refusal", async () => {
      const r = await startDrive();
      mockRpc.mockImplementation(async () => ({ data: null, error: { message: "That's a lot of reports in a short time." } }));
      await openOptions(r);
      await press(r, 'Report Speed check');
      expect(allText(r)).toContain("That's a lot of reports in a short time.");
    });
  });

  describe('Share ETA mid-drive', () => {
    it('starts sharing from the card, then stops without announcing an arrival', async () => {
      mockCircle.current = { id: 'c1', name: 'Family' };
      const r = await startDrive();
      expect(calls('start_shared_trip')).toHaveLength(0);
      await openOptions(r);
      await press(r, 'Share ETA with Family');
      await act(async () => {
        await Promise.resolve();
      });
      const start = calls('start_shared_trip');
      expect(start).toHaveLength(1);
      expect(start[0][1]).toMatchObject({ p_circle_id: 'c1', p_destination: 'Walmart Supercenter', p_mode: 'drive' });
      const etaMin = (new Date(start[0][1].p_eta).getTime() - Date.now()) / 60_000;
      expect(etaMin).toBeGreaterThan(5);
      expect(etaMin).toBeLessThan(15);
      expect(allText(r)).toContain('Sharing this trip with Family');

      await openOptions(r);
      await press(r, 'Stop sharing ETA with Family');
      expect(calls('end_shared_trip')[0][1]).toEqual({ p_trip: 'trip-1', p_arrived: false });
      expect(allText(r)).not.toContain('Sharing this trip with Family');
    });

    it('a double tap starts only one shared trip', async () => {
      mockCircle.current = { id: 'c1', name: 'Family' };
      const r = await startDrive();
      await openOptions(r);
      const btn = r.root.findAll((n) => typeof n.props.onPress === 'function' && text({ children: n.children }).includes('Share ETA with Family'))[0];
      await act(async () => {
        btn.props.onPress();
        btn.props.onPress();
      });
      expect(calls('start_shared_trip')).toHaveLength(1);
    });
  });

  describe('add a stop', () => {
    async function addHarps(r: ReactTestRenderer) {
      await openOptions(r);
      await press(r, 'Add a stop');
      await press(r, 'Gas');
      await act(async () => {
        await Promise.resolve();
      });
      const url = mockFetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('nominatim') && u.includes('/search?'))!;
      expect(url).toContain('q=gas+station');
      expect(allText(r)).toContain('Harps');
      expect(allText(r)).toMatch(/ahead/);
      await press(r, 'Harps');
      await act(async () => {
        await Promise.resolve();
      });
    }

    it('finds gas along the route, reroutes via the stop, announces and reaches it, then arrives', async () => {
      const r = await startDrive();
      (Speech.speak as jest.Mock).mockClear();
      await addHarps(r);
      const viaUrl = mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/route/v1/driving')).pop()!;
      expect(viaUrl).toMatch(/;-90\.7037953,35\.8210168;/);
      expect(allText(r)).toContain('Via ⛽ Harps');
      expect(spoken()).toContain('Adding Harps as a stop.');
      expect(allText(r)).not.toContain('Add a stop'); // card closed

      for (let i = 0; i < stopRoute.length; i++) await emit(stopRoute[i][0], stopRoute[i][1], 13, 20_000 + i * 1_000);
      expect(spoken().filter((s) => s === 'Your stop is just ahead.')).toHaveLength(1);
      expect(spoken().filter((s) => s === "You've reached Harps.")).toHaveLength(1);
      expect(spoken().indexOf("You've reached Harps.")).toBeLessThan(spoken().indexOf('You have arrived at your destination.'));
      expect(allText(r)).toContain("You've arrived");
    });

    it('removing the stop goes straight to the destination again', async () => {
      const r = await startDrive();
      await addHarps(r);
      await openOptions(r);
      await press(r, 'Remove stop: Harps');
      await act(async () => {
        await Promise.resolve();
      });
      const last = mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/route/v1/driving')).pop()!;
      expect((last.split('?')[0].match(/;/g) ?? []).length).toBe(1);
      expect(allText(r)).not.toContain('Via ⛽');
    });

    it('a reroute on the way keeps the stop', async () => {
      const r = await startDrive();
      await addHarps(r);
      for (let i = 0; i < 20; i++) await emit(stopRoute[i][0], stopRoute[i][1], 13, 20_000 + i * 1_000);
      for (let k = 0; k < 4; k++) await emit(stopRoute[20][0], stopRoute[20][1] + 0.002, 13, 60_000 + k * 1_000);
      await act(async () => {
        await Promise.resolve();
      });
      const last = mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/route/v1/driving')).pop()!;
      expect(last).toMatch(/;-90\.7037953,35\.8210168;/);
      expect(allText(r)).toContain('Via ⛽ Harps');
    });

    it('says so when nothing is found', async () => {
      const r = await startDrive();
      mockFetch.mockImplementation(async (url: string) => ({
        ok: !String(url).includes('nominatim'),
        json: async () => (String(url).includes('nominatim') ? {} : osrmFixture),
      }));
      await openOptions(r);
      await press(r, 'Add a stop');
      await press(r, 'Coffee');
      await act(async () => {
        await Promise.resolve();
      });
      expect(allText(r)).toContain('Nothing found near the road ahead.');
    });
  });
});

describe('Drive screen: Share ETA with anyone (outside the app)', () => {
  const calls = (name: string) => mockRpc.mock.calls.filter((c) => c[0] === name);

  async function startDrive(): Promise<ReactTestRenderer> {
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    await emit(route[0][0], route[0][1], 13, 9_000);
    return r;
  }

  async function choose(r: ReactTestRenderer, option: string) {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await press(r, 'More options');
    await press(r, 'Share ETA with anyone');
    const [title, , buttons] = alert.mock.calls[0] as [string, string, { text: string; onPress?: () => Promise<void> }[]];
    expect(title).toBe('Share your ETA');
    expect(buttons.map((b) => b.text)).toEqual(['Live link (until I arrive)', 'Just the ETA as a message', 'Cancel']);
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

  it('just the ETA: a plain message, and nothing goes to the server', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await startDrive();
    await choose(r, 'Just the ETA as a message');
    expect(share).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0][0] as { message: string }).message;
    expect(message).toMatch(/^I'm on my way to Walmart Supercenter, arriving around \d{1,2}:\d{2}/);
    expect(message).not.toContain('http');
    expect(calls('create_trip_share_link')).toHaveLength(0);
    share.mockRestore();
  });

  it('live link: creates it, sends it, keeps the ETA current, and tells them when you arrive', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await startDrive();
    await choose(r, 'Live link (until I arrive)');

    const create = calls('create_trip_share_link');
    expect(create).toHaveLength(1);
    expect(create[0][1]).toMatchObject({ p_destination: 'Walmart Supercenter', p_mode: 'drive' });
    const etaMin = (new Date(create[0][1].p_eta).getTime() - Date.now()) / 60_000;
    expect(etaMin).toBeGreaterThan(5);
    expect(etaMin).toBeLessThan(15);
    const message = (share.mock.calls[0][0] as { message: string }).message;
    expect(message).toMatch(/Follow along live until I get there: http:\/\/localhost:5173\/track\/tok123$/);
    expect(allText(r)).toContain('Live ETA link on, until you arrive');
    expect(allText(r)).toContain("only opens on this network"); // no deployed web URL in tests

    for (let i = 1; i < 40; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    expect(calls('update_trip_share_link')).toHaveLength(0); // too soon
    await act(async () => {
      jest.advanceTimersByTime(180_000);
    });
    await emit(route[41][0], route[41][1], 13, 60_000);
    expect(calls('update_trip_share_link')).toHaveLength(1);
    expect(calls('update_trip_share_link')[0][1].p_id).toBe('link-1');

    for (let i = 42; i < route.length; i++) await emit(route[i][0], route[i][1], 13, 61_000 + i * 1_000);
    expect(calls('finish_trip_share_link')).toEqual([['finish_trip_share_link', { p_id: 'link-1', p_arrived: true }]]);
    share.mockRestore();
  });

  it('works without a circle', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    mockCircle.current = null;
    const r = await startDrive();
    await choose(r, 'Live link (until I arrive)');
    expect(calls('create_trip_share_link')).toHaveLength(1);
    share.mockRestore();
  });

  it('the card can stop the link, which ends it without saying you arrived', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await startDrive();
    await choose(r, 'Live link (until I arrive)');
    await press(r, 'More options');
    expect(allText(r)).not.toContain('Share ETA with anyone');
    await press(r, 'Stop the live ETA link');
    expect(calls('finish_trip_share_link')).toEqual([['finish_trip_share_link', { p_id: 'link-1', p_arrived: false }]]);
    expect(allText(r)).not.toContain('Live ETA link on');
    share.mockRestore();
  });

  it('ending navigation ends the link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await startDrive();
    await choose(r, 'Live link (until I arrive)');
    await press(r, 'End navigation');
    expect(calls('finish_trip_share_link')).toEqual([['finish_trip_share_link', { p_id: 'link-1', p_arrived: false }]]);
    share.mockRestore();
  });

  it('turns location sharing on for the trip if it was off, so the link has a position to show', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    mockTracking.active = false;
    const r = await startDrive();
    await choose(r, 'Live link (until I arrive)');
    expect(mockTracking.start).toHaveBeenCalled();
    const windows = calls('set_share_window');
    expect(windows).toHaveLength(1);
    expect(windows[0][1].p_minutes).toBeGreaterThanOrEqual(15);
    expect(calls('create_trip_share_link')).toHaveLength(1);
    share.mockRestore();
  });

  it("says why when the link can't be made, and sends nothing", async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await startDrive();
    mockRpc.mockImplementation(async () => ({ data: null, error: { message: 'You already have 5 active links. Revoke one first.' } }));
    await choose(r, 'Live link (until I arrive)');
    expect(allText(r)).toContain('You already have 5 active links. Revoke one first.');
    expect(share).not.toHaveBeenCalled();
    expect(allText(r)).not.toContain('Live ETA link on');
    share.mockRestore();
  });
});

describe('Drive screen: Google-style navigation view', () => {
  const vehicleMarker = (r: ReactTestRenderer) =>
    r.root.findAll((n) => n.props.testID === 'marker' && n.props.title === 'You' && typeof n.type !== 'string')[0];
  const map = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'map' && typeof n.type !== 'string')[0];

  async function startDrive(): Promise<ReactTestRenderer> {
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    return r;
  }

  it('shows the next turn big with its arrow, the one after it, time, distance, arrival and Exit', async () => {
    const r = await startDrive();
    for (let i = 0; i < 20; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    const t = allText(r);
    expect(t).toMatch(/[↑↱↰↗↖↘↙↶↻🏁]/); // a turn arrow in the green card
    expect(t).toContain('Then');
    expect(t).toMatch(/\d+ min/);
    expect(t).toMatch(/mi · arrive \d{1,2}:\d{2}/);
    expect(t).toContain('Exit');
    expect(t).toContain('Report');
  });

  // offRoute: about 90 m to the side, where the car keeps the GPS heading
  // instead of turning to follow the road (lib/navigation.ts, shownOnMap)
  async function emitWithHeading(_r: ReactTestRenderer, heading: number, t: number, offRoute = false) {
    await act(async () => {
      mockWatchers.filter((w) => !w.removed).forEach((w) =>
        w.cb({ coords: { latitude: route[3][1] + (offRoute ? 0.0008 : 0), longitude: route[3][0], speed: 13, heading }, timestamp: t }),
      );
    });
  }

  // A fix whose GPS gives no heading (-1), so the screen works it out from movement.
  async function emitNoHeading(lon: number, lat: number, speed: number, t: number) {
    await act(async () => {
      mockWatchers.filter((w) => !w.removed).forEach((w) =>
        w.cb({ coords: { latitude: lat, longitude: lon, speed, heading: -1 }, timestamp: t }),
      );
    });
  }

  // How the car is drawn (iOS: Apple Maps can't rotate or flatten markers, so
  // the drawing itself is turned and tilted, lib/avatarPose.ts).
  // React Native's native animation driver doesn't run in tests, so turns
  // complete at once here; what each was asked for (angle, time) is kept.
  const turns: { toValue: number; duration: number }[] = [];
  let timingSpy: jest.SpyInstance;
  beforeEach(() => {
    turns.length = 0;
    timingSpy = jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, cfg: { toValue: number; duration: number }) => ({
      start: (cb?: (r: { finished: boolean }) => void) => {
        turns.push({ toValue: cfg.toValue, duration: cfg.duration });
        value.setValue(cfg.toValue);
        cb?.({ finished: true });
      },
      stop: () => {},
      reset: () => {},
    })) as unknown as typeof Animated.timing);
  });
  afterEach(() => timingSpy.mockRestore());

  // Let the turn animation finish, then read the drawn angle.
  const pose = async (r: ReactTestRenderer) => {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    return poseNow(r);
  };
  const poseNow = (r: ReactTestRenderer) => {
    const top = r.root.findAll((n) => n.props.testID === 'avatar-top' && typeof n.type !== 'string')[0];
    const t = (top.props.style.transform as Record<string, unknown>[]).reduce((a, x) => ({ ...a, ...x }), {} as Record<string, unknown>);
    // the turn is animated: read where it is heading (after the animation)
    const z = t.rotateZ as string | { __getValue: () => string };
    return { rotate: parseFloat(typeof z === 'string' ? z : z.__getValue()), tilt: parseFloat(t.rotateX as string) };
  };

  it('uses the GPS heading when the phone has one', async () => {
    const r = await startDrive();
    await press(r, 'Heading up'); // north up, so the car has to point its own way
    await emit(route[1][0], route[1][1], 13, 10_000); // the fake GPS reports heading 90
    expect((await pose(r)).rotate).toBe(90);
  });

  it('heading up: the map turns, so the car points up the screen; tilted like the map', async () => {
    const r = await startDrive();
    await emit(route[1][0], route[1][1], 13, 10_000);
    expect((await pose(r))).toEqual({ rotate: 0, tilt: 45 });
    expect(vehicleMarker(r).props.rotation).toBeUndefined(); // Google-only on iOS: not relied on
  });

  it('follows the map when it is turned or tilted by hand', async () => {
    const r = await startDrive();
    await press(r, 'Heading up'); // north up
    await emit(route[1][0], route[1][1], 13, 10_000);
    mockCamera.current = { heading: 30, pitch: 20 };
    await act(async () => {
      map(r).props.onRegionChangeComplete?.();
      await Promise.resolve();
    });
    expect((await pose(r))).toEqual({ rotate: 60, tilt: 20 }); // 90 heading on a map turned 30°
  });

  it('you are a vehicle that turns with your heading, not the blue dot', async () => {
    const r = await startDrive();
    expect(map(r).props.showsUserLocation).toBe(false);
    await press(r, 'Heading up'); // north up, so the drawing shows the real direction
    for (let i = 0; i < 6; i++) await emitNoHeading(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    expect(vehicleMarker(r)).toBeDefined();
    const rotation = (((await pose(r)).rotate % 360) + 360) % 360;
    // the marker points along the road, i.e. towards the next position
    const [lon0, lat0] = route[4];
    const [lon1, lat1] = route[5];
    const expected = ((Math.atan2(
      Math.sin(((lon1 - lon0) * Math.PI) / 180) * Math.cos((lat1 * Math.PI) / 180),
      Math.cos((lat0 * Math.PI) / 180) * Math.sin((lat1 * Math.PI) / 180) -
        Math.sin((lat0 * Math.PI) / 180) * Math.cos((lat1 * Math.PI) / 180) * Math.cos(((lon1 - lon0) * Math.PI) / 180),
    ) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(rotation - expected)).toBeLessThan(5);
  });

  it('keeps pointing the way you were going when you stop', async () => {
    const r = await startDrive();
    await press(r, 'Heading up'); // north up
    for (let i = 0; i < 6; i++) await emitNoHeading(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    const before = (await pose(r)).rotate;
    expect(before).not.toBe(0);
    await emitNoHeading(route[5][0], route[5][1], 0, 20_000); // stopped at a light
    expect((await pose(r)).rotate).toBe(before);
  });

  it('glides to each new fix over the time since the last one, and turns smoothly the short way', async () => {
    const r = await startDrive();
    await emit(route[0][0], route[0][1], 13, 10_000);
    await emit(route[1][0], route[1][1], 13, 11_000);
    await emit(route[2][0], route[2][1], 13, 11_800);
    const region = vehicleMarker(r).props.coordinate as { moves: { duration: number }[]; latitude: number };
    const durations = region.moves.map((m) => m.duration);
    expect(durations.slice(-2)).toEqual([1000, 800]); // matches the gaps between fixes
    expect(region.latitude).toBeCloseTo(route[2][1], 6); // ends where the fix is
    // the camera moves in step with the car, so it stays centred
    expect(mockAnimate.mock.calls[mockAnimate.mock.calls.length - 1][1]).toEqual({ duration: 800 });
    // turns are eased, not instant
    expect(turns.length).toBeGreaterThan(0);
    for (const t of turns) expect(t.duration).toBeGreaterThanOrEqual(200);
  });

  it('snaps instead of sliding after a big jump', async () => {
    const r = await startDrive();
    await emit(route[0][0], route[0][1], 13, 10_000);
    await emit(route[0][0] + 0.01, route[0][1], 13, 11_000); // ~900 m away a second later
    const region = vehicleMarker(r).props.coordinate as { moves: { duration: number }[] };
    expect(region.moves[region.moves.length - 1].duration).toBe(0);
  });

  it('turns from 170° to 190° by +20°, not back round by 340°', async () => {
    const r = await startDrive();
    await press(r, 'Heading up'); // north up: the drawing shows the real heading
    // (relative angles are kept within ±180°, so this is where the long way
    // round would happen: 170° to -170°)
    await emitWithHeading(r, 170, 10_000, true);
    await emitWithHeading(r, 190, 11_000, true);
    const last = turns[turns.length - 1].toValue;
    const prev = turns[turns.length - 2].toValue;
    expect(last - prev).toBeCloseTo(20, 5);
  });

  it('opens Choose driving avatar from the options card; Done saves the avatar and colour', async () => {
    const r = await startDrive();
    await press(r, 'More options');
    expect(allText(r)).toContain('Driving avatar');
    expect(allText(r)).toContain('Navigation arrow · Ocean blue');
    await press(r, 'Choose driving avatar');
    expect(allText(r)).toContain('Choose driving avatar');
    await press(r, 'Avatar: Off-road');
    await press(r, 'Colour: Coral red');
    expect(allText(r)).toContain('Coral red');
    await press(r, 'Done');
    expect(JSON.parse((await AsyncStorage.getItem('safecircle.vehicle.v1'))!)).toEqual({ style: 'offroad', color: 'red' });
    await emit(route[0][0], route[0][1], 13, 10_000);
    const icon = vehicleMarker(r).findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'VehicleIcon')[0];
    expect(icon.props).toMatchObject({ style: 'offroad', color: 'red' }); // drawn as slices when tilted
  });

  it('tapping your car on the map opens the avatar picker too', async () => {
    const r = await startDrive();
    await emit(route[0][0], route[0][1], 13, 10_000);
    await act(async () => vehicleMarker(r).props.onPress());
    expect(allText(r)).toContain('Choose driving avatar');
  });

  it('the compass switches between heading up and north up', async () => {
    const r = await startDrive();
    for (let i = 0; i < 6; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    const headingUp = mockAnimate.mock.calls[mockAnimate.mock.calls.length - 1][0];
    expect(headingUp.heading).not.toBe(0);
    await press(r, 'Heading up');
    await emit(route[6][0], route[6][1], 13, 20_000);
    expect(mockAnimate.mock.calls[mockAnimate.mock.calls.length - 1][0].heading).toBe(0);
    await press(r, 'North up');
    await emit(route[7][0], route[7][1], 13, 21_000);
    expect(mockAnimate.mock.calls[mockAnimate.mock.calls.length - 1][0].heading).not.toBe(0);
  });

  it('route overview shows the rest of the route and stops following; Re-center follows again', async () => {
    const r = await startDrive();
    for (let i = 0; i < 6; i++) await emit(route[i][0], route[i][1], 13, 10_000 + i * 1_000);
    await press(r, 'Route overview');
    expect(mockFit).toHaveBeenCalledTimes(1);
    expect((mockFit.mock.calls[0][0] as unknown[]).length).toBeGreaterThan(10);
    const followed = mockAnimate.mock.calls.length;
    await emit(route[6][0], route[6][1], 13, 20_000);
    expect(mockAnimate.mock.calls.length).toBe(followed); // the camera stays on the overview
    await press(r, 'Re-center');
    await emit(route[7][0], route[7][1], 13, 21_000);
    expect(mockAnimate.mock.calls.length).toBeGreaterThan(followed);
  });

  it('the search button goes straight to adding a stop, and the Report pill to the incident buttons', async () => {
    const r = await startDrive();
    await press(r, 'Add a stop');
    expect(allText(r)).toContain('Gas');
    expect(allText(r)).toContain('Coffee');
    await press(r, 'Back');
    await press(r, 'Done');
    await emit(route[0][0], route[0][1], 13, 10_000);
    await press(r, 'Report an incident');
    const t = allText(r);
    expect(t).toContain('Crash');
    expect(t).toContain('Road closed');
    expect(t).not.toContain('Audio'); // just the report buttons
    await press(r, 'Report Hazard');
    expect(mockRpc.mock.calls.some((c) => c[0] === 'report_road_incident' && c[1].p_kind === 'hazard')).toBe(true);
  });

  it('walking shows a walker arrow instead of the vehicle', async () => {
    const r = await mountAndPlan();
    await press(r, 'Walk');
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    await emit(footFixture.routes[0].geometry.coordinates[0][0], footFixture.routes[0].geometry.coordinates[0][1], 1.4, 10_000);
    const icon = vehicleMarker(r).findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'VehicleIcon')[0];
    expect(icon.props.walking).toBe(true);
  });
});

describe('Drive screen: lane guidance and speed limits', () => {
  const lanesRoute = densify(lanesFixture.routes[0].geometry.coordinates, 13);
  const reverseCalls = () => mockFetch.mock.calls.filter((c) => String(c[0]).includes('/reverse?'));

  async function startDrive(): Promise<ReactTestRenderer> {
    // the same trip, with the junction lane data the router sends
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('/reverse?')
          ? mockRoad.current
          : String(url).includes('/route/v1/driving')
            ? lanesFixture
            : photonFixture,
    }));
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    return r;
  }

  it('shows the lanes as you approach the turn that has them, and says which to use', async () => {
    const r = await startDrive();
    const laneLabel = () =>
      r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Lanes:'))[0]?.props
        .accessibilityLabel;
    let sawLanes: string | undefined;
    let shownFarAway = false;
    for (let i = 0; i < lanesRoute.length; i++) {
      await emit(lanesRoute[i][0], lanesRoute[i][1], 13, 10_000 + i * 1_000);
      const label = laneLabel();
      if (label) sawLanes = label;
      if (label && i < 50) shownFarAway = true;
    }
    expect(sawLanes).toBe('Lanes: use, use, no, no, no');
    expect(shownFarAway).toBe(false); // only near the turn, not from the start
    expect(spoken().some((t) => t.endsWith('Use the left 2 lanes.'))).toBe(true);
  });

  it('keeps the lanes hidden until the last half mile before the turn', async () => {
    // The same real route, with lanes put on the left turn onto East Highland
    // Drive, which comes after 1.4 km of South Main Street.
    const longApproach = JSON.parse(JSON.stringify(lanesFixture));
    longApproach.routes[0].legs[0].steps[5].intersections[0].lanes = [
      { indications: ['left'], valid: true },
      { indications: ['straight'], valid: false },
    ];
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('/reverse?') ? mockRoad.current : String(url).includes('/route/v1/driving') ? longApproach : photonFixture,
    }));
    const r = await mountAndPlan();
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    await act(async () => {
      await Promise.resolve();
    });
    const lanesShown = () =>
      r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Lanes:')).length > 0;
    // the first distance on screen is the one to the next turn
    const toNextM = () => {
      const m = allText(r).match(/(\d+(?:\.\d+)?) (mi|ft)/)!;
      return m[2] === 'mi' ? Number(m[1]) * 1609.344 : Number(m[1]) * 0.3048;
    };
    let hiddenWhileFar = false;
    let shownWhenNear = false;
    for (let i = 0; i < lanesRoute.length / 2; i++) {
      await emit(lanesRoute[i][0], lanesRoute[i][1], 13, 10_000 + i * 1_000);
      if (allText(r).includes('East Highland Drive')) {
        if (toNextM() > 900 && !lanesShown()) hiddenWhileFar = true;
        if (toNextM() > 900) expect(lanesShown()).toBe(false);
        if (lanesShown()) shownWhenNear = true;
      }
    }
    expect(hiddenWhileFar).toBe(true);
    expect(shownWhenNear).toBe(true);
  });

  it('shows the posted limit where the map has one, and your speed in red when over', async () => {
    mockRoad.current = { category: 'highway', osm_type: 'way', osm_id: 7, extratags: { maxspeed: '35 mph' } };
    const r = await startDrive();
    await emit(lanesRoute[0][0], lanesRoute[0][1], 13.4, 10_000); // 30 mph
    await act(async () => {
      await Promise.resolve();
    });
    expect(allText(r)).toContain('SPEEDLIMIT35');
    const speedLabel = () =>
      r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Speed ') && !n.props.accessibilityLabel.startsWith('Speed limit'))[0].props
        .accessibilityLabel as string;
    expect(speedLabel()).not.toContain('over the limit');
    for (let i = 1; i < 5; i++) await emit(lanesRoute[i][0], lanesRoute[i][1], 18, 11_000 + i * 1_000); // ~40 mph
    expect(speedLabel()).toContain('over the limit');
  });

  it('shows no sign at all where the road has no limit mapped', async () => {
    const r = await startDrive();
    for (let i = 0; i < 5; i++) await emit(lanesRoute[i][0], lanesRoute[i][1], 18, 10_000 + i * 1_000);
    await act(async () => {
      await Promise.resolve();
    });
    expect(reverseCalls().length).toBeGreaterThan(0);
    expect(allText(r)).not.toContain('LIMIT');
  });

  it('looks the limit up rarely: on a new road or every 30 s, never per GPS fix', async () => {
    await startDrive();
    for (let i = 0; i < 60; i++) await emit(lanesRoute[i][0], lanesRoute[i][1], 13, 10_000 + i * 1_000);
    // 60 GPS fixes over a minute: at most one lookup per new road plus one per 30 s
    expect(reverseCalls().length).toBeLessThanOrEqual(8);
    expect(reverseCalls().length).toBeGreaterThan(0);
  });

  it('a walk never looks up speed limits', async () => {
    const r = await mountAndPlan();
    await press(r, 'Walk');
    await search(r, 'walmart');
    await press(r, 'Walmart Supercenter');
    await press(r, 'Start');
    for (let i = 0; i < 10; i++) await emit(lanesRoute[i][0], lanesRoute[i][1], 1.4, 10_000 + i * 1_000);
    expect(reverseCalls()).toHaveLength(0);
  });

  it('offers every avatar and colour in the picker', async () => {
    const r = await startDrive();
    await press(r, 'More options');
    await press(r, 'Choose driving avatar');
    for (const label of [
      'Avatar: Navigation arrow',
      'Avatar: Sports car',
      'Avatar: Compact',
      'Avatar: Classic',
      'Avatar: Race car',
      'Avatar: Sedan',
      'Avatar: Off-road',
      'Colour: Polar white',
      'Colour: Night black',
      'Colour: Orchid',
    ]) {
      expect(r.root.findAll((n) => n.props.accessibilityLabel === label).length).toBeGreaterThan(0);
    }
  });
});
