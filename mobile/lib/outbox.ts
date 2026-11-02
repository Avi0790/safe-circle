import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { checkInNow } from '@/lib/clockIn';
import { formatClockTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { submitIncident, type IncidentKind } from '@/lib/incidents';
import { supabase } from '@/lib/supabase';

// Field crews work where there's no signal. An incident report, a check-in
// to your circle or a work "I'm OK" made with no connection is kept on the
// phone (a report's photo too) and sent, oldest first, as soon as there's a
// connection again (components/OutboxSync.tsx). Each says it was made
// without signal and when, so nobody reads a late one as current.

type Base = { id: string; createdAt: string };
export type OutboxItem =
  | (Base & {
      type: 'incident';
      orgId: string;
      userId: string;
      kind: IncidentKind;
      note: string;
      photoUri: string | null;
      position: { latitude: number; longitude: number } | null;
    })
  | (Base & { type: 'circle_checkin'; circleId: string; latitude: number; longitude: number })
  | (Base & { type: 'work_checkin' });

type NewItem =
  | Omit<Extract<OutboxItem, { type: 'incident' }>, 'id' | 'createdAt'>
  | Omit<Extract<OutboxItem, { type: 'circle_checkin' }>, 'id' | 'createdAt'>
  | Omit<Extract<OutboxItem, { type: 'work_checkin' }>, 'id' | 'createdAt'>;

const KEY = 'safecircle.outbox.v1';
const PHOTO_DIR = `${FileSystem.documentDirectory ?? ''}outbox/`;

// one read-modify-write at a time (as lib/locationQueue.ts)
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = lock.then(fn, fn);
  lock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function read(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OutboxItem[];
  } catch {
    return [];
  }
}

const listeners = new Set<(count: number) => void>();
async function write(items: OutboxItem[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((l) => l(items.length));
}

export function subscribeOutbox(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pendingItems(): Promise<OutboxItem[]> {
  return withLock(read);
}

// The connection is down, as far as the phone can tell.
export async function isOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}

// An error that means "couldn't reach the server", not "the server said no".
export function isNetworkError(message: string | null | undefined): boolean {
  return /network request failed|failed to fetch|fetch failed|network error|internet connection|timed out|timeout/i.test(message ?? '');
}

async function keepPhoto(id: string, uri: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {});
  const kept = `${PHOTO_DIR}${id}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: kept });
  return kept;
}

export async function enqueueOutbox(item: NewItem, now = new Date()): Promise<void> {
  const id = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  let full = { ...item, id, createdAt: now.toISOString() } as OutboxItem;
  if (full.type === 'incident' && full.photoUri) {
    try {
      full = { ...full, photoUri: await keepPhoto(id, full.photoUri) };
    } catch {
      // the report still goes, without its photo
      full = { ...full, photoUri: null };
    }
  }
  await withLock(async () => write([...(await read()), full]));
}

type SendOutcome = 'sent' | 'offline' | 'refused';

// What a late item says about itself.
export function sentLaterNote(createdAt: string): string {
  return t('(Made without signal at {time}; sent when the connection came back.)', { time: formatClockTime(createdAt) });
}

async function sendOne(item: OutboxItem): Promise<SendOutcome> {
  switch (item.type) {
    case 'incident': {
      const result = await submitIncident({
        orgId: item.orgId,
        userId: item.userId,
        kind: item.kind,
        note: `${item.note.trim()} ${sentLaterNote(item.createdAt)}`,
        photoUri: item.photoUri,
        position: item.position,
      });
      if (result.ok) return 'sent';
      return isNetworkError(result.error) ? 'offline' : 'refused';
    }
    case 'circle_checkin': {
      const { error } = await supabase.from('messages').insert({
        circle_id: item.circleId,
        body: `📍 Checked in ${sentLaterNote(item.createdAt)}`,
        latitude: item.latitude,
        longitude: item.longitude,
      });
      if (!error) return 'sent';
      return isNetworkError(error.message) ? 'offline' : 'refused';
    }
    case 'work_checkin': {
      const result = await checkInNow();
      if (result.ok) return 'sent';
      return isNetworkError(result.reason) ? 'offline' : 'refused';
    }
  }
}

let flushing: Promise<{ sent: number; refused: number }> | null = null;

// Sends what's waiting, oldest first; stops at the first sign the connection
// is still down. Something the server refuses (say, the worker has since left
// the organization) is dropped rather than retried forever.
export function flushOutbox(): Promise<{ sent: number; refused: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let refused = 0;
    try {
      for (;;) {
        const [next] = await pendingItems();
        if (!next) break;
        const outcome = await sendOne(next);
        if (outcome === 'offline') break;
        if (outcome === 'sent') sent += 1;
        else refused += 1;
        await withLock(async () => write((await read()).filter((i) => i.id !== next.id)));
        if (next.type === 'incident' && next.photoUri?.startsWith(PHOTO_DIR)) {
          await FileSystem.deleteAsync(next.photoUri, { idempotent: true }).catch(() => {});
        }
      }
    } finally {
      flushing = null;
    }
    return { sent, refused };
  })();
  return flushing;
}

export type SendOrQueue = { ok: true; queued: boolean } | { ok: false; error: string };

// An incident report: sent now if possible, otherwise kept for later.
export async function reportIncidentOrQueue(input: {
  orgId: string;
  userId: string;
  kind: IncidentKind;
  note: string;
  photoUri?: string | null;
  position?: { latitude: number; longitude: number } | null;
}): Promise<SendOrQueue> {
  if (!input.note.trim()) return { ok: false, error: 'Say what happened.' };
  const item = {
    type: 'incident' as const,
    orgId: input.orgId,
    userId: input.userId,
    kind: input.kind,
    note: input.note,
    photoUri: input.photoUri ?? null,
    position: input.position ?? null,
  };
  if (await isOffline()) {
    await enqueueOutbox(item);
    return { ok: true, queued: true };
  }
  const result = await submitIncident(input);
  if (result.ok) return { ok: true, queued: false };
  if (isNetworkError(result.error)) {
    await enqueueOutbox(item);
    return { ok: true, queued: true };
  }
  return { ok: false, error: result.error };
}

// A check-in to your circle (Chat): the position comes from GPS, which works
// without signal; the message waits for a connection if it has to.
export async function circleCheckInOrQueue(circleId: string | null): Promise<SendOrQueue> {
  if (!circleId) return { ok: false, error: 'No circle selected.' };
  let position: Location.LocationObject;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ok: false, error: 'Location permission denied.' };
    position = await Location.getCurrentPositionAsync({});
  } catch {
    return { ok: false, error: 'Could not get your location.' };
  }
  const item = {
    type: 'circle_checkin' as const,
    circleId,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
  if (await isOffline()) {
    await enqueueOutbox(item);
    return { ok: true, queued: true };
  }
  const { error } = await supabase.from('messages').insert({
    circle_id: circleId,
    body: '📍 Checked in',
    latitude: item.latitude,
    longitude: item.longitude,
  });
  if (!error) return { ok: true, queued: false };
  if (isNetworkError(error.message)) {
    await enqueueOutbox(item);
    return { ok: true, queued: true };
  }
  return { ok: false, error: error.message };
}

// "I'm OK" on shift.
export async function workCheckInOrQueue(): Promise<SendOrQueue> {
  if (await isOffline()) {
    await enqueueOutbox({ type: 'work_checkin' });
    return { ok: true, queued: true };
  }
  const result = await checkInNow();
  if (result.ok) return { ok: true, queued: false };
  if (isNetworkError(result.reason)) {
    await enqueueOutbox({ type: 'work_checkin' });
    return { ok: true, queued: true };
  }
  return { ok: false, error: result.reason };
}
