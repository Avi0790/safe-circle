// Planned shifts (migration ...000074), as the phone's lib/schedule.ts:
// org_schedule() pairs each with the clock-in nearest its start.

export type ScheduleStatus = 'upcoming' | 'on_time' | 'late' | 'missed' | 'worked'

export interface ScheduleRow {
  id: string
  user_id: string
  worker_name: string | null
  starts_at: string
  ends_at: string
  job_site: string | null
  note: string | null
  clocked_in_at: string | null
  clocked_out_at: string | null
  status: ScheduleStatus
}

export const SHIFT_LENGTHS = [4, 6, 8, 10, 12]

const STATUS: Record<ScheduleStatus, { label: string; tone: 'muted' | 'good' | 'warn' | 'danger' }> = {
  upcoming: { label: 'Upcoming', tone: 'muted' },
  on_time: { label: 'On time', tone: 'good' },
  worked: { label: 'Worked', tone: 'good' },
  late: { label: 'Late', tone: 'warn' },
  missed: { label: 'Missed', tone: 'danger' },
}

export function statusInfo(status: string) {
  return STATUS[status as ScheduleStatus] ?? STATUS.upcoming
}

const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000

export function planVsActual(rows: ScheduleRow[], now = Date.now()) {
  let plannedMinutes = 0
  let workedMinutes = 0
  let late = 0
  let missed = 0
  for (const r of rows) {
    plannedMinutes += minutesBetween(r.starts_at, r.ends_at)
    if (r.clocked_in_at) {
      workedMinutes += Math.max(0, minutesBetween(r.clocked_in_at, r.clocked_out_at ?? new Date(now).toISOString()))
    }
    if (r.status === 'late') late += 1
    if (r.status === 'missed') missed += 1
  }
  return { plannedMinutes, workedMinutes, late, missed, shifts: rows.length }
}

// Planned minutes per worker, for the timesheet's planned column.
export function plannedByWorker(rows: ScheduleRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) out.set(r.user_id, (out.get(r.user_id) ?? 0) + minutesBetween(r.starts_at, r.ends_at))
  return out
}

// Shifts grouped by the local day they start on, in order.
export function byDay(rows: ScheduleRow[]): { day: Date; rows: ScheduleRow[] }[] {
  const groups = new Map<string, { day: Date; rows: ScheduleRow[] }>()
  for (const r of [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const d = new Date(r.starts_at)
    const key = d.toDateString()
    if (!groups.has(key)) groups.set(key, { day: new Date(d.getFullYear(), d.getMonth(), d.getDate()), rows: [] })
    groups.get(key)!.rows.push(r)
  }
  return [...groups.values()]
}

// From the form's date ("2026-11-03") and time ("07:30") inputs, local time.
export function shiftFromInputs(date: string, time: string, lengthHours: number): { starts: Date; ends: Date } | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !tm) return null
  const starts = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(tm[1]), Number(tm[2]))
  return { starts, ends: new Date(starts.getTime() + lengthHours * 3_600_000) }
}

const pad = (n: number) => String(n).padStart(2, '0')
export const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
