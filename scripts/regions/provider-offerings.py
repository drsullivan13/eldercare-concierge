#!/usr/bin/env python3
"""Build location-specific offerings from a reviewed market roster and provider-page checks."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "research/north-jersey"
SUFFIXES = {"AVE": "AVENUE", "RD": "ROAD", "ST": "STREET", "DR": "DRIVE",
            "E": "EAST", "W": "WEST", "BLVD": "BOULEVARD", "STE": "SUITE"}


def address_key(value):
    return tuple(SUFFIXES.get(word, word) for word in re.findall(r"[A-Z0-9]+", value.upper()))


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode()


def check_identity(provider, page):
    roster_address = provider["address"]
    if provider["zip"] not in roster_address:
        roster_address += f" {provider['city']} {provider['state']} {provider['zip']}"
    if address_key(roster_address) != address_key(page["address"]):
        return "source_address_disagrees"
    if provider["category"] != page.get("category", "assisted-living"):
        return "scope_requires_unit_review"
    # An exact address and correct care setting corroborate the operator-page assignment.
    brand = provider["name"].upper().split()[0]
    if brand not in page["title"].upper():
        return "name_or_city_disagrees"
    return None


def release(provider, page, directory=None):
    pid = provider["id"]
    record = dict(providerId=pid, checkedAt=None, providerDetailsReviewed=False,
                  facts=[], sources=[], availability=dict(status="not-published",
                  text="Availability has not been independently checked.", sourceId=None, asOf=None),
                  reviewAggregates=[], reviews=[], notes=[])
    def source(src, kind, published):
        key = "offering-" + hashlib.sha256(src["url"].encode()).hexdigest()[:14]
        record["sources"].append(dict(id=key, url=src["url"], publisher=src["publisher"],
            title=src["title"], kind=kind, checkedAt=src["checkedAt"], publishedAt=published, access="full-page"))
        return key
    def fact(kind, text, source_id, as_of=None, **extra):
        record["facts"].append(dict(id=f"{pid}-offering-{len(record['facts'])+1}",
            kind=kind, text=text, sourceId=source_id, asOf=as_of, **extra))

    for src in provider["sources"]:
        doh = src["title"] == "NJ DOH licensed long-term care facilities"
        hha = src["title"] == "Home Health Care Agencies" and provider["category"] == "home-health"
        if not (doh or hha):
            continue
        sid = source(src, "regulator", src.get("dataAsOf"))
        for service in provider["services"]:
            description = f"State-licensed setting: {service}." if doh else f"CMS lists {service.lower()} for this certified agency."
            fact("care", description, sid, src.get("dataAsOf"))
        if doh and provider.get("capacity") is not None:
            fact("capacity", f"State-reported unit capacity: {provider['capacity']}. Current vacancies are unknown.",
                 sid, src.get("dataAsOf"), numericValue=provider["capacity"])
    if page:
        sid = source(page, "provider", page["asOf"])
        for service in page["services"]:
            fact("care", f"The provider lists {service.lower()}.", sid, page["asOf"])
        if page.get("dining"):
            fact("dining", page["dining"], sid, page["asOf"])
        for detail in page.get("practicalFacts", []):
            fact(detail["kind"], detail["text"], sid, page["asOf"])
        for detail_page in page.get("additionalPages", []):
            detail_id = source({**page, **detail_page}, "provider", page["asOf"])
            for detail in detail_page["facts"]:
                fact(detail["kind"], detail["text"], detail_id, page["asOf"])
        if page.get("identityEvidence"):
            source({**page, **page["identityEvidence"]}, "regulator", None)
        for rate in page["rates"]:
            if not isinstance(rate["min"], int) or rate["min"] <= 0:
                raise ValueError(f"Invalid published rate for {pid}")
            period = rate["period"]
            period_text = " (one-time)" if period == "one-time" else f" per {period}" if period else " (billing period unconfirmed)"
            maximum = rate.get("max")
            if maximum is not None and maximum < rate["min"]:
                raise ValueError(f"Invalid fee range for {pid}")
            amount = dict(min=rate["min"], max=maximum, period=period, currency="USD",
                          type=rate["type"], asOf=page["asOf"]) if period else None
            price_text = f"from ${rate['min']:,}" if maximum is None else f"${rate['min']:,}–${maximum:,}"
            if rate.get("exact") and maximum is None:
                price_text = f"${rate['min']:,}"
            fact("cost", f"{rate['label']}: {price_text}{period_text}. Confirm the current quote.",
                 sid, page["asOf"], amount=amount)
        if page.get("rateNote"):
            record["notes"].append(page["rateNote"])
        if page["inquiry"]:
            record["availability"] = dict(status="inquiry-only", sourceId=sid, asOf=None,
                text="Contact the community for availability. No dated vacancy or waitlist position was verified.")
        if page.get("identityUrl"):
            source({**page, "url":page["identityUrl"], "title":"Campus address published by the operator"}, "provider", None)
        if page.get("priorityUrl"):
            priority = source({**page, "url":page["priorityUrl"], "title":"Campus independent living priority list"}, "provider", None)
            record["availability"] = dict(status="waitlist-published", sourceId=priority, asOf=None,
                text="Independent living priority list advertised with a refundable $1,000 deposit. Wait time, openings and individual priority are unconfirmed.")
        record["providerDetailsReviewed"] = True
    if directory:
        overlaps = set(page.get("directoryOverlap", [])) if page else set()
        if page and any("salon" in item["text"].lower() for item in page.get("practicalFacts", [])):
            overlaps.add("Salon / Barber")
        retained = defaultdict(list)
        for item in directory["facts"]:
            if item["kind"] not in ("amenity", "dining", "room") or not item["text"].strip():
                raise ValueError(f"Invalid directory amenity for {pid}")
            if item["text"] not in overlaps and item["text"] not in retained[item["kind"]]:
                retained[item["kind"]].append(item["text"])
        if retained:
            sid = source(directory, "review-platform", None)
            for kind, items in retained.items():
                fact(kind, "MyLivingChoice lists: " + "; ".join(items) +
                     ". Confirm these details with the location.", sid)
    if record["sources"]:
        record["checkedAt"] = max(s["checkedAt"] for s in record["sources"])
    return record


def build(market, additional_pages=None):
    paths = [market / "runtime/providers.json", market / "runtime/crosswalk.json",
             market / "offerings/provider-page-checks.json", market / "offerings/directory-amenities.json",
             market / "review-release/locationResearch.json"]
    inputs = [p.read_bytes() for p in paths]
    providers, crosswalk, pages, listings, approved_reviews = map(json.loads, inputs)
    directories = {}
    for listing in listings:
        pid = listing["providerId"]
        approved = {src["url"] for src in approved_reviews.get(pid, {}).get("sources", [])
                    if src["kind"] == "review-platform"}
        if pid in directories or listing["url"] not in approved or not re.fullmatch(r"[0-9a-f]{64}", listing["captureSha256"]):
            raise ValueError(f"Invalid or unapproved exact-location directory source: {pid}")
        directories[pid] = listing
    county_map = defaultdict(set)
    for r in crosswalk:
        if r["status"].startswith("included"):
            county_map[r["providerId"]].add(r["county"])
    if additional_pages is not None:
        supplemental_bytes = additional_pages.read_bytes()
        existing = {r["providerId"]:r for r in pages}
        for candidate in json.loads(supplemental_bytes):
            pid = candidate["providerId"]
            if pid in existing:
                if existing[pid] != candidate:
                    raise ValueError(f"Candidate conflicts with an existing provider page: {pid}")
            else:
                pages.append(candidate)
                existing[pid] = candidate
    by_id = {p["providerId"]: p for p in pages}
    if len(by_id) != len(pages) or set(by_id) - {p["id"] for p in providers}:
        raise ValueError("Duplicate or unknown provider-page ID")
    records, coverage, groups = {}, [], defaultdict(Counter)
    for p in sorted(providers, key=lambda r:r["id"]):
        pid = p["id"]
        counties = county_map[pid]
        if len(counties) != 1:
            raise ValueError(f"No unique office or facility county for {pid}")
        county, = counties
        page = by_id.get(pid)
        issue = check_identity(p,page) if page else None
        reviewed = page if page and not issue else None
        r = release(p,reviewed,directories.get(pid))
        if r["facts"] or reviewed:
            records[pid] = r
        costs = [f for f in r["facts"] if f["kind"] == "cost"]
        status = issue or ("checked" if reviewed else "unsearched")
        row = dict(providerId=pid, county=county, category=p["category"], providerPageStatus=status,
                   providerPage=page["url"] if page else None, regulatedFacts=any(s["kind"]=="regulator" for s in r["sources"]),
                   directoryPracticalFacts=sum(s["kind"]=="review-platform" for s in r["sources"]) > 0,
                   practicalKinds=sorted({f["kind"] for f in r["facts"] if f["kind"] in ("room","amenity","dining","activity")}),
                   publishedPriceFacts=len(costs), comparableRates=sum(f["amount"] is not None for f in costs),
                   availability=r["availability"]["status"] if reviewed else "unverified")
        coverage.append(row)
        group = groups[(county,p["category"])]
        group.update(dict(records=1, operatorPagesChecked=int(bool(reviewed)), identityDiscrepancies=int(bool(issue)),
                          regulatoryCoverage=int(row["regulatedFacts"]), locationsWithPrice=int(bool(costs)),
                          locationsWithComparableRate=int(bool(row["comparableRates"])), publishedPriorityLists=int(row["availability"]=="waitlist-published"), datedVacancies=0))
    # Enrichments such as coordinates, new citations, and review scores are downstream outputs.
    # Only official roster fields actually consumed by this projection belong in its input hash.
    projection = [{**{k:p.get(k) for k in ("id","name","category","address","city","state","zip","services","capacity")},
                   "sources":[s for s in p["sources"] if s["title"] in
                              ("NJ DOH licensed long-term care facilities","Home Health Care Agencies")]}
                  for p in sorted(providers,key=lambda p:p["id"])]
    outputs = {"locationResearch.json":records, "coverage.json":coverage}
    summary = dict(inputs={"rosterIdentityAndRegulatoryFactsSha256":hashlib.sha256(encode(projection)).hexdigest(),
                          str(paths[1].relative_to(market)):hashlib.sha256(inputs[1]).hexdigest(),
                          **{str(path.relative_to(market)):hashlib.sha256(body).hexdigest() for path,body in zip(paths[2:], inputs[2:])}},
        outputs={name:{"sha256":hashlib.sha256(encode(value)).hexdigest()} for name,value in outputs.items()},
        roster=len(providers), sourcePages=len(pages), matchedPages=sum(r["providerPageStatus"]=="checked" for r in coverage),
        rowsWithFacts=len(records), comparableRates=sum(r["comparableRates"] for r in coverage),
        providerPriceLocations=sum(r["publishedPriceFacts"]>0 for r in coverage),
        countyAndSetting=[dict(county=c,category=s,**v) for (c,s),v in sorted(groups.items())])
    if additional_pages is not None:
        summary["inputs"][str(additional_pages.resolve().relative_to(market.resolve()))] = hashlib.sha256(supplemental_bytes).hexdigest()
    return {"locationResearch.json":records, "coverage.json":coverage, "manifest.json":summary}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", type=Path, default=DEFAULT)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--additional-pages", type=Path, help="Reviewed candidate pages to stage with existing observations")
    parser.add_argument("--output-dir", type=Path, help="Output directory for a candidate build")
    args = parser.parse_args()
    output = args.output_dir or args.market / "offerings"
    if args.additional_pages and output.resolve() == (args.market / "offerings").resolve():
        parser.error("Specify a separate --output-dir when staging additional pages")
    result = build(args.market, args.additional_pages)
    if not args.check:
        output.mkdir(parents=True, exist_ok=True)
    for name,value in result.items():
        path = output / name
        body = encode(value)
        if args.check:
            if path.read_bytes()!=body:
                raise SystemExit(f"Changed output: {path}")
        else:
            path.write_bytes(body)
    print(json.dumps({k:v for k,v in result["manifest.json"].items() if k not in ("inputs","countyAndSetting")}))


if __name__ == "__main__":
    main()
