import type { MemberWithLocation } from '../lib/types'
import { isLowBattery, isStale, timeAgo } from '../lib/format'
import { Avatar } from './Avatar'

export function MemberList({
  members,
  selectedId,
  historyLoading,
  onSelect,
}: {
  members: MemberWithLocation[]
  selectedId?: string | null
  historyLoading?: boolean
  onSelect?: (userId: string) => void
}) {
  return (
    <ul className="member-list">
      {members.map((member) => {
        const stale = member.location != null && isStale(member.location.recorded_at)
        const status = !member.location ? 'offline' : stale ? 'stale' : 'online'
        const selected = member.id === selectedId
        const lowBattery = isLowBattery(member.location?.battery_level ?? null)
        return (
          <li
            key={member.id}
            className={`member-row${selected ? ' member-row-selected' : ''}`}
            onClick={member.location ? () => onSelect?.(member.id) : undefined}
            role={member.location ? 'button' : undefined}
            tabIndex={member.location ? 0 : undefined}
          >
            <div className="avatar-wrap">
              <Avatar id={member.id} name={member.full_name} />
              <span className={`dot dot-${status} dot-badge`} />
            </div>
            <div className="member-info">
              <div className="member-name">{member.full_name}</div>
              <div className="member-meta">
                {!member.location ? (
                  'No location shared yet'
                ) : selected ? (
                  historyLoading ? (
                    'Loading history…'
                  ) : (
                    'Showing location history — click to hide'
                  )
                ) : (
                  <>
                    {stale ? 'Last seen' : 'Updated'} {timeAgo(member.location.recorded_at)}
                    {stale ? ' — may not be current' : ''}
                    {member.location.battery_level != null && (
                      <span className={lowBattery ? 'low-battery' : undefined}>
                        {' · '}
                        {Math.round(member.location.battery_level * 100)}% battery
                        {lowBattery ? ' ⚠️' : ''}
                      </span>
                    )}
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
