#!/usr/bin/env python3
"""Validate/rebuild the exact seven-unit evidence snapshot from retained CMS inputs.
Research normalization is retained, never synthesized at request time. Every
numeric/raw survey and quality field is checked against its original CMS row.
Run: python scripts/prepare-home-health.py (offline, standard library only).
"""
import hashlib,json,re
from datetime import datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];INPUT=ROOT/'src/data/inputs/home-health'
EXPECTED={'vna-care':['227068','227098'],'south-shore-vna':['227082'],'mgb-home-care':['227207'],'croi-health':['227241'],'all-care':['227263'],'bilh-at-home':['227495']}
def load(name):return json.loads((INPUT/name).read_text())
def write_json(path,value):
 temporary=path.with_suffix(path.suffix+'.tmp');temporary.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n');temporary.replace(path)
def numeric(raw):
 if raw is None:return None
 text=str(raw).strip().replace(',','')
 if text in {'','-','NA','N/A','Not Available'}:return None
 if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)',text):raise ValueError('Unexpected CMS numeric field: '+repr(raw))
 n=float(text);return int(n) if n.is_integer() else n

def main():
 snapshot=load('normalized-unit-evidence.json');quality={r['CMS Certification Number (CCN)']:r for r in load('matched-6jpm-sxkc.json')};survey={r['CMS Certification Number (CCN)']:r for r in load('matched-ccn4-8vby.json')}
 found={key:[] for key in EXPECTED}
 clinical_dates={r['Measure Name']:r['Measure Date Range'] for r in load('matched-c886-nwpj.json')}
 survey_ranges={r['Measure Date Range'] for r in load('matched-fa88-6ff2.json')}
 if len(survey_ranges)!=1:raise ValueError('Mixed survey date ranges require review')
 survey_dates=next(iter(survey_ranges)).split(' to ')
 survey_iso=[datetime.strptime(date.strip(),'%B %d, %Y').date().isoformat() for date in survey_dates]
 def check_metric(metric,row):
  if metric is None:return
  column=metric['sourceColumn']
  if column not in row or metric['rawValue']!=row[column] or metric['value']!=numeric(row[column]):raise ValueError('Metric mismatch: '+column)
  if metric['status']!=('published' if metric['value'] is not None else 'not published'):raise ValueError('Status mismatch')
 for unit in snapshot['units']:
  org=unit['organizationId'];ccn=unit['ccn']
  if org not in EXPECTED or ccn not in EXPECTED[org]:raise ValueError('Unverified organization/CCN match')
  found[org].append(ccn);q=quality[ccn];s=survey[ccn]
  if unit['cmsProviderName']!=q['Provider Name']:raise ValueError('CMS entity-name mismatch')
  if unit['cmsAddress']['street']!=q['Address'] or unit['cmsAddress']['zip']!=q['ZIP Code']:raise ValueError('CMS address mismatch')
  check_metric(unit['qualityOfPatientCare']['starRating'],q)
  if [unit['patientExperience']['period'][key] for key in ['start','end']]!=survey_iso:raise ValueError('Survey period mismatch')
  for key in ['summaryStarRating','completedSurveys','responseRate']:check_metric(unit['patientExperience'][key],s)
  for measure in unit['patientExperience']['measures']:
   check_metric(measure['percent'],s);check_metric(measure.get('starRating'),s)
  for measure in unit['qualityOfPatientCare'].get('components',[]):
   check_metric(measure['rate'],q)
   raw_range=clinical_dates[measure['dateSourceMeasureName']]
   if measure['dateSourceRawRange']!=raw_range:raise ValueError('Clinical raw period mismatch')
   clinical_iso=[datetime.strptime(date.strip(),'%B %d, %Y').date().isoformat() for date in raw_range.split('-',1)]
   if [measure['period'][key] for key in ['start','end']]!=clinical_iso:raise ValueError('Clinical period mismatch')
   if [unit['qualityOfPatientCare']['starComponentPeriod'][key] for key in ['start','end']]!=clinical_iso:raise ValueError('Star-component period mismatch')
   for key in ['publishedNumerator','publishedDenominator']:
    if key in measure:check_metric(measure[key],q)
 for org,ccns in EXPECTED.items():
  if sorted(found[org])!=sorted(ccns):raise ValueError('Missing/duplicate reporting unit for '+org)
 # Preserve actual date-file labels separately; a survey period is not a clinical period.
 sources=[]
 for dataset in ['6jpm-sxkc','ccn4-8vby','c886-nwpj','fa88-6ff2','m5jg-jg7i','vxub-6swi']:
  metadata=load('metadata-'+dataset+'.json');distribution=metadata['distribution'][0]
  sources.append({'datasetId':dataset,'title':metadata['title'],'url':(metadata['landingPage']['accessURL'] if isinstance(metadata['landingPage'],dict) else metadata['landingPage']),'downloadUrl':distribution['downloadURL'],'publisher':'Centers for Medicare & Medicaid Services','checkedAt':snapshot['checkedAt'],'releasedAt':metadata['released'],'modified':metadata.get('modified')})
 out={'schemaVersion':snapshot['schemaVersion'],'retrieved':snapshot['checkedAt'],'releasedAt':snapshot['releasedAt'],'sources':sources,'agencies':snapshot['units'],'clinicalMeasureDateRanges':[{'measure':r['Measure Name'],'rawPeriod':r['Measure Date Range']} for r in load('matched-c886-nwpj.json')],'surveyMeasureDateRanges':[{'measure':r['Measure Name'],'rawPeriod':r['Measure Date Range']} for r in load('matched-fa88-6ff2.json')],'patientExperienceComparators':snapshot['patientExperienceComparators'],'footnoteDefinitions':snapshot['footnoteDefinitions'],'interpretationRules':snapshot['interpretationRules']}
 dest=ROOT/'src/data/home-health-evidence.json';write_json(dest,out)
 manifest={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(INPUT.iterdir()) if p.is_file() and p.name!='source-hashes.json'};write_json(INPUT/'source-hashes.json',manifest)
 print('Validated 6 catalog organizations / 7 distinct CMS reporting units; preserved raw values and separate survey/quality data.')
if __name__=='__main__':main()
