-- Hanya relevan di proyek Supabase. Publikasi supabase_realtime tidak ada di
-- Postgres polos, jadi blok ini dilewati diam-diam di database lokal dan CI.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
    ) then
      alter publication supabase_realtime add table jobs;
    end if;
  end if;
end $$;

-- Diperlukan agar payload UPDATE memuat nilai kolom, bukan hanya primary key.
-- Aman dijalankan di Postgres mana pun.
alter table jobs replica identity full;
