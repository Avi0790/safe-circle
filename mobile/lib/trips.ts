import { supabase } from '@/lib/supabase';

export interface Trip {
  tripId: number;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  distanceMeters: number;
  maxSpeedMps: number | null;
  avgSpeedMps: number | null;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
}

interface TripRow {
  trip_id: number;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  distance_meters: number;
  max_speed_mps: number | null;
  avg_speed_mps: number | null;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number;
  end_longitude: number;
}

// Real trips — start, end, duration, distance, top speed — built from the
// same location pings the live map already collects (backend's get_trips(),
// migration ...000047_drive_reports.sql). This is Safe Circle's answer to
// Life360's paid Driver Reports, minus the paywall: a maximal run of pings
// no more than 15 min apart that includes at least one driving-speed ping.
export async function fetchTrips(userId: string, days = 30, limit = 20): Promise<Trip[]> {
  const { data, error } = await supabase.rpc('get_trips', {
    p_user_id: userId,
    p_days: days,
    p_limit: limit,
  });
  if (error || !data) return [];
  return (data as TripRow[]).map((r) => ({
    tripId: r.trip_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    distanceMeters: r.distance_meters,
    maxSpeedMps: r.max_speed_mps,
    avgSpeedMps: r.avg_speed_mps,
    startLatitude: r.start_latitude,
    startLongitude: r.start_longitude,
    endLatitude: r.end_latitude,
    endLongitude: r.end_longitude,
  }));
}

// "42 min" / "1 h 5 min" — same convention as format.ts's formatTimeLeft,
// just off a plain duration instead of a deadline offset from now.
export function formatTripDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function formatTripDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
