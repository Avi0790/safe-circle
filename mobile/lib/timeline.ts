import { haversineMeters } from '@/lib/geo';
import { isDriving, speedToMph } from '@/lib/format';

// Someone's day as stays and moves, from their location history (the member
// details screen, which records the look in "Who's checked on me"):
//   Home · 12:00 AM – 8:10 AM
//   Drove 12 min · 4.1 mi
//   Near 2108 Aggie Rd · 8:25 AM – now
// A stay is a run of positions within STAY_RADIUS_M of where it started that
// lasts at least STAY_MIN_MINUTES; what happens between two stays is a move,
// a drive if any point in it was at driving speed.

export const STAY_RADIUS_M = 150;
export const STAY_MIN_MINUTES = 10;

export interface Ping {
  latitude: number;
  longitude: number;
  speed: number | null;
  recorded_at: string;
}

export type TimelineEntry =
  | { kind: 'stay'; start: string; end: string; latitude: number; longitude: number; ongoing: boolean }
  | { kind: 'move'; start: string; end: string; meters: number; drove: boolean; topMph: number | null };

const ms = (iso: string) => new Date(iso).getTime();

export function buildTimeline(pings: Ping[], now = Date.now()): TimelineEntry[] {
  const pts = [...pings].sort((a, b) => ms(a.recorded_at) - ms(b.recorded_at));
  const entries: TimelineEntry[] = [];
  let i = 0;
  let moveFrom: number | null = null; // index where the current move began

  const closeMove = (endIdx: number) => {
    if (moveFrom == null || endIdx <= moveFrom) {
      moveFrom = null;
      return;
    }
    let meters = 0;
    let top: number | null = null;
    let drove = false;
    for (let k = moveFrom; k <= endIdx; k++) {
      if (k > moveFrom) {
        meters += haversineMeters(pts[k - 1].latitude, pts[k - 1].longitude, pts[k].latitude, pts[k].longitude);
      }
      const mph = speedToMph(pts[k].speed);
      if (mph != null && (top == null || mph > top)) top = mph;
      if (isDriving(pts[k].speed)) drove = true;
    }
    entries.push({
      kind: 'move',
      start: pts[moveFrom].recorded_at,
      end: pts[endIdx].recorded_at,
      meters,
      drove,
      topMph: top == null ? null : Math.round(top),
    });
    moveFrom = null;
  };

  while (i < pts.length) {
    // how far does a stay starting here reach?
    let j = i;
    while (
      j + 1 < pts.length &&
      haversineMeters(pts[i].latitude, pts[i].longitude, pts[j + 1].latitude, pts[j + 1].longitude) <= STAY_RADIUS_M
    ) {
      j++;
    }
    const isLast = j === pts.length - 1;
    const endTime = isLast ? Math.max(now, ms(pts[j].recorded_at)) : ms(pts[j].recorded_at);
    const minutes = (endTime - ms(pts[i].recorded_at)) / 60_000;
    if (minutes >= STAY_MIN_MINUTES || (isLast && j > i)) {
      closeMove(i);
      entries.push({
        kind: 'stay',
        start: pts[i].recorded_at,
        end: isLast ? new Date(endTime).toISOString() : pts[j].recorded_at,
        latitude: pts[i].latitude,
        longitude: pts[i].longitude,
        ongoing: isLast,
      });
      i = j + 1;
      if (i < pts.length) moveFrom = j; // the move starts where the stay ended
    } else {
      if (moveFrom == null) moveFrom = i;
      i++;
    }
  }
  closeMove(pts.length - 1);
  return entries;
}

// "8 h 10 min", "12 min"
export function spanText(startIso: string, endIso: string): string {
  const mins = Math.max(1, Math.round((ms(endIso) - ms(startIso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// "4.1 mi", "0.3 mi"
export function milesText(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}
