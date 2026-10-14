// Invite codes are 6 characters from this alphabet (backend
// generate_invite_code: no 0/O, 1/I/L). Keep in step with it.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

// What the QR code contains. Deliberately NOT a URL: a safecircle:// link
// would make a phone's own camera try to open the app, which doesn't work
// from Expo Go and lands on a route that doesn't exist in a real build. The
// QR is scanned inside the app's Join screen, so a plain tagged string does
// the job and does nothing surprising anywhere else.
export const JOIN_QR_PREFIX = 'SAFECIRCLE-JOIN:';

export function buildJoinPayload(code: string): string {
  return `${JOIN_QR_PREFIX}${code.trim().toUpperCase()}`;
}

// Accepts what the app generates, a bare code (someone pasted or typed it),
// or a safecircle://join?code=... link. Anything else — a URL to some other
// site, a random QR from the wall — is rejected rather than guessed at.
export function parseJoinCode(raw: string): string | null {
  const text = raw.trim();
  let candidate = text.toUpperCase();

  if (candidate.startsWith(JOIN_QR_PREFIX)) {
    candidate = candidate.slice(JOIN_QR_PREFIX.length);
  } else if (/^safecircle:\/\//i.test(text)) {
    const match = text.match(/[?&]code=([A-Za-z0-9]+)/);
    candidate = match ? match[1].toUpperCase() : '';
  }

  return CODE_PATTERN.test(candidate) ? candidate : null;
}
