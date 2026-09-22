# Safe Circle — Backend

Backend & data layer for the Safe Circle capstone project (Team Beacon).
Built on [Supabase](https://supabase.com): hosted Postgres, auth, and realtime —
no custom server to run or deploy.

## Schema

Four tables, per the proposal:

| Table            | Purpose                                                            |
|-------------------|---------------------------------------------------------------------|
| `profiles`        | One row per user, mirrors `auth.users`. Created automatically on sign-up. |
| `circles`         | A private group. Stores only a **hash** of its invite code, never the plaintext. |
| `circle_members`  | Join table: who belongs to which circle.                          |
| `locations`       | Append-only location pings (lat/lng/accuracy/battery/speed/timestamp). One row per update. |

`latest_locations` is a view over `locations` (distinct-on latest row per user) for the live map to query instead of re-deriving "most recent" client-side.

`speed` (ground speed, m/s, nullable) was added later (`...000018_location_speed.sql`) — expo-location reports it on every fix but the column didn't exist yet. Powers the "driving" status on both clients (beyond the proposal — see the top-level README).

Plus the geofencing/notifications stretch goal:

| Table                     | Purpose                                                             |
|---------------------------|----------------------------------------------------------------------|
| `places`                  | A named geofence (lat/lng/radius) inside a circle, e.g. "School".   |
| `place_membership_state`  | Bookkeeping: is this user currently inside this place? Lets us detect a transition instead of re-alerting on every ping. |
| `geofence_events`         | Log of `arrived`/`left` transitions. Written only by a trigger.     |
| `push_tokens`             | Expo/FCM push tokens per user/device.                               |

Plus the SOS button:

| Table         | Purpose                                                                     |
|---------------|-------------------------------------------------------------------------------|
| `sos_events`  | One tap = one row with your location. Not circle-scoped (same rule as `locations`) — visible to anyone who shares a circle with you. `resolved_at`/`resolved_by` track who cleared it. |

Plus in-circle chat (beyond the proposal — see the top-level README):

| Table      | Purpose                                                                        |
|------------|---------------------------------------------------------------------------------|
| `messages` | One row per chat message, scoped to a circle. Deliberately append-only, same philosophy as `locations`/`sos_events` — no edit, no delete. `...000016_messages.sql`. |

A new message also pushes to the rest of the circle (`...000017_message_push.sql` /
`send-message-push` Edge Function) — same pg_net + Vault-shared-secret
pattern as geofence/SOS, reusing `geofence_webhook_secret` rather than a
fourth one. Deployed via `supabase functions deploy send-message-push`;
verified live by confirming it 401s without the shared secret, same bar
used for the original webhook security fix above.

### Safety features beyond Life360 (migrations `...000024`–`...000027`)

The design theme is consent-based, time-limited safety. All three share one
internal push path: `send_alert_push()` (SQL) decides who and what, and the
`send-alert-push` Edge Function only turns user ids into Expo tokens (401s
without the shared secret, like the others). `send_alert_push` and the other
internal helpers are `revoke`d from `anon`/`authenticated` — functions in
`public` are otherwise callable by any signed-in user over `/rpc`, which for
these would mean pushing arbitrary text to anyone or raising fake SOS alerts.

| | What it does | Where the guarantee lives |
|---|---|---|
| **Temporary sharing** (`profiles.share_until`, `set_share_window`) | Share for a fixed window instead of until you remember to stop. | `locations` RLS: after the window, circle-mates can't read your pings **and** you can't write new ones. Refusing the writes matters — merely hiding them would make everything recorded after expiry visible the next time you started sharing. |
| **Walk me home** (`walks`, `start_walk` / `end_walk` / `extend_walk`) | Pick a saved place + a timer. Circle is told you left and when you arrive (a trigger on `locations` detects it). | A `pg_cron` job runs `expire_walks()` every minute: a walk past its deadline goes `overdue` and raises a **normal SOS** at your last known location (so it reuses the SOS banner and push), unless you arrive or tap "I'm safe" first — which also clears that SOS. No write policies on `walks`; only the RPCs change it. |
| **Need a ride** (`ride_requests`, `request_ride` / `accept_ride` / `cancel_ride`) | One tap alerts circle-mates who are **currently driving** (fix < 3 min old, >= 15 mph) **within ~6 mi**. Nobody qualifies? The app offers "ask everyone". | First `accept_ride` wins (atomic `UPDATE ... WHERE status = 'open'`); rate-limited to 5 per 10 min like SOS. |

Verified on the hosted DB in a rolled-back transaction: window open/closed
visibility, insert refused after expiry, arrival detection, expiry -> SOS
with last-known location -> resolved by "I'm safe", outsiders can't see,
start, end or accept anything, drivers-only vs everyone counts, double-accept
refused, and `has_function_privilege` showing the helpers are not callable by
clients. The cron job is live (`cron.job_run_details` shows it succeeding).

### Privacy and accountability features (migrations `...000028`–`...000032`)

A second batch on the same theme, aimed at Life360's other big criticism —
always-on tracking with no accountability for who's watching or how long
data sticks around.

| | What it does | Where the guarantee lives |
|---|---|---|
| **Who's checked on me** (`location_views`, `record_location_view`) | Logs when a circle-mate opens your location *history* screen (not every glance at the live map — that's everyone, continuously, and would just be noise). | Deduped to one row per (viewer, viewed) pair per 15 min; only the viewer and the viewed person can read the log — a third circle-mate can't see who's watching whom. |
| **Auto-delete history** (`profiles.history_retention_days`, `set_history_retention`) | Pick 1 / 7 / 30 days or forever for your own location trail. | A `pg_cron` job (`purge_old_locations`, daily at 04:17 UTC) deletes rows past the window — actual deletion, not a UI filter — but never the single most recent row per person, so the live map pin can't disappear from a stale retention setting. |
| **SOS acknowledge + escalation** (`sos_acknowledgements`, `acknowledge_sos`, `escalate_unacknowledged_sos`) | Circle-mates tap "I'm on my way"; the sender is told who's responding. If **nobody** acknowledges within 3 min, the whole circle is re-pushed (repeated every 5 min via `pg_cron`) instead of the alert quietly sitting there. | `acknowledge_sos` only pushes on a genuinely new acknowledgement (`on conflict do nothing` + `found`) — caught in testing: an early version re-pushed the sender on every repeat tap of the same button. |
| **Quick status** (`profiles.status_emoji/status_text/status_expires_at`, `set_status` / `clear_status`) | A short chip ("On my way", "Studying", "Don't disturb") next to your name and pin, from a fixed picklist. | Self-expires after up to 24h (`status_expires_at`) — checked client-side (`isStatusActive`) rather than needing a cleanup job, since an expired chip just stops being *shown*, it doesn't need to stop *existing*. |

Verified on the hosted DB in a rolled-back transaction: view logging dedupes
and is blocked for outsiders and self-views; retention purge keeps recent
rows and always keeps the latest one even when everything else is old;
invalid retention/status values rejected; acknowledging twice inserts once
and pushes once (the bug above, confirmed fixed); an unacknowledged SOS
escalates once and then throttles; escalation is skipped once someone
acknowledges; status text over 40 chars and windows over 24h rejected; and
`has_function_privilege` showing the internal helpers aren't callable by
clients. Both new cron jobs (`purge-old-locations`, `escalate-sos`) are
registered alongside `expire-walks`.

### Auto status from places (migrations `...000033`–`...000034`)

Arriving at a saved place sets your quick status on its own ("🏠 Home",
"📚 In class") — no Life360 equivalent, and nearly free: `evaluate_geofences()`
(migration `...000006`) already logs every arrive/leave transition to
`geofence_events`, so `apply_auto_status()` is just a second trigger on that
same table rather than duplicating the geofence math. `profiles.status_auto`
distinguishes "the app set this" from "I picked this" — arriving somewhere
only ever touches an absent or previously-auto status, and a status you set
yourself (via `set_status`) is never silently overwritten or cleared by a
later arrival/departure. Place names are matched with the same rules as
mobile/web's `placeIcon()` (`status_for_place()`, kept in sync by hand).

Verified on the hosted DB with real location inserts crossing into and out
of a place (not a synthetic call — this exercises the whole chain:
`locations` insert → `evaluate_geofences` → `geofence_events` insert →
`apply_auto_status`): arriving sets the status, leaving clears it, a manual
status survives both an arrival and a departure at another place, and a
fresh arrival after clearing a manual status re-applies the auto one. One
real bug caught by that test and fixed in `...000034`: a brand-new
profile's `status_auto` defaults to `false` (not null) — indistinguishable
from "a manual status is active" — so the original check skipped every
first arrival; the fix asks whether a manual status is *currently active*
instead of what the flag happens to be.

### Ghost mode, meetup pins, and curfew (migrations `...000035`–`...000038`)

| | What it does | Where the guarantee lives |
|---|---|---|
| **Ghost mode** (`hidden_from`, `hide_from` / `unhide_from`) | Hide your location from one specific circle-mate while everyone else still sees you normally — no Life360 equivalent, which is circle-wide or nothing. | `locations` RLS gains one more condition (`is_hidden_by()`); `hidden_from` itself can only be read by its owner, so neither the hidden person nor anyone else can confirm who's been hidden from whom. |
| **Meetup pins** (`map_pins`, `drop_pin` / `remove_pin`) | Drop a temporary "meet here" pin (festival, trailhead, campus) for the whole circle, pushed on drop, gone on its own. | `drop_pin` validates membership, label length, and a 24h cap on the expiry; a daily `pg_cron` job (`purge_expired_pins`) clears rows a day past expiry — live filtering is `expires_at > now()` on the client side, this is just storage hygiene. |
| **Curfew** (`curfews`, `set_curfew` / `clear_curfew`) | "Alert my circle if I'm not home by 10pm" — set once, then automatic. Reuses `place_membership_state` (already kept live by `evaluate_geofences()`), so there's no second location-tracking mechanism. | A `pg_cron` job (`check_curfews`, every 5 min) alerts once per calendar day (`last_alerted_date`) and skips anyone currently inside their curfew place. **Known simplification:** compared against UTC clock time — `profiles` has no timezone column, and real per-user timezone handling is out of scope for a capstone demo; documented here and in `mobile/README.md` rather than silently wrong. |

Verified on the hosted DB in a rolled-back transaction. One real bug caught
and fixed in `...000038`: hiding someone did nothing — the `locations`
policy's inline `hidden_from` subquery ran as the *viewer*, and
`hidden_from`'s own RLS only lets the *owner* read their rows, so as the
hidden viewer the subquery could never see the row hiding them and always
evaluated to "not hidden." Same class of problem `shares_circle_with()` and
`is_member_of()` already solve for `circle_members`: wrapped the check in
its own security-definer function (`is_hidden_by()`) so it runs as the
table owner instead. Also verified: an outsider can't drop or see a pin in
a circle they're not in; only the creator can remove their own pin; a label
over 40 chars or a pin longer than 24h is rejected; `purge_expired_pins`
only removes pins a day past expiry; curfew alerts fire once per day, skip
while home, and re-arm the next day; changing a curfew resets the
once-per-day guard; and an outsider can't set another person's curfew.

### Text for help and check-on-me timers (migrations `...000039`–`...000040`)

Every alert feature so far — SOS, walks, curfew, nearby — depends on this
phone *and* Supabase both having internet at the same time. A dead data
connection or an outage takes all of it down together. Two additions close
that gap.

| | What it does | Where the guarantee lives |
|---|---|---|
| **Text for help** (`profiles.phone_number`, `backup_contacts`) | An SMS fallback: compose (not silently send) a text with a location link to circle-mates who've added a phone number, or to personal backup contacts outside any circle. | `phone_number` rides on `profiles`' existing RLS — no new policy needed. `backup_contacts` is the first table in this project with direct owner-only policies (`for all using/with check (user_id = auth.uid())`) instead of security-definer RPCs, since there's no cross-user visibility to broker: nobody but the owner should ever read or write it. |
| **Check on me** (`safety_timers`, `start_safety_timer` / `end_safety_timer` / `extend_safety_timer`) | Walk me home's sibling for when there's no destination — studying alone, a first date, a solo hike. Set a timer and an optional note; an SOS fires automatically at your last known location if you don't check in. | A separate table from `walks` rather than making `place_id` nullable there — `walks`' schema (destination coordinates, arrival radius, the arrival trigger) is entirely built around having a place to arrive at, and retrofitting it would have been riskier than a small table with none of that. Same `pg_cron`-driven expiry pattern as `expire_walks()`. |

`end_safety_timer` learned from the SOS-acknowledge bug two batches back
(migration `...000032`): it checks `if t.status = 'safe' then return; end if;`
*before* doing anything else, so calling it more than once (a slow network,
a double-tap) only ever pushes the circle once — verified directly with
three back-to-back calls in one rolled-back transaction, not just inferred
from the guard being present.

Also verified: a circle-mate can read someone's `phone_number` (existing
`profiles` RLS) but an outsider can't see the profile row at all; a
circle-mate cannot read or write another person's `backup_contacts`;
`start_safety_timer` rejects an outsider, a label over 60 chars, and a
timer longer than 8 hours; starting a second timer ends the first the same
way a second walk does; expiry raises an SOS carrying the note and the
last known location, and a second expiry run on the same overdue timer is
a no-op; extending past the 10-hour cap is rejected; and another person
can't end or extend your timer.

## How access control works

Row-level security is the enforcement point, not application code:

- **Locations**: you can always write your own position. You can only *read*
  someone else's position if `circle_members` shows you share a circle with
  them (checked via the `shares_circle_with()` helper function).
- **Circles / circle_members**: visible only to members of that circle
  (`is_member_of()` helper). Leaving is a normal delete of your own
  membership row (`circle_members_delete_self`); a circle's creator can
  additionally remove *someone else's* row (`circle_members_delete_by_creator`,
  `...000014_circle_members_creator_removal.sql`) but not their own through
  that path — self-removal for a creator goes through Leave/Delete-circle
  instead, since dropping their own membership would make `is_member_of()`
  (and so `circles_select_members`) stop returning the circle to them at
  all, permanently orphaning it from their own view.
- **Joining a circle never happens via a raw INSERT.** It goes through two
  `security definer` RPCs so a client can never forge membership or brute-force
  invite codes against the table directly:
  - `create_circle(circle_name text)` — creates a circle, generates + hashes a
    6-character invite code, adds the caller as the first member, and returns
    the plaintext code **once** (it's never stored or retrievable again — if
    it's lost, regenerate a new circle or add a `regenerate_invite_code` RPC
    later).
  - `redeem_invite_code(code text)` — hashes the submitted code, looks up the
    matching circle, and enrolls the caller. Codes expire after 48h
    (`invite_code_expires_at`), and each user is capped at 10 redemption
    attempts per rolling 15-minute window (`invite_redemption_attempts`) —
    added after a security review found the original version had neither,
    leaving it open to brute-forcing the 6-character code. An invalid or
    expired code returns `null` rather than throwing, deliberately: a
    thrown exception aborts the whole call's transaction, which would also
    undo that same call's attempt-counter update, and a wrong code is
    exactly what a brute-force guess looks like — raising here silently
    defeated the rate limit (caught by testing: 12 wrong guesses left the
    counter table empty). Callers should treat a `null` return as
    "invalid code," not rely on `error`.

This mirrors the proposal's security section (page 4/5 of the proposal):
"access is enforced in the database" and "hashed invite codes."

Geofence detection itself needs no Edge Function or cron job — a trigger
(`evaluate_geofences()`) runs after every `locations` insert, checks the
reporting user's position against every place in their circles, and on an
inside/outside transition writes a row to `geofence_events`, which a
second trigger (`notify_geofence_event`, migration `...000007`) turns into
an HTTP call via the `pg_net` extension to the `send-geofence-push` Edge
Function — that's the part that actually talks to Expo/FCM.

This is wired with `pg_net` directly rather than Supabase's Dashboard
"Database Webhooks" UI, because that UI depends on an internal
`supabase_functions` schema that isn't provisioned on every project
(hit this as `ERROR: 3F000: schema "supabase_functions" does not exist`
when first setting this up). The `pg_net` approach is equivalent but
lives entirely in a migration instead of a manual dashboard step — just
make sure the `pg_net` extension is enabled (migration `...000007` does
this with `create extension if not exists pg_net;`).

**The webhook call is authenticated**, not just JWT-shaped. A security
review caught that the Edge Function originally trusted its request body
outright: its `verify_jwt` setting only checks that *some* valid Supabase
JWT was presented, and the public anon key (embedded in every client)
satisfies that trivially — nothing verified the call actually came from
our own trigger. Migration `...000009` closes this: it generates a random
shared secret via Supabase Vault (`vault.create_secret`, value never
written in plaintext to any git-tracked file), the trigger sends it as an
`X-Webhook-Secret` header, and the function now rejects anything that
doesn't match (`send-geofence-push/index.ts`).

## Environment variables

Two `.env.example` files, for two different audiences:

- [`.env.example`](../.env.example) (repo root) — client-safe
  `SUPABASE_URL` / anon key for **Avi (mobile)** and **Thi (web)**. Safe to
  put in a client bundle; RLS is what actually protects the data.
- [`backend/.env.example`](.env.example) — used only by Surendra to `supabase
  link` this folder and to deploy the Edge Function's secrets. The
  `service_role` key **must never** reach a client or get committed.

Copy each to `.env` (already gitignored) and fill in real values from
Project Settings → API once the Supabase project exists.

## Running locally

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase start          # boots local Postgres/Auth/Realtime/Studio in Docker
supabase db reset       # applies all migrations + seed.sql from scratch
```

Studio (table editor, SQL editor, auth users) runs at http://localhost:54323
once `supabase start` finishes.

## Deploying

```bash
supabase link --project-ref <your-project-ref>
supabase db push         # applies migrations to the hosted project, including the pg_net trigger

# Push notifications (stretch goal):
supabase functions deploy send-geofence-push
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` don't need to be set as
Edge Function secrets — Supabase injects both automatically for every
project (`supabase secrets list` will show them already present).

**One extra one-time step for `GEOFENCE_WEBHOOK_SECRET`**, needed only
the *first* time you push these migrations to a given project (already
done for our shared hosted project — skip this if you're just pulling
latest and pushing more migrations to the same project):

```bash
# 1. Push migrations 000009-000010 (NOT 000011 yet — see note below),
#    which generates the secret in Vault and creates a locked-down,
#    service_role-only accessor for it.
# 2. Read it out and mirror it into the Edge Function's env:
SECRET=$(curl -s -X POST "https://<ref>.supabase.co/rest/v1/rpc/_read_geofence_webhook_secret" \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" -d '{}' | tr -d '"')
supabase secrets set "GEOFENCE_WEBHOOK_SECRET=$SECRET"
supabase functions deploy send-geofence-push
# 3. Only now push migration 000011, which drops the accessor entirely.
```

If you `supabase db push` all pending migrations at once on a brand-new
project, 000011 drops the accessor in the same batch as 000009 creates
it — before you get a chance to read the secret out. For a fresh project,
apply through 000010 first, do the sync above, then apply 000011.

Give the mobile app and web dashboard the project's `SUPABASE_URL` and
`SUPABASE_ANON_KEY` (Project Settings → API) via the root `.env.example`.
Never ship the `service_role` key to a client — it bypasses RLS entirely.

## Example usage (client SDK)

```ts
// Create a circle
const { data, error } = await supabase.rpc('create_circle', { circle_name: 'The Smiths' });
// data: [{ circle_id, invite_code }] — show invite_code to the user once.

// Join a circle — check `data`, not just `error`: an invalid/expired
// code returns null rather than throwing (see the RLS section above).
const { data: joinedCircleId, error: joinError } = await supabase
  .rpc('redeem_invite_code', { code: 'AB12CD' });
if (joinError) { /* e.g. rate-limited */ }
if (!joinedCircleId) { /* invalid or expired code */ }

// Report a location ping
await supabase.from('locations').insert({
  latitude, longitude, accuracy, battery_level,
});

// Subscribe to the live map
supabase
  .channel('locations-feed')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, handleNewPing)
  .subscribe();

// Create a geofenced place (any circle member can)
await supabase.from('places').insert({
  circle_id, name: 'School', latitude, longitude, radius_meters: 150,
});

// Register this device for push notifications (call after Expo/FCM gives you a token)
await supabase.from('push_tokens').upsert({ token: expoPushToken, platform: 'ios' });

// See who's currently inside a place, and the arrive/leave history
await supabase.from('place_membership_state').select('*').eq('place_id', placeId);
await supabase.from('geofence_events').select('*').eq('place_id', placeId).order('occurred_at', { ascending: false });
```

## Everything from the proposal is built

All of the MVP (page 3) and all three stretch goals — geofenced places
with arrive/leave alerts, location history, and the SOS button — are
implemented, backend through UI, and verified against the real hosted
project rather than just written:

- **SOS button** — `sos_events` (not circle-scoped, same pattern as
  `locations`/`profiles`: visibility is "you, or anyone who shares a
  circle with you," via `shares_circle_with()`). One tap
  (`mobile/components/SosButton.tsx`) inserts a row with your current
  location; `notify_sos_event()` (migration `...000012`) fires the same
  pg_net + Vault-secret pattern as the geofence webhook, reusing the same
  `geofence_webhook_secret` rather than minting a second one, to the
  `send-sos-push` Edge Function, which notifies everyone across every
  circle you're in. Any circle member (or you) can mark it resolved
  (`mobile/components/SosBanner.tsx`), which is live via realtime. Capped
  at 3 alerts per 10 minutes per user (migration `...000013`) — a
  follow-up security pass caught that the first version had no limit,
  letting a buggy or malicious client spam a family and drain the Expo
  push quota. Enforced with a `before insert` trigger that counts
  existing rows rather than a mutable counter, sidestepping the exact
  rollback pitfall the invite-code rate limit hit (see below).
- **Location history** — `mobile/app/(app)/member/[userId].tsx` (tap a
  member on the Members tab) shows their last 100 pings as a map trail
  (list-only on web — `react-native-maps` has no web renderer, see
  `[userId].web.tsx`). No backend changes needed; `locations` was already
  append-only, so this is purely a new read.
- **Geofencing** — see the "How access control works" section above.

Caught one real bug building SOS: `sos_events` has two foreign keys to
`profiles` (`user_id` and `resolved_by`), so PostgREST couldn't
auto-resolve `profiles(full_name)` embeds (`PGRST201`, "more than one
relationship was found") until the query specified
`profiles!sos_events_user_id_fkey(full_name)`.
