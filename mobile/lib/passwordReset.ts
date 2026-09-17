// Supabase's password-recovery email link redirects to
// `safecircle://reset-password#access_token=...&refresh_token=...&type=recovery`
// (implicit auth flow — see lib/supabase.ts, which doesn't set flowType so
// it defaults to 'implicit'). The tokens land in the URL *fragment*, which
// survives deep-link delivery on both platforms since there's no browser
// stripping it the way there might be for an http(s) URL — but it still
// needs to be pulled out by hand: React Native's Linking has no built-in
// fragment/query parser, unlike a browser location object.
export interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
}

export function parseRecoveryTokensFromUrl(url: string | null): RecoveryTokens | null {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return null;

  const params = new URLSearchParams(url.slice(hashIndex + 1));
  if (params.get('type') !== 'recovery') return null;

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}
