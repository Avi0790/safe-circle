-- Real billing through Stripe (test mode until live keys are set). The owner
-- pays on Stripe's Checkout page from the web dashboard (Edge Function
-- `billing`); Stripe then calls the `stripe-webhook` Edge Function, which
-- checks Stripe's signature and calls stripe_sync_subscription() below with
-- the service role. That signed message is the only thing that can mark an
-- organization paid: the function is not callable by app users, and card
-- numbers never reach Safe Circle at all.
--
-- Organizations not on Stripe keep the demo billing (migration ...000064);
-- once an organization pays through Stripe, the demo buttons are refused so
-- the two can't disagree.

create table public.org_billing (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);

alter table public.org_billing enable row level security;
-- no policies: only the Edge Functions (service role) touch it

-- Stripe's subscription status, translated to a plan. Called only by the
-- webhook. A Stripe status we don't act on ('incomplete': checkout not
-- finished) leaves the plan as it was.
create function public.stripe_sync_subscription(
  p_org uuid,
  p_customer text,
  p_subscription text,
  p_status text,
  p_seats int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'No such organization.';
  end if;

  insert into public.org_billing (org_id, stripe_customer_id, stripe_subscription_id, updated_at)
  values (p_org, p_customer, p_subscription, now())
  on conflict (org_id) do update
    set stripe_customer_id = coalesce(excluded.stripe_customer_id, org_billing.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, org_billing.stripe_subscription_id),
        updated_at = now();

  case
    when p_status in ('active', 'trialing') then
      perform public.org_set_plan(p_org, 'active', greatest(1, least(coalesce(p_seats, 1), 500)));
    when p_status in ('past_due', 'unpaid') then
      perform public.org_set_plan(p_org, 'past_due');
    when p_status in ('canceled', 'incomplete_expired') then
      perform public.org_set_plan(p_org, 'canceled');
    else
      null;
  end case;

  return public.org_plan_state(p_org);
end;
$$;

-- For the Edge Functions: the Stripe customer to reuse at checkout, or to
-- open the billing portal for.
create function public.org_stripe_customer(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select stripe_customer_id from public.org_billing where org_id = p_org;
$$;

-- For the dashboard: is this organization paying through Stripe? Owners and
-- admins only; nobody else needs to know.
create function public.org_on_stripe(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(public.org_role_of(p_org) in ('owner', 'admin'), false) then
      exists (select 1 from public.org_billing where org_id = p_org and stripe_subscription_id is not null)
  end;
$$;

-- The demo buttons, now refused for an organization that pays through Stripe.
create or replace function public.org_demo_billing(p_org uuid, p_action text, p_seats int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.org_role_of(p_org) is distinct from 'owner' then
    raise exception 'Only the owner can change the plan.';
  end if;
  if exists (select 1 from public.org_billing where org_id = p_org and stripe_subscription_id is not null) then
    raise exception 'This organization pays through Stripe. Use Manage billing instead.';
  end if;

  case p_action
    when 'activate' then
      perform public.org_set_plan(p_org, 'active', p_seats);
    when 'payment_failed' then
      if public.org_plan_state(p_org) <> 'active' then
        raise exception 'Only an active plan has a payment to fail.';
      end if;
      perform public.org_set_plan(p_org, 'past_due');
    when 'cancel' then
      perform public.org_set_plan(p_org, 'canceled');
    when 'end_trial' then
      update public.org_plans
      set trial_ends_at = least(trial_ends_at, now()), updated_at = now()
      where org_id = p_org and status = 'trial';
    else
      raise exception 'Unknown billing action %', p_action;
  end case;
end;
$$;

revoke all on function public.stripe_sync_subscription(uuid, text, text, text, int) from public, anon, authenticated;
revoke all on function public.org_stripe_customer(uuid) from public, anon, authenticated;
revoke all on function public.org_on_stripe(uuid) from public, anon;
grant execute on function public.stripe_sync_subscription(uuid, text, text, text, int) to service_role;
grant execute on function public.org_stripe_customer(uuid) to service_role;
grant execute on function public.org_on_stripe(uuid) to authenticated;
