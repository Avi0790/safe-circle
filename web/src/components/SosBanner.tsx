import type { SosEvent } from '../lib/types'
import { timeAgo } from '../lib/format'

// Read-only, matching the dashboard's design (Dashboard.tsx never inserts
// or updates): resolving an SOS is a mobile-only action. This is here so a
// parent watching the web dashboard — not the phone — still sees an active
// emergency immediately, instead of only ever seeing it in Expo Go.
export function SosBanner({ events }: { events: SosEvent[] }) {
  if (events.length === 0) return null

  return (
    <div className="sos-banner">
      {events.map((event) => (
        <div key={event.id} className="sos-alert">
          <span className="sos-alert-title">
            🆘 {event.profiles?.full_name ?? 'Someone'} needs help
          </span>
          {event.message && <span className="sos-alert-message">"{event.message}"</span>}
          <span className="sos-alert-time">{timeAgo(event.created_at)}</span>
        </div>
      ))}
    </div>
  )
}
