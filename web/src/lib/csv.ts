import type { CrewShift } from './crew'

// A spreadsheet treats a cell that starts with = + - @ (or a tab/return) as
// a formula, and names here are typed by users — so "=HYPERLINK(...)" as a
// display name would run when an admin opens the export. Prefixing an
// apostrophe makes it plain text.
export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function durationMinutes(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000))
}

const HEADER = ['Worker', 'Date', 'Clock in', 'Clock out', 'Minutes', 'Status']

// One row per shift. An open shift's "end" is just now, so it's marked
// instead of being presented as a finished one.
export function shiftsToCsv(shifts: CrewShift[]): string {
  const rows = shifts.map((s) => {
    const start = new Date(s.clocked_in_at)
    return [
      s.full_name,
      start.toISOString().slice(0, 10),
      start.toISOString(),
      s.is_open ? '' : new Date(s.ended_at).toISOString(),
      durationMinutes(s.clocked_in_at, s.ended_at),
      s.is_open ? 'on shift' : 'completed',
    ]
  })
  return [HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
