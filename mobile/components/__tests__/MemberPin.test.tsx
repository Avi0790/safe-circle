jest.mock('react-native-maps', () => ({ Marker: () => null }));
import { pinBadges, PIN_ANCHOR } from '../MemberPin';
import type { MemberWithLocation } from '@/lib/types';

const now = Date.now();
const member = (loc: Partial<NonNullable<MemberWithLocation['location']>> | null, extra: Partial<MemberWithLocation> = {}) =>
  ({
    id: 'u1',
    full_name: 'Maya Patel',
    avatar_url: null,
    status_emoji: null,
    status_text: null,
    status_expires_at: null,
    share_until: null,
    location: loc && {
      id: 1, user_id: 'u1', latitude: 35.84, longitude: -90.7, accuracy: 10,
      battery_level: 0.8, speed: 0, recorded_at: new Date(now).toISOString(), ...loc,
    },
    ...extra,
  }) as unknown as MemberWithLocation;

describe('a member pin on the map', () => {
  it('a fresh, parked phone with a good battery: no badges', () => {
    expect(pinBadges(member({}))).toEqual({ stale: false, mph: null, battery: null, emoji: null, heading: null });
  });

  it('driving shows the speed; a low battery shows its percent', () => {
    const b = pinBadges(member({ speed: 15, battery_level: 0.12 }));
    expect(b.mph).toBe(34);
    expect(b.battery).toBe(12);
  });

  it('an old position is stale, and never shows as driving', () => {
    const b = pinBadges(member({ speed: 15, recorded_at: new Date(now - 60 * 60_000).toISOString() }));
    expect(b.stale).toBe(true);
    expect(b.mph).toBeNull();
  });

  it('shows a quick status only while it lasts', () => {
    expect(pinBadges(member({}, { status_emoji: '📚', status_expires_at: new Date(now + 60_000).toISOString() })).emoji).toBe('📚');
    expect(pinBadges(member({}, { status_emoji: '📚', status_expires_at: new Date(now - 60_000).toISOString() })).emoji).toBeNull();
  });

  it('the beam points the way they are heading, to the nearest 10 degrees', () => {
    expect(pinBadges(member({ heading: 274 })).heading).toBe(270);
    expect(pinBadges(member({ heading: 356 })).heading).toBe(0);
    expect(pinBadges(member({ heading: null })).heading).toBeNull();
  });

  it('no beam from an old position', () => {
    expect(pinBadges(member({ heading: 90, recorded_at: new Date(now - 60 * 60_000).toISOString() })).heading).toBeNull();
  });

  it('the dot is the middle of the drawing, so every map puts it on the spot', () => {
    expect(PIN_ANCHOR).toEqual({ x: 0.5, y: 0.5 });
  });
});
