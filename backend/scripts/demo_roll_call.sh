#!/usr/bin/env bash
# The roll call, live on stage, without six phones. Run it, then start a roll
# call on the dashboard's Roll call tab (or the phone) as the Demo Crew owner:
#
#   backend/scripts/demo_roll_call.sh
#
# It puts all six demo workers on shift, waits for your roll call, then has
# them answer over about half a minute: four "I'm safe", Aisha "I need help"
# (which pushes you, as it would for a real one), and Priya never answers,
# so if you leave it open five minutes the escalation shows too.
#
# Needs scripts/demo_seed.sql loaded. Only touches the fictional demo
# accounts; scripts/demo_reset.sql removes all of it.
set -uo pipefail
cd "$(dirname "$0")/.."

q() { supabase db query --linked "$1" 2>&1; }
# the database reports by raising "RESULT ..." (rolled back); print that part
result() { python3 -c '
import re, sys
raw = sys.stdin.read().replace("\\\\n", "\n").replace("\\n", "\n")
m = re.search(r"RESULT (.*?)(\nCONTEXT:|\"|$)", raw, re.S) or re.search(r"\"result\": \"(.*?)\"", raw)
print(m.group(1).strip() if m else raw.strip()[-400:])'; }

echo "Getting the demo crew on shift…"
supabase db query --linked -f scripts/demo_roll_call_prep.sql 2>&1 | result
echo
echo "Now start a roll call as the owner (dashboard → Roll call, or the phone)."
echo "Waiting for it (up to 3 minutes)…"
found=0
for _ in $(seq 1 60); do
  n=$(q "select count(*) as n from public.org_roll_calls c join public.organizations o on o.id = c.org_id
         where o.name = 'Demo Crew' and c.closed_at is null" | python3 -c 'import re, sys; m = re.search(r"\"n\": (\d+)", sys.stdin.read()); print(m.group(1) if m else 0)')
  if [ "${n:-0}" -gt 0 ]; then found=1; break; fi
  sleep 3
done
if [ "$found" -ne 1 ]; then
  echo "No roll call started. Run this again when you're ready."
  exit 1
fi
echo "Roll call started. Answering…"

answer() { # first name, safe|help, latitude, longitude
  q "do \$\$
declare w uuid; rc uuid;
begin
  select id into w from auth.users where email = 'demo.$1@demo.safecircle.invalid';
  select m.roll_call_id into rc from public.org_roll_call_members m
  join public.org_roll_calls c on c.id = m.roll_call_id
  where m.user_id = w and c.closed_at is null order by c.created_at desc limit 1;
  if rc is null then raise exception 'RESULT not asked (not on shift, or not overseen by whoever started it)'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.answer_roll_call(rc, '$2', $3, $4);
end \$\$;" | grep -o "RESULT[^\"]*" | sed 's/RESULT /  (skipped: /;s/$/)/'
}

sleep 4;  answer maya   safe 35.8431 -90.6751; echo "  ✅ Maya Patel: I'm safe"
sleep 4;  answer jordan safe 35.8202 -90.6810; echo "  ✅ Jordan Lee: I'm safe"
sleep 5;  answer luis   safe 35.8427 -90.6739; echo "  ✅ Luis Ramirez: I'm safe"
sleep 5;  answer aisha  help 35.8199 -90.6822; echo "  🆘 Aisha Khan: I need help (you get a push)"
sleep 6;  answer ben    safe 35.8440 -90.6760; echo "  ✅ Ben Carter: I'm safe"
echo "  ⏳ Priya Nair doesn't answer: leave it open 5 minutes and she's asked again, and you're told."
