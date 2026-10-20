import { normalizeAngle } from '@/lib/avatarPose';

// Smoothing the driving avatar between GPS fixes (about one a second): it
// glides to each new position over roughly the time the last gap took, so
// it arrives as the next fix comes in, and turns the short way round.
export const GLIDE_MIN_MS = 250;
export const GLIDE_MAX_MS = 1500;
// A jump this far (a GPS glitch, coming out of a tunnel) snaps instead of
// sliding across the map.
export const SNAP_METERS = 250;

export function glideDuration(previousFixAt: number | null, now: number): number {
  if (previousFixAt == null) return 0;
  return Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, now - previousFixAt));
}

// The angle to animate to, continuing from the current (unwrapped) one, so a
// turn from 350° to 10° goes +20°, not -340°.
export function unwrapTowards(current: number, target: number): number {
  return current + normalizeAngle(target - current);
}
