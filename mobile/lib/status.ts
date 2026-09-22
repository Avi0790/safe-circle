// Quick status: a short chip next to your name so a circle-mate doesn't
// have to guess what a dot on a map means. A fixed picklist rather than
// free text everywhere it's *set* — free text is still allowed as an
// optional detail alongside one — keeps the display predictable and skips
// a moderation problem entirely.
export interface QuickStatus {
  emoji: string;
  label: string;
}

export const QUICK_STATUSES: QuickStatus[] = [
  { emoji: '🚗', label: 'On my way' },
  { emoji: '📚', label: 'Studying' },
  { emoji: '🍽️', label: 'At dinner' },
  { emoji: '😴', label: 'Sleeping' },
  { emoji: '🏃', label: 'Need pickup' },
  { emoji: '🚫', label: "Don't disturb" },
];

// How long a status lasts before it's treated as expired — long enough to
// cover an evening out, short enough that it can't go stale forever like a
// bio would.
export const STATUS_DURATION_MINUTES = 240;
