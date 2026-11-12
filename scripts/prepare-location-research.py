#!/usr/bin/env python3
"""Rebuild source-linked location details from reviewed local inputs; no network."""
import json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'src/data'; INPUT=DATA/'inputs/location-research'
KINDS={'care','amenity','activity','dining','room','cost','availability','capacity'}
STATUS={'opening-published':3,'waitlist-published':2,'inquiry-only':1,'not-published':0}
def load(p): return json.loads(p.read_text())
def main():
    catalog=load(DATA/'providers.json'); ids={p['id'] for p in catalog}
    out={p['id']:{'providerId':p['id'],'checkedAt':None,'providerDetailsReviewed':False,'sources':[],'facts':[],'availability':{'status':'not-published','text':'No current opening or waitlist evidence has been established in this research snapshot.','sourceId':None,'asOf':None},'reviewAggregates':[],'reviews':[],'notes':[]} for p in catalog}
    for path in sorted(INPUT.glob('*.json')):
        rows=load(path)
        if not isinstance(rows,list): raise ValueError(f'{path}: expected array')
        for row in rows:
            pid=row['providerId']
            if pid not in ids: raise ValueError(f'Unknown provider {pid}')
            target=out[pid]; prefix=path.stem+'-'; source_ids={s['id'] for s in row.get('sources',[])}
            if len(source_ids)!=len(row.get('sources',[])): raise ValueError('Duplicate source ID: '+pid)
            for s in row.get('sources',[]):
                if not isinstance(s.get('url'),str) or not s['url'].startswith(('https://','http://')): raise ValueError('Invalid source URL: '+pid)
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',s['checkedAt']): raise ValueError('Missing source check: '+pid)
                target['sources'].append({**s,'id':prefix+s['id'],'publishedAt':s.get('publishedAt')})
            for fact in row.get('facts',[]):
                if fact['kind'] not in KINDS or fact['sourceId'] not in source_ids or not fact.get('text'): raise ValueError('Invalid fact/source: '+pid)
                amount=fact.get('amount')
                if amount is not None:
                    if amount['currency']!='USD' or amount['period'] not in {'month','day','hour','one-time'} or not isinstance(amount['min'],(int,float)) or amount['min']<0: raise ValueError('Invalid cost: '+pid)
                    if amount.get('max') is not None and amount['max']<amount['min']: raise ValueError('Invalid cost range: '+pid)
                target['facts'].append({**fact,'id':prefix+fact['id'],'sourceId':prefix+fact['sourceId']})
            for key in ['reviewAggregates','reviews']:
                for item in row.get(key,[]):
                    if item['sourceId'] not in source_ids: raise ValueError('Review source missing: '+pid)
                    result={**item,'sourceId':prefix+item['sourceId']}
                    if 'id' in item: result['id']=prefix+item['id']
                    target[key].append(result)
            availability=row.get('availability',{})
            if availability:
                status=availability['status']
                if status not in STATUS: raise ValueError('Unknown availability status')
                sid=availability.get('sourceId')
                if sid and sid not in source_ids: raise ValueError('Availability source missing')
                if status in {'opening-published','waitlist-published'} and not sid: raise ValueError('Published availability needs evidence')
                if STATUS[status]>STATUS[target['availability']['status']]:
                    target['availability']={**availability,'sourceId':prefix+sid if sid else None}
            if row.get('checkedAt'): target['checkedAt']=max(filter(None,[target['checkedAt'],row['checkedAt']]))
            provider_sources={s['id'] for s in row.get('sources',[]) if s['kind']=='provider' and s['access'] in {'full-page','pdf'}}
            if any(f['sourceId'] in provider_sources and f['kind'] in {'care','amenity','activity','dining','room','cost'} for f in row.get('facts',[])): target['providerDetailsReviewed']=True
            restriction=row.get('admissionRestriction')
            if restriction:
                if restriction['sourceId'] not in source_ids: raise ValueError('Admission restriction source missing')
                target['admissionRestriction']={**restriction,'sourceId':prefix+restriction['sourceId']}
            target['notes']+=row.get('notes',[])
    for row in out.values():
        row['notes']=list(dict.fromkeys(row['notes']))
        for key in ['sources','facts','reviews']:
            identities=[x['id'] for x in row[key]]
            if len(identities)!=len(set(identities)): raise ValueError('Duplicate merged identity')
    destination=DATA/'location-research.json'
    destination.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
    summary={'catalog':len(out),'withFacts':sum(bool(x['facts']) for x in out.values()),'providerDetailsReviewed':sum(x['providerDetailsReviewed'] for x in out.values()),'withPublishedCosts':sum(any(f.get('amount') is not None and f['amount']['min'] > 0 for f in x['facts']) for x in out.values()),'withReviewAggregates':sum(bool(x['reviewAggregates']) for x in out.values()),'withReviewExcerpts':sum(bool(x['reviews']) for x in out.values()),'publishedOpeningClaims':sum(x['availability']['status']=='opening-published' for x in out.values()),'publishedWaitlistClaims':sum(x['availability']['status']=='waitlist-published' for x in out.values())}
    (DATA/'location-research-coverage.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary))
if __name__=='__main__': main()
