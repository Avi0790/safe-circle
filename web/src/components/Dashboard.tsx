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

const HISTORY_LIMIT = 100

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
  const [presenceByPlace, setPresenceByPlace] = useState<Record<string, string[]>>({})
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null)
  const [history, setHistory] = useState<LatestLocation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

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
    // Switching circles can change who's even visible; drop any history
    // trail from the previous one rather than leave a stale selection.
    setHistoryMemberId(null)
    setHistory([])
  }, [selectedCircleId, loadMembers])

  // circle_members is already in the realtime publication but nothing
  // subscribed to it — the roster itself (someone joining, or using the
  // mobile app's leave/delete-circle actions) never updated live here,
  // only individual members' locations did. Full refetch: membership
  // changes are rare, and loadMembers already does the profiles +
  // latest_locations join this would need anyway.
  useEffect(() => {
    if (!selectedCircleId) return

    const channel = supabase
      .channel(`circle-members-${selectedCircleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'circle_members',
          filter: `circle_id=eq.${selectedCircleId}`,
        },
        () => loadMembers(selectedCircleId),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedCircleId, loadMembers])

  // Location history (parity with the mobile app's member/[userId] screen —
  // `locations` is already append-only, so this is purely a new read, no
  // backend changes). Drawn as a trail on the same map rather than a
  // separate screen, since this dashboard is built around one shared map.
  const loadHistory = useCallback(async (userId: string) => {
    setHistoryLoading(true)
    const { data } = await supabase
      .from('locations')
      .select('id, user_id, latitude, longitude, accuracy, battery_level, recorded_at')
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    setHistory(((data as LatestLocation[] | null) ?? []).reverse())
    setHistoryLoading(false)
  }, [])

  function toggleMemberHistory(userId: string) {
    if (historyMemberId === userId) {
      setHistoryMemberId(null)
      setHistory([])
      return
    }
    setHistoryMemberId(userId)
    loadHistory(userId)
  }

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
    const loadedPlaces = (placesRes.data as Place[]) ?? []
    if (placesRes.data) setPlaces(loadedPlaces)
    if (eventsRes.data) setEvents(eventsRes.data as unknown as GeofenceEvent[])

    // "Here now" — place_membership_state (...000006_push_and_geofencing.sql)
    // is kept live-accurate by evaluate_geofences() on every location
    // insert but wasn't read by any client until now, on either app; only
    // the historical arrive/leave feed above existed.
    if (loadedPlaces.length === 0) {
      setPresenceByPlace({})
      return
    }
    const { data: presence } = await supabase
      .from('place_membership_state')
      .select('place_id, profiles(full_name)')
      .eq('is_inside', true)
      .in(
        'place_id',
        loadedPlaces.map((p) => p.id),
      )
    const byPlace: Record<string, string[]> = {}
    for (const row of (presence ?? []) as unknown as {
      place_id: string
      profiles: { full_name: string } | null
    }[]) {
      const name = row.profiles?.full_name
      if (!name) continue
      ;(byPlace[row.place_id] ??= []).push(name)
    }
    setPresenceByPlace(byPlace)
  }, [])

  useEffect(() => {
    if (!selectedCircleId) return
    loadPlacesAndEvents(selectedCircleId)
  }, [selectedCircleId, loadPlacesAndEvents])

  // Live: refetch on any is_inside transition for places in view.
  useEffect(() => {
    if (!selectedCircleId) return
    const channel = supabase
      .channel(`place-membership-${selectedCircleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'place_membership_state' },
        () => loadPlacesAndEvents(selectedCircleId),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
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
        <MemberList
          members={members}
          selectedId={historyMemberId}
          historyLoading={historyLoading}
          onSelect={toggleMemberHistory}
        />
        <ActivityFeed events={events} />
      </aside>

      <main className="map-pane">
        <MapView
          members={members}
          places={places}
          history={history}
          presenceByPlace={presenceByPlace}
        />
      </main>
    </div>
  )
}
