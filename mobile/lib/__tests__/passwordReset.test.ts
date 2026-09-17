import { parseRecoveryTokensFromUrl } from '../passwordReset';

describe('parseRecoveryTokensFromUrl', () => {
  it('extracts tokens from a valid recovery deep link', () => {
    const url =
      'safecircle://reset-password#access_token=abc123&refresh_token=def456&type=recovery&expires_in=3600';
    expect(parseRecoveryTokensFromUrl(url)).toEqual({
      accessToken: 'abc123',
      refreshToken: 'def456',
    });
  });

  it('returns null for null/undefined input', () => {
    expect(parseRecoveryTokensFromUrl(null)).toBeNull();
  });

  it('returns null when there is no fragment', () => {
    expect(parseRecoveryTokensFromUrl('safecircle://reset-password')).toBeNull();
  });

  it('returns null for a non-recovery fragment (e.g. a different auth type)', () => {
    const url = 'safecircle://reset-password#access_token=abc123&refresh_token=def456&type=signup';
    expect(parseRecoveryTokensFromUrl(url)).toBeNull();
  });

  it('returns null when a token is missing', () => {
    const url = 'safecircle://reset-password#access_token=abc123&type=recovery';
    expect(parseRecoveryTokensFromUrl(url)).toBeNull();
  });
});
