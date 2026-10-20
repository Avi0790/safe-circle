import { formatTimeLeft, timeAgo } from './format'

// Crashes, hazards, speed checks and closed roads reported from the mobile
// app while driving (backend migration ...000061). The server only returns
// reports from people whose location you can see, and only while they're
// live (an hour; three for a closed road). Read-only here, like everything
// else on this dashboard: reporting and taking a report back are mobile-only.
export type RoadReportKind = 'crash' | 'hazard' | 'speed_check' | 'closure'

export interface RoadReport {
  id: string
  reporter_id: string
  kind: RoadReportKind
  latitude: number
  longitude: number
  created_at: string
  expires_at: string
  profiles: { full_name: string } | null
}

const KINDS: Record<RoadReportKind, { emoji: string; label: string }> = {
  crash: { emoji: '💥', label: 'Crash' },
  hazard: { emoji: '⚠️', label: 'Hazard' },
  speed_check: { emoji: '🚓', label: 'Speed check' },
  closure: { emoji: '🚧', label: 'Road closed' },
}

export const reportInfo = (kind: RoadReportKind) => KINDS[kind] ?? KINDS.hazard

// Reports from people in the selected circle (and your own), still live,
// so the map stays about one circle like its pins.
export function reportsForCircle(
  reports: RoadReport[],
  memberIds: string[],
  myUserId: string | undefined,
  nowMs: number = Date.now(),
): RoadReport[] {
  const ids = new Set(memberIds)
  return reports.filter(
    (r) => (r.reporter_id === myUserId || ids.has(r.reporter_id)) && new Date(r.expires_at).getTime() > nowMs,
  )
}

export function reportDetails(r: RoadReport, myUserId: string | undefined, nowMs: number = Date.now()) {
  const info = reportInfo(r.kind)
  const who = r.reporter_id === myUserId ? 'you' : (r.profiles?.full_name ?? 'someone in your circle')
  return {
    title: `${info.emoji} ${info.label} reported`,
    body: `By ${who} · ${timeAgo(r.created_at)} · clears in ${formatTimeLeft(r.expires_at, nowMs)}`,
  }
}
