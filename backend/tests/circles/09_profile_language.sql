-- Each person's language for notifications (migration ...000071). Rolls
-- itself back; results in the error text.
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

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b1';
  code text; lang text; n int; txt text;
  msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@test.invalid', '{"full_name":"Ana"}'), (b, 'b@test.invalid', '{"full_name":"Ben"}');
  perform pg_temp.sw(a);
  select x.invite_code into code from public.create_circle('Family') x;
  perform pg_temp.sw(b);
  perform public.redeem_invite_code(code);
  perform pg_temp.su();

  select language into lang from public.profiles where id = a;
  msg := msg || pg_temp.ok('everyone starts in English', lang = 'en');

  perform pg_temp.sw(a);
  update public.profiles set language = 'es' where id = a;
  perform pg_temp.su();
  select language into lang from public.profiles where id = a;
  msg := msg || pg_temp.ok('you can switch your own to Spanish', lang = 'es');

  -- a circle-mate can see your profile, but not change your language
  perform pg_temp.sw(b);
  update public.profiles set language = 'en' where id = a;
  get diagnostics n = row_count;
  perform pg_temp.su();
  select language into lang from public.profiles where id = a;
  msg := msg || pg_temp.ok('a circle-mate can''t change someone else''s', n = 0 and lang = 'es');

  perform pg_temp.sw(a);
  txt := null;
  begin
    update public.profiles set language = 'fr' where id = a;
  exception when check_violation then txt := 'refused';
  end;
  perform pg_temp.su();
  msg := msg || pg_temp.ok('only English or Spanish is accepted', txt = 'refused');

  perform pg_temp.sw(a);
  txt := null;
  begin
    update public.profiles set language = null where id = a;
  exception when not_null_violation then txt := 'refused';
  end;
  perform pg_temp.su();
  msg := msg || pg_temp.ok('it can''t be emptied', txt = 'refused');

  raise exception E'RESULT\n%', msg;
end $$;
