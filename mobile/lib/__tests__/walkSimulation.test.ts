import fixture from './fixtures/osrm-foot-jonesboro.json';
import { navState, nextAnnouncement, OFF_ROUTE_METERS, prepareRoute, type LatLng } from '../navigation';
import { parseOsrmRoute } from '../routing';

// A real walking route captured from the FOSSGIS foot-profile OSRM server
// (7.6 km across Jonesboro, 42 steps, walking pace 1.25 m/s), "walked" by
// feeding its own geometry back through the functions the Drive screen uses,
// densified to walking-sized steps and with GPS-sized noise on every fix.
const route = parseOsrmRoute(fixture, 'walk');
const prepared = prepareRoute(route);

function densify(points: LatLng[], stepM: number): LatLng[] {
  const out: LatLng[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dy = (b.latitude - a.latitude) * 110540;
    const dx = (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180) * 111320;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / stepM));
    for (let k = 1; k <= n; k++) {
      out.push({
        latitude: a.latitude + ((b.latitude - a.latitude) * k) / n,
        longitude: a.longitude + ((b.longitude - a.longitude) * k) / n,
      });
    }
  }
  return out;
}

function noisy(p: LatLng, i: number): LatLng {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  return {
    latitude: p.latitude + ((a - Math.floor(a)) - 0.5) * 0.00011,
    longitude: p.longitude + ((b - Math.floor(b)) - 0.5) * 0.00011,
  };
}

describe('walking a real route', () => {
  it('is a walking-pace route', () => {
    expect(route.distanceM / route.durationS).toBeGreaterThan(0.9);
    expect(route.distanceM / route.durationS).toBeLessThan(1.8); // a car on this route is ~10 m/s
    expect(route.steps[0].type).toBe('depart');
    expect(route.steps[route.steps.length - 1].type).toBe('arrive');
  });

  it('progresses, stays on route, warns before every turn by its real distance, and arrives', () => {
    const points = densify(route.coords, 1.3); // about one fix a second
    let hint: number | undefined;
    let lastAlong = -1;
    let maxOff = 0;
    let arrivedAt = -1;
    const said = new Set<string>();
    const spoken: string[] = [];

    points.forEach((point, i) => {
      const s = navState(prepared, noisy(point, i), hint)!;
      hint = s.alongM;
      maxOff = Math.max(maxOff, s.offRouteM);
      // Noise of up to ~8 m on each of two consecutive fixes can differ by ~16 m
      // along the route; it may wobble by that much but never run backwards further.
      expect(s.alongM).toBeGreaterThanOrEqual(lastAlong - 20);
      lastAlong = Math.max(lastAlong, s.alongM);
      const say = nextAnnouncement(s.nextStepIndex, s.distanceToNextM, route.steps, said, 'walk');
      if (say) {
        said.add(say.key);
        spoken.push(say.text);
      }
      if (s.arrived && arrivedAt < 0) arrivedAt = i;
    });

    expect(maxOff).toBeLessThan(OFF_ROUTE_METERS);
    expect(arrivedAt).toBeGreaterThan(points.length * 0.98);
    const far = spoken.filter((t) => /^In \d+ ft, /.test(t));
    expect(far.length).toBeGreaterThanOrEqual(15);
    expect(spoken.some((t) => t.includes('quarter mile'))).toBe(false);
    expect(spoken[spoken.length - 1]).toBe('Your destination is just ahead.');
    // each announcement is one step-and-phase key: nothing was said twice. (Two
    // different steps can read the same, e.g. an unnamed "Turn left.")
    expect(said.size).toBe(spoken.length);
  });
});
