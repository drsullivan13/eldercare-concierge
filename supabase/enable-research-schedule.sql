-- Run only after the authenticated worker's live check succeeds.
-- The named job is updated in place when this statement is repeated.
select cron.schedule(
  'harbor-research-every-15-min',
  '*/15 * * * *',
  $job$select harbor_research.invoke_worker('run');$job$
);
