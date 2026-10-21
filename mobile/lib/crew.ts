import { isDriving, isLowBattery, isStale, speedToMph } from '@/lib/format';

// Rows as returned by org_roster / org_live_roster / org_shifts /
// org_worker_track (migration ...000048). Everything a manager sees comes
// through those functions, which apply the visibility rule and write the
// audit log — never a direct read of locations.
export interface RosterMember {
  user_id: string;
  full_name: string;
  role: 'owner' | 'admin' | 'manager' | 'worker';
  status: 'invited' | 'active';
  consented_at: string | null;
  on_shift: boolean;
}

export interface LiveWorker {
  user_id: string;
  full_name: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  battery_level: number | null;
  recorded_at: string | null;
  clocked_in_at: string;
  team_names: string | null;
}

export interface CrewShift {
  shift_id: number;
  user_id: string;
  full_name: string;
  clocked_in_at: string;
  ended_at: string;
  is_open: boolean;
  // false once they've left the organization (migration ...000065); absent
  // from older servers
  is_current?: boolean;
}

export interface TrackPoint {
  shift_id: number;
  latitude: number;
  longitude: number;
  speed: number | null;
  battery_level: number | null;
  recorded_at: string;
}

export interface CrewSplit {
  onShift: LiveWorker[];
  offShift: RosterMember[];
  pending: RosterMember[];
}

// onShift comes straight from org_live_roster (already limited to people the
// caller may see). Off-shift workers are listed by name only — there is no
// location to show, by design. Pending workers have redeemed the code but
// not yet accepted the disclosure; nobody can see them.
export function splitCrew(roster: RosterMember[], live: LiveWorker[]): CrewSplit {
  const liveIds = new Set(live.map((w) => w.user_id));
  const workers = roster.filter((m) => m.role === 'worker');
  return {
    onShift: live,
    offShift: workers.filter((m) => m.status === 'active' && !liveIds.has(m.user_id)),
    pending: workers.filter((m) => m.status === 'invited'),
  };
}

export function crewSummary(split: CrewSplit): string {
  const parts = [`${split.onShift.length} on shift`, `${split.offShift.length} off`];
  if (split.pending.length > 0) parts.push(`${split.pending.length} waiting to accept`);
  return parts.join(' · ');
}

export interface WorkerFlags {
  noFix: boolean;
  stale: boolean;
  lowBattery: boolean;
  driving: boolean;
  mph: number | null;
}

export function workerFlags(w: LiveWorker): WorkerFlags {
  const noFix = w.recorded_at == null || w.latitude == null || w.longitude == null;
  return {
    noFix,
    // A clocked-in worker whose phone has gone quiet is exactly what a
    // manager needs to notice (dead battery, no signal, app closed).
    stale: !noFix && isStale(w.recorded_at as string),
    lowBattery: isLowBattery(w.battery_level),
    driving: isDriving(w.speed),
    mph: speedToMph(w.speed),
  };
}

export function hasPosition(w: LiveWorker): w is LiveWorker & { latitude: number; longitude: number } {
  return w.latitude != null && w.longitude != null;
}
