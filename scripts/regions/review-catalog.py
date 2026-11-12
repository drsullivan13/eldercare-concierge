#!/usr/bin/env python3
"""Build a source-linked catalog without retaining new review narratives."""

import argparse
import hashlib
import importlib.util
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urljoin, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "research/review-catalog"
OUTPUT = ROOT / "src/data/review-catalog.json"
MAX_PAGES = 20
MAX_BYTES = 2_000_000
MONTHS = {m: f"{i:02}" for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}
NOTES = [
    "Selected public accounts are not verified residents, representative prevalence or clinical evidence.",
    "Reported ratings include accounts not exposed by the public catalog. Retained counts are separate.",
    "Links do not grant redistribution rights. New narratives and author identities are not retained.",
    "This catalog does not feed numeric scores or family-experience ordering.",
]


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def canonical_review(url):
    parsed = urlsplit(url)
    if parsed.hostname in {"google.com", "www.google.com"}:
        match = re.search(r"!1s((?:Ci|Ch)[^!?#]+)", unquote(url))
        if match:
            return "google:" + match[1]
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, parsed.fragment))


def precision(value):
    if value is None:
        return "unknown"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        date.fromisoformat(value)
        return "day"
    if re.fullmatch(r"\d{4}-\d{2}", value) and 1 <= int(value[5:]) <= 12:
        return "month"
    if re.fullmatch(r"\d{4}", value):
        return "year"
    raise ValueError("Invalid source date")


def normalized(value):
    aliases = {"avenue": "ave", "street": "st", "road": "rd", "drive": "dr",
               "boulevard": "blvd", "north": "n", "south": "s", "east": "e",
               "west": "w", "lane": "ln", "new": "new"}
    return " ".join(aliases.get(w, w) for w in re.findall(r"[a-z0-9]+", value.lower()))


def allowed_page(url, root):
    p, r = urlsplit(url), urlsplit(root)
    return (p.scheme == "https" and p.hostname == "www.mylivingchoice.com"
            and p.netloc == r.netloc and p.path.rstrip("/") == r.path.rstrip("/")
            and not p.username and not p.password
            and all(k in {"page", "reviewPage", "reviewsPage"} and v.isdigit()
                    and 1 <= int(v) <= MAX_PAGES for k, v in parse_qsl(p.query, keep_blank_values=True))
            and not p.fragment)


def parse_page(result, target):
    url = result["requestedUrl"]
    if not allowed_page(url, target["url"]):
        raise ValueError("Unapproved public page")
    status = result.get("metadata", {}).get("statusCode")
    base = {"requestedUrl": url, "providerId": target["providerId"],
            "sourceId": target["id"], "checkedAt": result["checkedAt"],
            "status": status, "rows": [], "nextUrls": [], "reportedCount": None}
    if status != 200 or result.get("error"):
        return {**base, "stopReason": "fetch-error", "pageSha256": None}
    if not allowed_page(result.get("effectiveUrl", url), target["url"]):
        return {**base, "stopReason": "redirect-outside-approved-location", "pageSha256": None}
    markdown = result["markdown"]
    if len(markdown.encode()) > MAX_BYTES:
        return {**base, "stopReason": "page-byte-limit", "pageSha256": None}
    base["pageSha256"] = digest(markdown)
    identity = "\n\n".join(markdown.split("\n\n")[:2])
    expected = target["identity"]
    address = normalized(expected["address"])
    city = normalized(expected["city"])
    if address not in normalized(identity) or city not in normalized(identity):
        return {**base, "stopReason": "identity-mismatch"}
    match = re.search(r"^## Reviews(?: of [^\n]+)?\n(.*?)(?=^## |\Z)", markdown, re.M | re.S)
    if not match:
        return {**base, "stopReason": "review-section-unavailable"}
    section = match[1]
    count = re.search(r"[\d.]+\s*★\s*on Google\s*\(([\d,]+)\)", section)
    if count:
        base["reportedCount"] = int(count[1].replace(",", ""))
    pattern = re.compile(
        r"(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(?P<year>\d{4})"
        r"\s+\[via Google[^\]]*\]\((?P<url>https://www\.google\.com/[^\s]+?)\)"
        r"\s*·\s*\[Report\]\(https://www\.mylivingchoice\.com/reviews/report/external/(?P<id>\d+)\)"
        r"(?P<body>.*?)(?=\n!\[|\Z)", re.S)
    for m in pattern.finditer(section):
        body = m["body"]
        exclusions = []
        if re.search(r"\b(?:I (?:work|worked|am employed)|my (?:job|employer)|as an? (?:employee|vendor|contractor)|"
                     r"(?:I am|I'm) (?:a |an )?(?:realtor|employee)|our (?:company|business))\b", body, re.I):
            exclusions.append("possible-professional-or-staff-account")
        base["rows"].append({
            "nativeId": m["id"], "url": m["url"],
            "date": m["year"] + "-" + MONTHS[m["month"]],
            "exclusionReasons": exclusions,
        })
    for label, href in re.findall(r"\[([^\]]+)\]\(([^)\s]+)\)", section):
        current_page = max([1, *(int(v) for _, v in parse_qsl(urlsplit(url).query))])
        numbered = label.strip().isdigit() and current_page < int(label.strip()) <= MAX_PAGES
        if numbered or re.fullmatch(r"\s*(?:next(?: page)?|older(?: reviews)?|load more|show more|[›»→])\s*", label, re.I):
            next_url = urljoin(url, href)
            if allowed_page(next_url, target["url"]):
                base["nextUrls"].append(next_url)
            else:
                base["stopReason"] = "pagination-outside-permitted-location"
    base["nextUrls"] = sorted(set(base["nextUrls"]))
    if section.count("[Report](") != len(base["rows"]):
        base["stopReason"] = "review-parser-mismatch"
    elif not base["nextUrls"] and "stopReason" not in base:
        base["stopReason"] = "no-public-next-link"
    return base


def released():
    markets = [("massachusetts", read(ROOT / "src/data/providers.json"),
                read(ROOT / "src/data/location-research.json"))]
    for market in read(ROOT / "src/data/regional-markets.json"):
        markets.append((market["id"], market["providers"], market.get("locationResearch", {})))
    return markets


def editorial_release():
    directory = ROOT / "research/north-jersey/review-catalog-editorial"
    spec = importlib.util.spec_from_file_location("catalog_editorial", directory / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    release = read(directory / "overlay.json")
    return module.validate_public_release(release)


def plan():
    approvals = {}
    for rel in ("research/north-jersey/review-release/approvals.json",
                "research/north-jersey/listing-index/release/approvals.json"):
        for row in read(ROOT / rel)["approvals"]:
            approvals[(row["providerId"], row["url"])] = row["identity"]
    targets = {}
    for market, providers, records in released():
        catalog = {p["id"]: p for p in providers}
        for pid, record in records.items():
            if pid not in catalog:
                raise ValueError("Released evidence without exact provider")
            aggregates = {a["sourceId"]: a for a in record["reviewAggregates"]}
            for source in record["sources"]:
                aggregate = aggregates.get(source["id"])
                if not aggregate:
                    if source["kind"] not in {"public-discussion", "review-platform"} or not any(
                            r["sourceId"] == source["id"] for r in record["reviews"]):
                        continue
                    aggregate = {"sourceFamily": urlsplit(source["url"]).hostname,
                                 "scope": "selected-account", "count": None}
                url = source["url"]
                identity = approvals.get((pid, url))
                permitted = (urlsplit(url).hostname == "www.mylivingchoice.com"
                             and identity is not None and aggregate["scope"] == "consumer")
                key = (pid, url)
                target = {
                    "id": "catalog-" + digest(pid + "|" + url)[:20],
                    "providerId": pid, "market": market, "publisher": source["publisher"],
                    "sourceFamily": aggregate["sourceFamily"], "url": url,
                    "reportedCount": aggregate.get("count"), "scope": aggregate["scope"],
                    "identity": identity, "permitted": permitted,
                    "accessReason": "permitted-low-volume-public-pages" if permitted else (
                        "restricted-no-automation" if urlsplit(url).hostname in {
                            "www.caring.com", "www.aplaceformom.com", "reviews.birdeye.com", "findcandor.org",
                            "trustanalytica.org"}
                        else "withheld-incomplete-access-assessment"),
                }
                if key in targets and targets[key]["reportedCount"] != target["reportedCount"]:
                    targets[key]["reportedCount"] = None
                else:
                    targets[key] = target
    release = editorial_release()
    owners = {provider["id"]: market for market, providers, _ in released() for provider in providers}
    for page in release["pages"]:
        pid, url = page["providerId"], page["url"]
        if owners.get(pid) != "north-jersey":
            raise ValueError("Editorial page has no published exact provider owner")
        key = (pid, url)
        target = targets.setdefault(key, {
            "id": "catalog-" + digest(pid + "|" + url)[:20],
            "providerId": pid, "market": owners[pid], "publisher": page["source"],
            "sourceFamily": page["sourceFamily"], "url": url,
            "reportedCount": None, "scope": "consumer", "identity": page["identity"],
            "permitted": True, "accessReason": "permitted-low-volume-public-pages",
        })
        target["editorial"] = page
        target["publicationLabel"] = release["publicationLabel"]
    targets = list(targets.values())
    targets.sort(key=lambda t: (not t["permitted"], t["reportedCount"] not in range(35, 41),
                               t["identity"] is None or t["identity"]["city"].lower() not in {
                                   "rahway", "elizabeth", "morristown", "summit", "mountainside",
                                   "cranford", "union", "westfield", "boonton township"},
                               t["providerId"], t["url"]))
    return {"schemaVersion": 1, "targets": targets, "limits": {
        "maxPagesPerSource": MAX_PAGES, "maxPageBytes": MAX_BYTES,
        "transport": "FetchUrl only; sequential low-volume requests per host",
        "pagination": "Explicit same-location public next links only; no internal API or guessed cursor",
    }}


def crawl_state(target, pages):
    ordered, pending, seen_urls, seen_hashes, seen_ids = [], [target["url"]], set(), set(), set()
    stop = "not-fetched"
    while pending:
        url = pending.pop(0)
        if url in seen_urls:
            stop = "repeated-url"
            continue
        if len(ordered) >= MAX_PAGES:
            return ordered, [], "page-limit"
        page = pages.get(url)
        if page is None:
            return ordered, [url], "pending"
        seen_urls.add(url)
        ordered.append(page)
        if page.get("stopReason") not in {None, "no-public-next-link"}:
            return ordered, [], page["stopReason"]
        if page["pageSha256"] in seen_hashes:
            return ordered, [], "repeated-page-content"
        seen_hashes.add(page["pageSha256"])
        ids = {canonical_review(r["url"]) for r in page["rows"]}
        if not ids - seen_ids and len(ordered) > 1:
            return ordered, [], "no-new-review-ids"
        seen_ids.update(ids)
        if page["reportedCount"] is not None and len(seen_ids) >= page["reportedCount"]:
            return ordered, [], "reported-total-reached"
        pending.extend(page["nextUrls"])
        stop = "no-public-next-link"
    return ordered, [], stop


def account(pid, source, row, provenance):
    value = row.get("date")
    key = canonical_review(row["url"])
    if provenance == "retained-reviewed" and key == source["url"]:
        key += "|" + (value or "unknown") + "|" + row["id"]
    return {
        "id": source["sourceFamily"] + "-" + digest(pid + "|" + key)[:24],
        "sourceId": source["id"], "sourceFamily": source["sourceFamily"],
        "url": row["url"], "date": value, "datePrecision": precision(value),
        "relationship": row.get("relationship", "unknown"),
        "excerpt": None, "summary": None, "representation": "link-only",
        "provenance": provenance,
    }


def merge_massachusetts_catalog(output, coverage):
    directory = ROOT / "research/massachusetts/review-catalog"
    spec = importlib.util.spec_from_file_location("massachusetts_review_catalog", directory / "generate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    feed, checked = module.build()
    if read(directory / "catalog.json") != feed or read(directory / "coverage.json") != checked:
        raise ValueError("Massachusetts catalog differs from reviewed receipts")
    providers = {p["id"] for market, ps, _ in released() if market == "massachusetts" for p in ps}
    retained = read(ROOT / "src/data/location-research.json")
    receipts = {r["url"]: r for r in read(directory / "receipts.json")}
    aliases = {(a["providerId"], a["nativeId"]): a for a in read(directory / "retained-aliases.json")}
    checked = {(c["providerId"], c["id"]): c for c in checked}
    for pid, incoming in feed.items():
        if pid not in providers or incoming["providerId"] != pid:
            raise ValueError("Massachusetts feed has no exact published provider owner")
        record = output.setdefault(pid, {"providerId": pid, "checkedAt": incoming["checkedAt"],
                                         "accounts": [], "sources": [], "notes": []})
        record["checkedAt"] = max(record["checkedAt"], incoming["checkedAt"])
        record["notes"] = list(dict.fromkeys([*record["notes"], *incoming["notes"]]))
        source_ids = {}
        for source in incoming["sources"]:
            existing = next((s for s in record["sources"] if s["url"] == source["url"]
                             and s["sourceFamily"] == source["sourceFamily"]), None)
            if existing:
                source_ids[source["id"]] = existing["id"]
            else:
                source_ids[source["id"]] = source["id"]
                record["sources"].append(dict(source))
                details = checked[(pid, source["id"])]
                if details.get("scopeNote"):
                    record["sources"][-1]["scopeNote"] = details["scopeNote"]
                coverage.append({**source, "providerId": pid, "market": "massachusetts",
                                 "observedDistinctIds": details["visibleArticles"],
                                 "excludedRows": len(details["excluded"]), "pendingUrls": []})
        for incoming_account in incoming["accounts"]:
            a = dict(incoming_account)
            source = next(s for s in incoming["sources"] if s["id"] == a["sourceId"])
            key = canonical_review(a["url"])
            receipt = next(r for r in receipts[source["url"]]["rows"] if canonical_review(r["url"]) == key)
            a["nativeReviewId"] = receipt["nativeId"]
            a["sourceId"] = source_ids[a["sourceId"]]
            alias = aliases.get((pid, receipt["nativeId"]))
            if alias:
                original = next(r for r in retained[pid]["reviews"] if r["id"] == alias["retainedReviewId"])
                if alias["matchExcerpt"].lower() not in original["excerpt"].lower():
                    raise ValueError("Retained Massachusetts alias no longer matches approved excerpt")
                a["id"] = original["id"]
                a["retainedReview"] = {"id": original["id"], "url": original["url"]}
            existing = next((old for old in record["accounts"] if
                             (old["sourceFamily"] == a["sourceFamily"] and canonical_review(old["url"]) == key)
                             or (alias and old["id"] == a["id"])), None)
            if existing:
                if not alias:
                    a["id"], a["url"], a["sourceId"] = existing["id"], existing["url"], existing["sourceId"]
                a["excerpt"] = existing["excerpt"] or a["excerpt"]
                a["summary"] = existing["summary"] or a["summary"]
                record["accounts"].remove(existing)
            elif any(old["id"] == a["id"] for old in record["accounts"]):
                raise ValueError("Massachusetts stable account ID points at another original receipt")
            record["accounts"].append(a)
    for record in output.values():
        for source in record["sources"]:
            source["retainedCount"] = sum(a["sourceId"] == source["id"] for a in record["accounts"])
            source["previouslyUnseenCount"] = min(source["previouslyUnseenCount"], source["retainedCount"])
    sources = {(pid, s["id"]): s for pid, r in output.items() for s in r["sources"]}
    for row in coverage:
        row.update(sources[(row["providerId"], row["id"])])


def build(current_plan, pages):
    targets = current_plan["targets"]
    observations = read(ROOT / "research/north-jersey/review-excerpts/observations.json")
    reviewed = {(p["providerId"], p["url"]): p for p in observations["pages"]}
    records = {pid: row for _, _, rs in released() for pid, row in rs.items()}
    output, coverage = {}, []
    for target in targets:
        pid = target["providerId"]
        record = output.setdefault(pid, {"providerId": pid, "checkedAt": "2026-11-12",
                                        "accounts": [], "sources": [], "notes": NOTES})
        retained = records.get(pid, {"sources": [], "reviews": []})
        source_ids = {s["id"] for s in retained["sources"] if s["url"] == target["url"]}
        published = {canonical_review(r["url"]): r for r in retained["reviews"]
                     if r["sourceId"] in source_ids and canonical_review(r["url"]) != target["url"]}
        old_ids, accounts, exclusions = set(), {}, set()
        page = reviewed.get((pid, target["url"]))
        if page:
            for row in page["rows"]:
                old_ids.add(canonical_review(row["reviewUrl"]))
                if set(row["exclusionReasons"]) & {"not-consumer", "wrong-care-unit", "duplicate-review"}:
                    exclusions.add(canonical_review(row["reviewUrl"]))
                    continue
                a = account(pid, target, {"id": row["id"], "url": row["reviewUrl"],
                                         "date": row["publishedAt"], "relationship": row["role"]},
                            "retained-reviewed")
                a["nativeReviewId"] = row["id"]
                original = published.get(canonical_review(row["reviewUrl"]))
                if original:
                    a["id"] = original["id"]
                privacy = row.get("privacyRelease", {})
                if (not row["exclusionReasons"] and privacy.get("reviewed")
                        and not any(privacy.get(k, True) for k in
                                    ("containsNames", "containsMedicalInformation", "containsIdentifiers"))):
                    a.update(excerpt=row["originalExcerpt"], summary=row["paraphrase"],
                             representation="reviewed-excerpt")
                accounts[a["id"]] = a
        else:
            for row in retained["reviews"]:
                if row["sourceId"] not in source_ids:
                    continue
                a = account(pid, target, row, "retained-reviewed")
                a["id"] = row["id"]
                old_ids.add(canonical_review(row["url"]))
                accounts[a["id"]] = a
        fetched, pending, stop = crawl_state(target, pages) if target["permitted"] else ([], [], target["accessReason"])
        new_keys, excluded, all_keys = set(), set(), set()
        editorial = target.get("editorial")
        if editorial:
            if editorial["providerId"] != pid or editorial["url"] != target["url"]:
                raise ValueError("Editorial provider or source receipt mismatch")
            record["checkedAt"] = max(record["checkedAt"], editorial["checkedAt"])
            record["notes"] = list(dict.fromkeys([*record["notes"], target["publicationLabel"]]))
            for row in editorial["rows"]:
                key = canonical_review(row["originalReviewKey"])
                all_keys.add(key)
                if row["publication"] != "released":
                    exclusions.add(key)
                    excluded.add(key)
                    continue
                a = account(pid, target, {"id": row["id"], "url": row["originalReviewKey"],
                                         "date": row["publishedAt"], "relationship": row["role"]},
                            "new-public-page")
                a["nativeReviewId"] = row["id"]
                original = published.get(key)
                if original:
                    a["id"] = original["id"]
                existing = next((old for old in accounts.values() if canonical_review(old["url"]) == key), None)
                if existing:
                    a = existing
                a.update(summary=row["paraphrase"], representation="reviewed-excerpt")
                accounts[a["id"]] = a
                if key not in old_ids:
                    new_keys.add(key)
        for page in fetched:
            record["checkedAt"] = max(record["checkedAt"], page["checkedAt"])
            for row in page["rows"]:
                key = canonical_review(row["url"])
                all_keys.add(key)
                if row["exclusionReasons"] or key in exclusions:
                    excluded.add(key)
                    continue
                if key not in old_ids:
                    new_keys.add(key)
                a = account(pid, target, row, "new-public-page")
                a["nativeReviewId"] = "mlc-external-" + row["nativeId"]
                original = published.get(key)
                if original:
                    a["id"] = original["id"]
                if not any(canonical_review(old["url"]) == key for old in accounts.values()):
                    accounts[a["id"]] = a
        reported = next((p["reportedCount"] for p in reversed(fetched) if p["reportedCount"] is not None),
                        target["reportedCount"])
        status = ("exhausted-visible-pages" if stop in {"no-public-next-link", "reported-total-reached"}
                  else "partial") if fetched else ("retained-only" if accounts else "blocked")
        if editorial and not fetched:
            status, stop = "partial", "editorial-page-reviewed-pagination-not-assessed"
            pending = []
        source = {k: target[k] for k in ("id", "publisher", "sourceFamily", "url")}
        source.update(reportedCount=reported, retainedCount=len(accounts),
                      previouslyUnseenCount=len(new_keys), pagesChecked=len(fetched) or int(bool(editorial)),
                      coverage=status, stopReason=stop)
        record["sources"].append(source)
        record["accounts"].extend(accounts.values())
        coverage.append({**source, "providerId": pid, "market": target["market"],
                         "observedDistinctIds": len(all_keys), "excludedRows": len(excluded),
                         "pendingUrls": pending})
    merge_massachusetts_catalog(output, coverage)
    for record in output.values():
        unique = {}
        for a in record["accounts"]:
            unique.setdefault(a["id"], a)
        record["accounts"] = sorted(unique.values(), key=lambda a: (a["date"] or "", a["id"]), reverse=True)
    return dict(sorted(output.items())), coverage


def load_pages(current_plan):
    targets = {t["id"]: t for t in current_plan["targets"]}
    pages = {}
    for path in sorted((WORK / "pages").glob("*.json")):
        page = read(path)
        target = targets.get(page["sourceId"])
        if (not target or not target["permitted"] or page["providerId"] != target["providerId"]
                or not allowed_page(page["requestedUrl"], target["url"])
                or page["requestedUrl"] in pages):
            raise ValueError("Catalog receipt has a mismatched provider, source or URL")
        if page["pageSha256"] is not None and not re.fullmatch(r"[a-f0-9]{64}", page["pageSha256"]):
            raise ValueError("Catalog receipt has an invalid page hash")
        if page["reportedCount"] is not None and (
                type(page["reportedCount"]) is not int or page["reportedCount"] < 0):
            raise ValueError("Catalog receipt has an invalid reported count")
        if precision(page["checkedAt"]) != "day":
            raise ValueError("Catalog receipt has no observation date")
        for row in page["rows"]:
            parsed = urlsplit(row["url"])
            if (set(row) != {"nativeId", "url", "date", "exclusionReasons"}
                    or not re.fullmatch(r"\d+", row["nativeId"])
                    or parsed.scheme != "https" or parsed.hostname != "www.google.com"
                    or not parsed.path.startswith("/maps/reviews/") or parsed.username or parsed.password
                    or not canonical_review(row["url"]).startswith("google:")
                    or precision(row["date"]) != "month"):
                raise ValueError("Catalog receipt has an invalid original review row")
        if any(not allowed_page(url, target["url"]) for url in page["nextUrls"]):
            raise ValueError("Catalog receipt has an unapproved next URL")
        pages[page["requestedUrl"]] = page
    return pages


def manifest(output, coverage):
    inputs = [
        "src/data/providers.json", "src/data/location-research.json", "src/data/regional-markets.json",
        "research/north-jersey/review-release/approvals.json",
        "research/north-jersey/listing-index/release/approvals.json",
        "research/north-jersey/review-excerpts/observations.json",
        "research/north-jersey/reviews/source-access.json",
        "research/north-jersey/review-catalog-editorial/overlay.json",
        "research/north-jersey/review-catalog-editorial/source-receipts.json",
        "research/north-jersey/review-catalog-editorial/release-fingerprint.json",
        "research/massachusetts/review-catalog/catalog.json",
        "research/massachusetts/review-catalog/coverage.json",
        "research/massachusetts/review-catalog/receipts.json",
        "research/massachusetts/review-catalog/reviewed.json",
        "research/massachusetts/review-catalog/retained-aliases.json",
        "research/massachusetts/review-catalog/browser-pagination.json",
        "scripts/regions/review-catalog.py",
        "research/review-catalog/access.json", "research/review-catalog/plan.json",
    ]
    receipt_paths = sorted((WORK / "pages").glob("*.json"))
    inputs.extend(str(path.relative_to(ROOT)) for path in receipt_paths)
    accounts = [a for r in output.values() for a in r["accounts"]]
    ma_coverage = read(ROOT / "research/massachusetts/review-catalog/coverage.json")
    return {
        "schemaVersion": 1, "assessmentDate": "2026-11-12",
        "counts": {
            "providerRecords": len(output),
            "providersWithAccounts": sum(bool(r["accounts"]) for r in output.values()),
            "accounts": len(accounts),
            "accountsWithText": sum(bool(a["excerpt"] or a["summary"]) for a in accounts),
            "previouslyUnseenAccounts": sum(s["previouslyUnseenCount"] for s in coverage),
            "sourceCatalogs": len(coverage),
            "attachedPublicPagesChecked": sum(s["pagesChecked"] for s in coverage),
            "allAcquiredPublicPages": len(receipt_paths) + len(ma_coverage),
            "unattachedPublicPages": sum(not c["providerId"] for c in ma_coverage),
        },
        "inputs": [{"path": rel, "sha256": hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()}
                   for rel in inputs],
        "outputs": [{"path": str(path.relative_to(ROOT)),
                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    for path in [OUTPUT, WORK / "coverage.json"]],
        "limitations": [
            "Counts describe retained accounts, not people, prevalence, positivity or clinical quality.",
            "All acquired pages include one withheld Massachusetts listing without a catalog provider.",
            "Attached-page exhaustion does not imply the underlying Google rating corpus was acquired.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "queue", "ingest", "build", "check"])
    parser.add_argument("--input", type=Path)
    args = parser.parse_args()
    current_plan = plan()
    if args.action == "plan":
        write(WORK / "plan.json", current_plan)
    targets = {t["id"]: t for t in current_plan["targets"]}
    if args.action == "ingest":
        for result in read(args.input):
            target = targets[result["sourceId"]]
            if not target["permitted"]:
                raise ValueError("Source not permitted")
            receipt = parse_page(result, target)
            write(WORK / "pages" / (digest(receipt["requestedUrl"]) + ".json"), receipt)
    pages = load_pages(current_plan)
    if args.action == "queue":
        queue = []
        for t in targets.values():
            if t["permitted"]:
                _, pending, _ = crawl_state(t, pages)
                queue.extend({"sourceId": t["id"], "url": u} for u in pending)
        print(json.dumps(queue))
        return
    output, coverage = build(current_plan, pages)
    if args.action == "check":
        if (read(OUTPUT) != output or read(WORK / "coverage.json") != coverage
                or read(WORK / "plan.json") != current_plan):
            raise ValueError("Catalog differs from replay")
        if read(WORK / "manifest.json") != manifest(output, coverage):
            raise ValueError("Catalog manifest differs from retained inputs")
    elif args.action == "build":
        write(OUTPUT, output)
        write(WORK / "coverage.json", coverage)
        write(WORK / "manifest.json", manifest(output, coverage))
    print(json.dumps({"action": args.action, "providers": len(output),
                      "accounts": sum(len(r["accounts"]) for r in output.values()),
                      "previouslyUnseen": sum(s["previouslyUnseenCount"] for s in coverage),
                      "pagesChecked": sum(s["pagesChecked"] for s in coverage),
                      "sourceCatalogs": len(coverage)}))


if __name__ == "__main__":
    main()
