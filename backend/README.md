# Safe Circle — Backend

*Part of [Safe Circle](../README.md) — created and developed by **Surendra B K** ([@surendr7a](https://github.com/surendr7a)).*

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

### Join approval, medical card, and guest links (migrations `...000041`–`...000043`)

| | What it does | Where the guarantee lives |
|---|---|---|
| **Join approval** (`circles.require_approval`, `join_requests`, `join_with_code`, `decide_join_request`) | A circle's creator can require their OK for each new member, so an invite code that leaks into the wrong chat only creates a request they can deny — instead of adding a stranger to a group that sees everyone's live location. Off by default; existing circles are unchanged. | `redeem_invite_code` (the old instant-join path) now returns null for approval-required circles, so an old client can't bypass it — verified. `join_with_code` shares the same 10-per-15-min attempt counter and still *returns* (not raises) on a bad code so the attempt counts. A repeat request while one is pending doesn't re-notify the creator. |
| **Medical card** (`medical_cards`, `has_active_sos`) | Blood type, allergies, conditions, medications, a note — readable by circle-mates **only while you have an active SOS** (unresolved, under 12h old). | RLS, not a hidden UI section: `medical_cards_select_during_sos`. Verified: invisible with no SOS, visible during one, invisible again once resolved or after 12h, never writable by a circle-mate, never visible to an outsider. |
| **Guest links** (`share_links`, `create_share_link`, `get_shared_location`, `revoke_share_link`) | A link for someone who doesn't have the app — a grandparent, a friend picking you up. Shows the latest location and a first name only, until it expires or you revoke it. Life360 needs everyone to install the app and join a circle. | The token is 192 random bits, stored only as a hash and returned once. `get_shared_location` is the only thing `anon` can call; it returns nothing for an unknown, expired or revoked token (indistinguishable), and `anon` can't read `share_links`, `locations`, `profiles` or `medical_cards` directly — verified with a real anon JWT. Max 5 active links, 15 min–24 h. The owner sees a per-link visit count (a visit = at most one per 5 min, so the page's 15 s refresh doesn't inflate it). |

Verified on the hosted DB in rolled-back transactions, plus a real browser
check of the guest page (map, low-battery styling, expired state) against a
throwaway fixture that was deleted afterwards. One thing that looked like a
bug and wasn't: an "anon can read `share_links`" result came from my test
leaving the previous user's JWT claims set while switching to the `anon` role
(so `auth.uid()` was still non-null); re-run with real anon claims it returned
0 rows.

**Deployment note:** guest links point at the web dashboard's `/track/<token>`
page (`web/vercel.json` rewrites all paths to the SPA). Until the dashboard is
deployed and `EXPO_PUBLIC_WEB_URL` is set, links only open on the dev network —
the mobile screen warns about this.

### Nearby alerts respect ghost mode and sharing windows (migration `...000044`)

Found while re-reading the nearby-alert trigger: it predated ghost mode and
sharing windows and ignored both, so hiding your location from Bob still let
Bob's phone say "Alice is nearby" — exactly what hiding is meant to prevent.
`evaluate_nearby()` now skips anyone whose sharing window has ended, and never
notifies a recipient about someone who has hidden from them. (The hidden-from
check is a direct query rather than `is_hidden_by()`, which is defined in terms
of `auth.uid()` — inside this trigger that's the person who just reported a
location, not the person being notified.) Verified in a rolled-back
transaction: baseline still alerts both people; after Alice hides from Bob,
only Alice is told Bob is near; after Alice's window ends, nobody is alerted.

### Ownership transfer, data export and account deletion (migration `...000045`)

| | What it does | Notes |
|---|---|---|
| **Transfer ownership** (`transfer_circle_ownership`) | The creator hands a circle to another member. Creators previously couldn't leave their own circle without orphaning it. | Creator-only; the new owner must already be a member; the old owner immediately loses creator powers. |
| **Download my data** (`export_my_data`) | Everything the app holds about you as one JSON document: profile, circles, locations (newest 5,000), messages, SOS/walk/timer history, medical card, backup contacts, who's viewed your history, and more. | Scoped strictly to the caller; not callable by `anon`. |
| **Delete my account** (`delete_my_account`) | Removes the account and everything hanging off it. | Two traps found by reading the foreign keys first: `circles.created_by` cascades, so deleting a creator would have deleted the circle for everyone else — shared circles are now handed to the longest-standing member first, and only circles with nobody else in them are deleted; and `sos_events.resolved_by` has no `ON DELETE` action, which would have blocked deletion for anyone who'd ever resolved someone's SOS — those references are cleared and the SOS kept. Profile photos are removed by the app before deleting (SQL isn't allowed to delete from Storage). |

Verified in a rolled-back transaction, including both traps: a member who had
resolved an SOS deletes cleanly, and a creator's deletion leaves the shared
circle alive under the next-oldest member while a solo circle is removed.

### In-app help (migration `...000046`, `send-ai-help` — currently unused)

In-app help for "how do I..." questions about Safe Circle itself is a **free,
fully offline keyword matcher** (`mobile/lib/helpFaq.ts`) — no backend call,
no API key, no per-question cost, works with no signal. Everything in this
project deliberately runs on free services (OpenStreetMap, Esri satellite
tiles, Open-Meteo weather, Supabase's free tier), and a real LLM API is the
one thing that would have broken that: a small real cost per question that a
capstone demo could easily forget to keep funded right before presenting.

An earlier version called Anthropic's API from an Edge Function instead —
that function (`send-ai-help`) and its rate-limit table (`ai_help_usage`,
migration `...000046`) are still deployed and still work, kept as a ready
optional upgrade rather than deleted. It's the one Edge Function in this
project called directly by the signed-in client instead of by a database
trigger, so it relies on Supabase's ordinary JWT verification (the caller's
own session) rather than the `X-Webhook-Secret` pattern the trigger-invoked
functions use. To switch to it: create an account at
[console.anthropic.com](https://console.anthropic.com) (that's on whoever
owns it — not something this repo can do), then

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

and point `mobile/app/(app)/ai-help.tsx` at `askHelp()`
(`mobile/lib/aiHelp.ts`) instead of `findFaqAnswer()`. Until the secret is
set, the function returns a clear "AI help hasn't been set up for this
project yet" (503) rather than failing confusingly. It's rate-limited to 20
questions/hour per user (one counter row per user on a rolling window) to
bound cost, and never stores chat history.

Verified against the live function: no `Authorization` header → 401; the
anon key alone (not a real signed-in session) → also 401, since it isn't a
user JWT.

### Share my ETA (migration `...000057`)

While driving with in-app directions, someone can choose, trip by trip, to let
one circle see where they're headed and when they expect to arrive, and to be
told when they get there. `shared_trips` holds only the destination's **name**, an
ETA and a status: no route and no destination coordinates, so a shared trip
reveals less than the live location the circle can already see. Written only by
`start_shared_trip` / `update_shared_trip` / `end_shared_trip` (no write
policies); one active trip per person, updates throttled to one per 15 s, ETA
within 24 h, destination 1 to 80 characters.

It follows the privacy rules of seeing someone's location: the read policy is
"you, or a circle-mate who you haven't hidden from, while you're sharing"
(Ghost mode and sharing windows apply), and the pushes go through
`trip_recipients()`, which excludes anyone the driver hid from and sends nothing
if they aren't sharing. Pushes use relative minutes ("arriving in about 12
min"), since the server doesn't know a recipient's time zone, and only a real
arrival is announced; stopping a trip just makes it vanish. A cron job every 5
minutes marks trips nobody has heard from in 10 minutes `stale` (dead battery,
no signal) and deletes finished trips after 2 days: where someone drove is not
something to keep. Included in "Download my data" (destination only).

**A gap this surfaced, not changed here:** the older `circle_recipients()`
helper used by Walk me home, Check on me and map-pin pushes ignores Ghost mode,
so those pushes still reach people the sender has hidden from. SOS is meant to
ignore it (an emergency); the others arguably shouldn't.

Verified in a rolled-back transaction (29 checks,
`tests/circles/01_shared_trips.sql`, reading recipients from the queued
pushes): visibility for the driver, a circle-mate, someone hidden from, and an
outsider; only the right people pushed; one active trip; update throttling; no
tampering by circle-mates or direct writes; arrival pushes once and stopping
pushes nobody; validation; sharing window ended; expiry and cleanup; internal
helpers not callable; the export. Every organization, SOS and security suite
was rerun with identical results.

### Drive reports (migration `...000047`)

Real trips — not just the live "🚗 Driving NN mph" status that already
existed — going beyond Life360's paywalled Driver Reports for free.
`get_trips(p_user_id, p_days, p_limit)` groups a user's `locations` pings
into sessions with a classic SQL "gaps and islands" query: a gap of more
than 15 minutes between consecutive pings starts a new session (a smaller
gap doesn't split a trip — slowing down in traffic or at a light doesn't
stop pings, only an actual break in tracking does). Sessions with at least
one driving-speed ping (`speed >= 6.7` m/s / 15 mph, the same constant
`ride_requests` already uses) are kept and aggregated into a trip: start/end
time, duration, distance (summed via the same `haversine_meters()` used
elsewhere), and max/avg speed.

It's a `security definer` function reading `locations` directly, bypassing
that table's RLS — so it re-implements
`locations_select_self_or_circlemate`'s exact visibility rule by hand rather
than inventing a separate one: your own trips are always visible, and
someone else's only if you share a circle with them, they're still sharing,
and they haven't hidden from you (Ghost Mode). Getting that check wrong here
would silently leak trip history through a door the map and location-history
screen don't have.

Verified in a rolled-back transaction: a driver with two real trips
(separated by a >15 min gap) plus one purely-stationary session — the
stationary one correctly produces zero trips, viewed as self or a
sharing circle-mate both return the 2 real trips with correct
duration/distance/speed, an outsider with no shared circle gets zero, and
Ghost Mode / an ended sharing window each correctly drop it back to zero
(restored once undone).

### Organizations for field crews (migration `...000048`)

Safe Circle for businesses: an organization with owners, admins, managers and
workers. Circles are peer groups where everyone sees everyone; an organization
is one-directional (admins and managers see workers, workers never see each
other), so it gets its own tables rather than stretching `circle_members`.

| Rule | How it's enforced |
|---|---|
| Workers are invisible until they consent | Redeeming an org code (same hashed, 48 h, rate-limited pattern as circle invites) only creates an `invited` row; `accept_org_consent` makes it `active`. The check `(status = 'active') = (consented_at is not null)` keeps the two in sync. |
| Visible only while clocked in | Positions are returned only for pings recorded inside one of the worker's shifts. Personal time before clock-in or after clock-out never comes back, even for past shifts. |
| A forgotten clock-out can't mean permanent tracking | A shift stops being visible after 14 h (`max_shift_length()`), and a cron job closes stale ones. |
| One open shift per person across all organizations | Partial unique index, so being clocked in at one employer can't make you visible to another. |
| Managers see only teams they lead | Admins/owners see all workers; managers see workers on teams where they are `is_lead`. Only a manager can lead a team (demoting one clears their lead flags). |
| No teammate visibility | Workers can only select their own rows in every org table. |
| Every look is on the record | `org_audit` rows for live views and track pulls (deduped to one per viewer and worker per 15 min, like `location_views`); the worker can read every row about them, admins read the whole organization's log. |

The design decision worth knowing: **managers and admins get no read access to
`locations` itself.** Widening that table's RLS policy would expose a worker's
whole history, including personal time before they clocked in, and reads
through RLS can't be audited. Every non-worker read goes through
`org_live_roster`, `org_worker_track` and `org_shifts`, which apply the
visibility rule, limit pings to shift windows and write the audit log.
(Consequence: the manager dashboard polls these rather than using realtime.)

Ownership edge cases: `organizations.created_by` is `ON DELETE SET NULL` so a
deleted account can't cascade-delete an organization for everyone else. If the
sole owner's account is deleted, an admin (then a manager) inherits it; if only
workers remain the organization is deleted rather than handing a worker the
power to see the whole crew. Removing or leaving a member closes their open
shift and drops their team rows.

Verified in a rolled-back transaction (46 checks): the consent gate, clock-in
rules, who sees whom (admin, lead manager, other-team manager, worker,
outsider), no direct reads of `locations`/`latest_locations`, shift-window
scoping (pings 1, 4 and 5 are personal time and never returned), audit
visibility and deduping, stale shifts, role-escalation guards, demotion,
leaving, and both account-deletion cases.

`profiles.account_type` (`individual` | `family` | `industry`, migration
`...000049`) records the signup choice that routes onboarding; it defaults to
`family` and is a routing preference only. Verified in a rolled-back
transaction: industry and individual are stored, a missing or invalid value
falls back to `family`, and no existing account changed.

`org_my_views` (migration `...000050`) lets a worker read who looked at them
(viewer name and role, what they did, when) — profiles are only readable
between circle-mates, so the names need a function. Verified in a rolled-back
transaction: the worker sees both looks by name, a different worker sees none,
and an admin sees no rows about themselves.

**SOS for work crews** (migration `...000051`): a worker's SOS now also alerts
their organization's overseers (owners and admins, plus managers leading a team
the worker is on) and lets them see, acknowledge, resolve and be re-alerted
about it, but **only if the worker was clocked in when they sent it**. An SOS
sent from home on a day off still goes to circles only, so the "nobody at work
sees you off shift" promise holds. A manager who is also in the worker's family
circle gets the circle alert and isn't pushed twice. The first alert is a
separate trigger that swallows its own errors, so an organization problem can
never stop the SOS itself being recorded. The sos policies, `acknowledge_sos`
and the escalation job were widened by exactly this rule. Verified in a
rolled-back transaction (22 checks), reading the recipients straight out of
the queued push requests: on-shift SOS reaches owner, admin and lead manager
only; off-shift reaches nobody at work; another team's manager can't see,
acknowledge or resolve it; escalation reaches the same people; a circle-mate
manager isn't doubled; an on-shift SOS stays visible after clock-out.
Workers who consented before this migration agreed to a disclosure that didn't
mention SOS; pre-launch that's fine, but a real deployment would re-ask.
Deliberately not widened: the medical card, which circle-mates can read during
an SOS but organization overseers still can't.

**Re-consent** (migration `...000052`): a worker's consent now records which
disclosure version they accepted (`org_members.consent_version`;
`org_disclosure_version()` is the current one, 2 = adds SOS and check-ins).
Anyone on an older version is invisible to managers, excluded from SOS
recipients, refused at clock-in, and shown to admins as waiting to accept, until
they re-accept in the app (`accept_org_consent` handles both first-time
invitations and re-acceptance, and logs the difference). Bump the function in
the same change as the disclosure text in `mobile/lib/orgInfo.ts`.

**Lone-worker check-ins** (migration `...000053`): at clock-in a worker can opt
into check-ins every 15 min to 4 h (`clock_in(p_org, p_checkin_minutes)`; the
old one-argument function was dropped, since two overloads would be ambiguous
to the API). A cron job every minute alerts on a check-in more than 2 minutes
overdue on a still-open shift, once per miss: it raises an SOS at the last
on-shift location (so it uses the same banner, acknowledgement and escalation,
and reaches the same overseers, never anyone when the worker is off shift),
falling back to a plain push when there is no on-shift location rather than
inventing one. `shift_check_in()` ("I'm OK") re-arms the next interval,
resolves the alert and tells the overseers. It can't use the circle "check on
me" timer, which is tied to a circle a crew member may not have. A missed
check-in is an SOS, so, like that timer, it also reaches the worker's circles.
`my_orgs()` now also returns `needs_reconsent` and the check-in schedule.

**Export** (migration `...000054`): `export_my_data()` now includes the
organizations you belong to (role, teams, accepted disclosure version), your
shifts and check-in settings, and who at work looked at your location.

Verified in a rolled-back transaction (33 checks), and every earlier test
(46 organization, 22 SOS, teams, views) was rerun against the new migrations
with identical results: re-consent hides a worker until they re-accept
(roster, SOS recipients, clock-in, audit entry), check-ins alert only when
overdue, once, on an open shift, the no-location fallback, "I'm OK"
resolving and re-arming, a finished shift never alerting, and the export
containing the organization data and only the caller's own.

**Security review** (migration `...000055`). An adversarial pass over all of the
above, reproduced against the live database before fixing (16 failures, then
0 of 36):

- *Internal helpers were callable by any signed-in user.* `revoke ... from
  public, anon` doesn't touch `authenticated`, which Supabase grants new
  functions by default. That left `org_log` (**forge or frame anyone in the
  audit log**), the overseer and SOS-recipient lists, and role and visibility
  lookups open to the API. Revoked; only policy helpers that must run as the
  caller keep access, and `team_org` was folded into one admin-only check.
- *SOS rows could be rewritten* by anyone who could see them (coordinates,
  message, timestamp, even reassigned to another user), a hole in the original
  update policy that organizations widened to overseers. Updates are now limited
  to `resolved_at`/`resolved_by`, recorded honestly (who really resolved it, at
  server time) and a resolved SOS can't be re-opened.
- *The SOS rate limit could be dodged* by sending a backdated `created_at`
  (7 of 7 got through, each pushing a circle and managers). The server now sets
  the time and the server-only fields for API callers.
- *Becoming a worker needed no consent* when demoted from owner, admin or
  manager, because those roles were pre-marked as having accepted. Entering the
  worker role now resets consent, so they appear as waiting to accept and can't
  be seen until they accept themselves.
- *Overseers saw "Someone needs help"* with no name: profiles are circle-only.
  `org_sos_details` returns just the sender's and acknowledgers' names, for SOS
  the caller oversees.

What held up: no direct writes to any organization table, one organization
can't read or change another, a removed member loses everything including sight
of their old SOS, a worker can't edit their own role or consent.

Known and accepted: a worker's phone is trusted for what it reports
(a worker can send false positions or stop tracking, as with any phone-based
tracking; managers see only what the phone sends, and the app can't prove it
is real). Invite codes are six characters from a 32-letter set, protected by
the same per-account attempt limit and 48 h expiry as circle codes, which would
not stop someone with very many accounts but makes it impractical. Reads
through `pg_temp` shadowing aren't possible through the API.

The scripts that produced these results are in `tests/organizations/`; rerun
them after changing any of this.

**Quiet-phone alert** (migration `...000056`): a clocked-in worker whose phone
hasn't sent a location for 20 minutes (or since clocking in, if none ever
arrived) triggers one plain push to the people who oversee them. It is not an
SOS: a dead battery isn't an emergency and an SOS would also reach their family
circles; check-ins stay the opt-in "are you OK?" and this is the passive net
underneath for everyone. It alerts once per stretch, resets when the phone
reports again (so a later stretch alerts again), and skips finished or
14-hour-stale shifts and anyone pending re-consent. Because it is a new thing
the app does about workers, it is in the disclosure and `org_disclosure_version()`
is now 3, so existing workers are asked to accept again. The crew screens'
"may be offline" flag still shows at 15 minutes; the push waits until 20 so a
short tunnel doesn't page anyone. Verified in a rolled-back transaction
(9 checks, `tests/organizations/09_quiet_phone.sql`), reading recipients from the
queued pushes.

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
