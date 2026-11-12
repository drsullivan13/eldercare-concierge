-- Applied to the dedicated Harbor project on 2026-11-12 (creation + privilege-hardening migrations).
-- User data only. Public provider evidence belongs in a separately reviewed read-only catalogue.
begin;

create table if not exists public.user_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint workspace_object check (jsonb_typeof(data) = 'object'),
  constraint workspace_size check (octet_length(data::text) <= 131072),
  constraint workspace_profile check (coalesce(jsonb_typeof(data->'profile') = 'object', false)),
  constraint workspace_saved check (coalesce(jsonb_typeof(data->'savedProviderIds') = 'array', false)),
  constraint workspace_notes check (coalesce(jsonb_typeof(data->'notes') = 'object', false)),
  constraint workspace_tasks check (coalesce(jsonb_typeof(data->'tasks') = 'array', false))
);

alter table public.user_workspaces enable row level security;
-- Supabase default table grants can include TRUNCATE, which is not governed by RLS.
revoke all on public.user_workspaces from public, anon, authenticated;
grant select, insert, update, delete on public.user_workspaces to authenticated;

create policy "Read own workspace" on public.user_workspaces
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own workspace" on public.user_workspaces
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own workspace" on public.user_workspaces
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Delete own workspace" on public.user_workspaces
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
