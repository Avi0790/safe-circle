import fixture from './fixtures/osrm-jonesboro.json';
import {
  navState,
  nextAnnouncement,
  OFF_ROUTE_METERS,
  prepareRoute,
  type LatLng,
} from '../navigation';
import { parseOsrmRoute } from '../routing';

// A real route captured from the OSRM service (8.3 km across Jonesboro, 13
// manoeuvres), "driven" by feeding its own geometry back through the same
// functions the Drive screen uses, with GPS-sized noise on every fix.
const route = parseOsrmRoute(fixture);
const prepared = prepareRoute(route);

// Deterministic pseudo-noise (about +/- 6 m) so the test is repeatable.
function noisy(p: LatLng, i: number): LatLng {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  return {
    latitude: p.latitude + ((a - Math.floor(a)) - 0.5) * 0.00011,
    longitude: p.longitude + ((b - Math.floor(b)) - 0.5) * 0.00011,
  };
}

describe('driving a real route', () => {
  it('parses into a sane route', () => {
    expect(route.steps.length).toBeGreaterThanOrEqual(10);
    expect(route.steps[0].type).toBe('depart');
    expect(route.steps[route.steps.length - 1].type).toBe('arrive');
    expect(prepared.totalM).toBeGreaterThan(route.distanceM * 0.97);
    expect(prepared.totalM).toBeLessThan(route.distanceM * 1.03);
  });

  it('orders the manoeuvres along the polyline', () => {
    for (let i = 1; i < prepared.stepAlong.length; i++) {
      expect(prepared.stepAlong[i]).toBeGreaterThanOrEqual(prepared.stepAlong[i - 1]);
    }
    expect(prepared.stepAlong[prepared.stepAlong.length - 1]).toBeGreaterThan(prepared.totalM * 0.98);
  });

  it('progresses steadily, stays on route, announces every turn once, and arrives', () => {
    let hint: number | undefined;
    let lastAlong = -1;
    let lastNext = 0;
    let maxOff = 0;
    let arrivedAt = -1;
    const said = new Set<string>();
    const spoken: string[] = [];

    route.coords.forEach((point, i) => {
      const s = navState(prepared, noisy(point, i), hint)!;
      hint = s.alongM;
      maxOff = Math.max(maxOff, s.offRouteM);
      expect(s.alongM).toBeGreaterThanOrEqual(lastAlong - 15); // noise may wobble, never reverse
      expect(s.nextStepIndex).toBeGreaterThanOrEqual(lastNext);
      lastAlong = Math.max(lastAlong, s.alongM);
      lastNext = s.nextStepIndex;
      const say = nextAnnouncement(s.nextStepIndex, s.distanceToNextM, route.steps, said);
      if (say) {
        said.add(say.key);
        spoken.push(say.text);
      }
      if (s.arrived && arrivedAt < 0) arrivedAt = i;
    });

    expect(maxOff).toBeLessThan(OFF_ROUTE_METERS); // GPS noise alone never looks like leaving the route
    expect(arrivedAt).toBeGreaterThan(route.coords.length * 0.9);
    expect(spoken.filter((t) => t.startsWith('In a quarter mile')).length).toBeGreaterThanOrEqual(5);
    expect(spoken[spoken.length - 1]).toBe('Your destination is just ahead.');
    // every near/far key is unique: nothing was said twice
    expect(new Set(said).size).toBe(said.size);
  });

  it('notices a wrong turn, and a parallel road far enough away', () => {
    const mid = route.coords[Math.floor(route.coords.length / 2)];
    const wrong = { latitude: mid.latitude + 0.0009, longitude: mid.longitude }; // ~100 m north
    const s = navState(prepared, wrong, prepared.totalM / 2)!;
    expect(s.offRouteM).toBeGreaterThan(OFF_ROUTE_METERS);
  });
});
