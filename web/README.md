# Safe Circle — Web Dashboard

Read-only live map for the Safe Circle capstone project (Thi's layer, per
the proposal — page 3/5: "web dashboard... read-only, no tracking happens
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
- **Colored-initial avatars** everywhere a member shows up, including as
  custom Leaflet marker icons on the map — same reasoning as mobile's:
  `avatar_url` exists but nothing sets it. Note: Leaflet's `divIcon` html
  is raw, unescaped innerHTML, and `full_name` is fully user-controlled
  (editable in Settings on mobile), so the marker icon HTML-escapes the
  initials before interpolating to avoid a stored-XSS vector.
- **Driving status and distance** — same as mobile's: shows
  "🚗 Driving NN mph" once a member's reported GPS speed clears a 15mph
  threshold (a rough vehicle signal, not real trip detection — see
  mobile's README for the reasoning), and "N.N mi away" for each other
  member on the member list, measured from your own latest location.

All access control is enforced by the backend's row-level security — this
app never sees data for anyone outside your circles, and never writes to
`locations` or `places` (view only, by design — see the module docstring
in `src/components/Dashboard.tsx`).

## Deploying

Per the proposal, this deploys to Vercel:

```bash
npm run build   # outputs dist/
```

Push this folder to Vercel (or `vercel --cwd web`) and set the same two
env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the Vercel
project settings — `.env` files aren't available at Vercel build time.
