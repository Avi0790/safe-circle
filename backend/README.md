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
| `locations`       | Append-only location pings (lat/lng/accuracy/battery/timestamp). One row per update. |

`latest_locations` is a view over `locations` (distinct-on latest row per user) for the live map to query instead of re-deriving "most recent" client-side.

Plus the geofencing/notifications stretch goal:

| Table                     | Purpose                                                             |
|---------------------------|----------------------------------------------------------------------|
| `places`                  | A named geofence (lat/lng/radius) inside a circle, e.g. "School".   |
| `place_membership_state`  | Bookkeeping: is this user currently inside this place? Lets us detect a transition instead of re-alerting on every ping. |
| `geofence_events`         | Log of `arrived`/`left` transitions. Written only by a trigger.     |
| `push_tokens`             | Expo/FCM push tokens per user/device.                               |

## How access control works

Row-level security is the enforcement point, not application code:

- **Locations**: you can always write your own position. You can only *read*
  someone else's position if `circle_members` shows you share a circle with
  them (checked via the `shares_circle_with()` helper function).
- **Circles / circle_members**: visible only to members of that circle
  (`is_member_of()` helper).
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

## Not built yet (other layers, not backend)

- **SOS button** — a stretch goal that's mostly a mobile UI + a `sos_events`
  table; the location/push plumbing above already covers "notify the
  circle," so this is a small addition once the mobile team wants it.
- **Location history UI** — the data already supports it (`locations` is
  append-only); it's just a query on the mobile/web side that doesn't
  collapse to `latest_locations`.

Everything else from the MVP + stretch goals (page 3 of the proposal) that's
backend-shaped — accounts/circles, background-location writes, the live map
feed, and geofenced arrive/leave push alerts — is implemented above.
