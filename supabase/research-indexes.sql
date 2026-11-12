-- Apply after research-pipeline.sql. Cover source/provider joins and FK maintenance.
begin;
create index research_coverage_source on harbor_research.coverage(source_key);
create index research_jobs_source on harbor_research.jobs(source_key);
create index research_jobs_provider on harbor_research.jobs(provider_id);
create index research_snapshots_job on harbor_research.snapshots(job_id);
create index research_snapshots_provider on harbor_research.snapshots(provider_id);
create index research_candidates_job on harbor_research.candidates(job_id);
create index research_candidates_provider on harbor_research.candidates(provider_id);
create index research_candidates_snapshot on harbor_research.candidates(snapshot_id);
commit;
