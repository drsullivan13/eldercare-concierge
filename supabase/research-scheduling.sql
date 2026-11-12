-- Dedicated Harbor project only. Apply after research-pipeline.sql.
-- Apply research-worker-tickets.sql before deploying/enabling the worker.
begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Hosted Supabase owns net as supabase_admin. A postgres REVOKE does not remove
-- its PUBLIC grants. Never send Yelp keys or a project-wide key through pg_net.
-- The ticket migration uses an expiring, operation-bound, single-use credential.
-- net must remain outside the exposed Data API schemas, with no public proxy RPC.
commit;
