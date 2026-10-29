import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { SosEvent } from '../lib/types'
import { timeAgo } from '../lib/format'

// Unlike the circle dashboard's read-only banner, the people who oversee a
// crew are expected to respond from their desk: "on my way" tells the worker
// help is coming, and resolving ends the alert for everyone. The database
// (migration ...000051) only lets a worker's overseers do either.
export function OrgSosBanner({ events, onChanged }: { events: SosEvent[]; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (events.length === 0) return null

  async function acknowledge(id: number) {
    setError(null)
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('acknowledge_sos', { p_sos_event_id: id })
    setBusyId(null)
    if (rpcError) setError(rpcError.message)
    onChanged()
  }

  async function resolve(id: number) {
    setError(null)
    setBusyId(id)
    const { error: updateError } = await supabase
      .from('sos_events')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', id)
    setBusyId(null)
    if (updateError) setError(updateError.message)
    onChanged()
  }

  return (
    <div className="sos-banner" role="alert">
      {events.map((event) => (
        <div key={event.id} className="sos-alert">
          <span className="sos-alert-title">🆘 {event.profiles?.full_name ?? 'Someone'} needs help</span>
          {event.message && <span className="sos-alert-message">"{event.message}"</span>}
          {event.sos_acknowledgements.length > 0 && (
            <span className="sos-alert-message">
              👀 {event.sos_acknowledgements.map((a) => a.profiles?.full_name ?? 'Someone').join(', ')}{' '}
              {event.sos_acknowledgements.length === 1 ? 'is' : 'are'} on it
            </span>
          )}
          <span className="sos-alert-time">{timeAgo(event.created_at)}</span>
          <a
            className="org-link"
            target="_blank"
            rel="noopener noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${event.latitude}&mlon=${event.longitude}#map=16/${event.latitude}/${event.longitude}`}
          >
            Open location
          </a>
          <span className="org-inline">
            <button className="org-small" disabled={busyId === event.id} onClick={() => acknowledge(event.id)}>
              On my way
            </button>
            <button className="org-small" disabled={busyId === event.id} onClick={() => resolve(event.id)}>
              Resolve
            </button>
          </span>
        </div>
      ))}
      {error && <span className="sos-alert-message">{error}</span>}
    </div>
  )
}
