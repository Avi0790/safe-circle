import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-circle "last read" watermark for the unread-message badge — local
// only, not synced anywhere. A device-specific read state is the right
// call here (same device someone's actually holding decides what's
// "unread" to them, not a cross-device server concept this app doesn't
// otherwise have).
function key(circleId: string): string {
  return `safecircle.chatLastRead.${circleId}`;
}

export async function getLastRead(circleId: string): Promise<string | null> {
  return AsyncStorage.getItem(key(circleId));
}

export async function setLastRead(circleId: string, iso: string): Promise<void> {
  await AsyncStorage.setItem(key(circleId), iso);
}
