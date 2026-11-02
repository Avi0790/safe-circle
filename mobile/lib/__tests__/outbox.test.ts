import AsyncStorage from '@react-native-async-storage/async-storage';

// The outbox (lib/outbox.ts) against a stand-in network and server.
let mockOnline = true;
const mockSubmit = jest.fn();
const mockInsert = jest.fn();
const mockCheckIn = jest.fn();
const mockCopied: string[] = [];
const mockDeleted: string[] = [];

jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }),
  addEventListener: () => () => {},
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: async () => {},
  copyAsync: async ({ to }: { to: string }) => {
    mockCopied.push(to);
  },
  deleteAsync: async (uri: string) => {
    mockDeleted.push(uri);
  },
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 35.8, longitude: -90.7 } }),
}));
jest.mock('@/lib/incidents', () => ({ submitIncident: (...a: unknown[]) => mockSubmit(...a) }));
jest.mock('@/lib/clockIn', () => ({ checkInNow: (...a: unknown[]) => mockCheckIn(...a) }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ insert: (...a: unknown[]) => mockInsert(...a) }) },
}));

import {
  circleCheckInOrQueue,
  flushOutbox,
  isNetworkError,
  pendingItems,
  reportIncidentOrQueue,
  workCheckInOrQueue,
} from '@/lib/outbox';

const REPORT = { orgId: 'o1', userId: 'u1', kind: 'hazard' as const, note: 'Loose rail', photoUri: 'file:///tmp/p.jpg' };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockOnline = true;
  mockSubmit.mockReset();
  mockInsert.mockReset();
  mockCheckIn.mockReset();
  mockCopied.length = 0;
  mockDeleted.length = 0;
});

describe('without signal', () => {
  it('an incident report is kept on the phone, with a safe copy of its photo', async () => {
    mockOnline = false;
    expect(await reportIncidentOrQueue(REPORT)).toEqual({ ok: true, queued: true });
    expect(mockSubmit).not.toHaveBeenCalled();
    const [item] = await pendingItems();
    expect(item).toMatchObject({ type: 'incident', note: 'Loose rail' });
    expect(mockCopied).toEqual([(item as { photoUri: string }).photoUri]);
  });

  it('a send that fails for lack of network is kept too', async () => {
    mockSubmit.mockResolvedValue({ ok: false, error: 'TypeError: Network request failed' });
    expect(await reportIncidentOrQueue(REPORT)).toEqual({ ok: true, queued: true });
    expect(await pendingItems()).toHaveLength(1);
  });

  it('but a real refusal is shown, not kept', async () => {
    mockSubmit.mockResolvedValue({ ok: false, error: "You're not in this organization." });
    expect(await reportIncidentOrQueue(REPORT)).toEqual({ ok: false, error: "You're not in this organization." });
    expect(await pendingItems()).toHaveLength(0);
  });

  it('a circle check-in keeps the GPS position it took offline', async () => {
    mockOnline = false;
    expect(await circleCheckInOrQueue('c1')).toEqual({ ok: true, queued: true });
    expect((await pendingItems())[0]).toMatchObject({ type: 'circle_checkin', latitude: 35.8, longitude: -90.7 });
  });
});

describe('when the connection comes back', () => {
  it('sends everything oldest first, saying when it was really made', async () => {
    mockOnline = false;
    await reportIncidentOrQueue(REPORT);
    await workCheckInOrQueue();
    await circleCheckInOrQueue('c1');
    mockOnline = true;
    mockSubmit.mockResolvedValue({ ok: true, id: 'r1' });
    mockCheckIn.mockResolvedValue({ ok: true, nextDue: 'x' });
    mockInsert.mockResolvedValue({ error: null });

    expect(await flushOutbox()).toEqual({ sent: 3, refused: 0 });
    expect(mockSubmit.mock.calls[0][0].note).toMatch(/^Loose rail \(Made without signal at .+; sent when the connection came back\.\)$/);
    expect(mockCheckIn).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].body).toMatch(/^📍 Checked in \(Made without signal at /);
    expect(await pendingItems()).toHaveLength(0);
    expect(mockDeleted).toHaveLength(1); // the kept photo, once sent
  });

  it('stops at the first sign the connection is still down, and keeps the rest', async () => {
    mockOnline = false;
    await workCheckInOrQueue();
    await workCheckInOrQueue();
    mockCheckIn.mockResolvedValue({ ok: false, reason: 'Failed to fetch' });
    expect(await flushOutbox()).toEqual({ sent: 0, refused: 0 });
    expect(await pendingItems()).toHaveLength(2);
  });

  it('drops something the server refuses, rather than retrying it forever', async () => {
    mockOnline = false;
    await workCheckInOrQueue();
    mockCheckIn.mockResolvedValue({ ok: false, reason: 'Not on shift.' });
    expect(await flushOutbox()).toEqual({ sent: 0, refused: 1 });
    expect(await pendingItems()).toHaveLength(0);
  });
});

it('tells a network failure from a refusal', () => {
  expect(isNetworkError('TypeError: Network request failed')).toBe(true);
  expect(isNetworkError('Failed to fetch')).toBe(true);
  expect(isNetworkError('Say what happened.')).toBe(false);
});
