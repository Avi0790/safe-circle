import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLastRead, setLastRead } from '../chatReadState';

describe('chatReadState', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns null when nothing has been marked read yet', async () => {
    expect(await getLastRead('circle-1')).toBeNull();
  });

  it('persists and returns the last-read timestamp', async () => {
    await setLastRead('circle-1', '2026-01-01T00:00:00.000Z');
    expect(await getLastRead('circle-1')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps separate watermarks per circle', async () => {
    await setLastRead('circle-1', '2026-01-01T00:00:00.000Z');
    await setLastRead('circle-2', '2026-02-01T00:00:00.000Z');
    expect(await getLastRead('circle-1')).toBe('2026-01-01T00:00:00.000Z');
    expect(await getLastRead('circle-2')).toBe('2026-02-01T00:00:00.000Z');
  });
});
