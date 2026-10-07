// Mirrors the backend's max_shift_length() (migration ...000048): a shift
// stops being visible after this long even if nobody clocks out.
export const MAX_SHIFT_MINUTES = 14 * 60;

// "2 h 5 min" / "40 min" / "less than a minute", from when a shift began.
export function formatShiftElapsed(startedAtIso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(startedAtIso).getTime()) / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// When the automatic end of this shift lands, as an ISO string.
export function shiftAutoEndsAt(startedAtIso: string): string {
  return new Date(new Date(startedAtIso).getTime() + MAX_SHIFT_MINUTES * 60000).toISOString();
}

export function describeOrgAudit(action: string): string {
  switch (action) {
    case 'viewed_live':
      return 'looked at your live location';
    case 'viewed_track':
      return 'opened your shift track';
    default:
      return 'looked at your location';
  }
}
