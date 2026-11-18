-- Apply after outreach-requests.sql. No scheduling or messaging transport.
begin;
create table if not exists public.outreach_followups (
 owner_id uuid not null,
 followup_id uuid not null,
 request_id uuid not null,
 kind text not null check (kind in ('promised_callback','next_action')),
 assignee text not null check (assignee in ('office','family','coordinator')),
 note text not null check (char_length(note) between 1 and 500 and note !~ '^[[:space:]]*$'),
 due_at timestamptz,
 source text not null check (source in ('user_reported','validated_service')),
 channel text not null check (channel in ('phone','email','other')),
 status text not null default 'open' check (status in ('open','done')),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 primary key (owner_id, followup_id),
 foreign key (owner_id,request_id) references public.outreach_requests(owner_id,request_id) on delete cascade,
 check ((status = 'done') = (completed_at is not null)),
 check (due_at is null or isfinite(due_at))
);
create index if not exists outreach_followups_owner_due on public.outreach_followups(owner_id,status,due_at,followup_id);
create table if not exists public.outreach_followup_events (
 owner_id uuid not null,
 followup_id uuid not null,
 sequence integer not null check (sequence in (1,2)),
 event_type text not null check (event_type in ('recorded','completed')),
 source text not null check (source in ('user_reported','validated_service')),
 created_at timestamptz not null default now(),
 primary key(owner_id,followup_id,sequence),
 foreign key(owner_id,followup_id) references public.outreach_followups(owner_id,followup_id) on delete cascade
);
alter table public.outreach_followups enable row level security;
alter table public.outreach_followup_events enable row level security;
drop policy if exists followups_owner_read on public.outreach_followups;
create policy followups_owner_read on public.outreach_followups for select to authenticated using(owner_id=(select auth.uid()));
drop policy if exists followup_events_owner_read on public.outreach_followup_events;
create policy followup_events_owner_read on public.outreach_followup_events for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.outreach_followups,public.outreach_followup_events from public,anon,authenticated,service_role;
grant select on public.outreach_followups,public.outreach_followup_events to authenticated;
-- Caller-owned RPCs derive identity internally; no elevated server key required.
-- Remove superseded owner-argument overloads when reapplying this script.
drop function if exists public.record_outreach_followup(uuid,uuid,uuid,text,text,text,timestamptz,text);
drop function if exists public.complete_outreach_followup(uuid,uuid);
create or replace function public.record_outreach_followup(p_followup_id uuid,p_request_id uuid,p_kind text,p_assignee text,p_note text,p_due_at timestamptz,p_channel text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.outreach_followups; replayed boolean; v_owner_id uuid := auth.uid();
begin
 if v_owner_id is null or not exists (select 1 from auth.users where id=v_owner_id and not coalesce(is_anonymous,false)) then
 raise exception using errcode='42501',message='A non-anonymous account is required';
 end if;
 insert into public.outreach_followups(owner_id,followup_id,request_id,kind,assignee,note,due_at,source,channel)
 values(v_owner_id,p_followup_id,p_request_id,p_kind,p_assignee,p_note,p_due_at,'user_reported',p_channel)
 on conflict(owner_id,followup_id) do nothing returning * into r;
 replayed := not found;
 if replayed then
 select * into strict r from public.outreach_followups where owner_id=v_owner_id and followup_id=p_followup_id;
 if row(r.request_id,r.kind,r.assignee,r.note,r.due_at,r.channel) is distinct from row(p_request_id,p_kind,p_assignee,p_note,p_due_at,p_channel) then
 raise exception using errcode='23505',message='Follow-up ID already used';
 end if;
 else
 insert into public.outreach_followup_events(owner_id,followup_id,sequence,event_type,source) values(v_owner_id,p_followup_id,1,'recorded','user_reported');
 end if;
 return jsonb_build_object('followupId',r.followup_id,'replayed',replayed);
end; $$;
create or replace function public.complete_outreach_followup(p_followup_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.outreach_followups; replayed boolean; v_owner_id uuid := auth.uid();
begin
 if v_owner_id is null or not exists (select 1 from auth.users where id=v_owner_id and not coalesce(is_anonymous,false)) then
 raise exception using errcode='42501',message='A non-anonymous account is required';
 end if;
 select * into r from public.outreach_followups where owner_id=v_owner_id and followup_id=p_followup_id for update;
 if not found then raise exception using errcode='P0002',message='Follow-up not found'; end if;
 replayed := r.status='done';
 if not replayed then
 update public.outreach_followups set status='done',completed_at=now() where owner_id=v_owner_id and followup_id=p_followup_id;
 insert into public.outreach_followup_events(owner_id,followup_id,sequence,event_type,source) values(v_owner_id,p_followup_id,2,'completed','user_reported');
 end if;
 return jsonb_build_object('followupId',r.followup_id,'replayed',replayed);
end; $$;
revoke all on function public.record_outreach_followup(uuid,uuid,text,text,text,timestamptz,text),public.complete_outreach_followup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_outreach_followup(uuid,uuid,text,text,text,timestamptz,text),public.complete_outreach_followup(uuid) to authenticated;
commit;
