-- In-app AI help: a chatbot that answers questions about how to use Safe
-- Circle ("what does Ghost Mode do?", "how do I set a curfew?") — not an
-- emergency service. The actual chatting happens in the send-ai-help Edge
-- Function, which is the only thing that talks to Anthropic's API; this
-- migration is just the rate limit that protects against runaway cost.
--
-- Locked down (no RLS policies at all -> default deny), same as
-- invite_redemption_attempts (migration ...000010) — only the Edge
-- Function's service-role client touches this table.
create table public.ai_help_usage (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  window_start timestamptz not null default now(),
  message_count int not null default 0
);

alter table public.ai_help_usage enable row level security;
