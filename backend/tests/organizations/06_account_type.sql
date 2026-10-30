create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'PASS ' else 'FAIL ' end || label || E'\n'
$$;
do $$
declare a text; b text; c text; d text; msg text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-0000000000e1','e1@test.invalid','{"full_name":"A","account_type":"industry"}'),
    ('00000000-0000-0000-0000-0000000000e2','e2@test.invalid','{"full_name":"B","account_type":"individual"}'),
    ('00000000-0000-0000-0000-0000000000e3','e3@test.invalid','{"full_name":"C"}'),
    ('00000000-0000-0000-0000-0000000000e4','e4@test.invalid','{"full_name":"D","account_type":"hacker"}');
  select account_type into a from public.profiles where id='00000000-0000-0000-0000-0000000000e1';
  select account_type into b from public.profiles where id='00000000-0000-0000-0000-0000000000e2';
  select account_type into c from public.profiles where id='00000000-0000-0000-0000-0000000000e3';
  select account_type into d from public.profiles where id='00000000-0000-0000-0000-0000000000e4';
  msg := msg || pg_temp.ok('signing up for work stores industry', a = 'industry');
  msg := msg || pg_temp.ok('signing up just for yourself stores individual', b = 'individual');
  msg := msg || pg_temp.ok('no choice (older apps) means family', c = 'family');
  msg := msg || pg_temp.ok('a made-up account type falls back to family', d = 'family');
  raise exception E'RESULT\n%', msg;
end $$;
