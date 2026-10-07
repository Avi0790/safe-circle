do $$
declare a text; b text; c text; d text; e int;
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
  select count(*) into e from public.profiles where account_type <> 'family' and id::text not like '00000000-0000-0000-0000-0000000000e%';
  raise exception 'RESULT industry=% individual=% missing=% invalid=% existing_non_family=%', a, b, c, d, e;
end $$;
