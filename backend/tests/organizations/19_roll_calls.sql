-- Roll calls (migration ...000075). Rolls itself back; results in the error
-- text.
create function pg_temp.sw(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.su() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'PASS ' else 'FAIL ' end || label || E'\n'
$$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare
  o  uuid := '00000000-0000-0000-0000-0000000000a0';
  m1 uuid := '00000000-0000-0000-0000-0000000000b1';  -- leads w1
  m2 uuid := '00000000-0000-0000-0000-0000000000b2';  -- leads w2
  w1 uuid := '00000000-0000-0000-0000-0000000000c1';
  w2 uuid := '00000000-0000-0000-0000-0000000000c2';
  w3 uuid := '00000000-0000-0000-0000-0000000000c3';  -- off shift
  x  uuid := '00000000-0000-0000-0000-0000000000d1';
  org uuid; code text; ta uuid; tb uuid; r uuid;
  rc uuid; rc2 uuid; n int; txt text; ans text; lat double precision; ex jsonb;
  pushes_before bigint;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (o, 'o@test.invalid', '{"full_name":"Olive"}'), (m1, 'm1@test.invalid', '{"full_name":"Max"}'),
    (m2, 'm2@test.invalid', '{"full_name":"Mia"}'), (w1, 'w1@test.invalid', '{"full_name":"Wendy"}'),
    (w2, 'w2@test.invalid', '{"full_name":"Walt"}'), (w3, 'w3@test.invalid', '{"full_name":"Wes"}'),
    (x, 'x@test.invalid', '{"full_name":"Out"}');
  perform pg_temp.sw(o);
  select c.org_id, c.invite_code into org, code from public.create_organization('Crew') c;
  foreach r in array array[m1, m2, w1, w2, w3] loop
    perform pg_temp.sw(r); perform public.redeem_org_invite_code(code); perform public.accept_org_consent(org);
  end loop;
  perform pg_temp.sw(o);
  perform public.set_org_member_role(org, m1, 'manager'); perform public.set_org_member_role(org, m2, 'manager');
  ta := public.create_team(org, 'A'); tb := public.create_team(org, 'B');
  perform public.set_team_member(ta, m1, true); perform public.set_team_member(ta, w1, false);
  perform public.set_team_member(tb, m2, true); perform public.set_team_member(tb, w2, false);
  perform pg_temp.su();
  insert into public.shifts (org_id, user_id, clocked_in_at) values (org, w1, now() - interval '1 hour'), (org, w2, now() - interval '2 hours');

  -- ===== starting =====
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select public.start_roll_call(%L)', org));
  msg := msg || pg_temp.ok('a worker can''t start a roll call', txt like 'Only owners%');
  perform pg_temp.sw(x);
  txt := pg_temp.err(format('select public.start_roll_call(%L)', org));
  msg := msg || pg_temp.ok('nor can an outsider', txt like 'Only owners%');

  perform pg_temp.su();
  select count(*) into pushes_before from net.http_request_queue;
  perform pg_temp.sw(o);
  rc := public.start_roll_call(org, '  Storm warning: check in  ');
  perform pg_temp.su();
  select count(*) into n from public.org_roll_call_members where roll_call_id = rc;
  msg := msg || pg_temp.ok('the owner''s roll call asks everyone on shift, not the one off shift', n = 2
    and not exists (select 1 from public.org_roll_call_members where roll_call_id = rc and user_id = w3));
  msg := msg || pg_temp.ok('and pushes them', (select count(*) from net.http_request_queue) = pushes_before + 1);
  msg := msg || pg_temp.ok('the note is trimmed', (select note from public.org_roll_calls where id = rc) = 'Storm warning: check in');

  perform pg_temp.sw(o);
  txt := pg_temp.err(format('select public.start_roll_call(%L)', org));
  msg := msg || pg_temp.ok('one open roll call at a time per person', txt like 'You already have a roll call open%');

  perform pg_temp.sw(m1);
  rc2 := public.start_roll_call(org);
  perform pg_temp.su();
  select count(*) into n from public.org_roll_call_members where roll_call_id = rc2;
  msg := msg || pg_temp.ok('a manager''s roll call asks only their team', n = 1
    and exists (select 1 from public.org_roll_call_members where roll_call_id = rc2 and user_id = w1));
  perform pg_temp.sw(m1); perform public.close_roll_call(rc2);
  perform pg_temp.sw(m2);
  perform pg_temp.su(); update public.shifts set clocked_out_at = now() where user_id = w2;
  perform pg_temp.sw(m2);
  txt := pg_temp.err(format('select public.start_roll_call(%L)', org));
  msg := msg || pg_temp.ok('nobody on shift: nothing to ask', txt like 'Nobody you oversee is on shift%');

  -- ===== answering =====
  perform pg_temp.sw(w3);
  txt := pg_temp.err(format('select public.answer_roll_call(%L, %L)', rc, 'safe'));
  msg := msg || pg_temp.ok('someone who wasn''t asked can''t answer', txt = 'Roll call not found.');
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select public.answer_roll_call(%L, %L)', rc, 'maybe'));
  msg := msg || pg_temp.ok('the answer is safe or help', txt = 'Answer safe or help.');
  perform public.answer_roll_call(rc, 'safe', 35.84, -90.70);
  perform pg_temp.su();
  select count(*) into pushes_before from net.http_request_queue;
  perform pg_temp.sw(w2);
  perform public.answer_roll_call(rc, 'help', 35.81, -90.60);
  perform pg_temp.su();
  msg := msg || pg_temp.ok('"I need help" alerts their overseers at once',
    (select count(*) from net.http_request_queue) = pushes_before + 1);
  perform pg_temp.sw(w2);
  perform public.answer_roll_call(rc, 'help');
  perform pg_temp.su();
  msg := msg || pg_temp.ok('answering help twice doesn''t alert twice', (select count(*) from net.http_request_queue) = pushes_before + 1);
  select latitude into lat from public.org_roll_call_members where roll_call_id = rc and user_id = w2;
  msg := msg || pg_temp.ok('and keeps the position they sent first', lat = 35.81);

  -- ===== who sees what =====
  perform pg_temp.sw(o);
  select count(*) into n from public.roll_call_status(rc);
  msg := msg || pg_temp.ok('the owner sees every answer', n = 2);
  select answer into ans from public.roll_call_status(rc) limit 1;
  msg := msg || pg_temp.ok('"needs help" listed first', ans = 'help');
  select format('%s/%s/%s', asked, safe, help) into txt from public.org_roll_calls_list(org) where id = rc;
  msg := msg || pg_temp.ok('the tally: 2 asked, 1 safe, 1 needs help', txt = '2/1/1');
  perform pg_temp.sw(m1);
  select count(*) into n from public.roll_call_status(rc);
  msg := msg || pg_temp.ok('a manager sees only their team''s answers', n = 1);
  select count(*) into n from public.org_roll_call_members;
  msg := msg || pg_temp.ok('the same through the table', n = 2); -- w1 in rc and in rc2
  perform pg_temp.sw(w1);
  select count(*) into n from public.roll_call_status(rc);
  msg := msg || pg_temp.ok('a worker sees only their own answer', n = 1);
  select my_answer into ans from public.org_roll_calls_list(org) where id = rc and asked_me;
  msg := msg || pg_temp.ok('and the roll call they were asked in', ans = 'safe');
  perform pg_temp.sw(o);
  msg := msg || pg_temp.ok('the owner wasn''t asked in their own', not (select asked_me from public.org_roll_calls_list(org) where id = rc));
  perform pg_temp.sw(x);
  select count(*) into n from public.org_roll_calls;
  msg := msg || pg_temp.ok('an outsider sees none', n = 0);
  perform pg_temp.sw(w3);
  select count(*) into n from public.org_roll_calls_list(org);
  msg := msg || pg_temp.ok('nor does a worker who wasn''t asked', n = 0);
  txt := pg_temp.err(format('insert into public.org_roll_call_members (roll_call_id, user_id, answer) values (%L, %L, %L)', rc, w3, 'safe'));
  msg := msg || pg_temp.ok('no writing answers directly', txt is not null);

  -- ===== escalating and closing =====
  perform pg_temp.su();
  update public.org_roll_call_members set answer = null, answered_at = null where roll_call_id = rc and user_id = w1;
  update public.org_roll_calls set created_at = now() - interval '6 minutes' where id = rc;
  select count(*) into pushes_before from net.http_request_queue;
  perform public.escalate_roll_calls();
  msg := msg || pg_temp.ok('five minutes on, the silent are asked again and the starter told',
    (select count(*) from net.http_request_queue) = pushes_before + 2 and (select escalated_at from public.org_roll_calls where id = rc) is not null);
  perform public.escalate_roll_calls();
  msg := msg || pg_temp.ok('only once', (select count(*) from net.http_request_queue) = pushes_before + 2);

  perform pg_temp.sw(m1);
  txt := pg_temp.err(format('select public.close_roll_call(%L)', rc));
  msg := msg || pg_temp.ok('a manager can''t close the owner''s roll call', txt like 'Only the person%');
  perform pg_temp.sw(o);
  perform public.close_roll_call(rc);
  perform pg_temp.sw(w1);
  txt := pg_temp.err(format('select public.answer_roll_call(%L, %L)', rc, 'safe'));
  msg := msg || pg_temp.ok('a closed roll call takes no answers', txt = 'That roll call is closed.');
  perform pg_temp.su();
  update public.org_roll_calls set closed_at = null, created_at = now() - interval '3 hours' where id = rc;
  perform public.escalate_roll_calls();
  msg := msg || pg_temp.ok('two hours on, it closes by itself', (select closed_at from public.org_roll_calls where id = rc) is not null);

  -- ===== your data =====
  perform pg_temp.sw(w2);
  ex := public.export_my_data();
  msg := msg || pg_temp.ok('your roll-call answers are in "Download my data"',
    jsonb_array_length(ex -> 'roll_call_answers') = 1 and ex -> 'roll_call_answers' -> 0 ->> 'answer' = 'help'
    and ex ? 'planned_shifts' and ex ? 'profile');

  raise exception E'RESULT\n%', msg;
end $$;
