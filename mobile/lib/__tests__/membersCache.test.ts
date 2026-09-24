import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearMembersCache,
  loadCachedMembers,
  MEMBERS_CACHE_MAX_AGE_MS,
  saveCachedMembers,
} from '../membersCache';
import type { MemberWithLocation } from '../types';

const member = (id: string): MemberWithLocation => ({
  id,
  full_name: `Person ${id}`,
  avatar_url: null,
  share_until: null,
  status_emoji: null,
  status_text: null,
  status_expires_at: null,
  phone_number: null,
  location: null,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('members cache', () => {
  it('round-trips a circle for a user', async () => {
    await saveCachedMembers('u1', 'c1', [member('a')]);
    expect(await loadCachedMembers('u1', 'c1')).toEqual([member('a')]);
  });

  it('is scoped per user and per circle', async () => {
    await saveCachedMembers('u1', 'c1', [member('a')]);
    expect(await loadCachedMembers('u2', 'c1')).toBeNull();
    expect(await loadCachedMembers('u1', 'c2')).toBeNull();
  });

  it('ignores an entry older than the max age', async () => {
    const then = Date.now();
    await saveCachedMembers('u1', 'c1', [member('a')], then);
    expect(await loadCachedMembers('u1', 'c1', then + MEMBERS_CACHE_MAX_AGE_MS - 1)).not.toBeNull();
    expect(await loadCachedMembers('u1', 'c1', then + MEMBERS_CACHE_MAX_AGE_MS + 1)).toBeNull();
  });

  it('tolerates corrupt data', async () => {
    await AsyncStorage.setItem('safecircle.membersCache.v1.u1.c1', '{not json');
    expect(await loadCachedMembers('u1', 'c1')).toBeNull();
  });

  it('clear removes every cached circle but nothing else', async () => {
    await saveCachedMembers('u1', 'c1', [member('a')]);
    await saveCachedMembers('u1', 'c2', [member('b')]);
    await AsyncStorage.setItem('unrelated', 'keep me');
    await clearMembersCache();
    expect(await loadCachedMembers('u1', 'c1')).toBeNull();
    expect(await loadCachedMembers('u1', 'c2')).toBeNull();
    expect(await AsyncStorage.getItem('unrelated')).toBe('keep me');
  });
});
