// The phone's time zone as an IANA name ("America/Chicago"), for anything
// the server checks against a clock time, like curfew (migration ...000070).
// A named zone, not an offset, so daylight saving is handled server-side.
export function phoneTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
