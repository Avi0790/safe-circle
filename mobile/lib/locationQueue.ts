import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'safecircle.locationQueue.v1';

// Mirrors the public.locations insert shape. recorded_at is included (the
// column has a default, but clients may set it) so a ping's real capture
// time survives even if it sits queued for a while before upload.
export interface QueuedPing {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  battery_level: number | null;
  recorded_at: string;
}

export async function loadQueue(): Promise<QueuedPing[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedPing[];
  } catch {
    return [];
  }
}

export async function saveQueue(queue: QueuedPing[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueue(ping: QueuedPing): Promise<void> {
  const queue = await loadQueue();
  queue.push(ping);
  await saveQueue(queue);
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
