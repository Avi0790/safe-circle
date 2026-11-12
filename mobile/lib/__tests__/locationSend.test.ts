import AsyncStorage from '@react-native-async-storage/async-storage';

// Sending locations (lib/locationTracking.ts): the heading travels with each
// ping, and a database that doesn't have the column yet doesn't stop sharing.
const mockInsert = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ insert: (...a: unknown[]) => mockInsert(...a) }) } }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: async () => false }));
jest.mock('expo-battery', () => ({ getBatteryLevelAsync: async () => 0.5 }));
jest.mock('expo-location', () => ({}));
jest.mock('@/lib/workWeather', () => ({ checkWorkWeather: async () => [] }));

import { flushQueueAndSend } from '../locationTracking';

const ping = { latitude: 35.84, longitude: -90.7, accuracy: 5, battery_level: 0.5, speed: 12, heading: 90, recorded_at: '2026-11-12T18:00:00Z' };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockInsert.mockReset();
});

it('sends the heading with the position', async () => {
  mockInsert.mockResolvedValue({ error: null });
  await flushQueueAndSend(ping);
  expect(mockInsert).toHaveBeenCalledWith([ping]);
});

it('a database without the heading column yet gets the pings without it', async () => {
  mockInsert
    .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'heading' column of 'locations' in the schema cache" } })
    .mockResolvedValueOnce({ error: null });
  await flushQueueAndSend(ping);
  const { heading: _h, ...withoutHeading } = ping;
  expect(mockInsert).toHaveBeenLastCalledWith([withoutHeading]);
  expect(await AsyncStorage.getItem('safecircle.locationQueue.v1')).toBeNull();
});
