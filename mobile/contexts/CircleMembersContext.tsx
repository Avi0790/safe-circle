import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { LatestLocation, MemberWithLocation, Profile } from '@/lib/types';

interface CircleMembersValue {
  members: MemberWithLocation[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const CircleMembersContext = createContext<CircleMembersValue>({
  members: [],
  isLoading: true,
  error: null,
  refresh: async () => {},
});

// Realtime bursts (a profile update, an arrival that also flips a status,
// a membership change) often land as several events within a moment;
// refetching once per burst instead of once per event.
const RELOAD_DEBOUNCE_MS = 400;

// The one place the circle's members + their latest locations are fetched
// and kept live. This used to be a hook that the Map, Members and Chat tabs
// each ran their own copy of — and React Navigation keeps all three mounted
// — so every profile/membership change refetched everything three times over
// twelve realtime channels. One provider, one set of channels: the screens
// just read the result (see hooks/useCircleMembers.ts).
export function CircleMembersProvider({
  circleId,
  children,
}: {
  circleId: string | null;
  children: ReactNode;
}) {
  const [members, setMembers] = useState<MemberWithLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!circleId) {
      setMembers([]);
      setIsLoading(false);
      return;
    }
    setError(null);

    const { data: memberRows, error: memberError } = await supabase
      .from('circle_members')
      .select(
        'user_id, profiles(id, full_name, avatar_url, share_until, status_emoji, status_text, status_expires_at, phone_number)',
      )
      .eq('circle_id', circleId);

    if (memberError) {
      setError(memberError.message);
      setIsLoading(false);
      return;
    }

    const profiles = (memberRows ?? [])
      .map((row) => row.profiles as unknown as Profile)
      .filter(Boolean);

    const userIds = profiles.map((p) => p.id);
    if (userIds.length === 0) {
      setMembers([]);
      setIsLoading(false);
      return;
    }

    const { data: locations, error: locError } = await supabase
      .from('latest_locations')
      .select('*')
      .in('user_id', userIds);

    if (locError) {
      setError(locError.message);
      setIsLoading(false);
      return;
    }

    const locationByUser = new Map<string, LatestLocation>(
      (locations ?? []).map((loc) => [loc.user_id, loc as LatestLocation]),
    );

    setMembers(
      profiles.map((profile) => ({
        ...profile,
        location: locationByUser.get(profile.id) ?? null,
      })),
    );
    setIsLoading(false);
  }, [circleId]);

  const scheduleLoad = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      load();
    }, RELOAD_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    setIsLoading(true);
    load();
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [load]);

  // One channel for everything this circle needs. New location pings patch
  // the one member in place; anything that changes who's here or how they
  // look (membership, a profile edit) triggers a single debounced refetch.
  useEffect(() => {
    if (!circleId) return;
    const channel = supabase
      .channel(`circle-members-live-${circleId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, (payload) => {
        const loc = payload.new as LatestLocation;
        setMembers((prev) =>
          // No match -> return the same array, so unrelated pings (someone
          // outside this circle) don't re-render anything.
          prev.some((m) => m.id === loc.user_id)
            ? prev.map((m) => (m.id === loc.user_id ? { ...m, location: loc } : m))
            : prev,
        );
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'circle_members', filter: `circle_id=eq.${circleId}` },
        scheduleLoad,
      )
      // profiles has no circle_id to filter on, but its SELECT policy
      // already limits delivery to yourself and circle-mates.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, scheduleLoad)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, scheduleLoad]);

  // A sharing window ending changes nothing a client is told about — the
  // person's location rows just stop being readable — so refetch when the
  // soonest window is due to close, instead of leaving their pin on the map.
  useEffect(() => {
    const now = Date.now();
    const upcoming = members
      .map((m) => (m.share_until ? new Date(m.share_until).getTime() : null))
      .filter((t): t is number => t != null && t > now);
    if (upcoming.length === 0) return;
    const timer = setTimeout(load, Math.min(...upcoming) - now + 1000);
    return () => clearTimeout(timer);
  }, [members, load]);

  return (
    <CircleMembersContext.Provider value={{ members, isLoading, error, refresh: load }}>
      {children}
    </CircleMembersContext.Provider>
  );
}

export function useCircleMembersContext() {
  return useContext(CircleMembersContext);
}
