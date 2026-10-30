import { Platform } from 'react-native';
import { formatClockTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import type { OrgMembership } from '@/lib/orgInfo';
import { shiftAutoEndsAt } from '@/lib/shift';
import type { SafetyTimer, Walk } from '@/lib/types';

// Walk me home, Check on me and your shift on the iPhone lock screen and in
// the Dynamic Island, as a countdown that keeps running with the app closed
// (expo-live-activity). Only in builds made with SAFECIRCLE_LIVE_ACTIVITY=1
// (plugins/withLiveActivity.js); anywhere else starting one fails quietly
// and nothing changes.

export interface LockScreenItem {
  key: string; // what it's about, e.g. walk:<id>; a new key replaces the old
  title: string;
  subtitle: string;
  endsAt: string;
  deepLink: string;
}

// What should be showing now: your own walk, check-on-me timer and open
// shift, each counting down to its deadline. Overdue ones come off: the
// circle has already been alerted and the app's banner takes over.
export function lockScreenItems(
  walks: Walk[],
  timers: SafetyTimer[],
  orgs: OrgMembership[],
  userId: string | undefined,
  now = Date.now(),
): LockScreenItem[] {
  if (!userId) return [];
  const items: LockScreenItem[] = [];
  for (const w of walks) {
    if (w.user_id !== userId || w.status !== 'active' || Date.parse(w.expected_by) <= now) continue;
    items.push({
      key: `walk:${w.id}`,
      title: t('🚶 Walking to {place}', { place: w.place_name }),
      subtitle: t('Due {time}. Tap "I\'m safe" in the app when you arrive.', { time: formatClockTime(w.expected_by) }),
      endsAt: w.expected_by,
      deepLink: '/walk',
    });
  }
  for (const s of timers) {
    if (s.user_id !== userId || s.status !== 'active' || Date.parse(s.expected_by) <= now) continue;
    items.push({
      key: `timer:${s.id}`,
      title: `⏱️ ${s.label ?? t('Check on me')}`,
      subtitle: t('Check in by {time}, or your circle is alerted.', { time: formatClockTime(s.expected_by) }),
      endsAt: s.expected_by,
      deepLink: '/safety-timer',
    });
  }
  for (const o of orgs) {
    if (!o.on_shift || !o.shift_started_at) continue;
    const ends = shiftAutoEndsAt(o.shift_started_at);
    if (Date.parse(ends) <= now) continue;
    items.push({
      key: `shift:${o.org_id}:${o.shift_started_at}`,
      title: t('🟢 On shift at {org}', { org: o.name }),
      subtitle: t('Since {time} · visible to your managers until you clock out', { time: formatClockTime(o.shift_started_at) }),
      endsAt: ends,
      deepLink: '/work',
    });
  }
  return items;
}

type LiveActivityModule = typeof import('expo-live-activity');

function nativeModule(): LiveActivityModule | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return require('expo-live-activity') as LiveActivityModule;
  } catch {
    return null;
  }
}

// Brand colours, dark so they read on any lock screen.
const LOOK = {
  backgroundColor: '#1E1B4B',
  titleColor: '#FFFFFF',
  subtitleColor: '#C4B5FD',
  progressViewTint: '#A78BFA',
  progressViewLabelColor: '#FFFFFF',
  timerType: 'digital' as const,
};

// Starts and stops lock-screen countdowns to match `items`. Returns the
// running set: key → activity id. A failure (an older iPhone, a build
// without the extension) just means nothing shows.
export function syncLockScreen(items: LockScreenItem[], running: Map<string, string>, module = nativeModule()): Map<string, string> {
  if (!module) return running;
  const next = new Map(running);
  const wanted = new Set(items.map((i) => i.key));
  for (const [key, id] of running) {
    if (wanted.has(key)) continue;
    try {
      module.stopActivity(id, { title: t('Safe Circle') });
    } catch {
      // already gone
    }
    next.delete(key);
  }
  for (const item of items) {
    if (next.has(item.key)) continue;
    try {
      const id = module.startActivity(
        { title: item.title, subtitle: item.subtitle, progressBar: { date: Date.parse(item.endsAt) } },
        { ...LOOK, deepLinkUrl: item.deepLink },
      );
      if (id) next.set(item.key, id);
    } catch {
      // not available in this build
    }
  }
  return next;
}
