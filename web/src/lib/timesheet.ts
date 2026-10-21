import type { CrewShift } from './crew'
import { csvCell } from './csv'

// The web twin of mobile/lib/timesheet.ts (keep them in step).
// Weekly timesheets for the people who run an organization, built from the
// shifts org_shifts() already returns. That function decides who's in it:
// owners and admins get every worker, managers only the teams they lead, and
// for owners and admins it includes people who have since left (migration
// ...000065), so their hours still get paid. Times only, never locations.
// Each shift is already capped at the 14-hour automatic end (ended_at), and
// an open one counts up to now.
//
// Weeks run Monday to Sunday in the phone's time zone. A shift is split at
// midnight, so overnight work lands on the days (and weeks) it happened.

const DAY_MS = 24 * 60 * 60 * 1000
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// org_shifts looks back at most 90 days, so earlier weeks can't be built.
export const MAX_WEEKS_BACK = 12

export interface TimesheetShift {
  shiftId: number
  start: Date
  end: Date; // clipped to the week
  minutes: number; // within the week
  isOpen: boolean
}

export interface TimesheetRow {
  userId: string
  name: string
  days: number[]; // minutes per day, Monday first
  totalMinutes: number
  shifts: TimesheetShift[]
  onShift: boolean
  // has since left the organization
  former: boolean
}

export interface Timesheet {
  weekStart: Date
  weekEnd: Date; // exclusive: the next Monday
  rows: TimesheetRow[]
  totalMinutes: number
}

// Local midnight on the Monday of the week `weeksBack` weeks before now's.
export function weekStart(now: Date, weeksBack = 0): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - sinceMonday - 7 * weeksBack)
  return d
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// How many days org_shifts must look back to see every shift that touches
// the week (one extra day for a shift that started the night before).
export function daysToFetch(start: Date, now: Date): number {
  return Math.min(90, Math.ceil((now.getTime() - start.getTime()) / DAY_MS) + 2)
}

export function buildTimesheet(shifts: CrewShift[], start: Date): Timesheet {
  const end = addDays(start, 7)
  const dayStarts = Array.from({ length: 8 }, (_, i) => addDays(start, i))
  const byWorker = new Map<string, TimesheetRow>()

  for (const s of shifts) {
    const shiftStart = new Date(s.clocked_in_at)
    const shiftEnd = new Date(s.ended_at)
    const from = Math.max(shiftStart.getTime(), start.getTime())
    const to = Math.min(shiftEnd.getTime(), end.getTime())
    if (to <= from) continue

    let row = byWorker.get(s.user_id)
    if (!row) {
      row = { userId: s.user_id, name: s.full_name, days: [0, 0, 0, 0, 0, 0, 0], totalMinutes: 0, shifts: [], onShift: false, former: false }
      byWorker.set(s.user_id, row)
    }
    for (let i = 0; i < 7; i++) {
      const a = Math.max(from, dayStarts[i].getTime())
      const b = Math.min(to, dayStarts[i + 1].getTime())
      if (b > a) row.days[i] += (b - a) / 60_000
    }
    const minutes = (to - from) / 60_000
    row.totalMinutes += minutes
    row.shifts.push({ shiftId: s.shift_id, start: new Date(from), end: new Date(to), minutes, isOpen: s.is_open })
    if (s.is_open) row.onShift = true
    if (s.is_current === false) row.former = true
  }

  const rows = [...byWorker.values()]
    .map((r) => ({ ...r, shifts: r.shifts.sort((a, b) => a.start.getTime() - b.start.getTime()) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { weekStart: start, weekEnd: end, rows, totalMinutes: rows.reduce((t, r) => t + r.totalMinutes, 0) }
}

// Decimal hours, as payroll wants them: 450 minutes -> "7.50".
export function hours(minutes: number): string {
  return (Math.round(minutes) / 60).toFixed(2)
}

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Oct 19 – Oct 25, 2026"
export function weekLabel(sheet: Pick<Timesheet, 'weekStart'>): string {
  const last = addDays(sheet.weekStart, 6)
  const fmt = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `${fmt(sheet.weekStart)} – ${fmt(last)}, ${last.getFullYear()}`
}

// One row per shift, then each worker's total; times in the phone's time
// zone. Opens in Excel, Numbers or Google Sheets. Cells go through csvCell,
// which quotes and defuses spreadsheet formulas.
export function timesheetCsv(sheet: Timesheet, orgName: string): string {
  const lines = [
    [`Timesheet: ${orgName}`, weekLabel(sheet)],
    ['Worker', 'Date', 'Clocked in', 'Clocked out', 'Hours'],
  ]
  for (const r of sheet.rows) {
    for (const s of r.shifts) {
      lines.push([r.name, isoDate(s.start), clock(s.start), s.isOpen ? 'On shift' : clock(s.end), hours(s.minutes)])
    }
    lines.push([r.name, 'Total', '', '', hours(r.totalMinutes)])
  }
  lines.push(['All workers', 'Total', '', '', hours(sheet.totalMinutes)])
  return lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n'
}

export function timesheetFilename(sheet: Timesheet, orgName: string): string {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization'
  return `timesheet-${slug}-${isoDate(sheet.weekStart)}.csv`
}
