import { t } from '@/lib/i18n';

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return t('just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('{n}m ago', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{n}h ago', { n: hours });
  return t('{n}d ago', { n: Math.floor(hours / 24) });
}

// Pings land roughly every 60s while sharing is actually active (see
// TIME_INTERVAL_MS in lib/locationTracking.ts), so anything older than this
// means sharing has likely stopped — permission revoked, app killed, dead
// battery — rather than just being between updates.
export const STALE_AFTER_MS = 15 * 60 * 1000;

export function isStale(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > STALE_AFTER_MS;
}

// Matches iOS/Android's own "Low Power Mode" prompt threshold — a
// reasonable point to warn a circle-mate that someone's sharing is about
// to stop on its own, not just from a permission/connectivity issue.
export const LOW_BATTERY_THRESHOLD = 0.2;

export function isLowBattery(level: number | null): boolean {
  return level != null && level <= LOW_BATTERY_THRESHOLD;
}

const MPS_TO_MPH = 2.23694;

export function speedToMph(speedMetersPerSecond: number | null): number | null {
  if (speedMetersPerSecond == null || speedMetersPerSecond < 0) return null;
  return speedMetersPerSecond * MPS_TO_MPH;
}

// Speed classification off a single GPS fix is inherently fuzzy — this is
// a rough "probably in a vehicle" signal, not real trip/crash detection.
// 15mph comfortably clears brisk jogging/cycling speeds (~10-12mph) to
// avoid mislabeling those as "driving".
export const DRIVING_SPEED_THRESHOLD_MPH = 15;

export function isDriving(speedMetersPerSecond: number | null): boolean {
  const mph = speedToMph(speedMetersPerSecond);
  return mph != null && mph >= DRIVING_SPEED_THRESHOLD_MPH;
}

// Temporary sharing (profiles.share_until): null means normal always-on
// sharing, a future time means "sharing until then", a past time means the
// window has ended and circle-mates can no longer see the person.
export type ShareStatus = 'always' | 'window' | 'ended';

export function getShareStatus(shareUntil: string | null | undefined, now = Date.now()): ShareStatus {
  if (!shareUntil) return 'always';
  return new Date(shareUntil).getTime() > now ? 'window' : 'ended';
}

export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// "12 min", "1 h 5 min", "less than a minute", or "now" once it's passed —
// for walk timers, where a rounded-up minute count reads better than a
// ticking mm:ss that would need a per-second re-render.
export function formatTimeLeft(deadlineIso: string, now = Date.now()): string {
  const ms = new Date(deadlineIso).getTime() - now;
  if (ms <= 0) return t('now');
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes <= 1) return t('less than a minute');
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

// A quick status (profiles.status_emoji/status_text/status_expires_at)
// self-expires rather than needing to be manually cleared — this is the
// client-side mirror of that check (the server never resurrects an expired
// one, but a stale row doesn't disappear from the table on its own either).
export function isStatusActive(expiresAt: string | null | undefined): boolean {
  return expiresAt != null && new Date(expiresAt).getTime() > Date.now();
}

// Formats a Postgres `time` column ("22:00:00", "22:00") as "10:00 PM" —
// a plain string parse rather than routing through Date, since curfew_time
// (see the curfew feature in Settings) has no date component and is
// compared against UTC clock time on the server, not a local Date the
// device would mis-zone.
export function formatTimeOfDay(time: string): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour24 = Number(hourStr);
  const minute = Number(minuteStr);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}
