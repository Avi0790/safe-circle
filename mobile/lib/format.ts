export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Pings land roughly every 60s while sharing is actually active (see
// TIME_INTERVAL_MS in lib/locationTracking.ts), so anything older than this
// means sharing has likely stopped — permission revoked, app killed, dead
// battery — rather than just being between updates.
export const STALE_AFTER_MS = 15 * 60 * 1000;

export function isStale(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > STALE_AFTER_MS;
}
