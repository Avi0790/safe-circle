import { useEffect, useState } from 'react'
import { liveTripsOfOthers, tripEtaText, type SharedTrip } from '../lib/sharedTrips'

// Read-only, like WalkRideBanner: trips are started and ended from the mobile
// app. Shows who in the selected circle is driving somewhere and when they
// expect to arrive; it disappears when they arrive, stop sharing, or their
// phone goes quiet.
export function TripBanner({ trips, myUserId }: { trips: SharedTrip[]; myUserId: string }) {
  const [now, setNow] = useState(() => Date.now())

  // Keeps "in about 12 min" counting down between the driver's updates.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const visible = liveTripsOfOthers(trips, myUserId, now)
  if (visible.length === 0) return null

  return (
    <div className="sos-banner">
      {visible.map((trip) => (
        <div key={trip.id} className="info-alert">
          <span className="sos-alert-title">
            🚗 {trip.profiles?.full_name ?? 'Someone'} is heading to {trip.destination}
          </span>
          <span className="sos-alert-time">{tripEtaText(trip.eta, now)}</span>
        </div>
      ))}
    </div>
  )
}
