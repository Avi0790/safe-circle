# Circle feature tests

Rolled-back SQL tests for circle features, run the same way as the ones in
`../organizations/` (see its README): each is one `do $$ ... $$` block that
creates throwaway `@test.invalid` users, exercises the real functions as them,
and ends by raising an exception carrying the `PASS`/`FAIL` lines, so nothing
persists.

```bash
cd backend
supabase db query --linked -f tests/circles/01_shared_trips.sql
```

| Script | What it covers |
|---|---|
| `01_shared_trips` | Share my ETA: visibility (driver, circle-mate, someone hidden from, outsider), who is pushed, one active trip, throttling, tampering, validation, sharing windows, expiry, export (29 checks) |
| `02_ghost_aware_pushes` | Ghost mode on routine pushes: walk start/end/arrival, check-on-me start/check-in and pins skip someone hidden from (and everyone when the sender isn't sharing) but still reach the rest; overdue walk / check-on-me SOS, the manual SOS and the all-clear after an overdue one still reach the hidden person; helpers not callable (27 checks) |
