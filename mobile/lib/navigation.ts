import { haversineMeters } from '@/lib/geo';

// Pure navigation maths and wording. No React, no network, no GPS: the Drive
// screen feeds positions in and renders what comes out, which is what makes
// this testable without driving anywhere.

export interface LatLng {
  latitude: number;
  longitude: number;
}

// One manoeuvre. `distanceM` is the length of road AFTER it, until the next
// one (OSRM's meaning); `location` is where the manoeuvre itself happens.
export interface RouteStep {
  type: string;
  modifier?: string;
  name: string;
  exit?: number;
  distanceM: number;
  location: LatLng;
  instruction: string;
}

export interface Route {
  distanceM: number;
  durationS: number;
  coords: LatLng[];
  steps: RouteStep[];
}

// A route plus the numbers every position update needs, computed once.
export interface PreparedRoute {
  route: Route;
  cum: number[]; // metres along the polyline at each vertex
  stepAlong: number[]; // metres along the polyline at each step's manoeuvre
  totalM: number;
}

// How the trip is made. Walking has its own routing server, shorter spoken
// prompts (a walker needs seconds, not a quarter mile, of warning) and a pace
// readout instead of a speedometer.
export type TravelMode = 'drive' | 'walk';

export const OFF_ROUTE_METERS = 50;
export const ARRIVE_METERS = 30;
// A manoeuvre this close behind you has been taken.
const PASSED_TOLERANCE_M = 5;

// ---------------------------------------------------------------- wording

const MODIFIER_TEXT: Record<string, string> = {
  uturn: 'make a U-turn',
  'sharp right': 'turn sharp right',
  right: 'turn right',
  'slight right': 'bear right',
  straight: 'continue straight',
  'slight left': 'bear left',
  left: 'turn left',
  'sharp left': 'turn sharp left',
};

const HEADING_TEXT: Record<string, string> = {
  uturn: 'around',
  'sharp right': 'right',
  right: 'right',
  'slight right': 'right',
  straight: 'straight',
  'slight left': 'left',
  left: 'left',
  'sharp left': 'left',
};

function ordinal(n: number): string {
  const names = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  return names[n] ?? `${n}th`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Turn left onto Union Street." from an OSRM manoeuvre. Unnamed roads read as
// plain directions rather than "onto ".
export function instructionText(step: {
  type: string;
  modifier?: string;
  name: string;
  exit?: number;
}): string {
  const onto = step.name ? ` onto ${step.name}` : '';
  const on = step.name ? ` on ${step.name}` : '';
  const turn = step.modifier ? MODIFIER_TEXT[step.modifier] : undefined;

  switch (step.type) {
    case 'depart':
      return `Head ${step.modifier ? (HEADING_TEXT[step.modifier] ?? 'out') : 'out'}${on}`;
    case 'arrive':
      return 'You have arrived at your destination';
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return step.exit
        ? `At the roundabout, take the ${ordinal(step.exit)} exit${onto}`
        : 'Enter the roundabout';
    case 'merge':
      return `Merge${onto || ' ahead'}`;
    case 'on ramp':
      return `Take the ramp${onto}`;
    case 'off ramp':
      return `Take the exit${onto}`;
    case 'fork':
      return `Keep ${step.modifier?.includes('left') ? 'left' : step.modifier?.includes('right') ? 'right' : 'straight'} at the fork${onto}`;
    case 'end of road':
      return `At the end of the road, ${turn ?? 'turn'}${onto}`;
    case 'continue':
    case 'new name':
      return `Continue${on}`;
    case 'turn':
    default:
      return capitalise(`${turn ?? 'continue'}${turn === 'continue straight' || !turn ? on : onto}`);
  }
}

// ---------------------------------------------------------------- geometry

export function cumulativeDistances(coords: LatLng[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineMeters(
          coords[i - 1].latitude,
          coords[i - 1].longitude,
          coords[i].latitude,
          coords[i].longitude,
        ),
    );
  }
  return cum;
}

export interface Projection {
  alongM: number;
  offRouteM: number;
}

// Closest point on the polyline to `pos`, within a window of distance-along so
// a route that doubles back on itself can't snap to the wrong pass.
export function projectOnRoute(
  pos: LatLng,
  coords: LatLng[],
  cum: number[],
  minAlongM = 0,
  maxAlongM = Infinity,
): Projection | null {
  if (coords.length < 2) return null;
  // Local flat-earth metres around the position: accurate enough for points
  // a few hundred metres apart, and far cheaper than spherical maths per
  // segment on every GPS fix.
  const cosLat = Math.cos((pos.latitude * Math.PI) / 180);
  const mx = (lon: number) => (lon - pos.longitude) * cosLat * 111320;
  const my = (lat: number) => (lat - pos.latitude) * 110540;

  let best: Projection | null = null;
  for (let i = 0; i < coords.length - 1; i++) {
    if (cum[i + 1] < minAlongM || cum[i] > maxAlongM) continue;
    const ax = mx(coords[i].longitude);
    const ay = my(coords[i].latitude);
    const bx = mx(coords[i + 1].longitude);
    const by = my(coords[i + 1].latitude);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Position is the origin (0,0).
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist = Math.sqrt(px * px + py * py);
    if (best === null || dist < best.offRouteM) {
      best = { offRouteM: dist, alongM: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
  }
  return best;
}

export function prepareRoute(route: Route): PreparedRoute {
  const cum = cumulativeDistances(route.coords);
  const totalM = cum[cum.length - 1] ?? 0;
  const stepAlong: number[] = [];
  let previous = 0;
  for (const step of route.steps) {
    // Each manoeuvre is at or after the previous one; searching forward only
    // keeps an out-and-back route from matching the return leg.
    const hit = projectOnRoute(step.location, route.coords, cum, Math.max(0, previous - 1));
    const along = hit ? Math.max(previous, hit.alongM) : previous;
    stepAlong.push(along);
    previous = along;
  }
  return { route, cum, stepAlong, totalM };
}

// ------------------------------------------------------------------ state

export interface NavState {
  alongM: number;
  offRouteM: number;
  remainingM: number;
  remainingS: number;
  nextStepIndex: number;
  distanceToNextM: number;
  arrived: boolean;
}

export function navState(
  prepared: PreparedRoute,
  pos: LatLng,
  hintAlongM?: number,
): NavState | null {
  const { route, cum, stepAlong, totalM } = prepared;

  // Normally you're near where you were; a narrow window keeps the answer
  // stable. If that finds nothing close (GPS jumped, tunnel), look everywhere.
  let hit =
    hintAlongM == null
      ? null
      : projectOnRoute(pos, route.coords, cum, hintAlongM - 150, hintAlongM + 3000);
  if (!hit || hit.offRouteM > OFF_ROUTE_METERS) {
    const full = projectOnRoute(pos, route.coords, cum);
    if (full && (!hit || full.offRouteM < hit.offRouteM)) hit = full;
  }
  if (!hit) return null;

  const remainingM = Math.max(0, totalM - hit.alongM);
  let next = route.steps.length - 1;
  for (let i = 1; i < stepAlong.length; i++) {
    if (stepAlong[i] > hit.alongM + PASSED_TOLERANCE_M) {
      next = i;
      break;
    }
  }
  return {
    alongM: hit.alongM,
    offRouteM: hit.offRouteM,
    remainingM,
    remainingS: totalM > 0 ? route.durationS * (remainingM / totalM) : 0,
    nextStepIndex: next,
    distanceToNextM: Math.max(0, (stepAlong[next] ?? totalM) - hit.alongM),
    arrived: remainingM <= ARRIVE_METERS,
  };
}

// ------------------------------------------------------------------ voice

export const FAR_PROMPT_M = 420; // about a quarter mile
export const NEAR_PROMPT_M = 90;
export const WALK_FAR_PROMPT_M = 120; // about 400 feet
export const WALK_NEAR_PROMPT_M = 30;

export interface Announcement {
  key: string;
  text: string;
}

// What to say now, if anything. `said` holds the keys already spoken, so each
// manoeuvre is announced once from far and once when it is close, never twice
// and never out of order.
export function nextAnnouncement(
  stepIndex: number,
  distanceM: number,
  steps: RouteStep[],
  said: Set<string>,
  mode: TravelMode = 'drive',
): Announcement | null {
  const step = steps[stepIndex];
  if (!step) return null;
  const nearKey = `${stepIndex}:near`;
  const farKey = `${stepIndex}:far`;
  const walking = mode === 'walk';
  const nearM = walking ? WALK_NEAR_PROMPT_M : NEAR_PROMPT_M;
  const farM = walking ? WALK_FAR_PROMPT_M : FAR_PROMPT_M;

  if (distanceM <= nearM && !said.has(nearKey)) {
    // The arrival itself is announced by the screen when you actually get
    // there; saying "you have arrived" 90 m short would be wrong and twice.
    return { key: nearKey, text: step.type === 'arrive' ? 'Your destination is just ahead.' : `${step.instruction}.` };
  }
  if (distanceM <= farM && distanceM > nearM && !said.has(farKey) && step.type !== 'arrive') {
    const lower = step.instruction.charAt(0).toLowerCase() + step.instruction.slice(1);
    // Driving says a round "quarter mile"; a walker's next turn can be much
    // closer than any fixed phrase, so say the real distance.
    const lead = walking ? `In ${formatNavDistance(distanceM)}` : 'In a quarter mile';
    return { key: farKey, text: `${lead}, ${lower}.` };
  }
  return null;
}

// -------------------------------------------------------------- formatting

export function formatNavDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 100) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  if (feet < 528) return `${Math.round(feet / 50) * 50} ft`;
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

export function formatNavDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatArrivalClock(secondsFromNow: number, now = Date.now()): string {
  return new Date(now + secondsFromNow * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// GPS speed jitters by a few mph even at a steady pace; a light smoothing makes
// the number readable without lagging behind real braking.
export function smoothSpeed(previous: number | null, raw: number, alpha = 0.5): number {
  if (previous == null) return raw;
  return previous + alpha * (raw - previous);
}

// A map region that frames all the points with some breathing room. Computed
// up front so the map can mount already pointed at the route: react-native-maps
// ignores an animateToRegion issued right after mount (the same race the Map
// tab hit), so we never rely on one.
export function boundsRegion(points: LatLng[], padding = 1.5) {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * padding),
    longitudeDelta: Math.max(0.01, (maxLon - minLon) * padding),
  };
}
