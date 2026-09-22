import type { MemberWithLocation } from '../lib/types'
import {
  formatClockTime,
  getShareStatus,
  isDriving,
  isLowBattery,
  isStale,
  isStatusActive,
  speedToMph,
  timeAgo,
} from '../lib/format'
import { formatDistanceMiles, haversineMeters } from '../lib/geo'
import type { Weather } from '../lib/weather'
import { Avatar } from './Avatar'

export function MemberList({
  members,
  selectedId,
  historyLoading,
  weather,
  onSelect,
  myUserId,
}: {
  members: MemberWithLocation[]
  selectedId?: string | null
  historyLoading?: boolean
  // Weather at the selected member's most recent location — see
  // Dashboard.tsx's loadHistory.
  weather?: Weather | null
  onSelect?: (userId: string) => void
  myUserId?: string | null
}) {
  const myLocation = members.find((m) => m.id === myUserId)?.location ?? null

  return (
    <ul className="member-list">
      {members.map((member) => {
        const shareStatus = getShareStatus(member.share_until)
        const stale = member.location != null && isStale(member.location.recorded_at)
        const status = !member.location ? 'offline' : stale ? 'stale' : 'online'
        const selected = member.id === selectedId
        const lowBattery = isLowBattery(member.location?.battery_level ?? null)
        const driving = member.location != null && isDriving(member.location.speed)
        const mph = member.location ? speedToMph(member.location.speed) : null
        const distanceMiles =
          myLocation && member.location && member.id !== myUserId
            ? formatDistanceMiles(
                haversineMeters(
                  myLocation.latitude,
                  myLocation.longitude,
                  member.location.latitude,
                  member.location.longitude,
                ),
              )
            : null
        return (
          <li
            key={member.id}
            className={`member-row${selected ? ' member-row-selected' : ''}`}
            onClick={member.location ? () => onSelect?.(member.id) : undefined}
            role={member.location ? 'button' : undefined}
            tabIndex={member.location ? 0 : undefined}
          >
            <div className="avatar-wrap">
              <Avatar id={member.id} name={member.full_name} url={member.avatar_url} />
              <span className={`dot dot-${status} dot-badge`} />
            </div>
            <div className="member-info">
              <div className="member-name">
                {member.full_name}
                {isStatusActive(member.status_expires_at) && member.status_emoji && (
                  <span className="status-chip">
                    {member.status_emoji}
                    {member.status_text ? ` ${member.status_text}` : ''}
                  </span>
                )}
              </div>
              <div className="member-meta">
                {shareStatus === 'ended' ? (
                  'Stopped sharing'
                ) : !member.location ? (
                  'No location shared yet'
                ) : selected ? (
                  historyLoading ? (
                    'Loading history…'
                  ) : (
                    <>
                      Showing location history — click to hide
                      {weather && ` · ${weather.emoji} ${weather.tempF}°F, ${weather.description}`}
                    </>
                  )
                ) : (
                  <>
                    {driving
                      ? `🚗 Driving${mph != null ? ` ${Math.round(mph)} mph` : ''}`
                      : `${stale ? 'Last seen' : 'Updated'} ${timeAgo(member.location.recorded_at)}`}
                    {stale && !driving ? ' — may not be current' : ''}
                    {distanceMiles && ` · ${distanceMiles} away`}
                    {member.location.battery_level != null && (
                      <span className={lowBattery ? 'low-battery' : undefined}>
                        {' · '}
                        {Math.round(member.location.battery_level * 100)}% battery
                        {lowBattery ? ' ⚠️' : ''}
                      </span>
                    )}
                    {shareStatus === 'window' && member.share_until
                      ? ` · sharing until ${formatClockTime(member.share_until)}`
                      : ''}
                  </>
                )}
              </div>
            </div>
          </li>
        )
      })}
      {members.length === 0 && <li className="member-empty">No one in this circle yet.</li>}
    </ul>
  )
}
