jest.mock('react-native-maps', () => ({ Marker: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-location', () => ({}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { formatAddress, stayLength } from '../MemberCard';

const now = Date.parse('2026-11-12T16:00:00Z');
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();

describe('the person card', () => {
  it('says how long they have been there', () => {
    expect(stayLength(ago(48), now)).toBe('48 min');
    expect(stayLength(ago(125), now)).toBe('2 h 5 min');
    expect(stayLength(ago(180), now)).toBe('3 h');
    expect(stayLength(ago(0), now)).toBe('1 min'); // never "0 min"
  });

  it('splits an address into the street and the area', () => {
    expect(formatAddress({ streetNumber: '1815', street: 'E Highland Dr', city: 'Jonesboro', region: 'AR' })).toEqual({
      street: '1815 E Highland Dr',
      area: 'Jonesboro, AR',
    });
    expect(formatAddress({ name: 'Arkansas State University', city: 'Jonesboro' })).toEqual({
      street: 'Arkansas State University',
      area: 'Jonesboro',
    });
    expect(formatAddress(undefined)).toBeNull();
  });
});
