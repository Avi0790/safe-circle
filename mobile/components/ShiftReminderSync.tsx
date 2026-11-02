import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { useAuth } from '@/contexts/AuthContext';
import { activeOrgs } from '@/lib/orgInfo';
import { fetchSchedule, REMIND_AHEAD_DAYS, shiftReminders, syncShiftReminders, type Reminder } from '@/lib/schedule';
import { supabase } from '@/lib/supabase';
import { useThemeVersion } from '@/lib/theme';

// Keeps the phone's shift reminders in step with the schedule your managers
// plan (lib/schedule.ts): on open, on coming back to the front, and whenever
// a shift of yours is planned or cancelled. Draws nothing.
export function ShiftReminderSync() {
  const version = useThemeVersion(); // a language switch rewords them
  const { session } = useAuth();
  const { orgs } = useAccount();
  const userId = session?.user.id;
  const workerOrgs = activeOrgs(orgs).filter((o) => o.role === 'worker');
  const key = workerOrgs.map((o) => `${o.org_id}:${o.name}`).join('|');

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const sync = async () => {
      const now = new Date();
      const to = new Date(now.getTime() + REMIND_AHEAD_DAYS * 86_400_000);
      const all: Reminder[] = [];
      for (const org of workerOrgs) {
        const { rows, error } = await fetchSchedule(org.org_id, now, to);
        if (error) return; // offline: keep the reminders the phone already has
        all.push(...shiftReminders(rows.filter((r) => r.user_id === userId), org.name));
      }
      if (alive) await syncShiftReminders(all);
    };
    sync();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
    });
    const channel = supabase
      .channel(`schedule-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_shifts', filter: `user_id=eq.${userId}` }, () => sync())
      .subscribe();
    return () => {
      alive = false;
      app.remove();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key, version]);

  return null;
}
