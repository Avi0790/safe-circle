import { FALL_SOS_MESSAGE } from '@/lib/fallDetector';
import { t } from '@/lib/i18n';

// The messages an automatic SOS carries are written in English (by the
// database for an overdue walk, timer or check-in; by the app for a fall),
// and shown here in the reader's language. Anything a person typed is shown
// as they typed it. The push Edge Function does the same for notifications
// (backend/supabase/functions/_shared/pushText.ts).
export function localizeSosMessage(message: string): string {
  if (message === FALL_SOS_MESSAGE) return t(FALL_SOS_MESSAGE);
  let m = message.match(/^Automatic alert: didn't arrive at (.+) before their walk timer ran out\. This is their last known location\.$/);
  if (m) {
    return t("Automatic alert: didn't arrive at {place} before their walk timer ran out. This is their last known location.", { place: m[1] });
  }
  m = message.match(/^Automatic alert: didn't check in(?: \((.+)\))? before their safety timer ran out\. This is their last known location\.$/);
  if (m) {
    return m[1]
      ? t("Automatic alert: didn't check in ({label}) before their safety timer ran out. This is their last known location.", { label: m[1] })
      : t("Automatic alert: didn't check in before their safety timer ran out. This is their last known location.");
  }
  if (message === 'Automatic alert: missed a scheduled check-in. This is their last known location on shift.') {
    return t('Automatic alert: missed a scheduled check-in. This is their last known location on shift.');
  }
  return message;
}
