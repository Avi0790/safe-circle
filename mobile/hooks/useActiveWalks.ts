import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { cancelWalkReminder } from '@/lib/walkReminder';
import type { Walk } from '@/lib/types';

// Unfinished walks (timer running, or timer ran out and not yet resolved)
// for you and everyone in your circles — RLS already scopes it. Called from
// more than one mounted screen, hence the per-instance channel suffix (see
// the note in useCircleMembers).
export function useActiveWalks() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [walks, setWalks] = useState<Walk[]>([]);
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('walks')
      .select('id, user_id, circle_id, place_id, place_name, expected_by, status, created_at, profiles(full_name)')
      .in('status', ['active', 'overdue'])
      .order('expected_by');
    const next = (data as unknown as Walk[]) ?? [];
    setWalks(next);
    // The walk can end without this phone doing anything (arriving is
    // detected server-side) — drop the "timer ending soon" reminder then,
    // or it would fire for a walk that's already over.
    if (userId && !next.some((w) => w.user_id === userId)) cancelWalkReminder();
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`walks-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walks' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, instanceId]);

  return { walks, refresh: load };
}
