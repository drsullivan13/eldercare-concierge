-- Apply after outreach-requests.sql. Only the server can issue, exchange,
-- or authorize credentials. The browser-facing request ledger stays separate.
begin;

create schema if not exists harbor_outreach_handoff;
revoke all on schema harbor_outreach_handoff from public, anon, authenticated, service_role;
grant usage on schema harbor_outreach_handoff to service_role;

create table if not exists harbor_outreach_handoff.handoffs (
  token_digest text primary key check (token_digest ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null,
  request_id uuid not null,
  purpose text not null default 'voice_rehearsal' check (purpose = 'voice_rehearsal'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  run_id uuid unique,
  run_key_digest text unique check (run_key_digest ~ '^[0-9a-f]{64}$'),
  run_expires_at timestamptz,
  foreign key (owner_id, request_id)
    references public.outreach_requests(owner_id, request_id) on delete cascade,
  check (
    (consumed_at is null and run_id is null and run_key_digest is null and run_expires_at is null)
    or
    (consumed_at is not null and run_id is not null and run_key_digest is not null and run_expires_at is not null)
  )
);
create index if not exists handoffs_request_idx
  on harbor_outreach_handoff.handoffs (owner_id, request_id);
create unique index if not exists handoffs_one_pending_idx
  on harbor_outreach_handoff.handoffs (owner_id, request_id, purpose) where consumed_at is null;

alter table harbor_outreach_handoff.handoffs enable row level security;
revoke all on harbor_outreach_handoff.handoffs from public, anon, authenticated, service_role;

create or replace function harbor_outreach_handoff.issue_outreach_handoff(
  p_owner_user_id uuid,
  p_request_id uuid,
  p_token_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  grant_expiry timestamptz;
begin
  if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  -- Serialize launches for the same request before replacing the pending grant.
  perform 1 from public.outreach_requests as request
    where request.owner_id = p_owner_user_id and request.request_id = p_request_id
      and request.status = 'requested'
    for update;
  if not found then
    return null;
  end if;

  -- A failed insertion rolls back rotation. Reject reissuing any stored digest.
  if exists (select 1 from harbor_outreach_handoff.handoffs where token_digest = p_token_digest) then
    return null;
  end if;

  delete from harbor_outreach_handoff.handoffs
    where owner_id = p_owner_user_id and request_id = p_request_id
      and purpose = 'voice_rehearsal' and consumed_at is null;
  grant_expiry := clock_timestamp() + interval '2 minutes';
  insert into harbor_outreach_handoff.handoffs (token_digest, owner_id, request_id, expires_at)
    values (p_token_digest, p_owner_user_id, p_request_id, grant_expiry);

  return jsonb_build_object('expiresAt', grant_expiry);
exception
  when unique_violation then return null;
end;
$$;

create or replace function harbor_outreach_handoff.exchange_outreach_handoff(
  p_token_digest text,
  p_run_id uuid,
  p_run_key_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  exchanged_at timestamptz;
  result jsonb;
begin
  if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
    or p_run_id is null or p_run_key_digest is null or p_run_key_digest !~ '^[0-9a-f]{64}$'
    or p_token_digest = p_run_key_digest then
    return null;
  end if;

  -- Check the time after acquiring the lock so waiting past expiry fails.
  perform 1 from harbor_outreach_handoff.handoffs
    where token_digest = p_token_digest and purpose = 'voice_rehearsal'
      and consumed_at is null
    for update;
  if not found then
    return null;
  end if;
  exchanged_at := clock_timestamp();

  update harbor_outreach_handoff.handoffs as handoff
    set consumed_at = exchanged_at, run_id = p_run_id, run_key_digest = p_run_key_digest,
        run_expires_at = exchanged_at + interval '60 minutes'
    from public.outreach_requests as request
    where handoff.token_digest = p_token_digest and handoff.purpose = 'voice_rehearsal'
      and handoff.consumed_at is null and handoff.expires_at > exchanged_at
      and (request.owner_id, request.request_id) = (handoff.owner_id, handoff.request_id)
      and request.status = 'requested'
    returning jsonb_build_object(
      'runId', handoff.run_id, 'requestId', request.request_id,
      'providerId', request.provider_id, 'brief', request.brief
    ) into result;

  return result;
exception
  when unique_violation then return null;
end;
$$;

create or replace function harbor_outreach_handoff.authorize_outreach_run(
  p_run_id uuid,
  p_run_key_digest text
)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'runId', handoff.run_id, 'requestId', request.request_id,
    'providerId', request.provider_id, 'brief', request.brief
  )
    from harbor_outreach_handoff.handoffs as handoff
    join public.outreach_requests as request using (owner_id, request_id)
    where handoff.run_id = p_run_id and handoff.run_key_digest = p_run_key_digest
      and p_run_key_digest ~ '^[0-9a-f]{64}$'
      and handoff.purpose = 'voice_rehearsal' and handoff.run_expires_at > clock_timestamp()
      and request.status = 'requested';
$$;

revoke all on function harbor_outreach_handoff.issue_outreach_handoff(uuid, uuid, text),
  harbor_outreach_handoff.exchange_outreach_handoff(text, uuid, text),
  harbor_outreach_handoff.authorize_outreach_run(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function harbor_outreach_handoff.issue_outreach_handoff(uuid, uuid, text),
  harbor_outreach_handoff.exchange_outreach_handoff(text, uuid, text),
  harbor_outreach_handoff.authorize_outreach_run(uuid, text)
  to service_role;

create or replace function public.issue_outreach_handoff(
  p_owner_user_id uuid,
  p_request_id uuid,
  p_token_digest text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select harbor_outreach_handoff.issue_outreach_handoff(p_owner_user_id, p_request_id, p_token_digest);
$$;

create or replace function public.exchange_outreach_handoff(
  p_token_digest text,
  p_run_id uuid,
  p_run_key_digest text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select harbor_outreach_handoff.exchange_outreach_handoff(p_token_digest, p_run_id, p_run_key_digest);
$$;

create or replace function public.authorize_outreach_run(
  p_run_id uuid,
  p_run_key_digest text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select harbor_outreach_handoff.authorize_outreach_run(p_run_id, p_run_key_digest);
$$;

revoke all on function public.issue_outreach_handoff(uuid, uuid, text),
  public.exchange_outreach_handoff(text, uuid, text),
  public.authorize_outreach_run(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_outreach_handoff(uuid, uuid, text),
  public.exchange_outreach_handoff(text, uuid, text),
  public.authorize_outreach_run(uuid, text)
  to service_role;

commit;
