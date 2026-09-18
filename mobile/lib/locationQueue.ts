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
  speed: number | null;
  recorded_at: string;
}

// Serializes every read-modify-write below. Needed because the foreground
// watch and the background task can each independently fail to send and
// call enqueue() around the same time — without this, two concurrent
// enqueue() calls can both read the same starting queue and the second
// save silently overwrites (loses) the first one's ping.
let queueLock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = queueLock.then(fn, fn);
  queueLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readQueue(): Promise<QueuedPing[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedPing[];
  } catch {
    return [];
  }
}

export function loadQueue(): Promise<QueuedPing[]> {
  return withLock(readQueue);
}

export function saveQueue(queue: QueuedPing[]): Promise<void> {
  return withLock(() => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)));
}

export function enqueue(ping: QueuedPing): Promise<void> {
  return withLock(async () => {
    const queue = await readQueue();
    queue.push(ping);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  });
}

export function clearQueue(): Promise<void> {
  return withLock(() => AsyncStorage.removeItem(QUEUE_KEY));
}
