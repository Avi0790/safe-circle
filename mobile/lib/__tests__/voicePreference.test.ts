import AsyncStorage from '@react-native-async-storage/async-storage';
import { getVoiceMode, setVoiceMode, shouldSpeak } from '../voicePreference';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('voice levels', () => {
  it('All voice speaks everything, Alerts only just alerts, No voice nothing', () => {
    expect([shouldSpeak('all', 'guidance'), shouldSpeak('all', 'alert')]).toEqual([true, true]);
    expect([shouldSpeak('alerts', 'guidance'), shouldSpeak('alerts', 'alert')]).toEqual([false, true]);
    expect([shouldSpeak('off', 'guidance'), shouldSpeak('off', 'alert')]).toEqual([false, false]);
  });

  it('is remembered, defaults to All voice, and ignores junk', async () => {
    expect(await getVoiceMode()).toBe('all');
    await setVoiceMode('alerts');
    expect(await getVoiceMode()).toBe('alerts');
    await setVoiceMode('off');
    expect(await getVoiceMode()).toBe('off');
    await AsyncStorage.setItem('safecircle.voiceMode.v1', 'loud');
    expect(await getVoiceMode()).toBe('all');
  });
});
