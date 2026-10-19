import React from 'react';
import { TextInput } from 'react-native';
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@/contexts/CircleContext', () => ({ useCircles: () => ({ selectedCircle: null }) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
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

beforeEach(() => {
  jest.useFakeTimers();
  mockWatchers.length = 0;
  mockFetch.mockReset();
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
