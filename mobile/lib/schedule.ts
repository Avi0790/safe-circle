import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { formatClockTime } from '@/lib/format';
import { language, t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

// Planned shifts (migration ...000074). Owners, admins and a worker's managers
// plan them; the worker sees their own and their phone reminds them before
// each one starts. org_schedule() pairs each planned shift with the clock-in
// nearest its start, so a timesheet can show planned against actual hours.

export type ScheduleStatus = 'upcoming' | 'on_time' | 'late' | 'missed' | 'worked';

export interface ScheduleRow {
  id: string;
  user_id: string;
  worker_name: string | null;
  starts_at: string;
  ends_at: string;
  job_site: string | null;
  note: string | null;
  clocked_in_at: string | null;
  clocked_out_at: string | null;
  status: ScheduleStatus;
}

export const SHIFT_LENGTHS = [4, 6, 8, 10, 12];
export const NOTE_MAX = 200;
export const REMIND_BEFORE_MS = 30 * 60_000;
// how far ahead the phone keeps reminders (iOS allows 64 pending in all)
export const REMIND_AHEAD_DAYS = 14;
const REMINDER_PREFIX = 'safecircle-shift-';

const STATUS: Record<ScheduleStatus, { label: string; tone: 'muted' | 'good' | 'warn' | 'danger' }> = {
  upcoming: { label: 'Upcoming', tone: 'muted' },
  on_time: { label: 'On time', tone: 'good' },
  worked: { label: 'Worked', tone: 'good' },
  late: { label: 'Late', tone: 'warn' },
  missed: { label: 'Missed', tone: 'danger' },
};

export function statusInfo(status: string) {
  return STATUS[status as ScheduleStatus] ?? STATUS.upcoming;
}

const locale = () => (language() === 'es' ? 'es-US' : 'en-US');

// "Tue, Nov 3"
export function dayLabel(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' });
}

// "7:00 AM – 3:00 PM"
export function timeRange(startsAt: string, endsAt: string): string {
  return `${formatClockTime(startsAt)} – ${formatClockTime(endsAt)}`;
}

const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

// Planned against actual for a set of planned shifts: worked time counts from
// the clock-in to the clock-out (or now, while on shift).
export function planVsActual(rows: ScheduleRow[], now = Date.now()) {
  let plannedMinutes = 0;
  let workedMinutes = 0;
  let late = 0;
  let missed = 0;
  for (const r of rows) {
    plannedMinutes += minutesBetween(r.starts_at, r.ends_at);
    if (r.clocked_in_at) {
      const end = r.clocked_out_at ?? new Date(now).toISOString();
      workedMinutes += Math.max(0, minutesBetween(r.clocked_in_at, end));
    }
    if (r.status === 'late') late += 1;
    if (r.status === 'missed') missed += 1;
  }
  return { plannedMinutes, workedMinutes, late, missed, shifts: rows.length };
}

// The next shift of yours that hasn't ended.
export function nextShift<T extends Pick<ScheduleRow, 'starts_at' | 'ends_at'>>(rows: T[], now = Date.now()): T | null {
  return (
    rows
      .filter((r) => new Date(r.ends_at).getTime() > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null
  );
}

// Start times offered when planning: on the half hour, 5 AM to 10 PM.
export function startTimes(): { hour: number; minute: number }[] {
  const out: { hour: number; minute: number }[] = [];
  for (let h = 5; h <= 22; h++) for (const m of [0, 30]) out.push({ hour: h, minute: m });
  return out;
}

// The next `count` days, starting today, at local midnight.
export function upcomingDays(now = new Date(), count = 14): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
}

export function shiftTimes(day: Date, hour: number, minute: number, lengthHours: number) {
  const starts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
  return { starts, ends: new Date(starts.getTime() + lengthHours * 3_600_000) };
}

export async function fetchSchedule(orgId: string, from: Date, to: Date) {
  const { data, error } = await supabase.rpc('org_schedule', {
    p_org: orgId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  return { rows: (data as ScheduleRow[] | null) ?? [], error: error?.message ?? null };
}

export async function planShift(input: {
  orgId: string;
  userId: string;
  starts: Date;
  ends: Date;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('schedule_shift', {
    p_org: input.orgId,
    p_user: input.userId,
    p_starts: input.starts.toISOString(),
    p_ends: input.ends.toISOString(),
    p_note: input.note?.trim() || null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function cancelShift(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('cancel_scheduled_shift', { p_id: id });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---- reminders, on the worker's phone ----

export interface Reminder {
  identifier: string;
  fireAt: Date;
  title: string;
  body: string;
}

// One local notification half an hour before each of your shifts in the next
// two weeks (or right away, a minute from now, for one starting sooner). On
// the phone, so it fires with no signal.
export function shiftReminders(
  rows: Pick<ScheduleRow, 'id' | 'starts_at' | 'ends_at' | 'job_site'>[],
  orgName: string,
  now = Date.now(),
): Reminder[] {
  const horizon = now + REMIND_AHEAD_DAYS * 86_400_000;
  const out: Reminder[] = [];
  for (const r of rows) {
    const start = new Date(r.starts_at).getTime();
    if (start <= now + 60_000 || start > horizon) continue;
    const fireAt = Math.max(start - REMIND_BEFORE_MS, now + 60_000);
    out.push({
      identifier: `${REMINDER_PREFIX}${r.id}`,
      fireAt: new Date(fireAt),
      title: t('📅 Your shift starts at {time}', { time: formatClockTime(r.starts_at) }),
      body: r.job_site
        ? t('{org} · {site}. Clock in in Safe Circle when you get there.', { org: orgName, site: r.job_site })
        : t('{org}. Clock in in Safe Circle when you get there.', { org: orgName }),
    });
  }
  return out;
}

// Replaces whatever shift reminders the phone had with these.
export async function syncShiftReminders(reminders: Reminder[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const wanted = new Set(reminders.map((r) => r.identifier));
    await Promise.all(
      pending
        .filter((n) => n.identifier.startsWith(REMINDER_PREFIX) && !wanted.has(n.identifier))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    if (reminders.length === 0) return;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    for (const r of reminders) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: { title: r.title, body: r.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.fireAt },
      });
    }
  } catch (err) {
    // a missing reminder never stops anything else
    console.warn('[schedule] could not set shift reminders:', err);
  }
}
