// Colored initials in place of a photo — avatar_url exists on profiles but
// nothing has ever set it (no upload UI, no device to test an image-picker
// flow against), so this is the "Life360 pin" identity look without that
// dependency: deterministic per-person color, no upload, no permissions.

const AVATAR_PALETTE = [
  '#7c3aed', // accent purple
  '#0ea5e9', // sky
  '#f59e0b', // amber
  '#22c55e', // green
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
];

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Keyed by a stable id (not the display name) so a rename doesn't change
// someone's color, and two people who happen to share a first name don't
// collide.
export function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
