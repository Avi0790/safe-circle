import { checkInToCircle } from '@/lib/circleCheckIn';
import { getShareStatus, isDriving, isStale, isStatusActive, speedToMph, timeAgo } from '@/lib/format';
import { formatDistanceMiles, haversineMeters } from '@/lib/geo';
import { sendSos } from '@/lib/sos';
import { STATUS_DURATION_MINUTES } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import type { MemberWithLocation } from '@/lib/types';

// What Safe Circle shows on CarPlay (modules/safecircle-carplay draws it).
// CarPlay apps can't show their phone screens; in Apple's "Driving Task"
// category they get lists, short info screens and alerts, glanceable and
// one tap deep. So: the circle (who's where, sorted nearest first), and three
// quick actions. SOS asks for confirmation on the car screen first.

export interface CarPlayRow {
  id: string;
  title: string;
  detail: string;
  // shown when the row is tapped (an information screen)
  lines: { title: string; detail: string }[];
}

export interface CarPlayAction {
  id: CarPlayActionId;
  title: string;
  detail: string;
  // asked on the car screen before the action is sent
  confirm?: { title: string; button: string };
}

export interface CarPlayState {
  signedIn: boolean;
  circleName: string | null;
  members: CarPlayRow[];
  actions: CarPlayAction[];
}

export type CarPlayActionId = 'on-my-way' | 'check-in' | 'sos';

export const CARPLAY_ACTIONS: CarPlayAction[] = [
  { id: 'on-my-way', title: '🚗 On my way', detail: 'Set your status for your circle' },
  { id: 'check-in', title: '📍 Check in', detail: 'Share where you are in the circle chat' },
  {
    id: 'sos',
    title: '🆘 SOS',
    detail: 'Alert your circle with your location',
    confirm: { title: 'Send SOS to your circle?', button: 'Send SOS' },
  },
];

function memberRow(m: MemberWithLocation, myLocation: MemberWithLocation['location'], now: number): CarPlayRow & { meters: number | null } {
  const loc = m.location;
  const status = isStatusActive(m.status_expires_at) && m.status_emoji ? `${m.status_emoji} ${m.status_text ?? ''}`.trim() : null;
  const meters = loc && myLocation ? haversineMeters(myLocation.latitude, myLocation.longitude, loc.latitude, loc.longitude) : null;
  const distance = meters != null ? formatDistanceMiles(meters) : null;
  const away = distance == null ? null : distance === 'nearby' ? 'Nearby' : `${distance} away`;

  let where: string;
  if (getShareStatus(m.share_until, now) === 'ended') where = 'Stopped sharing';
  else if (!loc) where = 'No location yet';
  else if (isDriving(loc.speed)) {
    const mph = speedToMph(loc.speed);
    where = `Driving${mph != null ? ` ${Math.round(mph)} mph` : ''}`;
  } else where = `${isStale(loc.recorded_at) ? 'Last seen' : 'Updated'} ${timeAgo(loc.recorded_at)}`;

  const detail = [status, away, where].filter(Boolean).join(' · ');
  const lines = [
    ...(status ? [{ title: 'Status', detail: status }] : []),
    { title: 'Where', detail: away ?? where },
    ...(away ? [{ title: 'Last update', detail: where }] : []),
    ...(loc?.battery_level != null ? [{ title: 'Battery', detail: `${Math.round(loc.battery_level * 100)}%` }] : []),
  ];
  return { id: m.id, title: m.full_name, detail, lines, meters };
}

// Everyone but you, nearest first; people without a known distance last.
export function carPlayState(input: {
  signedIn: boolean;
  circleName: string | null;
  members: MemberWithLocation[];
  myUserId: string | undefined;
  now?: number;
}): CarPlayState {
  const now = input.now ?? Date.now();
  const me = input.members.find((m) => m.id === input.myUserId);
  const rows = input.members
    .filter((m) => m.id !== input.myUserId)
    .map((m) => memberRow(m, me?.location ?? null, now))
    .sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity) || a.title.localeCompare(b.title))
    .map(({ meters: _meters, ...row }) => row);
  return { signedIn: input.signedIn, circleName: input.circleName, members: rows, actions: CARPLAY_ACTIONS };
}

// What a tap on the car screen does. The message comes back to the car as a
// short alert, so it has to be brief.
export async function runCarPlayAction(id: string, circleId: string | null): Promise<string> {
  switch (id) {
    case 'on-my-way': {
      const { error } = await supabase.rpc('set_status', { p_emoji: '🚗', p_text: 'On my way', p_minutes: STATUS_DURATION_MINUTES });
      return error ? `Couldn't set status: ${error.message}` : 'Status set: On my way';
    }
    case 'check-in': {
      const r = await checkInToCircle(circleId);
      return r.ok ? 'Checked in with your circle' : `Couldn't check in: ${r.error}`;
    }
    case 'sos': {
      const r = await sendSos();
      return r.ok ? 'SOS sent to your circle' : `SOS not sent: ${r.message}`;
    }
    default:
      return 'Unknown action';
  }
}
