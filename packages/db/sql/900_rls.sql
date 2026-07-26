alter table profiles         enable row level security;
alter table api_keys         enable row level security;
alter table sources          enable row level security;
alter table transcripts      enable row level security;
alter table llm_runs         enable row level security;
alter table projects         enable row level security;
alter table clip_candidates  enable row level security;
alter table media_segments   enable row level security;
alter table clips            enable row level security;
alter table jobs             enable row level security;

-- Predikat tunggal untuk keterbacaan sumber. Semua tabel turunan memakainya,
-- sehingga aturan privasi hanya ditulis di satu tempat.
create or replace function public.can_read_source(sid uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from sources s
    where s.id = sid
      and (s.is_public or s.owner_user_id = auth.uid())
  );
$$;

create policy profiles_self on profiles
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy api_keys_self on api_keys
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy sources_read on sources for select
  using (is_public or owner_user_id = auth.uid());
create policy sources_write on sources for insert
  with check (is_public = false and owner_user_id = auth.uid());
create policy sources_update on sources for update
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy transcripts_read on transcripts for select
  using (public.can_read_source(source_id));
create policy llm_runs_read on llm_runs for select
  using (public.can_read_source(source_id));
create policy media_segments_read on media_segments for select
  using (public.can_read_source(source_id));

create policy projects_self on projects
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy clip_candidates_self on clip_candidates
  using (exists (select 1 from projects p
                 where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p
                      where p.id = project_id and p.user_id = auth.uid()));

create policy clips_self on clips
  using (exists (select 1 from projects p
                 where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p
                      where p.id = project_id and p.user_id = auth.uid()));

create policy jobs_self on jobs for select
  using (user_id = auth.uid());
