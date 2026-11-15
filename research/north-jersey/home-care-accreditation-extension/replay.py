#!/usr/bin/env python3
"""Replay source-specific Home Care accreditation matches against Harbor's actual NJ offices."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import sys
from datetime import date

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "scripts/regions"))
from nj_collect import workbook_rows

SOURCES = {
    "achc": ("Accreditation Commission for Health Care", "https://ams.achc.org/accredited_organizations.aspx"),
    "chap": ("Community Health Accreditation Partner", "https://locator.chaplinq.org/"),
}
CATALOG = ROOT / "src/data/regional-markets.json"
SUPPLY = HERE.parent / "home-care-supply"
ADDRESS_WORDS = {
    "AVENUE":"AVE", "ROAD":"RD", "STREET":"ST", "LANE":"LN", "BOULEVARD":"BLVD",
    "SUITE":"UNIT", "STE":"UNIT", "FLOOR":"FL", "HIGHWAY":"HWY", "ROUTE":"RT",
    "DRIVE":"DR", "PARKWAY":"PKWY", "NORTH":"N", "EAST":"E", "SOUTH":"S", "WEST":"W",
    "BUILDING":"BLDG", "PLACE":"PL", "COURT":"CT",
}
CORPORATE_WORDS = {"LLC","INC","INCORPORATED","CORPORATION","CORP","COMPANY","LIMITED","LIABILITY","THE","A","DBA","D","B","AND"}


def read(path):
    return json.loads(path.read_text())


def encoded(value):
    return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def words(value):
    return re.findall(r"[A-Z0-9]+", value.upper())


def address(value):
    value = re.sub(r"#(?=\s*[a-z0-9])", " UNIT ", value, flags=re.I)
    return " ".join(ADDRESS_WORDS.get(w,w) for w in words(value)).replace("UNIT UNIT ", "UNIT ")


def company(value):
    value = " ".join(words(value)).replace("HOME CARE","HOMECARE").replace("HEALTH CARE","HEALTHCARE")
    return " ".join(w for w in value.split() if w not in CORPORATE_WORDS)


def aliases(legal, trade):
    splits = re.split(r"\s+(?:DBA|D/B/A)\s+", legal, flags=re.I)
    return {value for n in [legal, trade, *splits] if (value := company(n))}


def number(value):
    return re.sub(r"\D", "", value or "")[-10:]


def load_roster():
    city = next(m for m in read(CATALOG) if m["id"] == "north-jersey")
    book = {r["source_row"]:r for r in workbook_rows(SUPPLY/"source/firms.xlsx")}
    ledger = {r["registrationId"]:r for r in read(SUPPLY/"registrations.json")}
    result = []
    for provider in city["providers"]:
        if provider["category"] != "home-care":
            continue
        rid = provider["id"].rsplit("-", 1)[-1].upper()
        item = ledger[rid]
        r = book[item["primaryRow"]]
        if r["License/Registration"].strip().upper() != rid or r["Business Name"] != provider["name"]:
            raise ValueError(f"Registry identity drift for {provider['id']}")
        result.append({"providerId":provider["id"], "registeredName":r["Business Name"], "dbas":r["DBAs"],
                       "street":r["Business Address"], "city":r["Business City"], "zip":r["Business Zipcode"],
                       "phone":r["Business Phone"], "row":r["source_row"], "hold":item["outcome"]!="published"})
    return result


def key_for(r):
    return address(f'{r["street"]} {r["city"]} NJ {r["zip"]}')


def match(source, row, index):
    if source == "achc":
        fulladdress = key_for(row)
    else:
        fulladdress = re.sub(r" (\d{5}) \d{4}$", r" \1", address(row["displayAddress"]))
    candidates = index.get(fulladdress, [])
    matched = []
    for office in candidates:
        if office["hold"] or (source=="chap" and number(row["phone"]) and number(row["phone"])!=number(office["phone"])):
            continue
        shared = aliases(row["name"],row.get("dba","")) & aliases(office["registeredName"],office["dbas"])
        if shared:
            matched.append((office, sorted(shared)))
    if len(matched) == 1:
        return matched[0], None
    return None, "ambiguous_exact_office" if matched else "exact_name_full_address_or_phone_unconfirmed"


def render(source, row, office, checked, date_rows, detail_issue):
    if detail_issue and date_rows:
        raise ValueError("Dated claims cannot coexist with a source lookup hold")
    publisher, url = SOURCES[source]
    programs = set()
    for fact in date_rows:
        if fact["program"] != "Home Care" or not fact["services"]:
            continue
        start, end = date.fromisoformat(fact["from"]), date.fromisoformat(fact["to"])
        if start > end:
            raise ValueError("Accreditation period ends before it begins")
        if start <= date.fromisoformat(checked) <= end:
            services = [v.strip() for v in fact["services"] if isinstance(v,str) and v.strip()]
            for service in services:
                programs.add(f"{service} · {start.isoformat()} to {end.isoformat()}")
    if date_rows and not programs:
        return None, "no_dated_home_care_scope_current_at_check"
    if programs:
        state, listing = "current_location_scope", sorted(programs)
    else:
        state, listing = "directory_only", ["Listed in the Home Care directory. Check the scope with the accreditor."]
    key = row["id"]
    return {
        "providerId":office["providerId"],
        "office":{"name":row["name"],"address": row["displayAddress"] if source=="chap" else f'{row["street"]}, {row["city"]}, NJ {row["zip"]}'},
        "source":{"id":f"{source}-{office['providerId']}-{key}","url":url,"title":f"{publisher} · Home Care directory · {row['name']}",
                  "publisher":publisher,"kind":"public-directory","access":"full-page","checkedAt":checked,"publishedAt":None},
        "accreditations":listing,"services":[],"awards":[],"paymentOptions":[]
    }, state


def replay():
    registered = load_roster()
    index=defaultdict(list)
    for item in registered:
        index[key_for(item)].append(item)
    old={r["providerId"] for r in read(HERE.parent/"home-care-pulse/cahc-branches.json")}
    offices=[]; decisions=[]; counts={}; source_hashes={}
    for source,(_,url) in SOURCES.items():
        paths = [HERE/"sources"/f"{source}-{suffix}.json" for suffix in ("search","details")]
        snapshot, details = [read(p) for p in paths]
        for p in paths:
            source_hashes[str(p.relative_to(HERE))] = hashlib.sha256(p.read_bytes()).hexdigest()
        if snapshot["sourceUrl"] != url or details["sourceUrl"] != url or snapshot["checkedAt"] != details["checkedAt"]:
            raise ValueError(f"Source receipt mismatch: {source}")
        qry=snapshot["query"]
        if not (qry == {"serviceLine":"HomeCare","state":"NJ"} if source=="chap" else qry["program"]=="Home Care" and qry["state"]=="New Jersey" and qry["programControlValue"]=="29" and qry["stateControlValue"]=="35"):
            raise ValueError(f"Missing NJ Home Care query: {source}")
        checked=snapshot["checkedAt"]; byid={r["id"]:r for r in snapshot["records"]}
        if len(byid)!=len(snapshot["records"]): raise ValueError(f"Duplicate source office in {source}")
        if source=="chap" and (len(byid)!=snapshot["displayedCount"] or set(byid)!={i for pg in snapshot["pages"] for i in pg["ids"]}):
            raise ValueError("Incomplete CHAP result set")
        if source=="chap":
            for page in snapshot["pages"]:
                rows = [byid[key] for key in page["ids"]]
                digest = hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
                if digest != page["sha256"] or len(rows) != page["count"]:
                    raise ValueError("CHAP page receipt differs from the captured directory")
        direct={r["id"]:r["details"] for r in details["records"]};issues={r["id"]:r["issue"] for r in details["issues"]}
        if len(direct)!=len(details["records"]) or len(issues)!=len(details["issues"]) or (set(direct)|set(issues))-set(byid) or set(direct)&set(issues): raise ValueError("Conflicting or orphan detailed source row")
        source_offices=[]
        for key,row in byid.items():
            trace={"publisher":source,"sourceRowId":key};hit, reason=match(source,row,index)
            if hit:
                office,names=hit
                trace.update({"providerId":office["providerId"],"registryRow":office["row"],"matchedNames":names,
                              "phoneCorroborated":source == "chap" and bool(number(row.get("phone")))})
                published,state=render(source,row,office,checked,direct.get(key,[]),issues.get(key))
                if published:
                    source_offices.append(published)
                reason=state
                if key in issues:trace["detailIssue"]=issues[key]
            trace["disposition"]=reason
            decisions.append(trace)
        offices.extend(source_offices)
        counts[source]={"statewideOfficeRecords":len(byid),"publishedOfficeRecords":len(source_offices),
                         "dispositions":dict(Counter(r["disposition"] for r in decisions if r["publisher"]==source))}
    distinct={r["providerId"] for r in offices}
    return {"offices.json":{"schemaVersion":1,"offices":sorted(offices,key=lambda r:(r["providerId"],r["source"]["id"]))},
            "decisions.json":decisions,"summary.json":{"sources":counts,"distinctOffices":len(distinct),
              "currentRosterSize":len(registered),"previouslyPresentInCahc":len(distinct&old),
              "additionalToCahc":len(distinct-old),"sourceSha256":source_hashes}}


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--check",action="store_true");args=parser.parse_args()
    for fn,value in replay().items():
        p = ROOT/"src/data/home-care-accreditation-extension.json" if fn=="offices.json" else HERE/fn
        body=encoded(value)
        if args.check:
            if not p.is_file() or p.read_text()!=body:raise SystemExit(f"Release drift: {p}")
        else:p.write_text(body)
        if fn=="summary.json":print(json.dumps(value["sources"]),value["distinctOffices"],"distinct offices")
