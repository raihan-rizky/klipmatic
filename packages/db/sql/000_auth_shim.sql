create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid;
$$;

-- Tiruan minimal auth.users milik Supabase; hanya kolom yang kita rujuk.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
