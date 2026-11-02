import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';

// Roll call (migration ...000075): "Is everyone OK?" An owner, admin or
// manager asks everyone they oversee who's on shift; each answers "I'm safe"
// or "I need help". Workers answer through components/RollCallPrompt.tsx;
// the people running it follow along on app/(app)/roll-call.tsx.

export type RollCallAnswer = 'safe' | 'help';

export interface RollCallSummary {
  id: string;
  started_by_name: string | null;
  note: string | null;
  created_at: string;
  closed_at: string | null;
  asked: number;
  safe: number;
  help: number;
  my_answer: RollCallAnswer | null;
  asked_me: boolean;
  can_close: boolean;
}

export interface RollCallPerson {
  user_id: string;
  full_name: string | null;
  answer: RollCallAnswer | null;
  answered_at: string | null;
  latitude: number | null;
  longitude: number | null;
}

export const NOTE_MAX = 120;

export function tally(r: Pick<RollCallSummary, 'asked' | 'safe' | 'help'>) {
  return { ...r, waiting: Math.max(0, r.asked - r.safe - r.help) };
}

// What the tally says, for screen readers and the summary line.
export function tallyLine(r: Pick<RollCallSummary, 'asked' | 'safe' | 'help'>, t: (s: string, v?: Record<string, string | number>) => string) {
  const { safe, help, waiting } = tally(r);
  return t('{safe} of {asked} safe · {help} need help · {waiting} no answer', { safe, asked: r.asked, help, waiting });
}

export async function startRollCall(orgId: string, note: string) {
  const { data, error } = await supabase.rpc('start_roll_call', { p_org: orgId, p_note: note.trim() || null });
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true, id: data as string } as const);
}

export async function closeRollCall(id: string) {
  const { error } = await supabase.rpc('close_roll_call', { p_id: id });
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true } as const);
}

export async function listRollCalls(orgId: string, limit = 20) {
  const { data, error } = await supabase.rpc('org_roll_calls_list', { p_org: orgId, p_limit: limit });
  return { rows: (data as RollCallSummary[] | null) ?? [], error: error?.message ?? null };
}

export async function rollCallStatus(id: string) {
  const { data, error } = await supabase.rpc('roll_call_status', { p_id: id });
  return { people: (data as RollCallPerson[] | null) ?? [], error: error?.message ?? null };
}

// Your answer, with where you are (you're on shift, or you wouldn't have
// been asked). The answer goes even if the position can't be had.
export async function sendAnswer(id: string, answer: RollCallAnswer, position?: { latitude: number; longitude: number } | null) {
  const { error } = await supabase.rpc('answer_roll_call', {
    p_id: id,
    p_answer: answer,
    p_latitude: position?.latitude ?? null,
    p_longitude: position?.longitude ?? null,
  });
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true } as const);
}

export async function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
    const pos = last ?? (await Location.getCurrentPositionAsync({}));
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

// The open roll calls you were asked in and haven't answered, across your
// organizations, newest first.
export async function unansweredRollCalls(orgIds: string[]) {
  const all = await Promise.all(orgIds.map(async (orgId) => ({ orgId, ...(await listRollCalls(orgId, 5)) })));
  return all
    .flatMap(({ orgId, rows }) => rows.map((r) => ({ ...r, orgId })))
    .filter((r) => !r.closed_at && r.asked_me && r.my_answer === null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
