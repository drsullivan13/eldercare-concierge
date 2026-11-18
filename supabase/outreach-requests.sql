-- Apply in the Harbor Supabase project. Account clients read their own ledger;
-- only the server can submit a request. No transport or provider call is made.
begin;

create schema if not exists harbor_outreach;
revoke all on schema harbor_outreach from public, anon, authenticated, service_role;

create table if not exists public.outreach_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  provider_id text not null check (provider_id ~ '^north-jersey-hp-hp[0-9]{7}$'),
  brief jsonb not null,
  status text not null default 'requested' check (status = 'requested'),
  created_at timestamptz not null default now(),
  primary key (owner_id, request_id),
  constraint outreach_request_brief_shape check (
    case
      when jsonb_typeof(brief) <> 'object'
        or jsonb_typeof(brief->'topics') is distinct from 'array'
        or jsonb_typeof(brief->'question') is distinct from 'string' then false
      else
        octet_length(brief::text) <= 16384
        and brief - array['topics', 'question', 'careZip', 'timing', 'situation', 'scenarioId'] = '{}'::jsonb
        and jsonb_array_length(brief->'topics') <= 6
        -- Strict mode keeps nested arrays from being unwrapped by the filter.
        and not (brief->'topics' @? 'strict $[*] ? (@.type() != "string" || !(@ like_regex "^.{1,80}$" flag "s") || @ like_regex "^[[:space:]]*$")')
        and char_length(brief->>'question') <= 1000
        and (brief->>'question' !~ '^[[:space:]]*$' or jsonb_array_length(brief->'topics') > 0)
        and (not brief ? 'careZip' or (
          jsonb_typeof(brief->'careZip') = 'string' and brief->>'careZip' ~ '^[0-9]{5}$'
        ))
        and (not brief ? 'timing' or (
          jsonb_typeof(brief->'timing') = 'string'
          and char_length(brief->>'timing') between 1 and 100
          and brief->>'timing' !~ '^[[:space:]]*$'
        ))
        and (not brief ? 'situation' or (
          jsonb_typeof(brief->'situation') = 'string'
          and char_length(brief->>'situation') between 1 and 500
          and brief->>'situation' !~ '^[[:space:]]*$'
        ))
        and (not brief ? 'scenarioId' or (
          jsonb_typeof(brief->'scenarioId') = 'string'
          and brief->>'scenarioId' in ('home-care-chris', 'home-care-priya', 'home-care-rob')
        ))
    end
  )
);
create index if not exists outreach_requests_owner_created_idx
  on public.outreach_requests (owner_id, created_at desc, request_id desc);

create table if not exists public.outreach_request_events (
  owner_id uuid not null,
  request_id uuid not null,
  sequence integer not null check (sequence > 0),
  event_type text not null check (event_type = 'requested'),
  created_at timestamptz not null,
  primary key (owner_id, request_id, sequence),
  foreign key (owner_id, request_id)
    references public.outreach_requests(owner_id, request_id) on delete cascade
);

alter table public.outreach_requests enable row level security;
alter table public.outreach_request_events enable row level security;

drop policy if exists outreach_requests_owner_read on public.outreach_requests;
create policy outreach_requests_owner_read on public.outreach_requests
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists outreach_request_events_owner_read on public.outreach_request_events;
create policy outreach_request_events_owner_read on public.outreach_request_events
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.outreach_requests, public.outreach_request_events
  from public, anon, authenticated, service_role;
grant select on public.outreach_requests, public.outreach_request_events to authenticated;
grant select, insert (owner_id, request_id, provider_id, brief)
  on public.outreach_requests to service_role;

-- The trigger makes a request and its first event atomic, including direct
-- inserts by the service role. API roles have no event mutation privileges.
create or replace function harbor_outreach.append_requested_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.outreach_request_events (owner_id, request_id, sequence, event_type, created_at)
    values (new.owner_id, new.request_id, 1, 'requested', new.created_at);
  return new;
end;
$$;
revoke all on function harbor_outreach.append_requested_event()
  from public, anon, authenticated, service_role;

drop trigger if exists outreach_request_append_event on public.outreach_requests;
create trigger outreach_request_append_event after insert on public.outreach_requests
  for each row execute function harbor_outreach.append_requested_event();

create or replace function public.create_outreach_request(
  p_owner_id uuid,
  p_request_id uuid,
  p_provider_id text,
  p_brief jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  request_row public.outreach_requests;
  replayed boolean;
begin
  insert into public.outreach_requests (owner_id, request_id, provider_id, brief)
    values (p_owner_id, p_request_id, p_provider_id, p_brief)
    on conflict (owner_id, request_id) do nothing
    returning * into request_row;
  replayed := not found;

  if replayed then
    -- At READ COMMITTED this statement also sees a concurrent winning insert.
    select * into strict request_row from public.outreach_requests
      where owner_id = p_owner_id and request_id = p_request_id;
    if request_row.provider_id is distinct from p_provider_id
      or request_row.brief is distinct from p_brief then
      raise exception using errcode = '23505', message = 'Outreach request ID already used';
    end if;
  end if;

  return jsonb_build_object(
    'requestId', request_row.request_id,
    'providerId', request_row.provider_id,
    'status', request_row.status,
    'createdAt', request_row.created_at,
    'replayed', replayed
  );
end;
$$;
revoke all on function public.create_outreach_request(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_outreach_request(uuid, uuid, text, jsonb)
  to service_role;

commit;
