import React from 'react';
import { Alert, Switch, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Speech from 'expo-speech';
import osrmFixture from './fixtures/osrm-jonesboro.json';
import photonFixture from './fixtures/photon-walmart.json';

// The Drive screen end to end: real screen, real navigation and routing code,
// real captured route. Only the device edges are faked: GPS (driven by the
// test), speech, the map view, and the network (serving the captured responses).

const mockWatchers: { cb: (loc: unknown) => void; removed: boolean }[] = [];
const mockStart = { latitude: 35.8423, longitude: -90.7043 };
const mockFetch = jest.fn();
const mockRpc = jest.fn();
const mockUser: { current: null | string } = { current: null };
const mockCircle: { current: null | { id: string; name: string } } = { current: null };

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
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
  const places: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) places[m] = () => places;
  places.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { supabase: { rpc: (...a: unknown[]) => mockRpc(...a), from: () => places } };
});
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
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
  const MapView = R.forwardRef((_p: unknown, ref: React.Ref<unknown>) => {
    R.useImperativeHandle(ref, () => ({ animateCamera: jest.fn() }));
    return null;
  });
  return { __esModule: true, default: MapView, Marker: () => null, Polyline: () => null, PROVIDER_DEFAULT: 'default' };
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
  const hit = r.root.findAll((n) => typeof n.props.onPress === 'function' && text({ children: n.children }).includes(label));
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
  mockRpc.mockImplementation(async (name: string) => ({ data: name === 'start_shared_trip' ? 'trip-1' : null, error: null }));
  mockCircle.current = null;
  mockUser.current = null;
  (Speech.speak as jest.Mock).mockClear();
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/route/v1/driving') ? osrmFixture : photonFixture),
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
    await press(r, 'End');
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
    expect(Object.keys(start[0][1]).sort()).toEqual(['p_circle_id', 'p_destination', 'p_eta']);
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
    await press(r, 'End');
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
