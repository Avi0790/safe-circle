import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import type { CrewShift } from '../lib/crew'
import { durationMinutes, shiftsToCsv } from '../lib/csv'
import { formatClockTime } from '../lib/format'

const RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

// Shift history for the workers the viewer oversees (the database already
// limits managers to their teams), with a CSV download for timesheets. Only
// clock-in and clock-out times appear here — no locations.
export function OrgShifts({ org }: { org: OrgMembership }) {
  const [days, setDays] = useState(7)
  const [shifts, setShifts] = useState<CrewShift[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: rpcError } = await supabase.rpc('org_shifts', {
        p_org: org.org_id,
        p_days: days,
        p_limit: 500,
      })
      if (cancelled) return
      if (rpcError) setError(rpcError.message)
      else {
        setError(null)
        setShifts((data as CrewShift[]) ?? [])
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [org.org_id, days])

  function download() {
    const blob = new Blob([shiftsToCsv(shifts)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shifts-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="org-page">
      <div className="org-inline">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </select>
        <button onClick={download} disabled={shifts.length === 0}>
          Download CSV
        </button>
      </div>
      {error && <p className="org-error">{error}</p>}
      {loaded && !error && shifts.length === 0 && <p className="org-note">No shifts in this range.</p>}
      {shifts.length > 0 && (
        <table className="org-table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Date</th>
              <th>Clock in</th>
              <th>Clock out</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => {
              const minutes = durationMinutes(s.clocked_in_at, s.ended_at)
              return (
                <tr key={s.shift_id}>
                  <td>{s.full_name}</td>
                  <td>{new Date(s.clocked_in_at).toLocaleDateString()}</td>
                  <td>{formatClockTime(s.clocked_in_at)}</td>
                  <td>{s.is_open ? 'on shift' : formatClockTime(s.ended_at)}</td>
                  <td>
                    {Math.floor(minutes / 60)} h {minutes % 60} min
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
