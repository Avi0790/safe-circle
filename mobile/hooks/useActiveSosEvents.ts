import { useCallback, useEffect, useRef, useState } from 'react';
import { eventsMissingNames, fillSosNames, type SosDetailRow } from '@/lib/sosNames';
import { supabase } from '@/lib/supabase';
import type { SosEvent } from '@/lib/types';

// Unresolved SOS events visible to the caller — RLS already scopes this to
// "yourself, or anyone you share a circle with" (same rule as locations),
// so no circle filtering needed here. Called from more than one mounted
// screen (Map, Work, Crew), hence the per-instance channel suffix: supabase-js
// returns the SAME channel for the same name, and adding listeners to one
// that's already subscribed throws (see useActiveWalks).
export function useActiveSosEvents() {
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;
  const [events, setEvents] = useState<SosEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    // sos_events has two FKs to profiles (user_id, resolved_by), so the
    // embed needs an explicit relationship hint or PostgREST can't tell
    // which one to use (PGRST201: "more than one relationship was found").
    // Nested embed pulls each event's acknowledgements (who's seen it and
    // is responding) in the same request — see acknowledge_sos in
    // migration ...000030_sos_acknowledge.sql.
    const { data } = await supabase
      .from('sos_events')
      .select(
        '*, profiles!sos_events_user_id_fkey(full_name), sos_acknowledgements(user_id, created_at, profiles(full_name))',
      )
      .is('resolved_at', null)
      .order('created_at', { ascending: false });
    let loaded = (data as unknown as SosEvent[]) ?? [];
    // An SOS a manager oversees through an organization has no readable
    // profile for the sender (they aren't circle-mates), so ask for just the
    // names — see migration ...000055. Only when something is missing.
    const missing = eventsMissingNames(loaded);
    if (missing.length > 0) {
      const { data: names } = await supabase.rpc('org_sos_details', { p_event_ids: missing });
      loaded = fillSosNames(loaded, (names as SosDetailRow[] | null) ?? []);
    }
    setEvents(loaded);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`sos-events-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_events' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_acknowledgements' }, () =>
        load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, instanceId]);

  return { events, isLoading, refresh: load };
}
