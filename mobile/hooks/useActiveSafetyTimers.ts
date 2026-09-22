import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { SafetyTimer } from '@/lib/types';

// Unfinished safety timers (see migration ...000040_safety_timer.sql —
// Walk me home's destination-less sibling) for you and everyone in your
// circles. Same per-instance channel suffix reasoning as useActiveWalks.
export function useActiveSafetyTimers() {
  const [timers, setTimers] = useState<SafetyTimer[]>([]);
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('safety_timers')
      .select('id, user_id, circle_id, label, expected_by, status, created_at, profiles(full_name)')
      .in('status', ['active', 'overdue'])
      .order('expected_by');
    setTimers((data as unknown as SafetyTimer[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`safety-timers-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'safety_timers' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, instanceId]);

  return { timers, refresh: load };
}
