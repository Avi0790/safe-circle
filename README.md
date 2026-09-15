# Safe Circle

Family location sharing that respects your battery and your privacy.

CS capstone project, Fall 2026 — Team Beacon: **Avi** (mobile & UI), **AJ**
(location engine), **Surendra** (backend & data), **Thi** (web client &
QA).

## What it does

Create a private circle with a 6-character invite code, and everyone in it
sees everyone else on a shared live map — no manual check-ins. Sharing is
always visible and can be paused at any time; if you're not in someone's
circle, you cannot see them. See [`backend/README.md`](backend/README.md)
for the full pitch and how access control is enforced.

## Structure

| Package | Owner | What it is |
|---|---|---|
| [`backend/`](backend/README.md) | Surendra | Supabase: schema, row-level security, invite-code RPCs, geofencing + push notifications |
| [`web/`](web/README.md) | Thi | Read-only React + Leaflet live-map dashboard |
| [`mobile/`](mobile/README.md) | Avi & AJ | Expo/React Native app — auth, circles, live map, and the background location engine |

Each package has its own README with setup and verification details.

**Status: the full proposal is built** — MVP (accounts/circles, live map,
background location) and all three stretch goals (geofenced places with
push alerts, location history, an SOS button), backend through UI,
verified end-to-end against the real hosted project. Two security review
passes caught and fixed three real issues (an unauthenticated webhook, no
rate limiting on invite-code guesses, no rate limiting on SOS alerts) —
see `backend/README.md`. Push notifications are registered with EAS
(`@suren.7a/safecircle`).

Tested on a real iPhone via Expo Go: auth, circles, the map, SOS, and
live location sharing all confirmed working on real hardware — including
two real bugs caught only by that testing (a crash in the background
permission request, and background location doing nothing at all in
Expo Go) and fixed on the spot; see `mobile/README.md`'s Verification
notes for both. The remaining gap: **true background tracking** (app
closed or screen off) still needs a custom development build — a
foreground fallback now covers sharing while the app is open, but not
backgrounded/closed. Getting a development build onto a physical iPhone
needs the paid Apple Developer Program ($99/yr), which this project
hasn't enrolled in; an Android development build has no such requirement
and would need testing whenever an Android device is available.

What's left isn't ordinary code: teammates joining, and (optionally) that
Apple Developer enrollment or an Android device to verify true background
tracking on real hardware.

## Getting started

1. **Backend first** — it's the foundation everything else talks to.
   Follow [`backend/README.md`](backend/README.md) to get a local Supabase
   stack running (`supabase start`) or link to the hosted project.
2. **Shared client env** — copy [`.env.example`](.env.example) to `.env`
   at this repo root and fill in the project's URL + anon key (Project
   Settings → API on the Supabase dashboard). Both `web/` and `mobile/`
   read from this one file — see each package's README for exactly how.
3. **Web or mobile** — `npm install && npm run dev` in `web/`, or
   `npm install && npx expo start` in `mobile/`.

## Tooling

- Git + GitHub, pull-request reviews.
- GitHub Actions CI (`.github/workflows/ci.yml`) — runs on every push/PR:
  applies all backend migrations against a real Postgres instance
  (`supabase db reset`, catching schema/RLS bugs before they reach the
  hosted project), and typechecks + tests both `web/` and `mobile/`.
- Jest for unit tests (`web/src/lib/__tests__`, `mobile/lib/__tests__`).

## Timeline

Fifteen weeks, five phases — see page 7 of the proposal for the full
breakdown and checkpoints. Hard rule: whatever's unfinished at the end of
week 13 gets cut; weeks 14–15 are for testing and the write-up only.
