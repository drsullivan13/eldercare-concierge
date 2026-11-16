-- Dedicated Harbor production project; apply after deploying /api/consultation-recovery.
begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create or replace function harbor_consultations.invoke_recovery()
returns bigint language plpgsql security invoker set search_path='' as $$
declare token uuid; job bigint;
begin
  delete from harbor_consultations.recovery_tickets where expires_at<=now();
  if not exists(select 1 from harbor_consultations.due_bookings) then return null; end if;
  insert into harbor_consultations.recovery_tickets default values returning id into token;
  select net.http_post(
    url:='https://eldercare-concierge-one.vercel.app/api/consultation-recovery',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:=jsonb_build_object('ticket',token),timeout_milliseconds:=60000) into job;
  return job;
end $$;
revoke all on function harbor_consultations.invoke_recovery() from public,anon,authenticated;
select cron.schedule('harbor-consultation-recovery','* * * * *', 'select harbor_consultations.invoke_recovery()');
commit;
