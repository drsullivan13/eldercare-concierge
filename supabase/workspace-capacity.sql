-- Existing projects: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/workspace-capacity.sql
-- Fresh projects use schema.sql. Reapplying schema.sql does not alter an existing constraint.
-- The app caps compact UTF-8 JSON at 2 MiB (2097152 bytes).
-- PostgreSQL caps JSONB text at 3 MiB (3145728 bytes), leaving formatting headroom.
begin;

alter table public.user_workspaces
  drop constraint workspace_size,
  add constraint workspace_size check (octet_length(data::text) <= 3145728);

commit;
