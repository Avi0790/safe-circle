import { supabase } from '@/lib/supabase';
import {
  getShareUntil,
  isTrackingActive,
  setShareUntil,
  startBackgroundTracking,
  stopBackgroundTracking,
} from '@/lib/locationTracking';

// Temporary sharing: share for a fixed window instead of until you remember
// to turn it off. The window is set on the server (profiles.share_until, via
// set_share_window, so a phone with a wrong clock can't stretch it) and is
// enforced there — see migration ...000025_temporary_sharing.sql. The
// timers on the phone only stop it tracking promptly.
export interface ShareDuration {
  label: string;
  // null = share until you turn it off.
  minutes: number | null;
}

export const SHARE_DURATIONS: ShareDuration[] = [
  { label: 'Until I stop', minutes: null },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '8 hours', minutes: 480 },
];

export type StartSharingResult =
  | { ok: true; backgroundGranted: boolean; until: string | null }
  | { ok: false; reason: string };

export async function startSharing(minutes: number | null): Promise<StartSharingResult> {
  // Window first, then tracking: once a previous window has expired the
  // server refuses pings, so starting to track before reopening it would
  // just be rejected.
  const { data, error } = await supabase.rpc('set_share_window', { p_minutes: minutes });
  if (error) return { ok: false, reason: error.message };
  const until = (data as string | null) ?? null;
  await setShareUntil(until);

  const result = await startBackgroundTracking();
  if (!result.ok) {
    // Don't leave a window open with nothing sharing behind it.
    if (minutes != null) await supabase.rpc('set_share_window', { p_minutes: 0 });
    await setShareUntil(null);
    return result;
  }
  return { ok: true, backgroundGranted: result.backgroundGranted, until };
}

export async function stopSharing(): Promise<void> {
  const until = await getShareUntil();
  await stopBackgroundTracking();
  if (until) {
    // A temporary window ends for real when you stop it — circle-mates lose
    // sight of you immediately, not when the timer would have run out.
    await supabase.rpc('set_share_window', { p_minutes: 0 });
    await setShareUntil(null);
  }
}

// Walk me home needs your position to arrive at the destination, so make
// sure something is sharing for at least the length of the walk. Leaves
// always-on sharing (or a window that already covers it) alone; otherwise
// opens a temporary window just long enough, plus a margin.
export async function ensureSharingFor(minutes: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [active, until] = await Promise.all([isTrackingActive(), getShareUntil()]);
  const needUntil = Date.now() + (minutes + 10) * 60_000;
  if (active && (until == null || until.getTime() >= needUntil)) return { ok: true };

  const result = await startSharing(minutes + 10);
  return result.ok ? { ok: true } : result;
}
