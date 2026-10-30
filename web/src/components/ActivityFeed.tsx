import type { GeofenceEvent } from '../lib/types'
import { timeAgo } from '../lib/format'
import { placeIcon } from '../lib/places'
import { t } from '../lib/i18n'

export function ActivityFeed({ events }: { events: GeofenceEvent[] }) {
  return (
    <div className="activity-feed">
      <h2 className="sidebar-section-title">{t('Recent activity')}</h2>
      <ul className="activity-list">
        {events.map((event) => (
          <li key={event.id} className="activity-row">
            <span>
              {event.profiles?.full_name ?? 'Someone'}{' '}
              {event.event_type === 'arrived' ? 'arrived at' : 'left'}{' '}
              <strong>
                {placeIcon(event.places?.name ?? '')} {event.places?.name ?? 'a place'}
              </strong>
            </span>
            <span className="activity-time">{timeAgo(event.occurred_at)}</span>
          </li>
        ))}
        {events.length === 0 && <li className="activity-empty">{t('Nothing yet.')}</li>}
      </ul>
    </div>
  )
}
