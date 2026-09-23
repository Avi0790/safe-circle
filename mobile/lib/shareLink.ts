import Constants from 'expo-constants';

export function buildTrackUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/track/${token}`;
}

export function getWebBaseUrl(): string {
  const configured = (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl;
  return configured ?? 'http://localhost:5173';
}

// A link to localhost only works on the machine running the dev server —
// the share screen warns instead of handing someone a dead link.
export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.)/i.test(url);
}
