-- Menjembatani Supabase Auth dengan tabel domain Klipmatic.
--
-- API memakai auth.users.id sebagai user_id. Setiap user baru harus langsung
-- mempunyai profiles agar foreign key projects/jobs/api_keys dapat dipenuhi.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Menutup gap untuk akun yang dibuat sebelum trigger dipasang.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
