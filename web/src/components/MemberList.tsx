import type { MemberWithLocation } from '../lib/types'

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function MemberList({ members }: { members: MemberWithLocation[] }) {
  return (
    <ul className="member-list">
      {members.map((member) => (
        <li key={member.id} className="member-row">
          <span className={`dot ${member.location ? 'dot-online' : 'dot-offline'}`} />
          <div className="member-info">
            <div className="member-name">{member.full_name}</div>
            <div className="member-meta">
              {member.location
                ? `Updated ${timeAgo(member.location.recorded_at)}${
                    member.location.battery_level != null
                      ? ` · ${Math.round(member.location.battery_level * 100)}% battery`
                      : ''
                  }`
                : 'No location shared yet'}
            </div>
          </div>
        </li>
      ))}
      {members.length === 0 && <li className="member-empty">No one in this circle yet.</li>}
    </ul>
  )
}
