import AsyncStorage from '@react-native-async-storage/async-storage';

// How much the Directions screen talks, like Apple Maps' audio setting:
//   all     turn-by-turn guidance plus alerts
//   alerts  only what you must know: an incident reported ahead, and arriving
//   off     nothing
// Per device, like the map style.
export type VoiceMode = 'all' | 'alerts' | 'off';
export type SpeechKind = 'guidance' | 'alert';

export const VOICE_MODES: { mode: VoiceMode; label: string }[] = [
  { mode: 'all', label: 'All voice' },
  { mode: 'alerts', label: 'Alerts only' },
  { mode: 'off', label: 'No voice' },
];

const KEY = 'safecircle.voiceMode.v1';

export function shouldSpeak(mode: VoiceMode, kind: SpeechKind): boolean {
  if (mode === 'off') return false;
  return mode === 'all' || kind === 'alert';
}

export async function getVoiceMode(): Promise<VoiceMode> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    return stored === 'alerts' || stored === 'off' ? stored : 'all';
  } catch {
    return 'all';
  }
}

export async function setVoiceMode(mode: VoiceMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, mode);
  } catch {
    // Losing the preference just means full voice next time.
  }
}
