-- Matches the owner-scoped request filter and the history cursor's tie-breaker.
create index if not exists outreach_rehearsal_receipts_request_page_idx
  on public.outreach_rehearsal_receipts (owner_id, request_id, created_at desc, run_id desc);
