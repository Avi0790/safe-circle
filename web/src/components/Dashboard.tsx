import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  Circle,
  GeofenceEvent,
  LatestLocation,
  MemberWithLocation,
  Place,
  Profile,
  SosEvent,
} from '../lib/types'
import { MapView } from './MapView'
import { MemberList } from './MemberList'
import { ActivityFeed } from './ActivityFeed'
import { SosBanner } from './SosBanner'

// Read-only by design (proposal page 3: "no tracking happens from the
// web"). This component only ever selects from circles/locations/places/
// geofence_events - it never inserts or updates. Creating a place is
// mobile-only (see mobile/app/(app)/places.tsx).
export function Dashboard() {
  const [circles, setCircles] = useState<Circle[]>([])
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberWithLocation[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [events, setEvents] = useState<GeofenceEvent[]>([])
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadCircles() {
      const { data, error } = await supabase.from('circles').select('*').order('created_at')
      if (cancelled) return
      if (error) {
        setError(error.message)
      } else {
        setCircles(data ?? [])
        setSelectedCircleId((current) => current ?? data?.[0]?.id ?? null)
      }
      setLoading(false)
    }

    loadCircles()
    return () => {
      cancelled = true
    }
  }, [])

  const loadMembers = useCallback(async (circleId: string) => {
    setError(null)

    const { data: memberRows, error: memberError } = await supabase
      .from('circle_members')
      .select('user_id, profiles(id, full_name, avatar_url)')
      .eq('circle_id', circleId)

    if (memberError) {
      setError(memberError.message)
      return
    }

    const profiles = (memberRows ?? [])
      .map((row) => row.profiles as unknown as Profile)
      .filter(Boolean)

    const userIds = profiles.map((p) => p.id)
    if (userIds.length === 0) {
      setMembers([])
      return
    }

    const { data: locations, error: locError } = await supabase
      .from('latest_locations')
      .select('*')
      .in('user_id', userIds)

    if (locError) {
      setError(locError.message)
      return
    }

    const locationByUser = new Map<string, LatestLocation>(
      (locations ?? []).map((loc) => [loc.user_id, loc as LatestLocation]),
    )

    setMembers(
      profiles.map((profile) => ({
        ...profile,
        location: locationByUser.get(profile.id) ?? null,
      })),
    )
  }, [])

  useEffect(() => {
    if (!selectedCircleId) return
    loadMembers(selectedCircleId)
  }, [selectedCircleId, loadMembers])

  // Not circle-scoped (see backend/supabase/migrations/...000012_sos.sql):
  // RLS already limits this to "yourself, or anyone you share a circle
  // with" — same rule as locations — so it loads once, independent of
  // which circle is selected in the sidebar.
  const loadSosEvents = useCallback(async () => {
    const { data } = await supabase
      .from('sos_events')
      .select('*, profiles!sos_events_user_id_fkey(full_name)')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
    setSosEvents((data as unknown as SosEvent[]) ?? [])
  }, [])

  useEffect(() => {
    loadSosEvents()

    const channel = supabase
      .channel('sos-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_events' }, () =>
        loadSosEvents(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadSosEvents])

  const loadPlacesAndEvents = useCallback(async (circleId: string) => {
    const [placesRes, eventsRes] = await Promise.all([
      supabase.from('places').select('*').eq('circle_id', circleId).order('name'),
      supabase
        .from('geofence_events')
        .select('id, event_type, occurred_at, places(name), profiles(full_name)')
        .order('occurred_at', { ascending: false })
        .limit(20),
    ])
    if (placesRes.data) setPlaces(placesRes.data as Place[])
    if (eventsRes.data) setEvents(eventsRes.data as unknown as GeofenceEvent[])
  }, [])

  useEffect(() => {
    if (!selectedCircleId) return
    loadPlacesAndEvents(selectedCircleId)
  }, [selectedCircleId, loadPlacesAndEvents])

  // Live updates for the activity feed, same pattern as locations below.
  useEffect(() => {
    if (!selectedCircleId) return

    const channel = supabase
      .channel(`geofence-events-${selectedCircleId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'geofence_events' },
        () => {
          // The insert payload doesn't include the joined place/profile
          // names we display, so just refetch — this fires rarely enough
          // (only on an actual arrive/leave) that it's not worth hand
          // -rolling the join client-side.
          loadPlacesAndEvents(selectedCircleId)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedCircleId, loadPlacesAndEvents])

  // Live updates: whenever a circle-mate's location is inserted, patch it
  // into state directly instead of re-fetching everything.
  useEffect(() => {
    if (!selectedCircleId) return

    const memberIds = new Set(members.map((m) => m.id))

    const channel = supabase
      .channel(`locations-${selectedCircleId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'locations' },
        (payload) => {
          const loc = payload.new as LatestLocation
          if (!memberIds.has(loc.user_id)) return
          setMembers((prev) =>
            prev.map((m) => (m.id === loc.user_id ? { ...m, location: loc } : m)),
          )
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCircleId, members.length])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  if (loading) {
    return <div className="centered">Loading your circles…</div>
  }

  if (circles.length === 0) {
    return (
      <div className="centered">
        <p>You're not in any circles yet.</p>
        <p className="hint">Join or create one from the Safe Circle mobile app first.</p>
        <button onClick={handleSignOut}>Sign out</button>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Safe Circle</h1>
          <button className="link-button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>

        {circles.length > 1 && (
          <select
            value={selectedCircleId ?? ''}
            onChange={(e) => setSelectedCircleId(e.target.value)}
            className="circle-select"
          >
            {circles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {circles.length === 1 && <div className="circle-name">{circles[0].name}</div>}

        {error && <p className="error">{error}</p>}

        <SosBanner events={sosEvents} />
        <MemberList members={members} />
        <ActivityFeed events={events} />
      </aside>

      <main className="map-pane">
        <MapView members={members} places={places} />
      </main>
    </div>
  )
}
