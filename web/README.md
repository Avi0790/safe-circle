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
  email + password).
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
  place is mobile-only (`mobile/app/(app)/places.tsx`).
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
