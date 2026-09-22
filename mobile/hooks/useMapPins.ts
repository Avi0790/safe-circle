import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { MapPin } from '@/lib/types';

// Active (not-yet-expired) meetup pins for a circle — see migration
// ...000036_map_pins.sql. Per-instance channel suffix for the same reason
// as useCircleMembers/useActiveWalks: more than one mounted screen can call
// this for the same circle.
export function useMapPins(circleId: string | null) {
  const [pins, setPins] = useState<MapPin[]>([]);
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;

  const load = useCallback(async () => {
    if (!circleId) {
      setPins([]);
      return;
    }
    const { data } = await supabase
      .from('map_pins')
      .select('id, circle_id, created_by, emoji, label, latitude, longitude, expires_at, created_at, profiles(full_name)')
      .eq('circle_id', circleId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    setPins((data as unknown as MapPin[]) ?? []);
  }, [circleId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!circleId) return;
    const channel = supabase
      .channel(`map-pins-${circleId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'map_pins', filter: `circle_id=eq.${circleId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, load, instanceId]);

  // A pin that's still in the list can quietly go stale (its expires_at
  // passes while this screen stays open) — refetch shortly after the
  // soonest one is due, same pattern useCircleMembers uses for sharing
  // windows, so a dead pin doesn't linger on the map until something else
  // triggers a reload.
  useEffect(() => {
    const now = Date.now();
    const upcoming = pins.map((p) => new Date(p.expires_at).getTime()).filter((t) => t > now);
    if (upcoming.length === 0) return;
    const timer = setTimeout(load, Math.min(...upcoming) - now + 1000);
    return () => clearTimeout(timer);
  }, [pins, load]);

  return { pins, refresh: load };
}
