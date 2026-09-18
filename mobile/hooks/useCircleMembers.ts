import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LatestLocation, MemberWithLocation, Profile } from '@/lib/types';

// Fetches every member of a circle plus their latest known location, and
// keeps it live via a postgres_changes subscription on `locations`. Called
// from the Map, Members, and Chat tabs — all mounted simultaneously, since
// React Navigation keeps tab screens alive in the background.
export function useCircleMembers(circleId: string | null) {
  const [members, setMembers] = useState<MemberWithLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // supabase.channel(topic) returns the SAME channel object for a repeated
  // topic string instead of a fresh one — with three tabs calling this hook
  // for the same circle at once, two instances racing to .channel() the
  // identical topic means the second's .on() call lands on a channel the
  // first has already .subscribe()'d, which throws ("cannot add
  // postgres_changes callbacks... after subscribe()"). A random per-instance
  // suffix keeps each mounted instance's channels independent.
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;

  const load = useCallback(async () => {
    if (!circleId) {
      setMembers([]);
      setIsLoading(false);
      return;
    }
    setError(null);

    const { data: memberRows, error: memberError } = await supabase
      .from('circle_members')
      .select('user_id, profiles(id, full_name, avatar_url)')
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

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!circleId) return;
    const memberIds = new Set(members.map((m) => m.id));

    const channel = supabase
      .channel(`locations-${circleId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'locations' },
        (payload) => {
          const loc = payload.new as LatestLocation;
          if (!memberIds.has(loc.user_id)) return;
          setMembers((prev) =>
            prev.map((m) => (m.id === loc.user_id ? { ...m, location: loc } : m)),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, members.length]);

  // circle_members is already in the realtime publication (see
  // ...000005_realtime.sql) but nothing was subscribed to it — the roster
  // itself (someone joining, or using the leave/delete-circle actions in
  // Settings) never updated live, only individual members' locations did.
  // A full refetch is simplest here: membership changes are rare, and this
  // join needs the same profiles/latest_locations lookups load() already
  // does, so there's nothing worth patching in incrementally.
  useEffect(() => {
    if (!circleId) return;
    const channel = supabase
      .channel(`circle-members-${circleId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'circle_members', filter: `circle_id=eq.${circleId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, load]);

  return { members, isLoading, error, refresh: load };
}
