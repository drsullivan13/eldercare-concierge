-- Research collection only. No publication, account UI, Vault, Cron, or remote execution.
-- Apply as a reviewed migration in the dedicated Harbor project. All RPCs are service-only.
begin;

create schema if not exists harbor_research;
revoke all on schema harbor_research from public, anon, authenticated;
grant usage on schema harbor_research to service_role;

create table harbor_research.catalog_entities (
  provider_id text primary key check (length(provider_id) between 1 and 160),
  name text not null check (length(name) between 1 and 300),
  care_category text not null,
  address text, city text, state text, zip text, phone text, website text,
  cms_ccns jsonb not null default '[]'::jsonb check (jsonb_typeof(cms_ccns) = 'array'),
  created_at timestamptz not null default now()
);

create table harbor_research.sources (
  source_key text primary key check (length(source_key) between 1 and 200),
  connector text not null check (connector in ('catalog', 'cms', 'yelp')),
  enabled boolean not null default false,
  rights_approved boolean not null default false,
  collection_scope text not null default 'manual_only'
    check (collection_scope in ('manual_only', 'official_public_data', 'identifiers_capability_only')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 16384),
  last_snapshot_hash text check (last_snapshot_hash ~ '^[0-9a-f]{64}$'),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  check ((connector = 'cms' and collection_scope in ('manual_only','official_public_data'))
    or (connector = 'yelp' and collection_scope in ('manual_only','identifiers_capability_only'))
    or (connector = 'catalog' and collection_scope = 'manual_only'))
);
comment on column harbor_research.sources.rights_approved is
  'Approval for declared collection_scope only; does not signify review-analysis or publication rights. Never store credentials in config.';

create table harbor_research.coverage (
  provider_id text not null references harbor_research.catalog_entities(provider_id),
  source_key text not null references harbor_research.sources(source_key),
  status text not null default 'not_checked'
    check (status in ('not_checked','queued','running','collected','unchanged','retry','blocked','failed')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_snapshot_hash text check (last_snapshot_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  primary key (provider_id, source_key)
);

create table harbor_research.jobs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references harbor_research.sources(source_key),
  provider_id text references harbor_research.catalog_entities(provider_id),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 300),
  status text not null default 'queued'
    check (status in ('queued','running','retry','succeeded','blocked','failed')),
  attempt integer not null default 0 check (attempt between 0 and 4),
  run_after timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'running' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'running' and lease_token is null and lease_expires_at is null))
);
create index research_jobs_due on harbor_research.jobs(run_after, created_at)
  where status in ('queued','retry','running');

create table harbor_research.attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references harbor_research.jobs(id),
  attempt integer not null check (attempt between 1 and 4),
  lease_token uuid not null,
  worker_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','succeeded','unchanged','retry','blocked','failed','lease_expired')),
  http_status integer check (http_status between 100 and 599),
  error_code text check (length(error_code) <= 64 and error_code ~ '^[A-Z0-9_]+$'),
  source_url text check (length(source_url) <= 2048),
  safe_metadata jsonb not null default '{}'::jsonb,
  unique (job_id, attempt),
  unique (job_id, lease_token)
);

create table harbor_research.snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references harbor_research.jobs(id),
  source_key text not null references harbor_research.sources(source_key),
  provider_id text references harbor_research.catalog_entities(provider_id),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content text not null check (octet_length(content) <= 1048576),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  fetched_at timestamptz not null default now(),
  unique (source_key, sha256)
);
comment on table harbor_research.snapshots is
  'CMS source responses only. Exact UTF8 content is hashed. No Yelp content, review text, ratings, or personal profiles.';

create table harbor_research.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references harbor_research.jobs(id),
  snapshot_id uuid not null references harbor_research.snapshots(id),
  provider_id text references harbor_research.catalog_entities(provider_id),
  kind text not null check (kind in ('cms-metadata','cms-survey','cms-clinical')),
  summary text not null check (length(summary) between 1 and 2000),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 131072),
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  review_reason text not null default 'New source observation; human review required before publication.',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index research_candidates_review on harbor_research.candidates(created_at)
  where review_status = 'pending';

create table harbor_research.daily_budgets (
  connector text not null check (connector in ('cms','yelp')),
  budget_day date not null,
  request_limit integer not null check (request_limit between 0 and 10000),
  used integer not null default 0 check (used >= 0 and used <= request_limit),
  primary key (connector, budget_day)
);

-- Private tables also use RLS as defense in depth. Only the backend role is allowed.
do $$ declare item record; begin
  for item in select tablename from pg_tables where schemaname = 'harbor_research' loop
    execute format('alter table harbor_research.%I enable row level security', item.tablename);
    execute format('create policy backend_only on harbor_research.%I for all to service_role using (true) with check (true)', item.tablename);
  end loop;
end $$;
revoke all on all tables in schema harbor_research from public, anon, authenticated;
revoke all on all sequences in schema harbor_research from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema harbor_research to service_role;
grant usage, select on all sequences in schema harbor_research to service_role;
-- No HTTP role needs to alter or truncate the evidence store.
revoke truncate, references, trigger on all tables in schema harbor_research from service_role;

create function public.harbor_research_enqueue_job(
  source_key text, provider_id text, payload jsonb, dedupe_key text,
  run_after timestamptz default now()
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_source text := source_key; v_provider text := provider_id;
  v_payload jsonb := payload; v_dedupe text := dedupe_key; v_after timestamptz := run_after;
  v_id uuid; v_existing harbor_research.jobs; v_bound_provider text;
begin
  if v_payload is null or jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 16384
    or v_dedupe is null or length(v_dedupe) not between 1 and 300 or v_after is null then
    raise exception 'Invalid enqueue arguments' using errcode = '22023';
  end if;
  select nullif(s.config->>'provider_id','') into v_bound_provider from harbor_research.sources s where s.source_key=v_source;
  if v_bound_provider is not null and v_bound_provider is distinct from v_provider then
    raise exception 'Job provider differs from configured source identity' using errcode = '22023';
  end if;
  insert into harbor_research.jobs(source_key,provider_id,payload,dedupe_key,run_after)
    values(v_source,v_provider,v_payload,v_dedupe,v_after)
    on conflict on constraint jobs_dedupe_key_key do nothing returning id into v_id;
  if v_id is null then
    select * into strict v_existing from harbor_research.jobs j where j.dedupe_key = v_dedupe;
    if v_existing.source_key is distinct from v_source or v_existing.provider_id is distinct from v_provider
      or v_existing.payload is distinct from v_payload then
      raise exception 'Dedupe key belongs to different work' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  if v_provider is not null then
    insert into harbor_research.coverage(provider_id,source_key,status)
      values(v_provider,v_source,'queued') on conflict on constraint coverage_pkey do nothing;
  end if;
  return v_id;
end $$;

create function public.harbor_research_enqueue_due_jobs()
returns integer language plpgsql security invoker set search_path = '' as $$
declare s harbor_research.sources; v_key text; v_added integer := 0; v_count integer;
begin
  for s in select * from harbor_research.sources
    where enabled and rights_approved and collection_scope <> 'manual_only' loop
    v_key := s.source_key || ':' || case when coalesce((s.config->>'repeat')::boolean, s.connector = 'cms')
      then (now() at time zone 'UTC')::date::text else 'initial' end;
    insert into harbor_research.jobs(source_key,provider_id,payload,dedupe_key)
      values(s.source_key,nullif(s.config->>'provider_id',''),s.config,v_key)
      on conflict (dedupe_key) do nothing;
    get diagnostics v_count = row_count;
    v_added := v_added + v_count;
    if nullif(s.config->>'provider_id','') is not null then
      insert into harbor_research.coverage(provider_id,source_key,status)
        values(s.config->>'provider_id',s.source_key,'queued') on conflict do nothing;
    end if;
  end loop;
  return v_added;
end $$;

create function public.harbor_research_claim_jobs(worker_id text, limit_count integer default 5)
returns table(job_id uuid, lease_token uuid, source_key text, provider_id text,
  payload jsonb, attempt integer, connector text, collection_scope text,
  config jsonb, source_last_snapshot_hash text)
language plpgsql security invoker set search_path = '' as $$
declare v_worker text := worker_id; v_limit integer := limit_count; j harbor_research.jobs;
  v_token uuid; v_count integer := 0;
begin
  if v_worker is null or length(v_worker) not between 1 and 100 or v_limit is null or v_limit not between 1 and 10 then
    raise exception 'Invalid worker or batch size' using errcode = '22023';
  end if;
  for j in select q.* from harbor_research.jobs q join harbor_research.sources s on s.source_key=q.source_key
    where s.enabled and s.rights_approved and s.collection_scope <> 'manual_only'
      and ((q.status in ('queued','retry') and q.run_after <= now())
        or (q.status='running' and q.lease_expires_at <= now()))
    order by q.run_after,q.created_at,q.id for update of q skip locked loop
    if j.status = 'running' then
      update harbor_research.attempts a set status='lease_expired', finished_at=now(),error_code='LEASE_EXPIRED'
        where a.job_id=j.id and a.lease_token=j.lease_token and a.status='running';
    end if;
    if j.attempt >= 4 then
      update harbor_research.jobs q set status='failed',lease_token=null,lease_expires_at=null,finished_at=now()
        where q.id=j.id;
      update harbor_research.coverage c set status='failed',last_attempt_at=now()
        where c.provider_id=j.provider_id and c.source_key=j.source_key;
      continue;
    end if;
    v_token := gen_random_uuid();
    update harbor_research.jobs q set status='running',attempt=q.attempt+1,worker_id=v_worker,
      lease_token=v_token,lease_expires_at=now()+interval '5 minutes',finished_at=null where q.id=j.id;
    insert into harbor_research.attempts(job_id,attempt,lease_token,worker_id)
      values(j.id,j.attempt+1,v_token,v_worker);
    update harbor_research.coverage c set status='running',last_attempt_at=now()
      where c.provider_id=j.provider_id and c.source_key=j.source_key;
    return query select j.id,v_token,j.source_key,j.provider_id,j.payload,j.attempt+1,
      s.connector,s.collection_scope,s.config,
      s.last_snapshot_hash
      from harbor_research.sources s where s.source_key=j.source_key;
    v_count := v_count+1;
    exit when v_count >= v_limit;
  end loop;
end $$;

create function public.harbor_research_reserve_budget(connector text, request_count integer default 1)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_connector text := connector; v_count integer := request_count;
  v_day date := (now() at time zone 'UTC')::date; v_limit integer; v_used integer;
begin
  if v_connector not in ('cms','yelp') or v_connector is null or v_count is null or v_count not between 1 and 25 then
    raise exception 'Invalid budget request' using errcode='22023';
  end if;
  -- Hard pilot ceiling is shared across every Yelp provider/source and worker.
  v_limit := case when v_connector='yelp' then 25 else 1000 end;
  insert into harbor_research.daily_budgets(connector,budget_day,request_limit,used)
    values(v_connector,v_day,v_limit,0) on conflict do nothing;
  update harbor_research.daily_budgets b set used=b.used+v_count
    where b.connector=v_connector and b.budget_day=v_day and b.used+v_count<=b.request_limit
    returning b.used into v_used;
  if v_used is null then
    select b.used,b.request_limit into v_used,v_limit from harbor_research.daily_budgets b
      where b.connector=v_connector and b.budget_day=v_day;
    return jsonb_build_object('reserved',false,'used',v_used,'limit',v_limit,'remaining',v_limit-v_used,'budget_day',v_day);
  end if;
  return jsonb_build_object('reserved',true,'used',v_used,'limit',v_limit,'remaining',v_limit-v_used,'budget_day',v_day);
end $$;

create function public.harbor_research_complete_job(job_id uuid, lease_token uuid, outcome jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_job uuid := job_id; v_token uuid := lease_token; o jsonb := outcome;
  j harbor_research.jobs; s harbor_research.sources; v_status text; v_http integer; v_error text;
  v_url text; v_meta jsonb := '{}'::jsonb; v_snapshot uuid; v_hash text; v_content text;
  v_item jsonb; v_delay integer; v_candidates integer := 0;
begin
  select * into j from harbor_research.jobs q where q.id=v_job for update;
  if not found or j.status <> 'running' or j.lease_token is distinct from v_token or j.lease_expires_at <= now() then
    raise exception 'Lease is absent, expired, or superseded' using errcode='55000';
  end if;
  select * into strict s from harbor_research.sources x where x.source_key=j.source_key;
  if not s.enabled or not s.rights_approved or s.collection_scope='manual_only' then
    raise exception 'Source collection is disabled' using errcode='42501';
  end if;
  if o is null or jsonb_typeof(o)<>'object' or octet_length(o::text)>1572864 then
    raise exception 'Invalid completion payload' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_object_keys(o) k where k not in
    ('status','http_status','error_code','source_url','retry_after_seconds','snapshot','candidates','listing_id','listing_url','capabilities')) then
    raise exception 'Unknown completion field' using errcode='22023';
  end if;
  v_status := o->>'status';
  if v_status is null or v_status not in ('succeeded','unchanged','retry','blocked','failed') then
    raise exception 'Invalid completion status' using errcode='22023';
  end if;
  if o ? 'http_status' then
    if jsonb_typeof(o->'http_status')<>'number' or o->>'http_status' !~ '^[0-9]{3}$' then
      raise exception 'Invalid HTTP status' using errcode='22023'; end if;
    v_http := (o->>'http_status')::integer;
    if v_http not between 100 and 599 then raise exception 'Invalid HTTP status' using errcode='22023'; end if;
  end if;
  v_error := o->>'error_code';
  if o ? 'error_code' and (jsonb_typeof(o->'error_code')<>'string' or length(v_error)>64 or v_error !~ '^[A-Z0-9_]+$') then
    raise exception 'Invalid error code' using errcode='22023'; end if;
  v_url := o->>'source_url';
  if v_url is not null and (length(v_url)>2048 or not (
      (s.connector='cms' and v_url ~ '^https://(data\.cms\.gov|www\.cms\.gov)/[^[:space:]]*$')
      or (s.connector='yelp' and v_url ~ '^https://(api\.yelp\.com/v3/|www\.yelp\.com/biz/)[A-Za-z0-9_/%.-]+$'))) then
    raise exception 'Source URL outside approved origin' using errcode='22023'; end if;
  if s.connector='yelp' then
    if o ? 'snapshot' or o ? 'candidates' then
      raise exception 'Yelp content retention is not permitted' using errcode='22023'; end if;
    if o ? 'listing_id' then
      if jsonb_typeof(o->'listing_id')<>'string' or length(o->>'listing_id') not between 1 and 200
        or o->>'listing_id' !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid listing ID' using errcode='22023'; end if;
      v_meta := v_meta || jsonb_build_object('listing_id',o->>'listing_id');
    end if;
    if o ? 'listing_url' then
      if jsonb_typeof(o->'listing_url')<>'string' or length(o->>'listing_url')>2048
        or o->>'listing_url' !~ '^https://www\.yelp\.com/biz/[A-Za-z0-9_%-]+$' then
        raise exception 'Invalid listing URL' using errcode='22023'; end if;
      v_meta := v_meta || jsonb_build_object('listing_url',o->>'listing_url');
    end if;
    if o ? 'capabilities' then
      if jsonb_typeof(o->'capabilities')<>'object' then raise exception 'Invalid capabilities' using errcode='22023'; end if;
      if exists(select 1 from jsonb_each(o->'capabilities') x where x.key not in ('business_match','business_details','reviews')
        or jsonb_typeof(x.value)<>'string' or x.value #>> '{}' not in ('available','unauthorized','forbidden','rate_limited','not_found','unknown')) then
        raise exception 'Invalid capability metadata' using errcode='22023'; end if;
      v_meta := v_meta || jsonb_build_object('capabilities',o->'capabilities');
    end if;
  elsif o ? 'listing_id' or o ? 'listing_url' or o ? 'capabilities' then
    raise exception 'Listing metadata requires Yelp connector' using errcode='22023';
  end if;
  if v_http in (401,403) then v_status := 'blocked'; end if;
  if v_http=429 and v_status not in ('blocked','failed') then v_status := 'retry'; end if;
  if v_status in ('succeeded','unchanged') and v_http is not null and v_http>=400 then
    raise exception 'HTTP failure cannot be successful collection' using errcode='22023'; end if;
  if (o ? 'snapshot' or o ? 'candidates') and (s.connector<>'cms' or v_status<>'succeeded') then
    raise exception 'Only successful CMS collections may stage content' using errcode='22023'; end if;
  if s.connector='cms' and v_status='succeeded' and
    (not (o ? 'snapshot') or v_http is null or v_http not between 200 and 299) then
    raise exception 'Successful CMS collection requires HTTP success and raw evidence' using errcode='22023'; end if;
  if o ? 'snapshot' then
    if jsonb_typeof(o->'snapshot')<>'object'
      or exists(select 1 from jsonb_object_keys(o->'snapshot') k where k not in ('sha256','content','metadata'))
      or jsonb_typeof(o#>'{snapshot,content}')<>'string' then
      raise exception 'CMS snapshot requires exact raw response text' using errcode='22023'; end if;
    v_content := o#>>'{snapshot,content}'; v_hash := o#>>'{snapshot,sha256}';
    if v_content is null or octet_length(v_content)>1048576 or v_hash is null or v_hash !~ '^[0-9a-f]{64}$'
      or v_hash<>encode(sha256(convert_to(v_content,'UTF8')),'hex') then
      raise exception 'Snapshot size or SHA256 mismatch' using errcode='22023'; end if;
    if o#>'{snapshot,metadata}' is not null and (jsonb_typeof(o#>'{snapshot,metadata}')<>'object'
      or octet_length((o#>'{snapshot,metadata}')::text)>16384) then
      raise exception 'Invalid snapshot metadata' using errcode='22023'; end if;
    insert into harbor_research.snapshots(job_id,source_key,provider_id,sha256,content,metadata)
      values(j.id,j.source_key,j.provider_id,v_hash,v_content,coalesce(o#>'{snapshot,metadata}','{}'::jsonb))
      on conflict (source_key,sha256) do nothing returning id into v_snapshot;
    if v_snapshot is null then
      select sn.id into v_snapshot from harbor_research.snapshots sn
        where sn.source_key=j.source_key and sn.sha256=v_hash and sn.provider_id is not distinct from j.provider_id;
      if v_snapshot is null then raise exception 'Snapshot belongs to another reporting identity' using errcode='22023'; end if;
    end if;
  end if;
  if o ? 'candidates' then
    if jsonb_typeof(o->'candidates')<>'array' or jsonb_array_length(o->'candidates')>25 or v_snapshot is null then
      raise exception 'Candidates require a verified snapshot; maximum25' using errcode='22023'; end if;
    for v_item in select value from jsonb_array_elements(o->'candidates') loop
      if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('kind','summary','data'))
        or v_item->>'kind' is null or v_item->>'kind' not in ('cms-metadata','cms-survey','cms-clinical')
        or jsonb_typeof(v_item->'summary')<>'string' or length(v_item->>'summary') not between 1 and 2000
        or jsonb_typeof(v_item->'data') is distinct from 'object' or octet_length((v_item->'data')::text)>131072 then
        raise exception 'Invalid candidate' using errcode='22023'; end if;
      -- Repeated content does not create repeated human-review work.
      if not exists(select 1 from harbor_research.candidates c where c.snapshot_id=v_snapshot
        and c.kind=v_item->>'kind' and c.data=v_item->'data') then
        insert into harbor_research.candidates(job_id,snapshot_id,provider_id,kind,summary,data)
          values(j.id,v_snapshot,j.provider_id,v_item->>'kind',v_item->>'summary',v_item->'data');
        v_candidates := v_candidates+1;
      end if;
    end loop;
  end if;
  if v_status='unchanged' and not exists(select 1 from harbor_research.snapshots sn
    where sn.source_key=j.source_key and sn.provider_id is not distinct from j.provider_id) then
    raise exception 'Unchanged requires a previous exact-identity snapshot' using errcode='22023'; end if;
  if v_status='retry' then
    if o ? 'retry_after_seconds' and (jsonb_typeof(o->'retry_after_seconds')<>'number'
      or o->>'retry_after_seconds' !~ '^[0-9]+$' or length(o->>'retry_after_seconds')>8) then
      raise exception 'Invalid retry delay' using errcode='22023'; end if;
    v_delay := greatest(60*(2^(j.attempt-1))::integer,least(coalesce((o->>'retry_after_seconds')::integer,0),86400));
    if j.attempt>=4 then v_status:='failed'; end if;
  end if;
  update harbor_research.attempts a set finished_at=now(),status=v_status,http_status=v_http,
    error_code=v_error,source_url=v_url,safe_metadata=v_meta where a.job_id=j.id and a.lease_token=v_token;
  update harbor_research.jobs q set status=case when v_status='unchanged' then 'succeeded' else v_status end,
    lease_token=null,lease_expires_at=null,finished_at=case when v_status='retry' then null else now() end,
    run_after=case when v_status='retry' then now()+make_interval(secs=>v_delay) else q.run_after end where q.id=j.id;
  update harbor_research.coverage c set status=case when v_status='succeeded' then 'collected' else v_status end,
    last_attempt_at=now(),last_success_at=case when v_status in ('succeeded','unchanged') then now() else c.last_success_at end,
    last_snapshot_hash=coalesce(v_hash,c.last_snapshot_hash),metadata=c.metadata||v_meta
    where c.provider_id=j.provider_id and c.source_key=j.source_key;
  if v_status in ('succeeded','unchanged') then
    update harbor_research.sources x set last_success_at=now(),last_snapshot_hash=coalesce(v_hash,x.last_snapshot_hash)
      where x.source_key=j.source_key;
  end if;
  return jsonb_build_object('job_id',j.id,'status',v_status,'snapshot_id',v_snapshot,'candidates_queued',v_candidates);
end $$;

create function public.harbor_research_status()
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'registry_count',(select count(*) from harbor_research.catalog_entities),
    'coverage_count',(select count(*) from harbor_research.coverage),
    'pending_review_count',(select count(*) from harbor_research.candidates where review_status='pending'),
    'jobs',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from
      (select status,count(*) n from harbor_research.jobs group by status) c),
    'enabled_sources',(select coalesce(jsonb_agg(jsonb_build_object('source_key',source_key,'connector',connector,
      'collection_scope',collection_scope,'config',config) order by source_key),'[]'::jsonb)
      from (select * from harbor_research.sources where enabled and rights_approved and collection_scope<>'manual_only'
        order by source_key limit 1000) s)
  );
$$;

-- PostgreSQL grants function EXECUTE to PUBLIC by default: narrow each exact signature.
revoke all on function public.harbor_research_enqueue_job(text,text,jsonb,text,timestamptz) from public,anon,authenticated;
revoke all on function public.harbor_research_enqueue_due_jobs() from public,anon,authenticated;
revoke all on function public.harbor_research_claim_jobs(text,integer) from public,anon,authenticated;
revoke all on function public.harbor_research_complete_job(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.harbor_research_reserve_budget(text,integer) from public,anon,authenticated;
revoke all on function public.harbor_research_status() from public,anon,authenticated;
grant execute on function public.harbor_research_enqueue_job(text,text,jsonb,text,timestamptz) to service_role;
grant execute on function public.harbor_research_enqueue_due_jobs() to service_role;
grant execute on function public.harbor_research_claim_jobs(text,integer) to service_role;
grant execute on function public.harbor_research_complete_job(uuid,uuid,jsonb) to service_role;
grant execute on function public.harbor_research_reserve_budget(text,integer) to service_role;
grant execute on function public.harbor_research_status() to service_role;
commit;
