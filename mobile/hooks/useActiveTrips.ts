import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { SharedTrip } from '@/lib/sharedTrips';

// Live shared trips from your circles, newest first. RLS already limits this to
// people you share a circle with who haven't hidden from you and are sharing.
// May be mounted by more than one screen at once, hence the per-instance
// channel name (supabase-js hands back the SAME channel for the same name, and
// adding listeners to a subscribed one throws; see useActiveSosEvents).
export function useActiveTrips() {
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;
  const [trips, setTrips] = useState<SharedTrip[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('shared_trips')
      .select('*, profiles(full_name)')
      .eq('status', 'active')
      .order('started_at', { ascending: false });
    setTrips((data as unknown as SharedTrip[] | null) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`shared-trips-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_trips' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, instanceId]);

  return { trips, refresh: load };
}
