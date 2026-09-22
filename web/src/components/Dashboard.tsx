import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  Circle,
  GeofenceEvent,
  LatestLocation,
  MapPin,
  MemberWithLocation,
  Message,
  Place,
  Profile,
  RideRequest,
  SosEvent,
  Walk,
} from '../lib/types'
import { MapView } from './MapView'
import { MemberList } from './MemberList'
import { ActivityFeed } from './ActivityFeed'
import { ChatFeed } from './ChatFeed'
import { SosBanner } from './SosBanner'
import { WalkRideBanner } from './WalkRideBanner'
import { fetchWeather, type Weather } from '../lib/weather'

const MESSAGE_LIMIT = 50

const HISTORY_LIMIT = 100

// Read-only by design (proposal page 3: "no tracking happens from the
// web"). This component only ever selects from circles/locations/places/
// geofence_events - it never inserts or updates. Creating a place is
// mobile-only (see mobile/app/(app)/places.tsx).
export function Dashboard({ myUserId }: { myUserId: string }) {
  const [circles, setCircles] = useState<Circle[]>([])
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberWithLocation[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [events, setEvents] = useState<GeofenceEvent[]>([])
  const [presenceByPlace, setPresenceByPlace] = useState<Record<string, string[]>>({})
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([])
  const [walks, setWalks] = useState<Walk[]>([])
  const [rides, setRides] = useState<RideRequest[]>([])
  const [pins, setPins] = useState<MapPin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null)
  const [history, setHistory] = useState<LatestLocation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [weather, setWeather] = useState<Weather | null>(null)

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
      .select('user_id, profiles(id, full_name, avatar_url, share_until, status_emoji, status_text, status_expires_at)')
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
    const rows = (data as LatestLocation[] | null) ?? []
    setHistory([...rows].reverse())
    setHistoryLoading(false)

    // Weather at their most recent ping — a nice-to-have, fetched
    // separately so a slow or failed request never blocks the history
    // itself. See lib/weather.ts.
    setWeather(null)
    if (rows[0]) {
      fetchWeather(rows[0].latitude, rows[0].longitude).then(setWeather)
    }
  }, [])

  function toggleMemberHistory(userId: string) {
    if (historyMemberId === userId) {
      setHistoryMemberId(null)
      setHistory([])
      setWeather(null)
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
      .select(
        '*, profiles!sos_events_user_id_fkey(full_name), sos_acknowledgements(user_id, profiles(full_name))',
      )
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_acknowledgements' }, () =>
        loadSosEvents(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadSosEvents])

  // Walk-me-home timers and ride requests (mobile creates and answers them;
  // this dashboard, like for SOS, only shows them). RLS scopes both to
  // people you share a circle with.
  const loadWalksAndRides = useCallback(async () => {
    const [walkRes, rideRes] = await Promise.all([
      supabase
        .from('walks')
        .select('id, user_id, circle_id, place_name, expected_by, status, profiles(full_name)')
        .in('status', ['active', 'overdue'])
        .order('expected_by'),
      supabase
        .from('ride_requests')
        .select(
          'id, user_id, status, created_at, requester:profiles!ride_requests_user_id_fkey(full_name), driver:profiles!ride_requests_accepted_by_fkey(full_name)',
        )
        .in('status', ['open', 'accepted'])
        .gt('created_at', new Date(Date.now() - 60 * 60_000).toISOString())
        .order('created_at', { ascending: false }),
    ])
    setWalks((walkRes.data as unknown as Walk[]) ?? [])
    setRides((rideRes.data as unknown as RideRequest[]) ?? [])
  }, [])

  useEffect(() => {
    loadWalksAndRides()

    const channel = supabase
      .channel('walks-and-rides')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walks' }, () =>
        loadWalksAndRides(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests' }, () =>
        loadWalksAndRides(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadWalksAndRides])

  // Meetup pins (mobile-only to drop/remove; this dashboard only shows
  // them, same as everything else). Circle-scoped, unlike walks/rides.
  const loadPins = useCallback(async (circleId: string) => {
    const { data } = await supabase
      .from('map_pins')
      .select('id, circle_id, created_by, emoji, label, latitude, longitude, expires_at, created_at, profiles(full_name)')
      .eq('circle_id', circleId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    setPins((data as unknown as MapPin[]) ?? [])
  }, [])

  useEffect(() => {
    if (!selectedCircleId) return
    loadPins(selectedCircleId)

    const channel = supabase
      .channel(`map-pins-${selectedCircleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'map_pins', filter: `circle_id=eq.${selectedCircleId}` },
        () => loadPins(selectedCircleId),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedCircleId, loadPins])

  // In-circle chat (...000016_messages.sql) — read-only here, matching this
  // dashboard's design; sending is mobile-only
  // (mobile/app/(app)/(tabs)/chat.tsx). Circle-scoped, unlike SOS.
  const loadMessages = useCallback(async (circleId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('id, circle_id, user_id, body, latitude, longitude, created_at, profiles(full_name, avatar_url)')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: true })
      .limit(MESSAGE_LIMIT)
    setMessages((data as unknown as Message[]) ?? [])
  }, [])

  useEffect(() => {
    if (!selectedCircleId) return
    loadMessages(selectedCircleId)

    const channel = supabase
      .channel(`messages-${selectedCircleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `circle_id=eq.${selectedCircleId}`,
        },
        () => loadMessages(selectedCircleId),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedCircleId, loadMessages])

  // Someone changing their photo or name (mobile app) shows up here without
  // a reload. profiles' SELECT policy already limits delivery to yourself
  // and circle-mates.
  useEffect(() => {
    if (!selectedCircleId) return

    const channel = supabase
      .channel(`profiles-${selectedCircleId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => {
        loadMembers(selectedCircleId)
        loadMessages(selectedCircleId)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedCircleId, loadMembers, loadMessages])

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
        <WalkRideBanner walks={walks} rides={rides} />
        <MemberList
          members={members}
          selectedId={historyMemberId}
          historyLoading={historyLoading}
          weather={weather}
          onSelect={toggleMemberHistory}
          myUserId={myUserId}
        />
        <ActivityFeed events={events} />
        <ChatFeed messages={messages} />
      </aside>

      <main className="map-pane">
        <MapView
          members={members}
          places={places}
          history={history}
          presenceByPlace={presenceByPlace}
          pins={pins}
        />
      </main>
    </div>
  )
}
