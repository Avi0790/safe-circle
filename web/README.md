# Safe Circle — Web Dashboard

*Part of [Safe Circle](../README.md) — created and developed by **Surendra B K** ([@surendr7a](https://github.com/surendr7a)).*

Read-only live map for the Safe Circle capstone project, designed and built
by Surendra B K (per the proposal — page 3/5: "web dashboard... read-only, no tracking happens
from the web"). React + Vite + Leaflet, talking directly to the Supabase
backend in [`../backend`](../backend).

## Running locally

```bash
npm install
npm run dev
```

Needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. This package reads
its `.env` from the **repo root** (see `envDir` in `vite.config.ts`), so
there's one shared `.env` for both this and the mobile app — copy
[`../.env.example`](../.env.example) to `../.env` and fill in real values
if you haven't already.

## What it does

- Sign in with the same account created in the mobile app (Supabase Auth,
  email + password), including **"Forgot password?"**
  (`src/components/LoginScreen.tsx` → `ResetPasswordScreen.tsx`). Simpler
  here than on mobile: the browser Supabase client's `detectSessionInUrl`
  is on by default, so it parses the reset link's tokens out of the URL
  itself — `App.tsx` just listens for the `PASSWORD_RECOVERY` auth event
  and swaps in the new-password form. Confirmed working end-to-end against
  the real hosted project (request sent, no errors, UI transitioned to
  "Check your email"). **Needs a one-time manual step, not in git:** add
  this dashboard's URL (`http://localhost:5173` for local dev, plus
  wherever it's deployed) to this Supabase project's
  **Auth → URL Configuration → Redirect URLs**, or the email link redirects
  to the project's default Site URL instead of back here.
- Lists the circles you belong to; if you're in more than one, a dropdown
  switches between them.
- Shows every circle member on a Leaflet map, using the `latest_locations`
  view from the backend, plus a sidebar with last-updated time and battery
  level.
- Subscribes to `postgres_changes` on the `locations` table so new pings
  move markers live, no polling or refresh needed.
- Draws each circle's geofenced places (the geofencing stretch goal, page
  3) as circle overlays on the map, and a "Recent activity" feed of
  arrive/leave events in the sidebar — both live via realtime, matching
  what's on the mobile app's Places screen. Read-only here too: creating a
  place is mobile-only (`mobile/app/(app)/places.tsx`). Each place gets a
  Life360-style icon (`lib/places.ts`) inferred from its name — same
  logic as mobile, kept in sync between the two packages.
- Click a place circle for a **"Here now"** popup — who's actually inside
  it at this moment (`place_membership_state`, live via realtime), not
  just the historical feed. Same feature on mobile's Places screen.
- Shows a red SOS banner (`src/components/SosBanner.tsx`) for any active
  emergency alert — yours or a circle-mate's — live via the same realtime
  pattern, so a parent watching this dashboard sees it even if they're not
  on the phone. Not circle-scoped (RLS already limits `sos_events` to
  "yourself, or anyone you share a circle with," same rule as locations).
  Read-only: marking one resolved is mobile-only
  (`mobile/components/SosBanner.tsx`), matching this dashboard's
  view-only design.
- Click a member with a location to draw their last 100 pings as a trail on
  the same map (location history, parity with the mobile app's
  `member/[userId]` screen) — click again to hide it. `locations` is
  already append-only, so this is purely a new read, no backend changes.
- Shows a read-only **Chat** feed (`ChatFeed.tsx`) of the circle's
  messages — beyond the proposal, matching mobile's new Chat tab. Sending
  stays mobile-only, same view-only design as everything else here.
- **Avatars** everywhere a member shows up, including as custom Leaflet
  marker icons on the map: the profile photo a member chose in the mobile
  app (uploaded there — this dashboard never writes), or colored initials
  when they haven't (or the image fails to load). Updates live when
  someone changes theirs (`profiles` realtime). Note: Leaflet's `divIcon`
  html is raw, unescaped innerHTML, and both `full_name` and `avatar_url`
  are fully user-controlled (editable via `profiles_update_self`), so the
  marker icon HTML-escapes both before interpolating to avoid a
  stored-XSS vector, and only http(s) photo URLs are ever rendered.
- **Sharing windows, walks and ride requests** — read-only, like SOS: a
  member on a temporary window shows "sharing until 4:15 PM", or "Stopped
  sharing" after (their pin disappears — the database stops serving it);
  active walk-me-home timers and open ride requests appear as banners
  (`WalkRideBanner.tsx`). An overdue walk isn't repeated because it has
  already raised a normal SOS.
- **Shared trips ("Share my ETA")** — read-only: when a circle-mate shares a
  drive, a walk, or a bus, train or flight from the mobile app, the selected
  circle shows "🚗 Sam is heading to Mall" (or "🚶 Sam is walking to the
  library", "✈️ Sam is flying to Denver") and "arriving in
  about 12 min (3:41 PM)" (`TripBanner.tsx`,
  `lib/sharedTrips.ts`). Only the destination's name and the ETA are shared,
  never the route. It counts down locally, updates live, and disappears when
  they arrive, stop sharing, or their phone goes quiet for 10 minutes. Your
  own trip isn't shown, and people who've hidden from you (Ghost mode) or
  stopped sharing are filtered out by the database, not this page.
- **Guest trip page** (`GuestTrack.tsx`, `lib/guestTrip.ts`) — a guest link
  sent with "Share ETA with anyone" shows "🚗 Alex is heading to Walmart" and
  "arriving in about 12 min (3:41 PM)" above the live map; once they arrive
  it says "✅ Alex arrived at Walmart" and no longer shows a location.
- **Road reports** (`lib/roadReports.ts`) — read-only: crashes, hazards,
  speed checks and closed roads reported from the mobile app while driving
  show on the map as red-ringed markers (💥 ⚠️ 🚓 🚧) for the selected
  circle's members (and your own), with a popup saying who reported it, when,
  and how long it has left. They update live and drop off when they expire
  (an hour; three for a closed road). Reporting and taking a report back stay
  mobile-only.
- **Quick status chips and SOS acknowledgements** — read-only: a member's
  chip ("🚗 On my way") shows next to their name in `MemberList.tsx` while
  it's still active; an active SOS shows who's tapped "I'm on my way" on
  mobile ("👀 Bob is on it"). Setting a status or acknowledging an SOS both
  stay mobile-only actions, matching this dashboard's view-only design.
- **Weather where they are** (`lib/weather.ts`) — when a member's location
  history is expanded, shows the temperature and conditions at their most
  recent point ("🌧️ 58°F, Rain") next to "Showing location history". Same
  Open-Meteo client-side fetch as mobile's; fails silently if it can't load.
- **Meetup pins** — pins dropped from the mobile app (`drop_pin`) show on
  this map too, with the same emoji marker and a popup naming who dropped
  it and when it expires. Read-only, like everywhere else — dropping and
  removing pins stay mobile-only actions. Ghost mode and curfew have no
  web-dashboard surface: ghost mode is invisible by design (a hidden
  member's pin just doesn't appear, same as any other sharing gap), and
  curfew is a personal setting with nothing circle-wide to show.
- **Check-on-me timers** — shown in the same banner as walk-me-home timers
  (`WalkRideBanner.tsx`), read-only: who asked to be checked on, their
  note if they left one, and when it's due. Text for help and backup
  contacts have no web surface — they're personal, on-device actions
  (composing an SMS) with nothing for a dashboard to show or do.
- **Guest tracking page** (`/track/<token>`, `components/GuestTrack.tsx`,
  `lib/track.ts`) — the one screen here that needs no account: opened from a
  link a member shares from the mobile app, it shows only that person's first
  name and latest location on a map (refreshing every 15 s) until the link
  expires or is revoked; an unknown, expired or revoked token all look the
  same ("This link has ended"). Routed before any sign-in logic in `App.tsx`;
  `vercel.json` rewrites every path to the SPA so deep links work once
  deployed.
- **Satellite view** — a layer switcher (top-right of the map, Leaflet's
  built-in `LayersControl`) between the default street map and satellite
  imagery from Esri's World Imagery service, which — like the OpenStreetMap
  tiles already in use — is free and keyless, so this needed no Google Maps
  billing account. Verified by exercising the actual switcher in a browser
  and confirming a real Esri tile request fired.
- **Driving status and distance** — same as mobile's: shows
  "🚗 Driving NN mph" once a member's reported GPS speed clears a 15mph
  threshold (a rough vehicle signal, not real trip detection — see
  mobile's README for the reasoning), and "N.N mi away" for each other
  member on the member list, measured from your own latest location.

All access control is enforced by the backend's row-level security — this
app never sees data for anyone outside your circles, and never writes to
`locations` or `places` (view only, by design — see the module docstring
in `src/components/Dashboard.tsx`).

## Work view for crews (owners, admins, managers)

Everything above is the **circle** dashboard, which stays read-only. Anyone who
oversees an organization (migration `...000048` in the backend) also gets a
**Work** view next to it (`AppShell.tsx` decides: no organization role means no
extra bar and exactly the dashboard they had before; workers clock in on their
phones, so a worker-only account doesn't get it either). It is the one place
the web dashboard writes: changing roles, managing teams, and acknowledging or
resolving an SOS. It still never tracks anyone; location only ever comes from
workers' phones.

- **Live crew** (`OrgLive.tsx`, `OrgMap.tsx`): a Leaflet map and list of who's
  clocked in, with last-heard-from, a "may be offline" warning once a phone has
  been quiet for 15 minutes, low battery and driving speed. Click a worker to
  see their last 24 hours of **on-shift** path and recent shifts. Off-shift
  workers are listed by name only and workers who haven't accepted the
  disclosure show as "waiting to accept". Admins see everyone; a manager sees
  only workers on teams they lead (enforced in the database).
- **People & teams** (`OrgPeople.tsx`, owners and admins): change roles, remove
  people, create and delete teams, make a manager a team's lead, add and remove
  people, and get a new invite code. The buttons mirror the database's rules
  (`lib/teams.ts`), which are what actually enforce them.
- **Shifts** (`OrgShifts.tsx`): clock-in and clock-out times for the last 7, 30
  or 90 days with a **CSV download** for timesheets. Names are user-typed, so
  the CSV writer (`lib/csv.ts`) prefixes any cell starting with `=`, `+`, `-`
  or `@` with an apostrophe; otherwise a display name like `=HYPERLINK(...)`
  would run as a formula when an admin opens the file.
- **SOS** (`OrgSosBanner.tsx`): active SOS from workers the viewer oversees
  (only those sent while the worker was clocked in), with "Open location",
  "On my way" and "Resolve", live over realtime.

Why it polls instead of streaming: managers have no read access to the
`locations` table at all. Every look goes through `org_live_roster`,
`org_worker_track` or `org_shifts`, which apply the shift window and write the
audit log the worker can read in their Work tab, so a realtime feed of
`locations` would bypass both. The live view refreshes every 30 s while open
and says on screen that workers can see when you look.

Checked by rendering the real components against a stubbed Supabase client with
fixture data (all three tabs, worker selection and the on-shift path, the SOS
banner), since a real sign-in would send credentials to the production project.
The permission and visibility rules themselves were verified against the live
database in the backend's rolled-back transaction tests. Logic is unit tested
in `src/lib/__tests__/crew.test.ts` (crew split and flags, team and permission
rules, CSV escaping).

## Deploying

Per the proposal, this deploys to Vercel:

```bash
npm run build   # outputs dist/
```

Push this folder to Vercel (or `vercel --cwd web`) and set the same two
env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the Vercel
project settings — `.env` files aren't available at Vercel build time.
