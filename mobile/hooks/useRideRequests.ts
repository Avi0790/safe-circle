import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RideRequest } from '@/lib/types';

// An accepted ride stays visible for an hour (someone's on their way);
// open requests expire after 30 min — that half is enforced by accept_ride
// and applied to the display in RideBanner.
const LOOKBACK_MS = 60 * 60_000;

export function useRideRequests() {
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;

  const load = useCallback(async () => {
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
    // ride_requests has two FKs to profiles (requester and driver), so each
    // embed needs its relationship named.
    const { data } = await supabase
      .from('ride_requests')
      .select(
        '*, requester:profiles!ride_requests_user_id_fkey(full_name), driver:profiles!ride_requests_accepted_by_fkey(full_name)',
      )
      .in('status', ['open', 'accepted'])
      .gt('created_at', since)
      .order('created_at', { ascending: false });
    setRequests((data as unknown as RideRequest[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`ride-requests-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, instanceId]);

  return { requests, refresh: load };
}
