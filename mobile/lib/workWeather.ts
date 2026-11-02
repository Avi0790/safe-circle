import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

// Heat, cold, storm and wind on shift (migration ...000076). While clocked
// in, the phone looks up the weather where the worker is, at most every 20
// minutes, from the location updates it already sends (lib/locationTracking.ts).
// A risk is told to the worker straight away with a local notification and
// reported so the people who oversee them get a heads-up, once per shift for
// each risk and level. Open-Meteo, keyless, as lib/weather.ts.

export type RiskKind = 'heat' | 'cold' | 'storm' | 'wind';
export type RiskLevel = 'caution' | 'danger';

export interface WorkWeather {
  tempF: number;
  feelsLikeF: number;
  gustMph: number;
  code: number;
}

export interface WeatherRisk {
  kind: RiskKind;
  level: RiskLevel;
  title: string;
  body: string;
}

// OSHA's heat index bands (91–103 °F moderate, 103+ high), the National
// Weather Service's wind chill frostbite guidance, WMO thunderstorm codes,
// and gusts strong enough to stop work at height.
export const HEAT_CAUTION_F = 91;
export const HEAT_DANGER_F = 103;
export const COLD_CAUTION_F = 0;
export const COLD_DANGER_F = -20;
export const GUST_CAUTION_MPH = 40;

export function assessWeather(w: WorkWeather): WeatherRisk[] {
  const risks: WeatherRisk[] = [];
  const f = Math.round(w.feelsLikeF);
  if (f >= HEAT_DANGER_F) {
    risks.push({ kind: 'heat', level: 'danger', title: t('🥵 Dangerous heat: feels like {f}°F', { f }), body: t('Stop and rest in the shade, drink water every 15 minutes, and watch your coworkers for heat illness.') });
  } else if (f >= HEAT_CAUTION_F) {
    risks.push({ kind: 'heat', level: 'caution', title: t('🌡️ Heat: feels like {f}°F', { f }), body: t('Drink water every 15 to 20 minutes and take breaks in the shade.') });
  }
  if (f <= COLD_DANGER_F) {
    risks.push({ kind: 'cold', level: 'danger', title: t('🥶 Dangerous cold: feels like {f}°F', { f }), body: t('Frostbite can set in within minutes. Get indoors to warm up.') });
  } else if (f <= COLD_CAUTION_F) {
    risks.push({ kind: 'cold', level: 'caution', title: t('❄️ Cold: feels like {f}°F', { f }), body: t('Cover skin and take warm-up breaks indoors.') });
  }
  if (w.code >= 95) {
    risks.push({ kind: 'storm', level: 'danger', title: t('⛈️ Thunderstorm where you are'), body: t('Lightning risk. Get indoors or into a vehicle, away from tall equipment.') });
  }
  if (w.gustMph >= GUST_CAUTION_MPH) {
    risks.push({ kind: 'wind', level: 'caution', title: t('💨 Gusts of {g} mph', { g: Math.round(w.gustMph) }), body: t('Stop work at height and secure loose materials.') });
  }
  return risks;
}

// The worst risk, for the Work tab.
export function worstRisk(risks: WeatherRisk[]): WeatherRisk | null {
  return risks.find((r) => r.level === 'danger') ?? risks[0] ?? null;
}

export async function fetchWorkWeather(latitude: number, longitude: number): Promise<WorkWeather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_gusts_10m' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph';
    const res = await fetch(url);
    if (!res.ok) return null;
    const c = ((await res.json()) as {
      current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; wind_gusts_10m?: number };
    }).current;
    if (c?.temperature_2m == null || c.apparent_temperature == null || c.weather_code == null) return null;
    return { tempF: c.temperature_2m, feelsLikeF: c.apparent_temperature, gustMph: c.wind_gusts_10m ?? 0, code: c.weather_code };
  } catch {
    return null;
  }
}

// ---- the on-shift watch ----

const WATCH_KEY = 'safecircle.workWeather.v1';
export const CHECK_EVERY_MS = 20 * 60_000;

interface WatchState {
  shiftStartedAt: string;
  lastCheckAt: number;
  told: string[]; // "heat:caution", … the worker was told this shift
  reported?: string[]; // … and their managers were (needs a connection)
}

async function readWatch(): Promise<WatchState | null> {
  try {
    const raw = await AsyncStorage.getItem(WATCH_KEY);
    return raw ? (JSON.parse(raw) as WatchState) : null;
  } catch {
    return null;
  }
}

async function writeWatch(state: WatchState | null) {
  try {
    if (state) await AsyncStorage.setItem(WATCH_KEY, JSON.stringify(state));
    else await AsyncStorage.removeItem(WATCH_KEY);
  } catch {
    // worst case the next check comes early, or a warning repeats
  }
}

// Called at clock-in and clock-out (lib/clockIn.ts).
export async function startWeatherWatch(now = new Date()) {
  await writeWatch({ shiftStartedAt: now.toISOString(), lastCheckAt: 0, told: [] });
}
export async function stopWeatherWatch() {
  await writeWatch(null);
}

// Keeps the watch in step with what the server says (a shift that ended on
// its own, or one started before this version of the app).
export async function syncWeatherWatch(onShift: boolean) {
  const watch = await readWatch();
  if (onShift && !watch) await startWeatherWatch();
  if (!onShift && watch) await stopWeatherWatch();
}

// From each location update. Does nothing off shift, or within 20 minutes of
// the last look. Returns the risks it newly told the worker about.
export async function checkWorkWeather(
  position: { latitude: number; longitude: number },
  now = Date.now(),
  fetcher: typeof fetchWorkWeather = fetchWorkWeather,
): Promise<WeatherRisk[]> {
  const watch = await readWatch();
  if (!watch || now - watch.lastCheckAt < CHECK_EVERY_MS) return [];
  watch.lastCheckAt = now;
  await writeWatch(watch);

  const weather = await fetcher(position.latitude, position.longitude);
  if (!weather) return [];
  const reported = watch.reported ?? [];
  const told: WeatherRisk[] = [];
  for (const risk of assessWeather(weather)) {
    const key = `${risk.kind}:${risk.level}`;
    if (!reported.includes(key)) {
      const { data, error } = await supabase.rpc('report_weather_risk', {
        p_kind: risk.kind,
        p_level: risk.level,
        p_feels_like_f: Math.round(weather.feelsLikeF),
        p_gust_mph: Math.round(weather.gustMph),
      });
      if (!error && data === false) {
        // the shift has ended (on its own, or on another device)
        await stopWeatherWatch();
        return told;
      }
      if (!error) reported.push(key); // otherwise tried again next time
    }
    if (!watch.told.includes(key)) {
      await notifyWorker(risk);
      watch.told.push(key);
      told.push(risk);
    }
  }
  watch.reported = reported;
  await writeWatch(watch);
  return told;
}

async function notifyWorker(risk: WeatherRisk) {
  if (Platform.OS === 'web') return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: { title: risk.title, body: risk.body },
      trigger: null,
    });
  } catch {
    // the managers are still told
  }
}
