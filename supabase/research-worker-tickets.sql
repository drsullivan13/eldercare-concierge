-- Apply AFTER research-pipeline.sql and research-scheduling.sql.
-- Replaces the existing (text) -> bigint function in place; the Cron command stays valid.
-- No reusable Vault token is read. The plaintext ticket exists only inside this call
-- and the outgoing pg_net Authorization header. Do not print or inspect queue headers.
begin;

create table harbor_research.worker_tickets (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  operation text not null check (operation in ('run','status')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '2 minutes'),
  check (used_at is null or used_at >= created_at)
);
create index worker_tickets_expiry on harbor_research.worker_tickets(expires_at);
alter table harbor_research.worker_tickets enable row level security;
create policy backend_read_tickets on harbor_research.worker_tickets
  for select to service_role using (true);
create policy backend_consume_tickets on harbor_research.worker_tickets
  for update to service_role using (used_at is null)
  with check (used_at is not null);
revoke all on harbor_research.worker_tickets from public,anon,authenticated,service_role;
grant select on harbor_research.worker_tickets to service_role;
grant update(used_at) on harbor_research.worker_tickets to service_role;
revoke all on schema harbor_research from public,anon,authenticated;
grant usage on schema harbor_research to service_role;

create function public.harbor_research_consume_worker_ticket(token_hash text, operation text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_hash text := token_hash; v_operation text := operation;
begin
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$'
    or v_operation is null or v_operation not in ('run','status') then
    return false;
  end if;
  -- One conditional UPDATE is the consume operation. PostgreSQL rechecks the row
  -- after waiting on another updater; a committed ticket cannot be used twice.
  update harbor_research.worker_tickets t set used_at=clock_timestamp()
    where t.hash=v_hash and t.operation=v_operation
      and t.used_at is null and t.expires_at>clock_timestamp();
  return found;
end $$;
revoke all on function public.harbor_research_consume_worker_ticket(text,text)
  from public,anon,authenticated;
grant execute on function public.harbor_research_consume_worker_ticket(text,text) to service_role;

create or replace function harbor_research.invoke_worker(operation text default 'run')
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  v_operation text := operation;
  v_token text;
  v_hash text;
  v_now timestamptz := clock_timestamp();
  v_request_id bigint;
begin
  if v_operation is null or v_operation not in ('run','status') then
    raise exception 'Invalid worker operation' using errcode='22023';
  end if;
  delete from harbor_research.worker_tickets t
    where t.expires_at<v_now-interval '1 day'
      or t.used_at<v_now-interval '1 day';
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  -- Hash the hexadecimal bearer STRING, matching the Edge Function's UTF8 hash.
  v_hash := encode(extensions.digest(v_token,'sha256'),'hex');
  insert into harbor_research.worker_tickets(hash,operation,created_at,expires_at)
    values(v_hash,v_operation,v_now,v_now+interval '2 minutes');
  select net.http_post(
    url := 'https://bewwwrokhfowjmzqrglo.supabase.co/functions/v1/research-collector',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token),
    body := jsonb_build_object('operation',v_operation),
    timeout_milliseconds := 95000
  ) into v_request_id;
  return v_request_id;
end $$;
alter function harbor_research.invoke_worker(text) owner to postgres;
revoke all on function harbor_research.invoke_worker(text) from public,anon,authenticated,service_role;
grant execute on function harbor_research.invoke_worker(text) to postgres;

comment on table harbor_research.worker_tickets is
  'SHA256-only, operation-bound worker tickets; expire within two minutes and consume once. No bearer plaintext retained here.';
comment on function harbor_research.invoke_worker(text) is
  'Postgres/Cron-only invocation with a fresh one-use ticket. A public pg_net queue can still expose an unused ticket briefly; this is not a queue confidentiality guarantee.';
commit;
