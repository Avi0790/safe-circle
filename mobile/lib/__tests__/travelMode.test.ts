import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTravelMode, setTravelMode } from '../travelMode';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('travel mode preference', () => {
  it('starts on drive', async () => {
    expect(await getTravelMode()).toBe('drive');
  });

  it('remembers walk, and switching back', async () => {
    await setTravelMode('walk');
    expect(await getTravelMode()).toBe('walk');
    await setTravelMode('drive');
    expect(await getTravelMode()).toBe('drive');
  });

  it('treats anything unexpected in storage as drive', async () => {
    await AsyncStorage.setItem('safecircle.travelMode.v1', 'cycling');
    expect(await getTravelMode()).toBe('drive');
  });

  it('does not throw when storage fails', async () => {
    const get = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('x'));
    expect(await getTravelMode()).toBe('drive');
    get.mockRestore();
    const set = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('x'));
    await expect(setTravelMode('walk')).resolves.toBeUndefined();
    set.mockRestore();
  });
});
