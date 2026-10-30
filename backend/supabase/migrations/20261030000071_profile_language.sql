-- The language someone reads Safe Circle in, so the notifications sent to
-- them arrive in it too. The database still writes every alert in English
-- (send_alert_push and the push Edge Functions); the Edge Functions translate
-- each message for its recipient just before delivery
-- (functions/_shared/pushText.ts). The app keeps this in step with the
-- language it's showing (lib/i18n.ts). Updating it goes through the existing
-- profiles_update_self policy: only you can change yours.

alter table public.profiles
  add column language text not null default 'en'
  check (language in ('en', 'es'));
