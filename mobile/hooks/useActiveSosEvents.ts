import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { SosEvent } from '@/lib/types';

// Unresolved SOS events visible to the caller — RLS already scopes this to
// "yourself, or anyone you share a circle with" (same rule as locations),
// so no circle filtering needed here.
export function useActiveSosEvents() {
  const [events, setEvents] = useState<SosEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    // sos_events has two FKs to profiles (user_id, resolved_by), so the
    // embed needs an explicit relationship hint or PostgREST can't tell
    // which one to use (PGRST201: "more than one relationship was found").
    const { data } = await supabase
      .from('sos_events')
      .select('*, profiles!sos_events_user_id_fkey(full_name)')
      .is('resolved_at', null)
      .order('created_at', { ascending: false });
    setEvents((data as unknown as SosEvent[]) ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('sos-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_events' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  return { events, isLoading, refresh: load };
}
