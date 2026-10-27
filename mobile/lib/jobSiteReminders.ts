import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

// "You're at the Main St yard. Clock in?" Workers who turn this on (Work tab,
// off by default) have the phone's own geofencing watch their organizations'
// job sites (migration ...000068). Arriving at one while not clocked in shows
// a local notification. The arrival never leaves the phone: no request is
// made, nothing is stored on the server, and nobody at work learns of it.
// iOS watches at most 20 regions per app, which is also the per-organization
// limit on sites.

export const JOB_SITE_TASK = 'safecircle-job-sites';
const ENABLED_KEY = 'safecircle.jobSiteReminders';
const SITES_KEY = 'safecircle.jobSites';
const ON_SHIFT_KEY = 'safecircle.onShift';
const REMINDED_KEY = 'safecircle.jobSiteReminded';
export const MAX_REGIONS = 20;
// Once per site per stretch: walking in and out of the yard all day
// shouldn't nag.
export const REMIND_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const isNative = Platform.OS !== 'web';

export interface JobSite {
  id: string;
  org_id: string;
  org_name: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
}

export type ReminderSetting = { ok: true; sites: number } | { ok: false; reason: string };

export function regionsFor(sites: JobSite[]): Location.LocationRegion[] {
  return sites.slice(0, MAX_REGIONS).map((s) => ({
    identifier: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    radius: s.radius_m,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
}

export function shouldRemind(siteId: string, onShift: boolean, reminded: Record<string, number>, now = Date.now()): boolean {
  if (onShift) return false;
  const last = reminded[siteId];
  return last == null || now - last >= REMIND_COOLDOWN_MS;
}

export function reminderContent(site: Pick<JobSite, 'name' | 'org_name'>): { title: string; body: string } {
  return {
    title: `📍 You're at ${site.name}`,
    body: `You're not clocked in to ${site.org_name}. Open Safe Circle to clock in.`,
  };
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// What the geofence task does with an event. Exported for tests.
export async function handleRegionEvent(
  eventType: Location.GeofencingEventType,
  region: { identifier?: string },
  now = Date.now(),
): Promise<boolean> {
  if (eventType !== Location.GeofencingEventType.Enter || !region.identifier) return false;
  const [sites, onShift, reminded] = await Promise.all([
    readJson<JobSite[]>(SITES_KEY, []),
    readJson<boolean>(ON_SHIFT_KEY, false),
    readJson<Record<string, number>>(REMINDED_KEY, {}),
  ]);
  const site = sites.find((s) => s.id === region.identifier);
  if (!site || !shouldRemind(site.id, onShift, reminded, now)) return false;

  await Notifications.scheduleNotificationAsync({
    content: { ...reminderContent(site), data: { type: 'job_site', siteId: site.id } },
    trigger: null,
  });
  await AsyncStorage.setItem(REMINDED_KEY, JSON.stringify({ ...reminded, [site.id]: now }));
  return true;
}

// Like the location task, defined at module scope on every launch (imported
// from app/_layout.tsx) so iOS can wake a closed app for a geofence event.
if (isNative) {
  TaskManager.defineTask(JOB_SITE_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const { eventType, region } = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };
    try {
      await handleRegionEvent(eventType, region);
    } catch (err) {
      console.warn('[jobSiteReminders]', err instanceof Error ? err.message : err);
    }
  });
}

// Kept current by the account refresh, so the task knows without a network
// request whether you're already clocked in.
export async function rememberOnShift(onShift: boolean): Promise<void> {
  await AsyncStorage.setItem(ON_SHIFT_KEY, JSON.stringify(onShift)).catch(() => {});
}

export async function jobSiteRemindersOn(): Promise<boolean> {
  return readJson<boolean>(ENABLED_KEY, false);
}

async function stopWatching(): Promise<void> {
  if (!isNative) return;
  const started = await Location.hasStartedGeofencingAsync(JOB_SITE_TASK).catch(() => false);
  if (started) await Location.stopGeofencingAsync(JOB_SITE_TASK);
}

// Fetch the sites and (re)register them. Returns how many are watched.
async function watchSites(): Promise<number> {
  const { data, error } = await supabase.rpc('my_job_sites');
  if (error) throw new Error(error.message);
  const sites = ((data as JobSite[] | null) ?? []).slice(0, MAX_REGIONS);
  await AsyncStorage.setItem(SITES_KEY, JSON.stringify(sites));
  if (sites.length === 0) {
    await stopWatching();
    return 0;
  }
  if (isNative) await Location.startGeofencingAsync(JOB_SITE_TASK, regionsFor(sites));
  return sites.length;
}

export async function setJobSiteReminders(on: boolean): Promise<ReminderSetting> {
  if (!on) {
    await stopWatching().catch(() => {});
    await AsyncStorage.multiRemove([ENABLED_KEY, SITES_KEY, REMINDED_KEY]).catch(() => {});
    return { ok: true, sites: 0 };
  }
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return { ok: false, reason: 'Location permission is off for Safe Circle.' };
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      return { ok: false, reason: 'Reminders need location set to "Always" for Safe Circle in Settings.' };
    }
    const notes = await Notifications.requestPermissionsAsync();
    if (notes.status !== 'granted') return { ok: false, reason: 'Notifications are off for Safe Circle.' };
    const sites = await watchSites();
    await AsyncStorage.setItem(ENABLED_KEY, JSON.stringify(true));
    return { ok: true, sites };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not set up the reminders.' };
  }
}

// After the account refreshes: sites may have been added or removed, or the
// plan ended. A no-op unless the worker turned reminders on.
export async function syncJobSiteReminders(): Promise<void> {
  if (!(await jobSiteRemindersOn())) return;
  try {
    await watchSites();
  } catch {
    // keep watching the last known sites until the next refresh
  }
}
