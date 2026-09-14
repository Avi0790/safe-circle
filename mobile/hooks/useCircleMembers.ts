import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LatestLocation, MemberWithLocation, Profile } from '@/lib/types';

// Fetches every member of a circle plus their latest known location, and
// keeps it live via a postgres_changes subscription on `locations`. Shared
// by the map tab and the member-list tab so both stay in sync.
export function useCircleMembers(circleId: string | null) {
  const [members, setMembers] = useState<MemberWithLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .channel(`locations-${circleId}`)
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

  return { members, isLoading, error, refresh: load };
}
