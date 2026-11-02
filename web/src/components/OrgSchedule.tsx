import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import type { RosterMember } from '../lib/crew'
import { formatClockTime } from '../lib/format'
import { t } from '../lib/i18n'
import { byDay, dateInput, planVsActual, SHIFT_LENGTHS, shiftFromInputs, statusInfo, type ScheduleRow } from '../lib/schedule'
import { hours, weekLabel, weekStart } from '../lib/timesheet'
import { OrgShiftRequests } from './OrgShiftRequests'

// Plan shifts ahead (migration ...000074) and see each against the real
// clock-in: upcoming, on time, late, missed or worked. Managers plan only the
// workers on teams they lead. The worker is notified, and their phone reminds
// them half an hour before it starts.
export function OrgSchedule({ org }: { org: OrgMembership }) {
  const [weeksBack, setWeeksBack] = useState(0) // negative = weeks ahead
  const [rows, setRows] = useState<ScheduleRow[] | null>(null)
  const [workers, setWorkers] = useState<RosterMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const tomorrow = new Date(Date.now() + 86_400_000)
  const [worker, setWorker] = useState('')
  const [date, setDate] = useState(dateInput(tomorrow))
  const [time, setTime] = useState('07:00')
  const [length, setLength] = useState(8)
  const [note, setNote] = useState('')

  const start = useMemo(() => weekStart(new Date(), weeksBack), [weeksBack])
  const end = useMemo(() => new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7), [start])

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('org_schedule', {
      p_org: org.org_id,
      p_from: start.toISOString(),
      p_to: end.toISOString(),
    })
    if (rpcError) setError(rpcError.message)
    else {
      setError(null)
      setRows((data as ScheduleRow[]) ?? [])
    }
  }, [org.org_id, start, end])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    supabase.rpc('org_roster', { p_org: org.org_id }).then(({ data }) => {
      const list = ((data as RosterMember[] | null) ?? []).filter(
        (m) => m.role === 'worker' && m.status === 'active' && m.consented_at,
      )
      setWorkers(list.sort((a, b) => a.full_name.localeCompare(b.full_name)))
    })
  }, [org.org_id])

  const totals = planVsActual(rows ?? [])
  const shift = shiftFromInputs(date, time, length)

  async function plan(e: React.FormEvent) {
    e.preventDefault()
    if (!worker || !shift) return
    setBusy('plan')
    const { error: rpcError } = await supabase.rpc('schedule_shift', {
      p_org: org.org_id,
      p_user: worker,
      p_starts: shift.starts.toISOString(),
      p_ends: shift.ends.toISOString(),
      p_note: note.trim() || null,
    })
    setBusy(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setNote('')
    await load()
  }

  async function cancel(r: ScheduleRow) {
    if (!window.confirm(t('Cancel {name}\'s shift on {day}?', { name: r.worker_name ?? t('Worker'), day: new Date(r.starts_at).toLocaleDateString() }))) return
    setBusy(r.id)
    const { error: rpcError } = await supabase.rpc('cancel_scheduled_shift', { p_id: r.id })
    setBusy(null)
    if (rpcError) setError(rpcError.message)
    await load()
  }

  return (
    <div className="org-page">
      <div className="org-inline">
        <button onClick={() => setWeeksBack((w) => w + 1)} disabled={weeksBack >= 8}>
          {t('‹ Earlier')}
        </button>
        <strong className="ts-week">{weekLabel({ weekStart: start })}</strong>
        <span className="org-note">
          {weeksBack === 0 ? t('This week') : weeksBack === -1 ? t('Next week') : weeksBack === 1 ? t('Last week') : ''}
        </span>
        <button onClick={() => setWeeksBack((w) => w - 1)} disabled={weeksBack <= -3}>
          {t('Later ›')}
        </button>
      </div>

      <OrgShiftRequests orgId={org.org_id} onChanged={load} />

      <form className="org-card schedule-form" onSubmit={plan}>
        <h3>{t('Plan a shift')}</h3>
        {workers.length === 0 ? (
          <p className="org-note">{t('Once workers have joined and accepted, you can plan their shifts here.')}</p>
        ) : (
          <div className="org-inline">
            <label>
              {t('Who')}
              <select value={worker} onChange={(e) => setWorker(e.target.value)} required>
                <option value="">{t('Choose a worker')}</option>
                {workers.map((w) => (
                  <option key={w.user_id} value={w.user_id}>
                    {w.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Day')}
              <input type="date" value={date} min={dateInput(new Date())} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label>
              {t('Starts')}
              <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} required />
            </label>
            <label>
              {t('Length')}
              <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
                {SHIFT_LENGTHS.map((h) => (
                  <option key={h} value={h}>
                    {t('{n} h', { n: h })}
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-note">
              {t('Note (optional)')}
              <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t('Where to go, what to bring')} />
            </label>
            <button type="submit" disabled={!worker || !shift || busy === 'plan'}>
              {busy === 'plan' ? t('Saving…') : t('Save shift')}
            </button>
          </div>
        )}
      </form>

      {error && <p className="org-error" role="alert">{t(error)}</p>}

      {rows && rows.length > 0 && (
        <div className="pf-tiles">
          <div className="pf-tile">
            <span className="pf-label">{t('hours planned')}</span>
            <span className="pf-value">{hours(totals.plannedMinutes)}</span>
          </div>
          <div className="pf-tile">
            <span className="pf-label">{t('hours worked')}</span>
            <span className="pf-value">{hours(totals.workedMinutes)}</span>
          </div>
          <div className="pf-tile">
            <span className="pf-label">{t('late or missed')}</span>
            <span className={totals.late + totals.missed > 0 ? 'pf-value pf-warn' : 'pf-value'}>{totals.late + totals.missed}</span>
          </div>
        </div>
      )}

      {rows && rows.length === 0 && <p className="org-note">{t('No shifts planned this week.')}</p>}

      {byDay(rows ?? []).map((g) => (
        <section key={g.day.toISOString()} className="org-card">
          <h3>{g.day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
          <table className="org-table">
            <tbody>
              {g.rows.map((r) => {
                const s = statusInfo(r.status)
                return (
                  <tr key={r.id}>
                    <td>{r.worker_name ?? t('Worker')}</td>
                    <td>
                      {formatClockTime(r.starts_at)} – {formatClockTime(r.ends_at)}
                      {r.note && <div className="org-note">{r.note}</div>}
                    </td>
                    <td>
                      <span className={`schedule-status schedule-${s.tone}`}>{t(s.label)}</span>
                      {r.clocked_in_at && (
                        <div className="org-note">{t('clocked in {time}', { time: formatClockTime(r.clocked_in_at) })}</div>
                      )}
                    </td>
                    <td className="ts-num">
                      {new Date(r.starts_at).getTime() > Date.now() && (
                        <button className="link-button" onClick={() => cancel(r)} disabled={busy === r.id}>
                          {t('Cancel shift')}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}

      <p className="org-note">
        {t('Workers get a notification when a shift is planned or cancelled, and a reminder on their phone half an hour before it starts. Late means clocked in more than 10 minutes after the start; missed means no clock-in within an hour.')}
      </p>
    </div>
  )
}
