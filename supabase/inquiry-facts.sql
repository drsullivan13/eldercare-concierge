-- Private append-only family-reported facts. Apply after outreach-requests.sql.
begin;
create table if not exists public.inquiry_facts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  request_id uuid not null,
  provider_id text not null,
  fact jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, request_id) references public.outreach_requests(owner_id, request_id) on delete cascade,
  constraint inquiry_fact_shape check ((
    jsonb_typeof(fact) = 'object' and octet_length(fact::text) <= 2048
    and fact - array['id','requestId','providerId','careZip','kind','value','checkedOn','validUntil','source'] = '{}'::jsonb
    and fact ?& array['id','requestId','providerId','careZip','kind','value','checkedOn','validUntil','source']
    and fact->>'id' = id::text and fact->>'requestId' = request_id::text and fact->>'providerId' = provider_id
    and jsonb_typeof(fact->'careZip') = 'string'
    and fact->>'careZip' ~ '^[0-9]{5}$'
    and fact->>'source' = 'family_reported_office_response'
    and fact->>'kind' in ('coverage_zip','hourly_rate','minimum_hours','earliest_start')
    and jsonb_typeof(fact->'checkedOn') = 'string' and fact->>'checkedOn' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (fact->>'checkedOn')::date <= current_date
    and (fact->'validUntil' = 'null'::jsonb or (jsonb_typeof(fact->'validUntil') = 'string' and fact->>'validUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (fact->>'validUntil')::date >= (fact->>'checkedOn')::date))
    and (fact->'value' = 'null'::jsonb or (jsonb_typeof(fact->'value') = 'string' and case fact->>'kind'
      when 'coverage_zip' then fact->>'value' in ('serves','does_not_serve')
      when 'hourly_rate' then case when fact->>'value' ~ '^(0|[1-9][0-9]{0,4})(\.[0-9]{1,2})?$' then (fact->>'value')::numeric <= 10000 else false end
      when 'minimum_hours' then case when fact->>'value' ~ '^(0|[1-9][0-9]{0,4})(\.[0-9]{1,2})?$' then (fact->>'value')::numeric <= 168 else false end
      when 'earliest_start' then fact->>'value' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (fact->>'value')::date is not null
      else false end))
  ) is true)
);
create index if not exists inquiry_facts_request_idx on public.inquiry_facts(owner_id, request_id, created_at, id);
alter table public.inquiry_facts enable row level security;
drop policy if exists inquiry_facts_owner_read on public.inquiry_facts;
create policy inquiry_facts_owner_read on public.inquiry_facts for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists inquiry_facts_owner_insert on public.inquiry_facts;
create policy inquiry_facts_owner_insert on public.inquiry_facts for insert to authenticated with check (owner_id = (select auth.uid()));
revoke all on public.inquiry_facts from public, anon, authenticated, service_role;
grant select on public.inquiry_facts to authenticated;
grant insert (owner_id,id,request_id,provider_id,fact) on public.inquiry_facts to authenticated;
create or replace function public.guard_inquiry_fact() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text || ':' || new.request_id::text, 0));
  if not exists (select 1 from public.outreach_requests where owner_id=new.owner_id and request_id=new.request_id and provider_id=new.provider_id) then
    raise exception 'Request/provider mismatch' using errcode='23503';
  end if;
  if not exists (select 1 from public.inquiry_facts where owner_id=new.owner_id and id=new.id) and (select count(*) from public.inquiry_facts where owner_id=new.owner_id and request_id=new.request_id) >= 200 then
    raise exception 'Private fact history limit reached' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_inquiry_fact() from public, anon, authenticated, service_role;
drop trigger if exists guard_inquiry_fact on public.inquiry_facts;
create trigger guard_inquiry_fact before insert on public.inquiry_facts for each row execute function public.guard_inquiry_fact();
commit;
