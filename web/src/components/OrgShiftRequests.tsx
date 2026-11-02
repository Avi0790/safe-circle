import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatClockTime } from '../lib/format'
import { t } from '../lib/i18n'
import { requestWhen, type ShiftRequest } from '../lib/schedule'

// Time off and "can't make this shift" waiting for an answer (migration
// ...000077), on the Schedule tab. Approving takes the worker off the
// planned shifts it covers; the worker is told either way.
export function OrgShiftRequests({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<ShiftRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('org_shift_requests', { p_org: orgId, p_pending_only: true })
    if (rpcError) setError(rpcError.message)
    else setRows(((data as ShiftRequest[]) ?? []).filter((r) => r.can_decide))
  }, [orgId])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`web-shift-requests-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_requests', filter: `org_id=eq.${orgId}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, orgId])

  async function decide(id: string, approve: boolean) {
    setBusy(id)
    setError(null)
    const { error: rpcError } = await supabase.rpc('decide_shift_request', { p_id: id, p_approve: approve })
    setBusy(null)
    if (rpcError) setError(rpcError.message)
    else onChanged()
    load()
  }

  if (rows.length === 0 && !error) return null
  return (
    <section className="org-card">
      <h3>{t('Waiting for you ({n})', { n: rows.length })}</h3>
      {error && <p className="org-error" role="alert">{t(error)}</p>}
      <table className="org-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.kind === 'time_off' ? '🏖️' : '🔁'} {r.worker_name ?? t('Worker')}
                <div className="org-note">{r.kind === 'time_off' ? t('Time off') : t("Can't make this shift")}</div>
              </td>
              <td>
                {requestWhen(r, (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), formatClockTime)}
                {r.note && <div className="org-note">“{r.note}”</div>}
              </td>
              <td className="ts-num">
                <button onClick={() => decide(r.id, false)} disabled={busy === r.id}>
                  {t('Decline')}
                </button>{' '}
                <button onClick={() => decide(r.id, true)} disabled={busy === r.id}>
                  {t('Approve')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
