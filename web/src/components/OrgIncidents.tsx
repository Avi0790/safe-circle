import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { OrgMembership } from '../lib/org'
import { formatClockTime, timeAgo } from '../lib/format'
import { t } from '../lib/i18n'

interface Incident {
  id: string
  reporter_name: string | null
  kind: string
  note: string
  latitude: number | null
  longitude: number | null
  photo_path: string | null
  status: 'open' | 'resolved'
  created_at: string
  can_resolve: boolean
}

const KINDS: Record<string, { emoji: string; label: string }> = {
  hazard: { emoji: '⚠️', label: 'Hazard' },
  near_miss: { emoji: '😮', label: 'Near miss' },
  injury: { emoji: '🩹', label: 'Injury' },
  other: { emoji: '📝', label: 'Other' },
}

// Incident and hazard reports from the crew (org_incidents, migration
// ...000072): owners and admins see all, a manager sees their teams'. Photos
// open through short-lived links; a position shows only if the worker was on
// shift when they reported.
export function OrgIncidents({ org }: { org: OrgMembership }) {
  const [status, setStatus] = useState<'open' | 'resolved'>('open')
  const [rows, setRows] = useState<Incident[] | null>(null)
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('org_incidents', { p_org: org.org_id, p_status: status })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setError(null)
    const list = (data as Incident[]) ?? []
    setRows(list)
    const urls: Record<string, string> = {}
    await Promise.all(
      list
        .filter((r) => r.photo_path)
        .map(async (r) => {
          const { data: signed } = await supabase.storage.from('incident-photos').createSignedUrl(r.photo_path!, 600)
          if (signed?.signedUrl) urls[r.id] = signed.signedUrl
        }),
    )
    setPhotos(urls)
  }, [org.org_id, status])

  useEffect(() => {
    load()
  }, [load])

  async function resolve(id: string) {
    setBusy(id)
    const { error: rpcError } = await supabase.rpc('resolve_incident', { p_id: id })
    setBusy(null)
    if (rpcError) setError(rpcError.message)
    await load()
  }

  return (
    <div className="org-page">
      <div className="org-inline">
        <select value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'resolved')} aria-label={t('Show')}>
          <option value="open">{t('Open')}</option>
          <option value="resolved">{t('Resolved')}</option>
        </select>
        <button className="link-button" onClick={load}>
          {t('Refresh')}
        </button>
      </div>
      {error && <p className="org-error" role="alert">{t(error)}</p>}
      {rows && rows.length === 0 && (
        <p className="org-note">{status === 'open' ? t('No open reports.') : t('No resolved reports yet.')}</p>
      )}
      {rows?.map((r) => {
        const kind = KINDS[r.kind] ?? KINDS.other
        return (
          <article key={r.id} className={`org-card incident-card${r.status === 'open' && r.kind === 'injury' ? ' incident-injury' : ''}`}>
            <h3>
              {kind.emoji} {t(kind.label)}
            </h3>
            <p className="org-note">
              {r.reporter_name ?? t('Someone')} · {timeAgo(r.created_at)} ({formatClockTime(r.created_at)})
            </p>
            <p>{r.note}</p>
            {photos[r.id] && (
              <a href={photos[r.id]} target="_blank" rel="noreferrer">
                <img className="incident-photo" src={photos[r.id]} alt={t('Photo from the report')} />
              </a>
            )}
            {r.latitude != null && r.longitude != null && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`} target="_blank" rel="noreferrer">
                {t('View on map ›')}
              </a>
            )}
            {r.status === 'open' && r.can_resolve && (
              <button onClick={() => resolve(r.id)} disabled={busy === r.id}>
                {busy === r.id ? t('Saving…') : t('Mark resolved')}
              </button>
            )}
          </article>
        )
      })}
    </div>
  )
}
