#!/usr/bin/env python3
"""Stage retained public listing pages and release explicitly adjudicated location aggregates."""
import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REGION = Path("research/north-jersey")
INDEX = REGION / "listing-index"
OUT = INDEX / "release"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/regions" / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


review = load_module("harbor_review_release", "release-reviews.py")
discovery = load_module("harbor_listing_discovery", "listing-index-discover.py")


def read(path):
    return json.loads((ROOT / path).read_bytes())


def sha(body):
    return hashlib.sha256(body).hexdigest()


def store(path, data):
    body = review.encoded(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != body:
        path.write_bytes(body)
    return sha(body)


class Ineligible(ValueError):
    pass


def need(test, reason):
    if not test:
        raise Ineligible(reason)


def assess(data, url, providers, crosswalk, by_address, official, assessment_date):
    md = data.get("markdown") or ""
    need(data.get("metadata", {}).get("statusCode") == 200 and
         review.canonical_url(data.get("effectiveUrl", "")) == review.canonical_url(url)
         and url.startswith("https://www.mylivingchoice.com/property/"), "page_access")
    page = discovery.extract_page(data, url)
    ident = page["identity"]
    header = re.search(r"(?m)^# ([^\n]+)\n+\[([^\]\n]+)\]\([^\n)]+\)", md)
    need(header and header[1].strip() == ident["name"], "unconfirmed_page_header")
    if ident.get("address") != header[2]:
        # Some listing headers place a suite after a comma or omit all comma delimiters.
        # Only recover the explicit address if it reproduces a single official address
        # and city in the visible header. Never fill omitted city, state or ZIP.
        state_suffix = re.search(r"(?i)(?:,?\s+)(New Jersey|NJ)(?:\s+(\d{5}(?:-\d{4})?))?$", header[2])
        need(state_suffix, "unconfirmed_page_header")
        front = header[2][:state_suffix.start()].strip(" ,")
        matches = []
        for provider in providers.values():
            city = provider["city"]
            city_match = re.search(r"(?:,?\s+)(" + re.escape(city) + r")$", front, re.I)
            if city_match:
                street = front[:city_match.start()].strip(" ,")
                if review.words(street) == review.provider_street(provider):
                    matches.append((street, city_match[1]))
        need(len(set(matches)) == 1, "unconfirmed_page_header")
        street, city = matches[0]
        ident.update(street=street, city=city, zip=state_suffix[2])
    groups = set(discovery.CARE_LABELS.get(label.lower()) for label in ident.get("careLabels", []))
    need(len(groups) == 1 and None not in groups and not ident.get("unrecognizedCareLabels")
         and not ident.get("contradictoryScope"), "mixed_or_unknown_care_units")
    care = ident["careUnitText"]
    identity = {"name": ident["name"], "address": ident["street"], "city": ident["city"],
                "state": "New Jersey" if "new jersey" in header[2].lower() else "NJ",
                "zip": ident["zip"], "careUnit": care}
    peers = by_address.get((review.words(identity["address"]), review.token(identity["city"])), [])
    need(peers, "no_exact_official_address")
    need(len(peers) == 1, "overlapping_official_units")
    provider = peers[0]
    pid = provider["id"]
    need(groups == {provider["category"]}, "category_mismatch")
    candidates = []
    for oid in official[pid]:
        try:
            review.validate_identity({"providerId": pid, "officialId": oid, "identity": identity},
                {"providerId": None, "officialId": None, "identity": identity}, providers, crosswalk)
            candidates.append(oid)
        except review.ReleaseError:
            continue
    need(candidates, "official_name_or_scope_mismatch")
    sections = re.split(r"(?im)^## (?:Reviews|Resident and Family Reviews)[^\n]*\n", md, maxsplit=1)
    need(len(sections) == 2, "no_review_section")
    section = re.split(r"(?m)^## ", sections[1], maxsplit=1)[0]
    places = sorted(set(re.findall(r"0x[0-9a-f]+:0x[0-9a-f]+", section, re.I)))
    need(len(places) <= 1, "multiple_underlying_google_places")
    need(not re.search(r"\b(as an? (?:former )?employee|I work(?:ed)? (?:here|at)|my employer|my job interview|"
                       r"great place to work|working at|work here|professional development|my (?:boss|recruiter)|as a former staff member)\b", section, re.I),
         "possible_employee_population")
    need(not re.search(r"\b(?:other location|different (?:location|facility)|nationwide reviews|brand average)\b",
                       section, re.I), "possible_nonlocal_population")
    display = re.search(r"(?m)^([0-5](?:\.\d+)?)\s*overall\s*·\s*([\d,]+) ratings combined\s*\n+"
                        r"([0-5](?:\.\d+)?)★ on Google \(([\d,]+)\)\s*$", section)
    need(display, "missing_direct_google_panel")
    rating, count = float(display[3]), int(display[4].replace(",", ""))
    need(count > 0 and float(display[1]) == rating and int(display[2].replace(",", "")) == count,
         "mixed_or_empty_source_panel")
    corroborated = [a for a in page["aggregates"] if a["family"] == "google" and a["value"] == rating
                    and a["count"] == count and a["locationSpecific"] and a["scale"] == 5]
    need(corroborated, "no_location_specific_google_attribution")
    checked = (data.get("retrievedAt") or "")[:10]
    need(review.valid_date(checked) and checked <= assessment_date, "unknown_check_date")
    return pid, candidates[0], identity, {"url": url, "checkedAt": checked, "inspection": "full-page",
        "httpStatus": 200, "identityText": header[0], "careUnitText": care,
        "aggregateText": display[0].strip(), "faqAggregateText": corroborated[0]["evidence"],
        "scopeQa": {"reviewSectionInspected": True, "googlePlaceIdCount": len(places), "googlePlaceIds": places}}, {
        "asOf": None, "count": count, "rating": rating, "scale": 5, "scope": "consumer", "sourceFamily": "google"}


def scan(root=ROOT):
    providers = {r["id"]: r for r in read(REGION / "runtime/providers.json")}
    crosswalk = read(REGION / "runtime/crosswalk.json")
    baseline = read(REGION / "review-release/approvals.json")
    base = {a["providerId"] for a in baseline["approvals"]}
    official = defaultdict(list)
    for row in crosswalk:
        if row.get("status") == "included" and row.get("officialId"):
            official[row["providerId"]].append(row["officialId"])
    addresses = defaultdict(list)
    for provider in providers.values():
        addresses[(review.provider_street(provider), review.token(provider["city"]))].append(provider)
    allow = read(REGION / "reviews/source-access.json")
    need(any(a["source"] == "MyLivingChoice" and a["access_decision"] == "permitted_low_volume"
             for a in allow["sources"]), "source_policy")
    pages = sorted((root / INDEX / "discovery/pages").glob("*.json"))
    candidates, disposition = {}, []
    for path in pages:
        body = path.read_bytes()
        d = json.loads(body)
        url = d.get("url") or d.get("effectiveUrl", "")
        row = {"url": url, "capture": str(path.relative_to(root)), "sha256": sha(body)}
        try:
            pid, oid, identity, material, agg = assess(d, url, providers, crosswalk, addresses, official, baseline["assessmentDate"])
            row["providerId"] = pid
            row["status"] = "previously_released" if pid in base else "pending_editorial_review"
            if pid not in base:
                candidates[url] = (pid, oid, identity, material, agg, row)
        except Ineligible as e:
            row["status"] = str(e)
        disposition.append(row)
    present = {r["url"] for r in disposition}
    priority = {r["url"] for r in read(INDEX / "fetch-plan.json")["requests"]}
    for existing in baseline["approvals"]:
        url = existing["url"]
        if url in present or url not in priority:
            continue
        ref = existing["material"]
        material = (root / ref["path"]).read_bytes()
        need(sha(material) == ref["sha256"] and
             review.checked_listing_aggregate(existing, json.loads(material)) == existing["aggregate"],
             "baseline_source_check_drift")
        disposition.append({"url":url, "capture":ref["path"], "sha256":ref["sha256"],
                            "providerId":existing["providerId"], "status":"reused_verified_baseline_page"})
    return providers, base, candidates, disposition


def run(mode, destination=None):
    providers, base, candidates, rows = scan()
    directory = destination or ROOT / OUT
    if mode == "scan":
        store(directory / "page-inventory.json", rows)
        store(directory / "candidates.json", [{"url": u, "providerId": p, "officialId": o, "identity": i,
                                               "material": m, "aggregate": a, "captureSha256": r["sha256"]}
                    for u,(p,o,i,m,a,r) in sorted(candidates.items())])
        return
    decisions = read(OUT / "decisions.json")
    observations, approvals = [], []
    for dec in decisions:
        u = dec["url"]
        need(u in candidates, "decision_no_longer_qualifies: " + u)
        p,o,i,m,a,r = candidates[u]
        need(dec["providerId"] == p and dec["captureSha256"] == r["sha256"] and dec["reason"], "decision_drift")
        need(all(x["providerId"] != p for x in approvals), "duplicate_provider_family")
        m["scopeQa"]["assessment"] = "Approved. " + dec["reason"]
        f = OUT / "source-checks" / (u.rsplit("/",1)[-1] + ".json")
        h = store(directory / f.relative_to(OUT), m)
        approval = {"id":"additional-"+u.rsplit("/",1)[-1], "providerId":p, "officialId":o,
                    "platform":"MyLivingChoice", "access":"full-page", "url":u,"identity":i,"aggregate":a,
                    "checkedAt":m["checkedAt"],"reason":dec["reason"],"material":{"path":str(f),"sha256":h}}
        need(review.checked_listing_aggregate(approval,m) == a, "material_failed_release_validation")
        approvals.append(approval)
        observations.append({"url":u,"platform":"MyLivingChoice","identity":i,"aggregate":a,"checkedAt":m["checkedAt"],
             "inspection":"full-page","sourceType":"review-platform","access_decision":"permitted_low_volume",
             "originalReceipt":{"path":r["capture"], "sha256":r["sha256"]}})
    obs_path = OUT / "source-observations.json"
    h = store(directory / obs_path.relative_to(OUT), {"schemaVersion":1,"observations":observations})
    for idx,a in enumerate(approvals):
        a["observation"]={"path":str(obs_path),"pointer":f"/observations/{idx}","sha256":h}
    store(directory / "approvals.json", {"schemaVersion":1,"assessmentDate":read(REGION / "review-release/approvals.json")["assessmentDate"],"approvals":approvals})
    accepted = {a["providerId"] for a in approvals}
    report = {"catalogLocations":len(providers), "baseApprovedProviders":len(base), "inspectedPages":len(rows),
              "dispositions":dict(sorted(Counter(r["status"] for r in rows).items())),
              "newProviderIds":sorted(accepted), "totalLocationsWithAggregate":len(base|accepted),
              "catalogLocationsWithoutReleasedAggregate":len(providers.keys() - (base|accepted))}
    # A fetched candidate URL is a search attempt, even if wrong geography/unit disqualifies it.
    searched_urls = {r["url"] for r in rows}
    plan = read(INDEX / "discovery-queue.json")
    attempted = {r["providerId"] for r in plan["requests"] if r["url"] in searched_urls}
    grouped = defaultdict(Counter)
    counties = defaultdict(set)
    for row in read(REGION / "runtime/crosswalk.json"):
        if row.get("providerId") in providers and row.get("status", "").startswith("included") and row.get("county"):
            counties[row["providerId"]].add(row["county"])
    dispositions_by_id = {}
    for pid, provider in providers.items():
        status = ("additional_approved" if pid in accepted else "baseline_approved" if pid in base
                  else "candidate_page_checked_no_release" if pid in attempted else "no_candidate_page_checked")
        need(len(counties[pid]) == 1, "ambiguous_catalog_county:" + pid)
        county = next(iter(counties[pid]))
        grouped[county + "/" + provider["category"]][status] += 1
        dispositions_by_id[pid] = {"county":county, "setting":provider["category"], "status":status}
    store(directory / "provider-coverage.json", dispositions_by_id)
    report["coverageByCountyAndSetting"] = {k: dict(v) for k,v in sorted(grouped.items())}
    report["locationsByStatus"] = dict(sum(grouped.values(), Counter()))
    priority = {r["url"] for r in read(INDEX / "fetch-plan.json")["requests"]}
    reused = {r["url"] for r in rows if r["status"] == "reused_verified_baseline_page"}
    report["priorityUrls"] = {"total":len(priority), "retainedCurrentPages":len((priority & searched_urls) - reused),
                              "reusedVerifiedPages":len(priority & reused), "missing":len(priority - searched_urls)}
    approved_urls = {a["url"] for a in approvals}
    hold_path = ROOT / OUT / "held.json"
    holds = {r["url"]: r for r in json.loads(hold_path.read_bytes())} if hold_path.exists() else {}
    for u, hold in holds.items():
        need(u not in approved_urls and u in candidates, "held_decision_changed")
        pid, _, _, _, _, original = candidates[u]
        need(hold["providerId"] == pid and hold["captureSha256"] == original["sha256"]
             and hold["reason"], "held_decision_stale")
    report["pageDispositionsAfterReview"] = dict(Counter(
        "additional_approved" if r["url"] in approved_urls else "editorial_hold" if r["url"] in holds
        else r["status"] for r in rows))
    report["stillPendingEditorialCandidates"] = len(set(candidates) - approved_urls - set(holds))
    store(directory / "coverage.json", report)
    if mode == "verify":
        for f in sorted(directory.rglob("*.json")):
            if f.name not in {"coverage.json", "provider-coverage.json"}:
                need(f.read_bytes() == (ROOT / OUT / f.relative_to(directory)).read_bytes(),
                     "published_addendum_drift: " + f.name)
    print(json.dumps(report))


def archive_wave():
    """Freeze redacted release artifacts and source receipts independently of rolling page paths."""
    directory = ROOT / OUT
    ledger = read(OUT / "approvals.json")
    observations = read(OUT / "source-observations.json")["observations"]
    artifacts = {name: (directory / name).read_bytes()
                 for name in ("approvals.json", "source-observations.json", "decisions.json")}
    for name in ("coverage.json", "provider-coverage.json", "held.json"):
        if (directory / name).exists():
            artifacts[name] = (directory / name).read_bytes()
    for approval in ledger["approvals"]:
        material_path = Path(approval["material"]["path"])
        name = material_path.relative_to(OUT).as_posix()
        artifacts[name] = (ROOT / material_path).read_bytes()
        need(sha(artifacts[name]) == approval["material"]["sha256"], "approved_material_drift")
        index = int(approval["observation"]["pointer"].split("/")[-1])
        source = observations[index]
        need(source["url"] == approval["url"] and source["aggregate"] == approval["aggregate"], "observation_drift")
        ref = source["originalReceipt"]
        capture = (ROOT / ref["path"]).read_bytes()
        need(sha(capture) == ref["sha256"], "reviewed_capture_changed_before_archive")
        doc = json.loads(capture)
        need(doc["effectiveUrl"] == source["url"] and doc["metadata"].get("statusCode") == 200,
             "capture_receipt_mismatch")
        material = json.loads(artifacts[name])
        need(material["identityText"] in doc["markdown"] and material["aggregateText"] in doc["markdown"],
             "reviewed_sections_no_longer_match_capture")
        receipt = {"url":doc["effectiveUrl"], "retrievedAt":doc["retrievedAt"],
                   "httpStatus":doc["metadata"]["statusCode"], "captureSha256":ref["sha256"],
                   "rawHtmlSha256":(doc.get("materializedFrom") or {}).get("rawSha256"),
                   "materialSha256":sha(artifacts[name]),
                   "addressHeader":material["identityText"], "careUnit":material["careUnitText"],
                   "ratingPanel":material["aggregateText"], "ratingAttribution":material["faqAggregateText"],
                   "scopeChecks":material["scopeQa"]}
        artifacts["receipts/" + approval["id"] + ".json"] = review.encoded(receipt)
    manifest = {name:sha(body) for name,body in sorted(artifacts.items())}
    manifest_bytes = review.encoded(manifest)
    wave = directory / "history" / sha(manifest_bytes)[:16]
    for name,body in artifacts.items():
        target = wave / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            need(target.read_bytes() == body, "immutable_history_drift")
        else:
            target.write_bytes(body)
    if (wave / "manifest.json").exists():
        need((wave / "manifest.json").read_bytes() == manifest_bytes, "immutable_manifest_drift")
    else:
        (wave / "manifest.json").write_bytes(manifest_bytes)
    return wave


def verify_history(wave):
    manifest = (wave / "manifest.json").read_bytes()
    need(sha(manifest)[:16] == wave.name, "wave_digest_mismatch")
    items = json.loads(manifest)
    for name,h in items.items():
        file = (wave / name).resolve()
        need(file.is_relative_to(wave.resolve()) and sha(file.read_bytes()) == h, "historical_file_drift")
    approvals = json.loads((wave / "approvals.json").read_bytes())["approvals"]
    observations = json.loads((wave / "source-observations.json").read_bytes())["observations"]
    need(len(observations) == len(approvals), "historical_assignment_count")
    for row in approvals:
        receipt = json.loads((wave / "receipts" / (row["id"] + ".json")).read_bytes())
        materialname = Path(row["material"]["path"]).relative_to(OUT).as_posix()
        source = observations[int(row["observation"]["pointer"].split("/")[-1])]
        need(receipt["captureSha256"] == source["originalReceipt"]["sha256"] and
             items["source-observations.json"] == row["observation"]["sha256"] and
             items[materialname] == row["material"]["sha256"] == receipt["materialSha256"],
             "broken_historical_source_chain")
        need(review.checked_listing_aggregate(row, json.loads((wave / materialname).read_bytes())) == row["aggregate"],
             "historical_aggregate_drift")
    print(f"Verified {len(approvals)} archived approvals in {wave.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["scan","release","verify","archive-wave","verify-history"])
    parser.add_argument("--output-dir", type=Path, help="Scratch directory for assessing additional pages")
    parser.add_argument("--wave", type=Path, help="Historical snapshot directory for offline verification")
    args = parser.parse_args()
    if args.mode == "archive-wave":
        verify_history(archive_wave())
    elif args.mode == "verify-history":
        if args.wave is None:
            parser.error("--wave is required for verify-history")
        verify_history(args.wave)
    elif args.mode == "verify":
        with tempfile.TemporaryDirectory() as scratch:
            run("verify", Path(scratch))
    else:
        run(args.mode, args.output_dir)
