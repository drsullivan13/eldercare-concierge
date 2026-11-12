#!/usr/bin/env python3
"""Write an idempotent SQL seed from reviewed catalog data; never connect to a DB."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
providers = json.loads((ROOT / 'src/data/providers.json').read_text())
research = json.loads((ROOT / 'src/data/location-research.json').read_text())
home_health = json.loads((ROOT / 'src/data/home-health-evidence.json').read_text())
pilot = ['ma-alr-sunrise-of-newton', 'lifeplan-brooksby-village', 'ma-alr-allerton-house-at-harbor-park']
assert set(pilot) <= {p['id'] for p in providers}
ccns = {}
for agency in home_health['agencies']:
    ccns.setdefault(agency['organizationId'], []).append(agency['ccn'])
records = [dict(provider_id=p['id'], name=p['name'], care_category=p['category'],
                address=p['address'], city=p['city'], state=p['state'], zip=p['zip'],
                phone=p.get('phone'), website=p.get('website'),
                cms_ccns=ccns.get(p['id'], [p['cms']['ccn']] if p.get('cms') else [])) for p in providers]
manual = [dict(provider_id=p['id'], status='collected' if research[p['id']]['reviewAggregates'] else 'not_checked',
               metadata={'collection_mode': 'reviewed_manual_snapshot', 'aggregate_sources': len(research[p['id']]['reviewAggregates']),
                         'observed_date': research[p['id']]['checkedAt']}) for p in providers]
sources = []
for dataset in ['4pq5-n9py', '6jpm-sxkc', 'ccn4-8vby', 'c886-nwpj', 'fa88-6ff2']:
    sources.append(dict(source_key=f'cms-metadata-{dataset}', config={'dataset': dataset, 'mode': 'metadata', 'repeat': True}))
for dataset in ['c886-nwpj', 'fa88-6ff2']:
    sources.append(dict(source_key=f'cms-periods-{dataset}', config={'dataset': dataset, 'mode': 'periods', 'repeat': True}))
for provider_id, identities in ccns.items():
    for ccn in identities:
        for dataset in ['ccn4-8vby', '6jpm-sxkc']:
            sources.append(dict(source_key=f'cms-{dataset}-{ccn}', config={'dataset': dataset, 'mode': 'record', 'ccn': ccn, 'provider_id': provider_id, 'repeat': True}))

def literal(value):
    data = json.dumps(value, ensure_ascii=False)
    assert '$harbor_seed$' not in data
    return '$harbor_seed$' + data + '$harbor_seed$::jsonb'

sql = f"""begin;
insert into harbor_research.catalog_entities(provider_id,name,care_category,address,city,state,zip,phone,website,cms_ccns)
select provider_id,name,care_category,address,city,state,zip,phone,website,cms_ccns from jsonb_to_recordset({literal(records)})
as x(provider_id text,name text,care_category text,address text,city text,state text,zip text,phone text,website text,cms_ccns jsonb)
on conflict(provider_id) do nothing;

insert into harbor_research.sources(source_key,connector,enabled,rights_approved,collection_scope,config)
values ('manual-public-reviews','catalog',false,false,'manual_only','{{"reason":"Public review evidence requires source-specific access and reviewed ingestion."}}'),
('facebook-research','catalog',false,false,'manual_only','{{"reason":"External research files enter the validated private staging workflow."}}')
on conflict(source_key) do nothing;

insert into harbor_research.coverage(provider_id,source_key,status,metadata)
select provider_id,'manual-public-reviews',status,metadata from jsonb_to_recordset({literal(manual)})
as x(provider_id text,status text,metadata jsonb) on conflict do nothing;
insert into harbor_research.coverage(provider_id,source_key,status)
select provider_id,'facebook-research','not_checked' from harbor_research.catalog_entities on conflict do nothing;

insert into harbor_research.sources(source_key,connector,enabled,rights_approved,collection_scope,config)
select 'yelp-'||provider_id,'yelp',provider_id in (select jsonb_array_elements_text({literal(pilot)})),true,'identifiers_capability_only',
jsonb_build_object('provider_id',provider_id,'repeat',false,'identity',jsonb_build_object('name',name,'address',address,'city',city,'state',state,'zip',zip,'phone',phone),
'access_mode','standard_places_evaluation','analysis_permitted',false,'content_retention_permitted',false)
from harbor_research.catalog_entities on conflict(source_key) do nothing;
insert into harbor_research.coverage(provider_id,source_key,status)
select provider_id,'yelp-'||provider_id,'not_checked' from harbor_research.catalog_entities on conflict do nothing;

insert into harbor_research.sources(source_key,connector,enabled,rights_approved,collection_scope,config)
select source_key,'cms',true,true,'official_public_data',config from jsonb_to_recordset({literal(sources)})
as x(source_key text,config jsonb) on conflict(source_key) do nothing;
select public.harbor_research_enqueue_due_jobs();
-- Check configured credentials first using the bounded three-location evaluation.
update harbor_research.jobs set run_after=now()-interval '1 hour' where source_key like 'yelp-%' and status='queued';
commit;
"""
output = ROOT / 'artifacts/research-registry-seed.sql'
output.parent.mkdir(exist_ok=True)
output.write_text(sql)
print(f'Prepared {len(records)} registry records, {len(sources)} CMS sources and {len(pilot)} enabled Yelp evaluation locations in {output}.')
