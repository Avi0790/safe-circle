import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoadReport } from '@/lib/roadReports';
import { supabase } from '@/lib/supabase';

// Live road reports from people whose location you can see. RLS already
// limits this to circle-mates who are sharing and haven't hidden from you,
// and to reports that haven't expired. Per-instance channel name, as in
// useActiveTrips.
export function useRoadReports(enabled = true) {
  const instanceId = useRef(Math.random().toString(36).slice(2, 10)).current;
  const [reports, setReports] = useState<RoadReport[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('road_reports')
      .select('id, reporter_id, kind, latitude, longitude, created_at, expires_at')
      .order('created_at', { ascending: false });
    setReports((data as RoadReport[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const channel = supabase
      .channel(`road-reports-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'road_reports' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, load, instanceId]);

  return { reports, refresh: load };
}
