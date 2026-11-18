-- Apply after outreach-handoffs.sql. Receipts describe simulated runs only;
-- recording a rehearsal never changes the parent request's requested state.
begin;

create table if not exists public.outreach_rehearsal_receipts (
  -- Run grants expire and may be purged; durable history belongs to the request.
  run_id uuid primary key,
  owner_id uuid not null,
  request_id uuid not null,
  outcome jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (owner_id, request_id)
    references public.outreach_requests(owner_id, request_id) on delete cascade,
  constraint outreach_rehearsal_outcome_shape check (
    case when jsonb_typeof(outcome) <> 'object'
      or jsonb_typeof(outcome->'status') is distinct from 'string'
      or jsonb_typeof(outcome->'takeaways') is distinct from 'array'
      or jsonb_typeof(outcome->'nextSteps') is distinct from 'array' then false
    else
      octet_length(outcome::text) <= 8192
      and outcome - array['status', 'takeaways', 'nextSteps'] = '{}'::jsonb
      and outcome->>'status' in ('completed', 'failed')
      and jsonb_array_length(outcome->'takeaways') <= 6
      and jsonb_array_length(outcome->'nextSteps') <= 6
      and not (outcome->'takeaways' @? 'strict $[*] ? (@.type() != "string" || !(@ like_regex "^.{1,240}$" flag "s") || @ like_regex "^[[:space:]]*$")')
      and not (outcome->'nextSteps' @? 'strict $[*] ? (@.type() != "string" || !(@ like_regex "^.{1,240}$" flag "s") || @ like_regex "^[[:space:]]*$")')
    end
  )
);
create index if not exists outreach_rehearsal_receipts_owner_created_idx
  on public.outreach_rehearsal_receipts(owner_id, created_at desc, run_id);
alter table public.outreach_rehearsal_receipts enable row level security;
drop policy if exists outreach_rehearsal_receipts_owner_read on public.outreach_rehearsal_receipts;
create policy outreach_rehearsal_receipts_owner_read on public.outreach_rehearsal_receipts
  for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.outreach_rehearsal_receipts from public, anon, authenticated, service_role;
grant select on public.outreach_rehearsal_receipts to authenticated;

create or replace function harbor_outreach_handoff.record_outreach_rehearsal_receipt(
  p_run_id uuid, p_run_key_digest text, p_outcome jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run_grant harbor_outreach_handoff.handoffs;
  receipt public.outreach_rehearsal_receipts;
begin
  if p_run_id is null or p_run_key_digest is null
    or p_run_key_digest !~ '^[0-9a-f]{64}$' then return null; end if;

  -- Serialize submissions for this run, then check expiry after lock acquisition.
  select * into run_grant from harbor_outreach_handoff.handoffs
    where run_id = p_run_id and run_key_digest = p_run_key_digest
      and purpose = 'voice_rehearsal' for update;
  if not found or run_grant.run_expires_at <= clock_timestamp() then return null; end if;

  select * into receipt from public.outreach_rehearsal_receipts where run_id = p_run_id;
  if found then
    if receipt.outcome is distinct from p_outcome then
      raise exception using errcode = '23505', message = 'Rehearsal run already has an outcome';
    end if;
  else
    insert into public.outreach_rehearsal_receipts(run_id, owner_id, request_id, outcome)
      values(p_run_id, run_grant.owner_id, run_grant.request_id, p_outcome)
      returning * into receipt;
  end if;
  return jsonb_build_object('runId', receipt.run_id, 'requestId', receipt.request_id,
    'outcome', receipt.outcome, 'createdAt', receipt.created_at);
end;
$$;
revoke all on function harbor_outreach_handoff.record_outreach_rehearsal_receipt(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function harbor_outreach_handoff.record_outreach_rehearsal_receipt(uuid, text, jsonb)
  to service_role;
create or replace function public.record_outreach_rehearsal_receipt(
  p_run_id uuid, p_run_key_digest text, p_outcome jsonb
)
returns jsonb language sql security invoker set search_path = '' as $$
  select harbor_outreach_handoff.record_outreach_rehearsal_receipt(p_run_id, p_run_key_digest, p_outcome);
$$;
revoke all on function public.record_outreach_rehearsal_receipt(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_outreach_rehearsal_receipt(uuid, text, jsonb)
  to service_role;
commit;
