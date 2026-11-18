-- Apply after outreach-requests.sql, before deploying the v2 family form/API.
-- Replaces the check on existing deployments; legacy briefs remain valid.
begin;
create or replace function harbor_outreach.valid_brief_list(items jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; value text;
begin
  if jsonb_typeof(items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(items) > 3 then return false; end if;
  for item in select * from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'string' then return false; end if;
    value := item #>> '{}';
    if char_length(value) > 160 or btrim(value, E' \t\n\r' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = ''
      or regexp_replace(value, E'[\t\n\r]', '', 'g') ~ ('[[:cntrl:]' || chr(128) || '-' || chr(159) || ']') then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function harbor_outreach.valid_brief_list(jsonb) from public;
grant usage on schema harbor_outreach to service_role;
grant execute on function harbor_outreach.valid_brief_list(jsonb) to service_role;
alter table public.outreach_requests drop constraint if exists outreach_request_brief_shape;
alter table public.outreach_requests add constraint outreach_request_brief_shape check (
    case
      when jsonb_typeof(brief) <> 'object'
        or jsonb_typeof(brief->'topics') is distinct from 'array'
        or jsonb_typeof(brief->'question') is distinct from 'string' then false
      else
        octet_length(brief::text) <= 16384
        and brief - array['topics', 'question', 'careZip', 'timing', 'situation', 'scenarioId', 'briefVersion', 'knownAnswers', 'outstandingQuestions'] = '{}'::jsonb
        and (not brief ? 'briefVersion' or brief->'briefVersion' = '2'::jsonb)
        and (not (brief ? 'knownAnswers' or brief ? 'outstandingQuestions') or brief->'briefVersion' = '2'::jsonb and brief ? 'briefVersion')
        and (not brief ? 'knownAnswers' or harbor_outreach.valid_brief_list(brief->'knownAnswers'))
        and (not brief ? 'outstandingQuestions' or harbor_outreach.valid_brief_list(brief->'outstandingQuestions'))
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
);
commit;
