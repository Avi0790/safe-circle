# Load test

`01_crew_scale.sql` checks that Safe Circle stays fast with a real-sized
crowd. Inside one transaction that rolls itself back it builds a work
organization with 200 workers on shift (a manager leading a team of 40) and
25 family circles of 4, each person with 3 days of location history (about
115,000 positions, written through the same triggers as a phone's uploads).
Then it times what the apps actually run, as the person who runs it, through
row-level security, and reports rows and the best of 3 runs against a
generous limit:

| Query | Who | Expected rows | Limit |
|---|---|---|---|
| Live crew map | owner | 200 | 1000 ms |
| Live crew map | manager of a 40-person team | 40 | 1000 ms |
| A worker's shift track for the day | owner | 60 (on-shift only) | 500 ms |
| Family map, latest positions | circle member | 4 | 500 ms |
| A circle-mate's trail, latest 100 | circle member | 100 | 500 ms |
| Everyone else's positions | a worker | 0 | 3000 ms |
| One location upload (average of 100) | a phone | — | 50 ms |

It runs on every push in CI (`tests/run_all.sh` against the fresh local
database), and locally with `supabase start` then `tests/run_all.sh load`.
`--linked` skips it: it isn't something to do to the live project.
