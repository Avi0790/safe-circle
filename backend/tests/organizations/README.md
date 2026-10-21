# Organization, SOS and security tests

SQL scripts that run against the linked Supabase project and **roll themselves
back**: each is one `do $$ ... $$` block that creates throwaway
`@test.invalid` users, exercises the real functions as those users (by
switching role and JWT claims), and ends by raising an exception whose message
carries the results, which aborts the transaction so nothing persists.

```bash
cd backend
supabase db query --linked -f tests/organizations/07_adversarial_security.sql
```

The outcome appears in the error text as `PASS ...` / `FAIL ...` lines (the
exception is deliberate). A script that prints `RESULT key=value ...` instead
reports values to compare. After a run, this should return 0 for both:

```sql
select count(*) from auth.users where email like '%@test.invalid';
select count(*) from public.organizations;
```

| Script | What it covers |
|---|---|
| `01_organizations_core` | consent gate, clock-in, who sees whom, shift-window scoping, audit log, role guards, leaving, account deletion (46 checks) |
| `02_teams_and_rls` | the exact reads and calls the team screens make, as each role |
| `03_worker_views` | a worker reading who looked at them |
| `04_sos_to_overseers` | SOS reaches only the right overseers and only on shift (22 checks) |
| `05_reconsent_checkins_export` | re-consent, check-ins, "I'm OK", the export (33 checks) |
| `06_account_type` | the signup choice and its fallbacks |
| `07_adversarial_security` | forged audit rows, internal helpers, direct writes, cross-organization access, SOS tampering and rate-limit dodging, consent bypass, removed members (36 checks) |
| `08_sos_names` | overseers get the sender's name without opening profiles |
| `09_quiet_phone` | the "gone quiet" push: who is told, once per stretch, resets, exclusions |
| `10_org_plans` | paid work organizations: trial, seats, demo billing, no self-upgrade, and that an ended plan stops new shifts and joins but never SOS, clock-out or a running shift (27 checks) |
| `11_former_worker_shifts` | people who left stay on timesheets for owners and admins (times only); managers, other organizations and the leaver don't see them; nobody sees where a former worker was; the disclosure bump to version 4 (18 checks) |
| `12_platform_stats` | the platform owner's dashboard: only a platform admin reads it, nobody can make themselves one, the numbers move with the data, and no names, emails, coordinates or ids come back (23 checks) |

Scripts 04, 05, 07 and 09 insert "trusted" rows as the database owner; their
helper clears the fake JWT claims first (`auth.uid()` must be null, as it is
for cron jobs), because the SOS insert guard deliberately treats any signed-in
caller differently.
