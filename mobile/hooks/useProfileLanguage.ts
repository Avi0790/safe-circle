import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { language } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useThemeVersion } from '@/lib/theme';

// Tells the server which language you read Safe Circle in, so the
// notifications sent to you arrive in it too (profiles.language, migration
// ...000071; translated by the push Edge Functions). Runs when you sign in
// and whenever the language changes (a switch redraws, see lib/i18n.ts).
export function useProfileLanguage(): void {
  useThemeVersion();
  const { session } = useAuth();
  const userId = session?.user.id;
  const lang = language();
  useEffect(() => {
    if (!userId) return;
    try {
      // a server without the column refuses it; nothing else depends on it
      supabase
        .from('profiles')
        .update({ language: lang })
        .eq('id', userId)
        .then(
          () => {},
          () => {},
        );
    } catch {
      // not saved: notifications stay in English
    }
  }, [lang, userId]);
}
