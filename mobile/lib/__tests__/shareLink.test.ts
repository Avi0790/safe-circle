jest.mock('expo-constants', () => ({ expoConfig: { extra: { webUrl: 'https://safecircle.example' } } }));

import { buildTrackUrl, getWebBaseUrl, isLocalUrl } from '../shareLink';

describe('buildTrackUrl', () => {
  it('joins base and token, tolerating trailing slashes', () => {
    expect(buildTrackUrl('https://x.app', 'abc')).toBe('https://x.app/track/abc');
    expect(buildTrackUrl('https://x.app///', 'abc')).toBe('https://x.app/track/abc');
  });
});

describe('getWebBaseUrl', () => {
  it('reads the configured web URL', () => {
    expect(getWebBaseUrl()).toBe('https://safecircle.example');
  });
});

describe('isLocalUrl', () => {
  it('flags addresses only reachable on the same machine or network', () => {
    expect(isLocalUrl('http://localhost:5173')).toBe(true);
    expect(isLocalUrl('http://192.168.1.5:5173')).toBe(true);
    expect(isLocalUrl('https://safecircle.vercel.app')).toBe(false);
  });
});
