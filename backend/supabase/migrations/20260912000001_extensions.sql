-- pgcrypto gives us digest() for hashing invite codes (gen_random_uuid() is
-- built into Postgres core as of v13, no extension needed for that part).
-- Supabase's convention is to keep extensions out of `public`.
create extension if not exists pgcrypto with schema extensions;
