import { useEffect, useState } from 'react'
import { getAvatarColor, getInitials, isSafeAvatarUrl } from '../lib/avatar'

// Profile photo when there is one, colored initials otherwise (and if the
// photo fails to load).
export function Avatar({
  id,
  name,
  url,
  size = 32,
}: {
  id: string
  name: string
  url?: string | null
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])

  const color = getAvatarColor(id)
  if (isSafeAvatarUrl(url) && !failed) {
    return (
      <img
        className="avatar"
        src={url}
        alt={`${name}'s photo`}
        width={size}
        height={size}
        style={{ width: size, height: size, backgroundColor: color, objectFit: 'cover' }}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: color }}>
      {getInitials(name)}
    </div>
  )
}
