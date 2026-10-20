import { formatTimeLeft, timeAgo } from '@/lib/format';
import { projectOnRoute, type LatLng, type PreparedRoute } from '@/lib/navigation';
import { supabase } from '@/lib/supabase';

// Report an incident while driving (backend migration ...000061). Circle-mates
// who can see your location see the report on their Directions map and hear
// about it when their route runs past it. Reports fade out after an hour
// (three for a closed road).
export type RoadReportKind = 'crash' | 'hazard' | 'speed_check' | 'closure';

export interface RoadReport extends LatLng {
  id: string;
  reporter_id: string;
  kind: RoadReportKind;
  created_at: string;
  expires_at: string;
  profiles?: { full_name: string } | null;
}

export const ROAD_REPORT_KINDS: { kind: RoadReportKind; emoji: string; label: string; spoken: string }[] = [
  { kind: 'crash', emoji: '💥', label: 'Crash', spoken: 'Crash reported ahead.' },
  { kind: 'hazard', emoji: '⚠️', label: 'Hazard', spoken: 'Hazard reported ahead.' },
  { kind: 'speed_check', emoji: '🚓', label: 'Speed check', spoken: 'Speed check reported ahead.' },
  { kind: 'closure', emoji: '🚧', label: 'Road closed', spoken: 'Road closure reported ahead.' },
];

export const reportInfo = (kind: RoadReportKind) => ROAD_REPORT_KINDS.find((k) => k.kind === kind) ?? ROAD_REPORT_KINDS[1];

// Close enough to the route to be on it, and far enough ahead to be useful
// but not so far that it's forgotten by the time you get there.
export const REPORT_ON_ROUTE_M = 40;
export const REPORT_ALERT_AHEAD_M = 800;

// The next report on the road ahead that hasn't been announced yet. Only the
// stretch from where you are onwards is searched, so a report you've passed,
// or one on the other side of a loop in the route, never comes up.
export function upcomingReport(
  prepared: PreparedRoute,
  alongM: number,
  reports: RoadReport[],
  alerted: Set<string>,
  nowMs: number = Date.now(),
): { report: RoadReport; aheadM: number } | null {
  let best: { report: RoadReport; aheadM: number } | null = null;
  for (const report of reports) {
    if (alerted.has(report.id) || new Date(report.expires_at).getTime() <= nowMs) continue;
    const hit = projectOnRoute(report, prepared.route.coords, prepared.cum, alongM, alongM + REPORT_ALERT_AHEAD_M);
    if (!hit || hit.offRouteM > REPORT_ON_ROUTE_M) continue;
    const aheadM = hit.alongM - alongM;
    if (aheadM < 0 || aheadM > REPORT_ALERT_AHEAD_M) continue;
    if (!best || aheadM < best.aheadM) best = { report, aheadM };
  }
  return best;
}

// For the Map tab: reports from people in the circle you're looking at (and
// your own), still live. The server already limits reports to people whose
// location you can see; this keeps the map about one circle, like its pins.
export function reportsForCircle(
  reports: RoadReport[],
  memberIds: string[],
  myUserId: string | undefined,
  nowMs: number = Date.now(),
): RoadReport[] {
  const ids = new Set(memberIds);
  return reports.filter(
    (r) => (r.reporter_id === myUserId || ids.has(r.reporter_id)) && new Date(r.expires_at).getTime() > nowMs,
  );
}

// "💥 Crash reported" / "By Sam · 12m ago · clears in 48 min".
export function reportDetails(r: RoadReport, myUserId: string | undefined, nowMs: number = Date.now()) {
  const info = reportInfo(r.kind);
  const who = r.reporter_id === myUserId ? 'you' : (r.profiles?.full_name ?? 'someone in your circle');
  return {
    title: `${info.emoji} ${info.label} reported`,
    body: `By ${who} · ${timeAgo(r.created_at)} · clears in ${formatTimeLeft(r.expires_at, nowMs)}`,
  };
}

export type ReportResult = { ok: true; id: string } | { ok: false; error: string };

export async function reportIncident(kind: RoadReportKind, at: LatLng): Promise<ReportResult> {
  const { data, error } = await supabase.rpc('report_road_incident', {
    p_kind: kind,
    p_latitude: at.latitude,
    p_longitude: at.longitude,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't send the report." };
  return { ok: true, id: data as string };
}

export async function clearReport(id: string): Promise<void> {
  await supabase.rpc('clear_road_report', { p_id: id }).then(
    () => {},
    () => {},
  );
}
