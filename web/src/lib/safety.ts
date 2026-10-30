// The safety report (org_safety_report, migration ...000073): one row per
// week, oldest first. These turn the rows into what the page shows.

export interface SafetyWeek {
  week_start: string
  hours: number
  shifts: number
  workers: number
  sos: number
  sos_answered: number
  median_response_minutes: number | null
  missed_checkins: number
  quiet_phones: number
  incidents: number
  incidents_resolved: number
  location_views: number
}

export interface SafetySummary {
  hours: number
  shifts: number
  sos: number
  sosAnswered: number
  missedCheckins: number
  quietPhones: number
  incidents: number
  incidentsOpen: number
  locationViews: number
  // the slowest week's median, the honest headline for "how fast is help"
  slowestMedianMinutes: number | null
}

// Postgres numerics arrive as strings; counts as numbers.
const num = (v: unknown) => (v == null ? 0 : Number(v))

export function normalizeWeeks(rows: unknown[]): SafetyWeek[] {
  return (rows as Record<string, unknown>[]).map((r) => ({
    week_start: String(r.week_start),
    hours: num(r.hours),
    shifts: num(r.shifts),
    workers: num(r.workers),
    sos: num(r.sos),
    sos_answered: num(r.sos_answered),
    median_response_minutes: r.median_response_minutes == null ? null : Number(r.median_response_minutes),
    missed_checkins: num(r.missed_checkins),
    quiet_phones: num(r.quiet_phones),
    incidents: num(r.incidents),
    incidents_resolved: num(r.incidents_resolved),
    location_views: num(r.location_views),
  }))
}

export function summarize(weeks: SafetyWeek[]): SafetySummary {
  const sum = (pick: (w: SafetyWeek) => number) => weeks.reduce((total, w) => total + pick(w), 0)
  const medians = weeks.map((w) => w.median_response_minutes).filter((m): m is number => m != null)
  const incidents = sum((w) => w.incidents)
  return {
    hours: Math.round(sum((w) => w.hours) * 10) / 10,
    shifts: sum((w) => w.shifts),
    sos: sum((w) => w.sos),
    sosAnswered: sum((w) => w.sos_answered),
    missedCheckins: sum((w) => w.missed_checkins),
    quietPhones: sum((w) => w.quiet_phones),
    incidents,
    incidentsOpen: incidents - sum((w) => w.incidents_resolved),
    locationViews: sum((w) => w.location_views),
    slowestMedianMinutes: medians.length ? Math.max(...medians) : null,
  }
}

// Bars for weekly hours: each week's share of the busiest week.
export function hourBars(weeks: SafetyWeek[], locale?: string) {
  const max = Math.max(0, ...weeks.map((w) => w.hours))
  return weeks.map((w) => ({
    week: w.week_start,
    label: new Date(w.week_start + 'T12:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    hours: w.hours,
    share: max > 0 ? w.hours / max : 0,
  }))
}

// A week with something that needs a look: an unanswered SOS, a missed
// check-in, a quiet phone or an injury-level signal.
export function needsAttention(w: SafetyWeek): boolean {
  return w.sos > w.sos_answered || w.missed_checkins > 0 || w.quiet_phones > 0 || w.incidents > w.incidents_resolved
}
