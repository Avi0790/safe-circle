import { getAvatarColor, getInitials } from '../lib/avatar'

export function Avatar({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: getAvatarColor(id),
      }}
    >
      {getInitials(name)}
    </div>
  )
}
