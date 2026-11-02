import AsyncStorage from '@react-native-async-storage/async-storage';

const mockRpc = jest.fn();
const mockNotify = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ status: 'granted' }),
  scheduleNotificationAsync: (...a: unknown[]) => mockNotify(...a),
}));

import {
  assessWeather,
  CHECK_EVERY_MS,
  checkWorkWeather,
  startWeatherWatch,
  stopWeatherWatch,
  syncWeatherWatch,
  worstRisk,
  type WorkWeather,
} from '../workWeather';

const mild: WorkWeather = { tempF: 72, feelsLikeF: 72, gustMph: 8, code: 1 };
const here = { latitude: 35.84, longitude: -90.7 };
const kinds = (w: WorkWeather) => assessWeather(w).map((r) => `${r.kind}:${r.level}`);

describe('assessWeather', () => {
  it('a mild day is no risk', () => expect(kinds(mild)).toEqual([]));
  it('heat: caution from 91°F feels-like, danger from 103°F', () => {
    expect(kinds({ ...mild, feelsLikeF: 90.4 })).toEqual([]);
    expect(kinds({ ...mild, feelsLikeF: 95 })).toEqual(['heat:caution']);
    expect(kinds({ ...mild, feelsLikeF: 104 })).toEqual(['heat:danger']);
  });
  it('cold: caution at 0°F wind chill, danger at -20°F', () => {
    expect(kinds({ ...mild, feelsLikeF: -5 })).toEqual(['cold:caution']);
    expect(kinds({ ...mild, feelsLikeF: -25 })).toEqual(['cold:danger']);
  });
  it('thunderstorms and strong gusts, together', () => {
    expect(kinds({ ...mild, code: 95, gustMph: 48 })).toEqual(['storm:danger', 'wind:caution']);
  });
  it('the worst one leads', () => {
    expect(worstRisk(assessWeather({ ...mild, code: 96, gustMph: 45 }))?.kind).toBe('storm');
    expect(worstRisk([])).toBeNull();
  });
});

describe('checkWorkWeather', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockRpc.mockReset().mockResolvedValue({ data: true, error: null });
    mockNotify.mockReset();
  });

  it('off shift it does nothing at all', async () => {
    const fetcher = jest.fn();
    expect(await checkWorkWeather(here, Date.now(), fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('on shift: tells the worker and reports it, once per risk, at most every 20 minutes', async () => {
    await startWeatherWatch();
    const fetcher = jest.fn().mockResolvedValue({ ...mild, feelsLikeF: 98 });
    const t0 = Date.now();
    expect((await checkWorkWeather(here, t0, fetcher)).map((r) => r.kind)).toEqual(['heat']);
    expect(mockRpc).toHaveBeenCalledWith('report_weather_risk', { p_kind: 'heat', p_level: 'caution', p_feels_like_f: 98, p_gust_mph: 8 });
    expect(mockNotify).toHaveBeenCalledTimes(1);

    expect(await checkWorkWeather(here, t0 + 60_000, fetcher)).toEqual([]); // too soon
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await checkWorkWeather(here, t0 + CHECK_EVERY_MS, fetcher)).toEqual([]); // same risk
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('with no signal the worker is still told, and the managers on a later check', async () => {
    await startWeatherWatch();
    const fetcher = jest.fn().mockResolvedValue({ ...mild, code: 95 });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    const t0 = Date.now();
    expect((await checkWorkWeather(here, t0, fetcher)).length).toBe(1);
    expect(await checkWorkWeather(here, t0 + CHECK_EVERY_MS, fetcher)).toEqual([]);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('stops watching when the server says the shift is over', async () => {
    await startWeatherWatch();
    mockRpc.mockResolvedValue({ data: false, error: null });
    const fetcher = jest.fn().mockResolvedValue({ ...mild, feelsLikeF: 110 });
    expect(await checkWorkWeather(here, Date.now(), fetcher)).toEqual([]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(await checkWorkWeather(here, Date.now() + CHECK_EVERY_MS, fetcher)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('follows the server about being on shift', async () => {
    await syncWeatherWatch(true);
    const fetcher = jest.fn().mockResolvedValue(mild);
    await checkWorkWeather(here, Date.now(), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await syncWeatherWatch(false);
    await checkWorkWeather(here, Date.now() + CHECK_EVERY_MS, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await stopWeatherWatch();
  });
});
