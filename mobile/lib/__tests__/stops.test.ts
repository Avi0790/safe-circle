import fixture from './fixtures/osrm-jonesboro.json';
import withStop from './fixtures/osrm-with-stop.json';
import gas from './fixtures/nominatim-gas.json';
import { navState, nextAnnouncement, prepareRoute, type LatLng } from '../navigation';
import { fetchRoute, parseOsrmRoute } from '../routing';
import { rankStops, searchBox, searchStops, STOP_MAX_OFF_ROUTE_M } from '../stops';

// Real data: the captured Jonesboro route, and a real Nominatim answer for
// "gas station" around it.
const prepared = prepareRoute(parseOsrmRoute(fixture));

describe('rankStops', () => {
  it('keeps real gas stations near the road ahead, least detour first', () => {
    const r = rankStops(gas, 'gas', prepared, 0);
    expect(r.length).toBeGreaterThan(2);
    expect(r.length).toBeLessThanOrEqual(6);
    for (const s of r) expect(s.offRouteM).toBeLessThanOrEqual(STOP_MAX_OFF_ROUTE_M);
    const cost = r.map((s) => s.aheadM + 2 * s.offRouteM);
    expect([...cost].sort((a, b) => a - b)).toEqual(cost);
  });

  it('never offers a stop you have already passed', () => {
    for (const along of [2000, 4000, 6000]) {
      for (const s of rankStops(gas, 'gas', prepared, along)) expect(s.aheadM).toBeGreaterThanOrEqual(0);
    }
    // Harps is 2.7 km in: offered from the start, gone once you're well past it
    expect(rankStops(gas, 'gas', prepared, 0).some((s) => s.title === 'Harps')).toBe(true);
    expect(rankStops(gas, 'gas', prepared, 4000).some((s) => s.title === 'Harps')).toBe(false);
  });

  it('drops places whose name matches but are something else, and names blank ones', () => {
    const harps = (gas as any[]).find((g) => g.name === 'Harps');
    const fake = [
      { ...harps, place_id: 1, name: 'Gas Lamp Cafe', type: 'cafe' },
      { ...harps, place_id: 2, name: '', type: 'fuel' },
    ];
    const r = rankStops(fake, 'gas', prepared, 0);
    expect(r.map((s) => s.title)).toEqual(['Gas']);
  });

  it('survives a bad response', () => {
    expect(rankStops(null, 'gas', prepared, 0)).toEqual([]);
    expect(rankStops({ error: 'x' }, 'gas', prepared, 0)).toEqual([]);
  });
});

describe('searchStops', () => {
  afterEach(() => {
    delete (global as any).fetch;
  });

  it('asks for the category inside a box around the road ahead', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => gas }));
    (global as any).fetch = fetchMock;
    const r = await searchStops('gas', prepared, 0);
    expect(r.length).toBeGreaterThan(0);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('gas station');
    expect(url.searchParams.get('bounded')).toBe('1');
    const box = searchBox(prepared, 0);
    expect(url.searchParams.get('viewbox')).toBe(`${box.west},${box.north},${box.east},${box.south}`);
    // the box covers the start of the route
    const start = prepared.route.coords[0];
    expect(start.longitude).toBeGreaterThan(box.west);
    expect(start.latitude).toBeLessThan(box.north);
  });

  it('returns nothing, rather than throwing, when the service fails', async () => {
    (global as any).fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await searchStops('coffee', prepared, 0)).toEqual([]);
    (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await searchStops('coffee', prepared, 0)).toEqual([]);
  });
});

describe('a route with a stop', () => {
  const route = parseOsrmRoute(withStop);

  it('marks the stop as a stop, and only the last arrival as the destination', () => {
    const types = route.steps.map((s) => s.type);
    expect(types.filter((t) => t === 'waypoint')).toHaveLength(1);
    expect(types.filter((t) => t === 'arrive')).toHaveLength(1);
    expect(types[types.length - 1]).toBe('arrive');
    expect(route.steps.find((s) => s.type === 'waypoint')!.instruction).toBe('Arrive at your stop');
  });

  it('asks the router to go via the stop', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => withStop }));
    (global as any).fetch = fetchMock;
    await fetchRoute({ latitude: 35.8423, longitude: -90.7043 }, { latitude: 35.8101, longitude: -90.656292 }, undefined, 'drive', [
      { latitude: 35.8210168, longitude: -90.7037953 },
    ]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      '/route/v1/driving/-90.7043,35.8423;-90.7037953,35.8210168;-90.656292,35.8101?',
    );
    delete (global as any).fetch;
  });

  it('driving it announces the stop once, carries on, and only arrives at the end', () => {
    const prep = prepareRoute(route);
    const said = new Set<string>();
    const spoken: string[] = [];
    let hint: number | undefined;
    let arrivedAt = -1;
    route.coords.forEach((p: LatLng, i: number) => {
      const s = navState(prep, p, hint)!;
      hint = s.alongM;
      const say = nextAnnouncement(s.nextStepIndex, s.distanceToNextM, route.steps, said);
      if (say) {
        said.add(say.key);
        spoken.push(say.text);
      }
      if (s.arrived && arrivedAt < 0) arrivedAt = i;
    });
    expect(spoken.filter((t) => t === 'Your stop is just ahead.')).toHaveLength(1);
    expect(spoken.indexOf('Your stop is just ahead.')).toBeLessThan(spoken.indexOf('Your destination is just ahead.'));
    expect(spoken[spoken.length - 1]).toBe('Your destination is just ahead.');
    // arrival (within 30 m of the end) comes only in the last few points, well past the stop
    expect(arrivedAt).toBeGreaterThanOrEqual(route.coords.length - 5);
  });
});
