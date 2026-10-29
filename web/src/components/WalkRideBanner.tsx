import type { RideRequest, SafetyTimer, Walk } from '../lib/types'
import { formatClockTime, formatTimeLeft, timeAgo } from '../lib/format'

// Read-only, like SosBanner: walks, safety timers and ride requests are
// created and answered from the mobile app. An overdue walk/timer isn't
// repeated here — it has already raised a normal SOS, which SosBanner shows.
export function WalkRideBanner({
  walks,
  timers = [],
  rides,
}: {
  walks: Walk[]
  timers?: SafetyTimer[]
  rides: RideRequest[]
}) {
  const activeWalks = walks.filter((w) => w.status === 'active')
  const activeTimers = timers.filter((t) => t.status === 'active')
  const openRides = rides.filter((r) => r.status === 'open' || r.status === 'accepted')
  if (activeWalks.length === 0 && activeTimers.length === 0 && openRides.length === 0) return null

  return (
    <div className="sos-banner" role="status">
      {activeWalks.map((walk) => (
        <div key={walk.id} className="info-alert">
          <span className="sos-alert-title">
            🚶 {walk.profiles?.full_name ?? 'Someone'} is walking to {walk.place_name}
          </span>
          <span className="sos-alert-time">
            Due {formatClockTime(walk.expected_by)} · {formatTimeLeft(walk.expected_by)}
          </span>
        </div>
      ))}
      {activeTimers.map((timer) => (
        <div key={timer.id} className="info-alert">
          <span className="sos-alert-title">
            ⏱️ {timer.profiles?.full_name ?? 'Someone'} asked to be checked on
            {timer.label ? ` — ${timer.label}` : ''}
          </span>
          <span className="sos-alert-time">
            Due {formatClockTime(timer.expected_by)} · {formatTimeLeft(timer.expected_by)}
          </span>
        </div>
      ))}
      {openRides.map((ride) => (
        <div key={ride.id} className="info-alert info-alert-ride">
          <span className="sos-alert-title">
            {ride.status === 'accepted'
              ? `🚗 ${ride.driver?.full_name ?? 'Someone'} is picking up ${ride.requester?.full_name ?? 'someone'}`
              : `🚗 ${ride.requester?.full_name ?? 'Someone'} needs a ride`}
          </span>
          <span className="sos-alert-time">{timeAgo(ride.created_at)}</span>
        </div>
      ))}
    </div>
  )
}
