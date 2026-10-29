import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import type { CrewShift } from '../lib/crew'
import {
  buildTimesheet,
  DAY_LABELS,
  daysToFetch,
  hours,
  MAX_WEEKS_BACK,
  timesheetCsv,
  timesheetFilename,
  weekLabel,
  weekStart,
} from '../lib/timesheet'

// Weekly hours for payroll: a worker-by-day grid with totals and a CSV, the
// same as the phone's Timesheets screen. Built on org_shifts(), so managers
// see only the teams they lead, and it's times only, never locations.
export function OrgTimesheets({ org }: { org: OrgMembership }) {
  const [weeksBack, setWeeksBack] = useState(0)
  const [shifts, setShifts] = useState<CrewShift[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useMemo(() => weekStart(new Date(), weeksBack), [weeksBack])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: rpcError } = await supabase.rpc('org_shifts', {
        p_org: org.org_id,
        p_days: daysToFetch(start, new Date()),
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
  }, [org.org_id, start])

  const sheet = useMemo(() => buildTimesheet(shifts, start), [shifts, start])

  function download() {
    const blob = new Blob([timesheetCsv(sheet, org.name)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = timesheetFilename(sheet, org.name)
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="org-page">
      <div className="org-inline">
        <button onClick={() => setWeeksBack((w) => w + 1)} disabled={weeksBack >= MAX_WEEKS_BACK}>
          ‹ Earlier
        </button>
        <strong className="ts-week">{weekLabel(sheet)}</strong>
        <span className="org-note">
          {weeksBack === 0 ? 'This week' : weeksBack === 1 ? 'Last week' : `${weeksBack} weeks ago`}
        </span>
        <button onClick={() => setWeeksBack((w) => w - 1)} disabled={weeksBack === 0}>
          Later ›
        </button>
        <span className="shell-spacer" />
        <button onClick={download} disabled={sheet.rows.length === 0}>
          Download timesheet (CSV)
        </button>
      </div>

      {error && <p className="org-error" role="alert">{error}</p>}
      {loaded && !error && sheet.rows.length === 0 && <p className="org-note">No shifts this week.</p>}

      {sheet.rows.length > 0 && (
        <table className="org-table ts-table">
          <thead>
            <tr>
              <th scope="col">Worker</th>
              {DAY_LABELS.map((d) => (
                <th key={d} scope="col" className="ts-num">
                  {d}
                </th>
              ))}
              <th scope="col" className="ts-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r) => (
              <tr key={r.userId}>
                <td>
                  {r.name}
                  <div className="org-note">
                    {r.shifts.length} {r.shifts.length === 1 ? 'shift' : 'shifts'}
                    {r.onShift ? ' · on shift now' : ''}
                    {r.former ? ' · has left' : ''}
                  </div>
                </td>
                {r.days.map((m, i) => (
                  <td key={i} className={m > 0 ? 'ts-num' : 'ts-num ts-zero'}>
                    {m > 0 ? hours(m) : '–'}
                  </td>
                ))}
                <td className="ts-num ts-total">{hours(r.totalMinutes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>All workers</td>
              {DAY_LABELS.map((d, i) => (
                <td key={d} className="ts-num">
                  {hours(sheet.rows.reduce((t, r) => t + r.days[i], 0))}
                </td>
              ))}
              <td className="ts-num ts-total">{hours(sheet.totalMinutes)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <p className="org-note">
        Hours, Monday to Sunday in your time zone. Shift times only, never locations; managers see only the teams
        they lead. A shift counts up to 14 hours, when it ends by itself, and overnight shifts are split at
        midnight. Owners and admins also see people who have left, for the weeks they worked.
      </p>
    </div>
  )
}
