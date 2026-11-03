import {
  ARRIVE_METERS,
  cumulativeDistances,
  boundsRegion,
  formatNavDistance,
  formatNavDuration,
  instructionText,
  navState,
  nextAnnouncement,
  prepareRoute,
  projectOnRoute,
  smoothSpeed,
  type LatLng,
  type Route,
  shownOnMap,
  SNAP_METERS,
} from '../navigation';
import { externalMapsUrl } from '../externalMaps';
import { parseOsrmRoute, RoutingError } from '../routing';
import { parsePhotonResults } from '../geocode';

// An L-shaped route: ~1.1 km north, then ~0.9 km east.
const A: LatLng = { latitude: 35.0, longitude: -90.0 };
const B: LatLng = { latitude: 35.01, longitude: -90.0 };
const C: LatLng = { latitude: 35.01, longitude: -89.99 };
const line = (from: LatLng, to: LatLng, n: number): LatLng[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    latitude: from.latitude + ((to.latitude - from.latitude) * i) / n,
    longitude: from.longitude + ((to.longitude - from.longitude) * i) / n,
  }));
const coords = [...line(A, B, 10), ...line(B, C, 10).slice(1)];

const lRoute: Route = {
  distanceM: 2000,
  durationS: 240,
  coords,
  steps: [
    { type: 'depart', modifier: 'straight', name: 'Main Street', distanceM: 1100, location: A, instruction: 'Head straight on Main Street' },
    { type: 'turn', modifier: 'right', name: 'Oak Avenue', distanceM: 900, location: B, instruction: 'Turn right onto Oak Avenue' },
    { type: 'arrive', name: 'Oak Avenue', distanceM: 0, location: C, instruction: 'You have arrived at your destination' },
  ],
};

describe('route geometry', () => {
  const prepared = prepareRoute(lRoute);

  it('measures the polyline', () => {
    const cum = cumulativeDistances(coords);
    expect(cum[0]).toBe(0);
    expect(prepared.totalM).toBeGreaterThan(1900);
    expect(prepared.totalM).toBeLessThan(2100);
  });

  it('places each manoeuvre along the route, in order', () => {
    const [a, b, c] = prepared.stepAlong;
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(1050);
    expect(b).toBeLessThan(1150);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeCloseTo(prepared.totalM, -1);
  });

  it('projects a position onto the route and reports how far off it is', () => {
    const on = projectOnRoute({ latitude: 35.005, longitude: -90.0 }, coords, prepared.cum)!;
    expect(on.offRouteM).toBeLessThan(2);
    expect(on.alongM).toBeGreaterThan(500);
    expect(on.alongM).toBeLessThan(600);
    // ~100 m east of the northbound leg
    const off = projectOnRoute({ latitude: 35.005, longitude: -89.9989 }, coords, prepared.cum)!;
    expect(off.offRouteM).toBeGreaterThan(80);
    expect(off.offRouteM).toBeLessThan(120);
  });

  it('does not snap to the wrong pass of an out-and-back route', () => {
    // north 1 km, then back south 20 m to the east: same stretch of road twice
    const out = line({ latitude: 35.0, longitude: -90.0 }, { latitude: 35.009, longitude: -90.0 }, 9);
    const back = line({ latitude: 35.009, longitude: -89.9998 }, { latitude: 35.0, longitude: -89.9998 }, 9);
    const both = [...out, ...back];
    const cum = cumulativeDistances(both);
    const onReturn = { latitude: 35.004, longitude: -89.9998 };
    const hinted = projectOnRoute(onReturn, both, cum, cum[both.length - 1] - 700, Infinity)!;
    expect(hinted.alongM).toBeGreaterThan(cum[10]); // on the return leg
  });
});

describe('navState', () => {
  const prepared = prepareRoute(lRoute);

  it('at the start the next manoeuvre is the turn, about a kilometre ahead', () => {
    const s = navState(prepared, A)!;
    expect(s.nextStepIndex).toBe(1);
    expect(s.distanceToNextM).toBeGreaterThan(1050);
    expect(s.arrived).toBe(false);
    expect(s.remainingS).toBeCloseTo(240, -1);
  });

  it('after the corner the next manoeuvre is the arrival', () => {
    const s = navState(prepared, { latitude: 35.01, longitude: -89.995 }, 1200)!;
    expect(s.nextStepIndex).toBe(2);
    expect(s.distanceToNextM).toBeLessThan(500);
  });

  it('reports arrival within the threshold of the end', () => {
    const s = navState(prepared, { latitude: 35.01, longitude: -89.99002 })!;
    expect(s.remainingM).toBeLessThanOrEqual(ARRIVE_METERS);
    expect(s.arrived).toBe(true);
  });

  it('flags being off route', () => {
    const s = navState(prepared, { latitude: 35.005, longitude: -89.998 })!;
    expect(s.offRouteM).toBeGreaterThan(150);
  });

  it('recovers from a GPS jump by searching the whole route', () => {
    const s = navState(prepared, { latitude: 35.01, longitude: -89.995 }, 100)!;
    expect(s.offRouteM).toBeLessThan(5);
    expect(s.alongM).toBeGreaterThan(1100);
  });
});

describe('instructionText', () => {
  it('words common manoeuvres', () => {
    expect(instructionText({ type: 'turn', modifier: 'left', name: 'Union Street' })).toBe('Turn left onto Union Street');
    expect(instructionText({ type: 'turn', modifier: 'slight right', name: '' })).toBe('Bear right');
    expect(instructionText({ type: 'depart', modifier: 'right', name: '' })).toBe('Head right');
    expect(instructionText({ type: 'arrive', name: '' })).toBe('You have arrived at your destination');
    expect(instructionText({ type: 'merge', modifier: 'slight left', name: 'I-555' })).toBe('Merge onto I-555');
    expect(instructionText({ type: 'fork', modifier: 'slight left', name: 'US-49' })).toBe('Keep left at the fork onto US-49');
    expect(instructionText({ type: 'roundabout', exit: 2, name: 'Race Street' })).toBe('At the roundabout, take the second exit onto Race Street');
    expect(instructionText({ type: 'end of road', modifier: 'left', name: 'Oak Ave' })).toBe('At the end of the road, turn left onto Oak Ave');
    expect(instructionText({ type: 'turn', modifier: 'uturn', name: '' })).toBe('Make a U-turn');
    expect(instructionText({ type: 'new name', name: 'Highland Dr' })).toBe('Continue on Highland Dr');
  });
});

describe('nextAnnouncement', () => {
  const steps = lRoute.steps;

  it('stays quiet while the turn is far away', () => {
    expect(nextAnnouncement(1, 900, steps, new Set())).toBeNull();
  });

  it('warns a quarter mile out, once, then again when close, once', () => {
    const said = new Set<string>();
    const far = nextAnnouncement(1, 400, steps, said)!;
    expect(far.text).toBe('In a quarter mile, turn right onto Oak Avenue.');
    said.add(far.key);
    expect(nextAnnouncement(1, 380, steps, said)).toBeNull();
    const near = nextAnnouncement(1, 80, steps, said)!;
    expect(near.text).toBe('Turn right onto Oak Avenue.');
    said.add(near.key);
    expect(nextAnnouncement(1, 20, steps, said)).toBeNull();
  });

  it('never says "in a quarter mile" for the arrival', () => {
    expect(nextAnnouncement(2, 400, steps, new Set())).toBeNull();
    // arriving is announced by the screen once you are there, not 60 m short
    expect(nextAnnouncement(2, 60, steps, new Set())!.text).toBe('Your destination is just ahead.');
  });

  it('does not play the far warning after the near one was missed into', () => {
    expect(nextAnnouncement(1, 50, steps, new Set())!.key).toBe('1:near');
  });
});

describe('nextAnnouncement while walking', () => {
  const steps = lRoute.steps;

  it('stays quiet until the turn is about 400 feet away, and says the real distance', () => {
    expect(nextAnnouncement(1, 300, steps, new Set(), 'walk')).toBeNull();
    const far = nextAnnouncement(1, 110, steps, new Set(), 'walk')!;
    expect(far.text).toBe('In 350 ft, turn right onto Oak Avenue.');
    // a driver 110 m out gets the quarter-mile wording, not a distance in feet
    expect(nextAnnouncement(1, 110, steps, new Set())!.text).toBe('In a quarter mile, turn right onto Oak Avenue.');
  });

  it('warns once far, once near (30 m), never twice', () => {
    const said = new Set<string>();
    const far = nextAnnouncement(1, 100, steps, said, 'walk')!;
    said.add(far.key);
    expect(nextAnnouncement(1, 80, steps, said, 'walk')).toBeNull();
    const near = nextAnnouncement(1, 25, steps, said, 'walk')!;
    expect(near.text).toBe('Turn right onto Oak Avenue.');
    said.add(near.key);
    expect(nextAnnouncement(1, 10, steps, said, 'walk')).toBeNull();
  });

  it('keeps the arrival wording', () => {
    expect(nextAnnouncement(2, 100, steps, new Set(), 'walk')).toBeNull();
    expect(nextAnnouncement(2, 20, steps, new Set(), 'walk')!.text).toBe('Your destination is just ahead.');
  });
});

describe('formatting', () => {
  it('shows feet when close and miles when far', () => {
    expect(formatNavDistance(20)).toBe('70 ft');
    expect(formatNavDistance(90)).toBe('300 ft'); // 295 ft -> nearest 50
    expect(formatNavDistance(1609)).toBe('1.0 mi');
    expect(formatNavDistance(45000)).toBe('28 mi');
  });
  it('formats durations', () => {
    expect(formatNavDuration(20)).toBe('1 min');
    expect(formatNavDuration(12 * 60)).toBe('12 min');
    expect(formatNavDuration(3900)).toBe('1 h 5 min');
  });
  it('smooths speed toward the new reading', () => {
    expect(smoothSpeed(null, 10)).toBe(10);
    expect(smoothSpeed(10, 20)).toBe(15);
  });
});

describe('boundsRegion', () => {
  it('centres on and contains the points with padding', () => {
    const r = boundsRegion([A, C]);
    expect(r.latitude).toBeCloseTo(35.005, 5);
    expect(r.longitude).toBeCloseTo(-89.995, 5);
    expect(r.latitudeDelta).toBeGreaterThanOrEqual(0.01);
    expect(r.latitudeDelta).toBeGreaterThanOrEqual((C.latitude - A.latitude) * 1.5);
  });

  it('never collapses to a point', () => {
    const r = boundsRegion([A]);
    expect(r.latitudeDelta).toBe(0.01);
    expect(r.longitudeDelta).toBe(0.01);
  });
});

describe('external maps fallback', () => {
  it('builds the right link per platform', () => {
    expect(externalMapsUrl(B, 'ios')).toBe('http://maps.apple.com/?daddr=35.01,-90&dirflg=d');
    expect(externalMapsUrl(B, 'android')).toBe('google.navigation:q=35.01,-90');
  });

  it('hands transit to the Maps app: Apple Maps public-transit, Google Maps universal link', () => {
    expect(externalMapsUrl(B, 'ios', 'transit')).toBe('http://maps.apple.com/?daddr=35.01,-90&dirflg=r');
    expect(externalMapsUrl(B, 'android', 'transit')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=35.01,-90&travelmode=transit',
    );
  });

  it('asks for walking directions when walking', () => {
    expect(externalMapsUrl(B, 'ios', 'walk')).toBe('http://maps.apple.com/?daddr=35.01,-90&dirflg=w');
    expect(externalMapsUrl(B, 'android', 'walk')).toBe('google.navigation:q=35.01,-90&mode=w');
    expect(externalMapsUrl(B, 'ios', 'drive')).toBe(externalMapsUrl(B, 'ios'));
  });
});

describe('parseOsrmRoute', () => {
  // Mirrors the real response shape: [lon, lat] geometry, per-step manoeuvre.
  const ok = {
    code: 'Ok',
    routes: [
      {
        distance: 8294.4,
        duration: 651.5,
        geometry: { coordinates: [[-90.7043, 35.8423], [-90.7042, 35.8421], [-90.7057, 35.8421]] },
        legs: [
          {
            steps: [
              { distance: 23, name: '', maneuver: { type: 'depart', modifier: 'right', location: [-90.704193, 35.8423] } },
              { distance: 140, name: 'Cate Avenue', maneuver: { type: 'turn', modifier: 'right', location: [-90.704193, 35.842094] } },
              { distance: 0, name: 'Cate Avenue', maneuver: { type: 'arrive', location: [-90.7057, 35.8421] } },
            ],
          },
        ],
      },
    ],
  };

  it('turns lon/lat pairs into coordinates and steps into instructions', () => {
    const r = parseOsrmRoute(ok);
    expect(r.coords[0]).toEqual({ latitude: 35.8423, longitude: -90.7043 });
    expect(r.steps.map((s) => s.instruction)).toEqual([
      'Head right',
      'Turn right onto Cate Avenue',
      'You have arrived at your destination',
    ]);
    expect(r.distanceM).toBe(8294.4);
    expect(r.steps[1].location).toEqual({ latitude: 35.842094, longitude: -90.704193 });
  });

  it('reports no route, and a malformed response, distinctly', () => {
    expect(() => parseOsrmRoute({ code: 'NoRoute' })).toThrow(RoutingError);
    try { parseOsrmRoute({ code: 'NoRoute' }); } catch (e) { expect((e as RoutingError).kind).toBe('no-route'); }
    expect(() => parseOsrmRoute({ code: 'NoRoute' })).toThrow("Couldn't find a driving route there.");
    expect(() => parseOsrmRoute({ code: 'NoRoute' }, 'walk')).toThrow("Couldn't find a walking route there.");
    try { parseOsrmRoute({ code: 'Ok', routes: [{ distance: 1, duration: 1, geometry: { coordinates: [] } }] }); }
    catch (e) { expect((e as RoutingError).kind).toBe('bad-response'); }
  });
});

describe('parsePhotonResults', () => {
  it('maps features to places, using the street as the title when there is no name', () => {
    const results = parsePhotonResults({
      features: [
        { geometry: { coordinates: [-90.6852722, 35.8190864] }, properties: { osm_type: 'N', osm_id: 1, name: 'Walmart Supercenter', street: 'East Highland Drive', housenumber: '1815', city: 'Jonesboro', state: 'AR' } },
        { geometry: { coordinates: [-90.7, 35.8] }, properties: { osm_type: 'W', osm_id: 2, street: 'Main Street', housenumber: '12', city: 'Jonesboro' } },
        { geometry: { coordinates: [-90.7, 35.8] }, properties: {} },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: 'Walmart Supercenter', subtitle: '1815 East Highland Drive, Jonesboro, AR', latitude: 35.8190864, longitude: -90.6852722 });
    expect(results[1].title).toBe('12 Main Street');
  });

  it('drops duplicates and tolerates garbage', () => {
    const f = { geometry: { coordinates: [-90, 35] }, properties: { osm_type: 'N', osm_id: 9, name: 'Cafe', city: 'X' } };
    expect(parsePhotonResults({ features: [f, f] })).toHaveLength(1);
    expect(parsePhotonResults(null)).toEqual([]);
    expect(parsePhotonResults({ features: 'nope' })).toEqual([]);
  });
});

describe('the car on the route', () => {
  // a road running due north
  const road = [
    { latitude: 35.84, longitude: -90.7 },
    { latitude: 35.85, longitude: -90.7 },
  ];
  const cum = cumulativeDistances(road);
  const east = (m: number) => m / (111320 * Math.cos((35.845 * Math.PI) / 180));

  it('finds the nearest point on the route and the way the road runs', () => {
    const hit = projectOnRoute({ latitude: 35.845, longitude: -90.7 + east(12) }, road, cum)!;
    expect(hit.offRouteM).toBeCloseTo(12, 0);
    expect(hit.point.longitude).toBeCloseTo(-90.7, 6);
    expect(hit.point.latitude).toBeCloseTo(35.845, 6);
    expect(hit.bearing).toBeCloseTo(0, 3);
  });

  it('GPS 12 m to the side draws the car on the route, pointing along the road', () => {
    const fix = { latitude: 35.845, longitude: -90.7 + east(12) };
    const hit = projectOnRoute(fix, road, cum)!;
    const nav = { offRouteM: hit.offRouteM, snapped: hit.point, roadBearing: hit.bearing };
    const shown = shownOnMap(fix, 12, nav);
    expect(shown.snapped).toBe(true);
    expect(shown.position).toEqual(hit.point);
    expect(shown.heading).toBe(hit.bearing);
  });

  it('really off the route, it stays where you are', () => {
    const fix = { latitude: 35.845, longitude: -90.7 + east(SNAP_METERS + 15) };
    const hit = projectOnRoute(fix, road, cum)!;
    const shown = shownOnMap(fix, 90, { offRouteM: hit.offRouteM, snapped: hit.point, roadBearing: hit.bearing });
    expect(shown).toEqual({ position: fix, heading: 90, snapped: false });
  });

  it('facing the other way keeps your own heading, and walking snaps less', () => {
    const nav = { offRouteM: 8, snapped: road[0], roadBearing: 0 };
    expect(shownOnMap(road[1], 180, nav).heading).toBe(180);
    expect(shownOnMap(road[1], 0, { ...nav, offRouteM: 20 }, true).snapped).toBe(false);
    expect(shownOnMap(road[1], 0, null)).toEqual({ position: road[1], heading: 0, snapped: false });
  });
});

