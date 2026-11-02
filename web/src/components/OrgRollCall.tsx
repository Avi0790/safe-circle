import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import { formatClockTime, timeAgo } from '../lib/format'
import { t } from '../lib/i18n'
import { rollCallTally, type RollCallPerson, type RollCallSummary } from '../lib/rollCall'

// "Is everyone OK?" (migration ...000075): ask everyone you oversee who's on
// shift, then watch the answers come in, the people who need help first.
export function OrgRollCall({ org }: { org: OrgMembership }) {
  const [list, setList] = useState<RollCallSummary[] | null>(null)
  const [people, setPeople] = useState<RollCallPerson[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = list?.find((r) => !r.closed_at && r.can_close) ?? null

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('org_roll_calls_list', { p_org: org.org_id, p_limit: 20 })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const rows = (data as RollCallSummary[]) ?? []
    setList(rows)
    const live = rows.find((r) => !r.closed_at && r.can_close)
    if (live) {
      const status = await supabase.rpc('roll_call_status', { p_id: live.id })
      setPeople((status.data as RollCallPerson[]) ?? [])
    } else setPeople([])
  }, [org.org_id])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`web-roll-call-${org.org_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_roll_call_members' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_roll_calls', filter: `org_id=eq.${org.org_id}` }, () => load())
      .subscribe()
    const id = setInterval(load, 15_000) // in case Realtime drops
    return () => {
      clearInterval(id)
      supabase.removeChannel(channel)
    }
  }, [load, org.org_id])

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('start_roll_call', { p_org: org.org_id, p_note: note.trim() || null })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setNote('')
    load()
  }

  async function close(r: RollCallSummary) {
    const { waiting } = rollCallTally(r)
    const question = waiting > 0 ? t("Close the roll call? {n} still haven't answered.", { n: waiting }) : t('Close the roll call?')
    if (!window.confirm(question)) return
    const { error: rpcError } = await supabase.rpc('close_roll_call', { p_id: r.id })
    if (rpcError) setError(rpcError.message)
    load()
  }

  const past = (list ?? []).filter((r) => r.id !== open?.id).slice(0, 10)

  return (
    <div className="org-page">
      {error && <p className="org-error" role="alert">{t(error)}</p>}

      {list && !open && (
        <form className="org-card rollcall-start" onSubmit={start}>
          <h3>{t('Is everyone OK?')}</h3>
          <p className="org-note">
            {t('Asks everyone you oversee who is on shift right now to tap "I\'m safe" or "I need help". Anyone who hasn\'t answered in 5 minutes is asked again, and you\'re told who.')}
          </p>
          <div className="org-inline">
            <input
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Storm warning. Get inside and check in.')}
              aria-label={t('Message (optional)')}
              className="rollcall-note"
            />
            <button type="submit" disabled={busy}>
              {busy ? t('Sending…') : `📣 ${t('Start roll call')}`}
            </button>
          </div>
        </form>
      )}

      {open && (
        <section className="org-card">
          <div className="pf-tiles" aria-live="polite">
            <div className="pf-tile">
              <span className="pf-label">{t('safe')}</span>
              <span className="pf-value">{open.safe} / {open.asked}</span>
            </div>
            <div className="pf-tile">
              <span className="pf-label">{t('need help')}</span>
              <span className={open.help > 0 ? 'pf-value pf-warn' : 'pf-value'}>{open.help}</span>
            </div>
            <div className="pf-tile">
              <span className="pf-label">{t('no answer')}</span>
              <span className="pf-value">{rollCallTally(open).waiting}</span>
            </div>
          </div>
          <p className="org-note">
            {t('Started {time}', { time: formatClockTime(open.created_at) })}
            {open.note ? ` · “${open.note}”` : ''}
          </p>
          <table className="org-table">
            <tbody>
              {people.map((p) => (
                <tr key={p.user_id} className={p.answer === 'help' ? 'rollcall-help' : undefined}>
                  <td>
                    {p.answer === 'help' ? '🆘' : p.answer === 'safe' ? '✅' : '⏳'} {p.full_name ?? t('Worker')}
                  </td>
                  <td>
                    {p.answer === 'help'
                      ? t('Needs help · {ago}', { ago: timeAgo(p.answered_at!) })
                      : p.answer === 'safe'
                        ? t('Safe · {ago}', { ago: timeAgo(p.answered_at!) })
                        : t('No answer yet')}
                  </td>
                  <td className="ts-num">
                    {p.latitude != null && p.longitude != null && (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`} target="_blank" rel="noreferrer">
                        {t('View on map ›')}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => close(open)}>{t('Close roll call')}</button>
        </section>
      )}

      {past.length > 0 && (
        <section className="org-block">
          <h3>{t('Earlier roll calls')}</h3>
          <table className="org-table">
            <tbody>
              {past.map((r) => {
                const tl = rollCallTally(r)
                return (
                  <tr key={r.id}>
                    <td>{timeAgo(r.created_at)}</td>
                    <td>{r.started_by_name ?? ''}</td>
                    <td>{t('{safe} of {asked} safe · {help} need help · {waiting} no answer', { safe: r.safe, asked: r.asked, help: r.help, waiting: tl.waiting })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
