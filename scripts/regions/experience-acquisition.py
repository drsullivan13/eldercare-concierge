#!/usr/bin/env python3
"""Inventory all active NJ experience evidence without publishing or fetching it."""

import argparse
import csv
import datetime
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
from collections import Counter, defaultdict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[2]
AREA = ROOT / "research/north-jersey/experience-acquisition"
INVENTORY = AREA / "inventory"
IDENTITY_KEYS = (
    "providerId", "marketId", "name", "address", "city", "state", "zip",
    "category", "locationKind", "county", "officialIdentities", "ccn",
)
SKIP_KEYS = {
    "description", "descriptions", "text", "excerpt", "excerpts", "summary",
    "notes", "note", "basis", "reason", "justification", "query", "queries",
    "reviews", "provider_facts", "content", "html",
    "markdown", "body", "inputCheckpoints", "sitemapEvidence",
}
URL_KEYS = ("url", "canonicalUrl", "source_url", "canonical_url", "sourceUrl")
URL_LIST_KEYS = ("result_urls", "discovered_urls", "resultUrls")
EXCLUDED_DIRS = {"raw", "cache", "history", "runs", "pages", "source-checks"}


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def sha(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def file_sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path, value, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x" if exclusive else "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")


def csv_text(rows, columns):
    handle = io.StringIO(newline="")
    writer = csv.writer(handle, lineterminator="\r\n")
    writer.writerow(columns)
    for row in rows:
        values = []
        for key in columns:
            value = row.get(key)
            if isinstance(value, (dict, list)):
                value = json.dumps(value, sort_keys=True, ensure_ascii=False)
            value = "" if value is None else str(value)
            if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n")):
                value = "'" + value
            values.append(value)
        writer.writerow(values)
    return handle.getvalue()


def table(directory, name, rows, columns):
    dump(directory / f"{name}.json", rows)
    (directory / f"{name}.csv").write_text(csv_text(rows, columns), encoding="utf-8", newline="")


def runtime_snapshot(date):
    command = [
        str(ROOT / "node_modules/.bin/tsx"),
        str(ROOT / "tests/nj-experience-acquisition.test.ts"), "--snapshot", date,
    ]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=True)
    snapshot = json.loads(result.stdout)
    assert snapshot["scope"] == "all-active-registered-NJ-providers"
    providers = snapshot["runtimeProviders"]
    assert providers and len({p["providerId"] for p in providers}) == len(providers)
    assert all(p["state"] == "NJ" and p["county"] for p in providers)
    return snapshot


def totals(providers):
    groups = {}
    for key in ("county", "category"):
        groups[key] = [
            {
                key: name, "total": len(rows),
                "scored": sum(p["experience"]["value"] is not None for p in rows),
                "unscored": sum(p["experience"]["value"] is None for p in rows),
            }
            for name, rows in sorted(group_by(providers, key).items())
        ]
    families = defaultdict(lambda: {"aggregates": 0, "reportedReviews": 0, "providerIds": set()})
    for provider in providers:
        for source in provider["experience"]["includedSources"]:
            family = families[source["sourceFamily"]]
            family["aggregates"] += 1
            family["reportedReviews"] += source["count"]
            family["providerIds"].add(provider["providerId"])
    return {
        "total": len(providers),
        "scored": sum(p["experience"]["value"] is not None for p in providers),
        "unscored": sum(p["experience"]["value"] is None for p in providers),
        "coverageStatuses": dict(sorted(Counter(p["coverage"]["status"] for p in providers).items())),
        **groups,
        "countyCategory": [
            {"county": county, "category": category, "total": len(rows),
             "scored": sum(p["experience"]["value"] is not None for p in rows),
             "unscored": sum(p["experience"]["value"] is None for p in rows)}
            for (county, category), rows in sorted(group_by(providers, ("county", "category")).items())
        ],
        "includedSourceFamilies": [
            {"sourceFamily": name, "aggregates": value["aggregates"],
             "reportedReviews": value["reportedReviews"], "providers": len(value["providerIds"])}
            for name, value in sorted(families.items())
        ],
    }


def group_by(rows, key):
    result = defaultdict(list)
    for row in rows:
        value = tuple(row[k] for k in key) if isinstance(key, tuple) else row[key]
        result[value].append(row)
    return result


def normalize_url(value):
    if not isinstance(value, str):
        return None
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").lower().removeprefix("www.")
        if parts.scheme not in ("http", "https") or not host:
            return None
        if any(host == name or host.endswith("." + name) for name in ("facebook.com", "fb.com", "fb.watch")):
            return None
        query = urlencode(sorted(
            (key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in ("gclid", "fbclid", "tracking")
        ))
        return urlunsplit(("https", host, parts.path.rstrip("/"), query, ""))
    except ValueError:
        return None


def source_name(url):
    host = urlsplit(url).hostname
    return {
        "mylivingchoice.com": "MyLivingChoice",
        "caring.com": "Caring.com",
        "aplaceformom.com": "A Place for Mom",
        "senioradvisor.com": "SeniorAdvisor",
        "seniorly.com": "Seniorly",
        "senioradvice.com": "SeniorAdvice",
        "google.com": "Google",
        "maps.google.com": "Google",
    }.get(host, host)


def url_kind(url):
    parts = urlsplit(url)
    host, path = parts.hostname, parts.path.lower()
    if any(token in path for token in ("sitemap", "robots.txt", "/terms", "/privacy", "/legal")):
        return "access-or-discovery-infrastructure"
    if host in ("healthapps.nj.gov", "rgbportal.dca.njoag.gov"):
        return "official-identity-evidence"
    if host == "mylivingchoice.com":
        return "location-listing" if path.startswith("/property/") else "directory-discovery"
    if host in ("caring.com", "aplaceformom.com", "senioradvisor.com", "google.com",
                "maps.google.com", "seniorly.com", "senioradvice.com"):
        return "review-platform-candidate"
    return "other-discovery"


def family_name(record, url):
    aggregate = record.get("aggregate") or record.get("rating") or {}
    if not isinstance(aggregate, dict):
        aggregate = {}
    declared = (record.get("sourceFamily") or record.get("source_family")
                or aggregate.get("sourceFamily") or aggregate.get("source_family")
                or aggregate.get("family"))
    token = "".join(c for c in str(declared or "").lower() if c.isalnum())
    host = urlsplit(url).hostname
    if token in ("google", "googlemaps", "googlereviews") or host in ("google.com", "maps.google.com"):
        return "google"
    if token in ("apfm", "aplaceformom", "senioradvisor") or host in ("aplaceformom.com", "senioradvisor.com"):
        return "aplaceformom"
    if token in ("caring", "caringcom") or host == "caring.com":
        return "caring"
    return token or "unknown"


def pick(record, keys):
    return {key: record[key] for key in keys if key in record}


def aggregate_metadata(record):
    value = record.get("aggregate") or record.get("rating")
    if not isinstance(value, dict):
        return None
    return pick(value, (
        "kind", "value", "rating", "scale", "count", "review_count", "asOf",
        "published_as_of", "scope", "sourceFamily", "source_family", "family",
        "attribution", "syndicated", "locationSpecific",
    ))


def identity_metadata(record):
    value = record.get("identity")
    if not isinstance(value, dict):
        return None
    return pick(value, (
        "name", "address", "street", "city", "state", "zip", "careSetting", "careUnit",
        "careUnitText", "observed_name", "observed_address", "observed_city",
        "observed_state", "observed_zip", "observed_care_unit",
    ))


def source_inputs(root=ROOT):
    base = root / "research/north-jersey"
    included = []
    excluded = Counter()
    for name in ("reviews", "review-excerpts", "review-release", "listing-index", "experience-acquisition"):
        directory = base / name
        for path in sorted(directory.rglob("*.json")):
            relative_parts = set(path.relative_to(directory).parts[:-1])
            if name == "experience-acquisition" and "inventory" in relative_parts:
                continue
            if relative_parts & EXCLUDED_DIRS:
                excluded["retained-pages-cache-history-runs"] += 1
                continue
            if any(term in str(path.relative_to(directory)).lower() for term in ("facebook", "description")):
                excluded["out-of-scope"] += 1
                continue
            included.append(path)
    return included, dict(excluded)


def candidate_inventory(snapshot, paths, root=ROOT):
    providers = {p["providerId"]: p for p in snapshot["runtimeProviders"]}
    aliases = defaultdict(set)
    for provider in providers.values():
        pid = provider["providerId"]
        aliases[pid.lower()].add(pid)
        if provider.get("ccn"):
            aliases[("cms-ccn:" + provider["ccn"]).lower()].add(pid)
        for identity in provider["officialIdentities"]:
            for key in ("officialId", "license"):
                value = identity.get(key)
                if value:
                    aliases[str(value).lower()].add(pid)
                    aliases[("nj-doh:" + str(value)).lower()].add(pid)
                    aliases[("nj-dca:" + str(value)).lower()].add(pid)
                    aliases[("nj-dca-hcsf:" + str(value)).lower()].add(pid)
    candidates = {}
    receipts = []
    publication = []
    manifests = []
    unmatched = []

    def identifiers(record, inherited):
        ids = set(inherited)
        explicit = []
        for key in ("providerId", "provider_id", "harbor_id", "officialId", "official_id",
                    "rosterKey", "roster_key", "license_number", "ccn"):
            value = record.get(key)
            if isinstance(value, str) and value:
                explicit.append(value)
                matches = aliases.get(value.lower(), set())
                if key == "ccn":
                    matches = aliases.get(("cms-ccn:" + value).lower(), set())
                ids.update(matches)
        return ids, explicit

    def walk(value, path, pointer, inherited=(), context=None):
        if isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, path, f"{pointer}/{index}", inherited, context)
            return
        if not isinstance(value, dict):
            return
        ids, explicit = identifiers(value, inherited)
        location = value.get("location")
        if isinstance(location, dict):
            location_ids, _ = identifiers(location, ())
            ids.update(location_ids)
        context = {**(context or {}), **pick(value, (
            "checkedAt", "checked_at", "observedAt", "inspection", "status", "outcome",
            "access_decision", "access", "pageAccess", "retainedPage", "retainedSha256",
            "receipt", "originalReceipt", "material", "captureSha256",
        ))}
        urls = []
        for key in URL_KEYS:
            if key in value:
                urls.append((value[key], f"{pointer}/{key}"))
        for key in URL_LIST_KEYS:
            for index, item in enumerate(value.get(key, []) if isinstance(value.get(key), list) else []):
                if isinstance(item, str):
                    urls.append((item, f"{pointer}/{key}/{index}"))
        seen = set()
        for raw, url_pointer in urls:
            url = normalize_url(raw)
            if not url or url in seen:
                continue
            seen.add(url)
            key = sha(url)[:24]
            candidate = candidates.setdefault(key, {
                "candidateId": key, "url": url, "source": source_name(url),
                "urlKind": url_kind(url),
                "sourceFamilies": set(), "providerIds": set(), "references": [],
                "observedAggregates": [], "observedIdentities": [],
            })
            candidate["providerIds"].update(ids)
            candidate["sourceFamilies"].add(family_name(value, url))
            ref = {"path": str(path.relative_to(root)), "pointer": url_pointer,
                   "sha256": file_hashes[path], "providerIds": sorted(ids),
                   "identityBasis": "explicit-runtime-or-official-reference" if ids else "unresolved",
                   "recordedStatus": value.get("status") or value.get("outcome"),
                   "recordedReason": value.get("reason") or value.get("identityLimitation") or value.get("limitation"),
                   "identityChecks": value.get("identityChecks")}
            candidate["references"].append(ref)
            aggregate = aggregate_metadata(value)
            if aggregate:
                candidate["observedAggregates"].append({**ref, "aggregate": aggregate})
            identity = identity_metadata(value)
            if identity:
                candidate["observedIdentities"].append({**ref, "identity": identity})
            if explicit and not ids:
                unmatched.append({"candidateId": key, "identifiers": explicit, **ref})
            if any(context.get(k) is not None for k in (
                "checkedAt", "checked_at", "observedAt", "inspection", "pageAccess", "receipt", "originalReceipt",
            )):
                receipt_id = sha([str(path.relative_to(root)), pointer, url])[:24]
                access = context.get("access")
                receipts.append({
                    "receiptId": receipt_id, "candidateId": key, **ref,
                    "checkedAt": context.get("checkedAt") or context.get("checked_at") or context.get("observedAt"),
                    "inspection": context.get("inspection"),
                    "accessDecision": context.get("access_decision") or
                        (access.get("decision") if isinstance(access, dict) else access),
                    "pageAccess": pick(context.get("pageAccess") or {}, (
                        "httpStatus", "error", "interrupted", "restricted", "samePage",
                    )),
                    "retainedPage": context.get("retainedPage"),
                    "retainedSha256": context.get("retainedSha256") or context.get("captureSha256"),
                    "receipt": context.get("receipt") or context.get("originalReceipt"),
                    "error": value.get("error"),
                    "verification": "retained-metadata-only-not-a-new-retrieval",
                })
            if any(token in path.name for token in ("approvals", "decisions")) and value.get("reason"):
                publication.append({
                    "candidateId": key, **ref, "decision": "existing-recorded-publication-review",
                    "justification": value["reason"],
                    "reviewer": value.get("reviewer"), "reviewedAt": value.get("reviewedAt"),
                    "authorizesScoreChange": False,
                })
        if not seen and (
            any(key in value for key in ("tool", "query", "error", "result_urls"))
            or (ids and any(key in value for key in ("status", "review_outcome", "review_status")))
        ):
            receipts.append({
                "receiptId": sha([str(path.relative_to(root)), pointer, "no-linked-url"])[:24],
                "candidateId": None, "providerIds": sorted(ids),
                "path": str(path.relative_to(root)), "pointer": pointer, "sha256": file_hashes[path],
                "checkedAt": context.get("checkedAt") or context.get("checked_at") or context.get("observedAt"),
                "inspection": value.get("inspection"), "accessDecision": value.get("access_decision"),
                "recordedStatus": value.get("status") or value.get("review_outcome")
                    or value.get("review_status") or value.get("outcome") or value.get("kind"),
                "error": value.get("error"), "recordedReason": value.get("reason")
                    or value.get("note") or value.get("limitation"),
                "verification": "retained-attempt-metadata-no-linked-url",
            })
        for key, item in value.items():
            if key in SKIP_KEYS or "facebook" in key.lower() or "description" in key.lower():
                continue
            if key == "rows" and "review-excerpts" in path.parts:
                continue
            child_ids = set(ids)
            if key in providers:
                child_ids.add(key)
            child_pointer = f"{pointer}/{key.replace('~', '~0').replace('/', '~1')}"
            walk(item, path, child_pointer, child_ids, context)

    file_hashes = {}
    for path in paths:
        raw = path.read_bytes()
        file_hashes[path] = hashlib.sha256(raw).hexdigest()
        value = json.loads(raw)
        manifests.append({"path": str(path.relative_to(root)), "sha256": file_hashes[path], "bytes": len(raw)})
        walk(value, path, "")
    for provider in providers.values():
        for source in provider["sources"]:
            url = normalize_url(source["url"])
            if not url:
                continue
            key = sha(url)[:24]
            candidate = candidates.setdefault(key, {
                "candidateId": key, "url": url, "source": source_name(url),
                "urlKind": url_kind(url),
                "sourceFamilies": set(), "providerIds": set(), "references": [],
                "observedAggregates": [], "observedIdentities": [],
            })
            candidate["providerIds"].add(provider["providerId"])
            candidate["sourceFamilies"].update(
                item["sourceFamily"] for item in provider["experience"]["includedSources"]
                if item["sourceId"] == source["id"]
            )
            candidate.setdefault("runtimeProviderIds", set()).add(provider["providerId"])
    output = []
    for candidate in candidates.values():
        candidate["providerIds"] = sorted(candidate["providerIds"])
        candidate["sourceFamilies"] = sorted(candidate["sourceFamilies"] - {"unknown"}) or ["unknown"]
        candidate["runtimeProviderIds"] = sorted(candidate.get("runtimeProviderIds", set()))
        candidate["unscoredProviderIds"] = [
            pid for pid in candidate["providerIds"] if providers[pid]["experience"]["value"] is None
        ]
        candidate["identityStatus"] = (
            "multiple-provider-references-review-care-unit" if len(candidate["providerIds"]) > 1
            else "candidate-reference-not-publication-approval" if candidate["providerIds"]
            else "unresolved-provider"
        )
        output.append(candidate)
    return {
        "sourceCandidates": sorted(output, key=lambda item: item["candidateId"]),
        "retrievalReceipts": sorted(receipts, key=lambda item: item["receiptId"]),
        "reviewedPublicationDecisions": publication,
        "unmatchedIdentifiers": unmatched,
        "sourceInputs": manifests,
    }


def evidence_digest(provider):
    return sha(pick(provider, ("experience", "reviewAggregates", "sources")))


def compare(baseline, current, decisions):
    before = {p["providerId"]: p for p in baseline["runtimeProviders"]}
    after = {p["providerId"]: p for p in current["runtimeProviders"]}
    errors = []
    changes = []
    if baseline["asOfDate"] != current["asOfDate"]:
        errors.append("Assessment date differs from baseline.")
    if before.keys() != after.keys():
        errors.append(f"Population drift. Missing {sorted(before.keys() - after.keys())}; added {sorted(after.keys() - before.keys())}.")
    scorer = "src/lib/experience-score.ts"
    if baseline["inputHashes"][scorer] != current["inputHashes"][scorer]:
        errors.append("Real scorer changed. Policy changes are outside this acquisition task.")
    for pid in sorted(before.keys() & after.keys()):
        old, new = before[pid], after[pid]
        if pick(old, IDENTITY_KEYS) != pick(new, IDENTITY_KEYS):
            errors.append(f"Provider identity changed without an identity migration contract: {pid}")
        old_hash, new_hash = evidence_digest(old), evidence_digest(new)
        if old_hash == new_hash:
            continue
        approved = any(
            row.get("provider_id") == pid and row.get("before_sha256") == old_hash
            and row.get("after_sha256") == new_hash and row.get("decision") == "approve-score-change"
            and all(str(row.get(key, "")).strip() for key in
                    ("decision_id", "reviewer", "reviewed_at", "justification", "evidence"))
            for row in decisions
        )
        change = {
            "providerId": pid, "before": old["experience"]["value"], "after": new["experience"]["value"],
            "before_sha256": old_hash, "after_sha256": new_hash, "reviewDecisionMatched": approved,
        }
        changes.append(change)
        if old["experience"]["value"] is not None and not approved:
            errors.append(f"Existing scored evidence changed without exact reviewed approval: {pid}")
    return {
        "passed": not errors, "asOfDate": baseline["asOfDate"],
        "baselineTotals": totals(list(before.values())), "currentTotals": totals(list(after.values())),
        "unchangedExistingScores": sum(
            p["experience"]["value"] is not None and pid in after and evidence_digest(p) == evidence_digest(after[pid])
            for pid, p in before.items()
        ),
        "changes": changes, "errors": errors,
    }


def baseline_read(directory):
    path = directory / "baseline.json"
    manifest = json.loads((directory / "baseline-manifest.json").read_text())
    if file_sha(path) != manifest["sha256"]:
        raise ValueError("Immutable baseline digest mismatch.")
    return json.loads(path.read_text())


def inventory_write(snapshot, directory, paths):
    inventory = candidate_inventory(snapshot, paths)
    providers = snapshot["runtimeProviders"]
    by_provider = defaultdict(list)
    checks_by_provider = defaultdict(list)
    for receipt in inventory["retrievalReceipts"]:
        for pid in receipt["providerIds"]:
            if any(receipt.get(key) for key in ("recordedStatus", "recordedReason", "error")):
                checks_by_provider[pid].append(pick(receipt, (
                    "receiptId", "candidateId", "path", "pointer", "checkedAt",
                    "recordedStatus", "recordedReason", "error",
                )))
    for candidate in inventory["sourceCandidates"]:
        for pid in candidate["providerIds"]:
            by_provider[pid].append(candidate)
    unscored = []
    queue = []
    for provider in providers:
        if provider["experience"]["value"] is not None:
            continue
        pid = provider["providerId"]
        context_links = by_provider[pid]
        candidates = [
            c for c in context_links
            if c["urlKind"] not in ("official-identity-evidence", "access-or-discovery-infrastructure")
        ]
        location_candidates = [
            c for c in candidates if c["urlKind"] in ("location-listing", "review-platform-candidate")
        ]
        unscored.append({
            **pick(provider, IDENTITY_KEYS), "status": provider["coverage"]["status"],
            "remainingReason": provider["experience"]["reason"],
            "excludedSources": provider["experience"]["excludedSources"],
            "includedSources": provider["experience"]["includedSources"],
            "candidateIds": [c["candidateId"] for c in candidates],
            "knownSourceLinks": [c["url"] for c in candidates],
            "candidateCount": len(candidates),
            "locationCandidateCount": len(location_candidates),
            "retainedCheckOutcomes": checks_by_provider[pid],
            "contextOnlySourceLinks": [
                c["url"] for c in context_links if c not in candidates
            ],
            "unusedRuntimeSourceLinks": [
                c["url"] for c in candidates if pid not in c["runtimeProviderIds"]
            ],
            "nextAction": provider["coverage"]["nextAction"],
        })
        targets = candidates or [None]
        for candidate in targets:
            queue.append({
                "taskId": sha([pid, candidate["candidateId"] if candidate else "discover"])[:24],
                "providerId": pid, "county": provider["county"], "category": provider["category"],
                "candidateId": candidate["candidateId"] if candidate else None,
                "url": candidate["url"] if candidate else None,
                "source": candidate["source"] if candidate else None,
                "action": (
                    "discover-exact-provider-source" if not candidate
                    else "inspect-exact-location-rating-and-count"
                    if candidate["urlKind"] in ("location-listing", "review-platform-candidate")
                    else "discover-location-from-retained-lead"
                ),
                "nextAction": provider["coverage"]["nextAction"],
                "remainingReason": provider["experience"]["reason"],
                "identityWarning": candidate["identityStatus"] if candidate else "no-known-source-link",
                "recordedCandidateOutcomes": [
                    pick(ref, ("path", "pointer", "recordedStatus", "recordedReason", "identityChecks"))
                    for ref in candidate["references"] if pid in ref["providerIds"]
                    and any(ref.get(key) for key in ("recordedStatus", "recordedReason", "identityChecks"))
                ] if candidate else checks_by_provider[pid],
                "publicationGate": "Confirm exact identity and care unit, access permission, rating, scale, count, date, source family; retain receipt and obtain reviewed publication decision.",
            })
    source_totals = []
    for source, candidates in sorted(group_by(inventory["sourceCandidates"], "source").items()):
        source_totals.append({
            "source": source, "uniqueUrls": len(candidates),
            "linkedProviders": len({pid for c in candidates for pid in c["providerIds"]}),
            "unscoredProviders": len({pid for c in candidates for pid in c["unscoredProviderIds"]}),
            "unusedUnscoredProviderLinks": sum(
                pid not in c["runtimeProviderIds"] for c in candidates for pid in c["unscoredProviderIds"]
            ),
            "withObservedAggregates": sum(bool(c["observedAggregates"]) for c in candidates),
            "unresolvedUrls": sum(not c["providerIds"] for c in candidates),
            "locationCandidateUrls": sum(c["urlKind"] in ("location-listing", "review-platform-candidate") for c in candidates),
            "unscoredLocationProviders": len({
                pid for c in candidates if c["urlKind"] in ("location-listing", "review-platform-candidate")
                for pid in c["unscoredProviderIds"]
            }),
            "unusedUnscoredLocationLinks": sum(
                pid not in c["runtimeProviderIds"]
                for c in candidates if c["urlKind"] in ("location-listing", "review-platform-candidate")
                for pid in c["unscoredProviderIds"]
            ),
        })
    summary = {
        **totals(providers), "asOfDate": snapshot["asOfDate"],
        "uniqueCandidateUrls": len(inventory["sourceCandidates"]),
        "unscoredWithKnownLinks": sum(bool(row["candidateCount"]) for row in unscored),
        "unscoredWithoutKnownLinks": sum(not row["candidateCount"] for row in unscored),
        "unscoredWithLocationCandidates": sum(bool(row["locationCandidateCount"]) for row in unscored),
        "unscoredWithoutLocationCandidates": sum(not row["locationCandidateCount"] for row in unscored),
        "retrievalReceiptMetadataRows": len(inventory["retrievalReceipts"]),
        "recordedPublicationDecisions": len(inventory["reviewedPublicationDecisions"]),
        "discoveryTasks": len(queue),
        "sourceTotals": source_totals,
        "limitations": [
            "Candidates and retained receipt metadata are not new retrievals or publication approvals.",
            "Provider links from explicit official references are discovery crosswalks, not exact-care-unit verification.",
            "Unknown source family remains unknown. MyLivingChoice is not automatically treated as independent of Google.",
            "Retained page bodies, historical copies, social evidence and descriptions are outside this inventory.",
            "All active NJ providers are included, regardless of older collector denominators or county scope.",
        ],
    }
    dump(directory / "current.json", snapshot)
    dump(directory / "summary.json", summary)
    table(directory, "runtime-providers", [
        {**provider, "score": provider["experience"]["value"],
         "reason": provider["experience"]["reason"],
         "status": provider["coverage"]["status"]}
        for provider in providers
    ], [
        *IDENTITY_KEYS, "score", "status", "reason", "experience", "reviewAggregates", "sources", "coverage",
    ])
    table(directory, "unscored-crosswalk", unscored, [
        *IDENTITY_KEYS, "status", "remainingReason", "candidateCount", "locationCandidateCount",
        "contextOnlySourceLinks", "candidateIds",
        "knownSourceLinks", "unusedRuntimeSourceLinks", "includedSources", "excludedSources",
        "retainedCheckOutcomes", "nextAction",
    ])
    for name, key, columns in (
        ("source-candidates", "sourceCandidates", [
            "candidateId", "url", "source", "urlKind", "sourceFamilies", "providerIds", "unscoredProviderIds",
            "runtimeProviderIds", "identityStatus", "references", "observedAggregates", "observedIdentities",
        ]),
        ("retrieval-receipts", "retrievalReceipts", [
            "receiptId", "candidateId", "providerIds", "path", "pointer", "sha256", "checkedAt",
            "inspection", "accessDecision", "pageAccess", "retainedPage", "retainedSha256", "receipt",
            "recordedStatus", "recordedReason", "error", "verification",
        ]),
        ("reviewed-publication-decisions", "reviewedPublicationDecisions", [
            "candidateId", "providerIds", "path", "pointer", "sha256", "decision", "justification",
            "reviewer", "reviewedAt", "authorizesScoreChange",
        ]),
        ("unmatched-identifiers", "unmatchedIdentifiers", [
            "candidateId", "identifiers", "path", "pointer", "sha256",
        ]),
    ):
        table(directory, name, inventory[key], columns)
    table(directory, "discovery-queue", queue, [
        "taskId", "providerId", "county", "category", "candidateId", "url", "source",
        "action", "nextAction", "remainingReason", "identityWarning", "recordedCandidateOutcomes", "publicationGate",
    ])
    table(directory, "source-totals", source_totals, list(source_totals[0]) if source_totals else ["source"])
    dump(directory / "source-inputs.json", inventory["sourceInputs"])
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("baseline", "inventory", "compare"))
    parser.add_argument("--as-of", default=None)
    args = parser.parse_args(argv)
    INVENTORY.mkdir(parents=True, exist_ok=True)
    if args.command == "baseline":
        if (INVENTORY / "baseline.json").exists() or (INVENTORY / "baseline-manifest.json").exists():
            raise ValueError("Baseline already exists. Refusing to overwrite the immutable baseline.")
        date = args.as_of or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        snapshot = runtime_snapshot(date)
        snapshot["totals"] = totals(snapshot["runtimeProviders"])
        dump(INVENTORY / "baseline.json", snapshot, exclusive=True)
        dump(INVENTORY / "baseline-manifest.json", {
            "sha256": file_sha(INVENTORY / "baseline.json"), "asOfDate": date,
            "scope": snapshot["scope"], "totals": snapshot["totals"],
        }, exclusive=True)
        (INVENTORY / "baseline.json").chmod(0o444)
        (INVENTORY / "baseline-manifest.json").chmod(0o444)
        print(json.dumps({"baseline": snapshot["totals"], "sha256": file_sha(INVENTORY / "baseline.json")}))
        return 0
    baseline = baseline_read(INVENTORY)
    if args.as_of and args.as_of != baseline["asOfDate"]:
        raise ValueError("Use the frozen baseline date. A different date confounds freshness with acquisition.")
    current = runtime_snapshot(baseline["asOfDate"])
    with (AREA / "decisions.tsv").open(newline="") as handle:
        decisions = list(csv.DictReader(handle, delimiter="\t"))
    comparison = compare(baseline, current, decisions)
    dump(INVENTORY / "comparison.json", comparison)
    if args.command == "inventory":
        paths, exclusions = source_inputs()
        summary = inventory_write(current, INVENTORY, paths)
        dump(INVENTORY / "input-scope.json", {
            "includedFiles": len(paths), "excludedFilesByReason": exclusions,
            "excludedDirectories": sorted(EXCLUDED_DIRS),
            "retainedMetadataOnly": True,
        })
        print(json.dumps(summary))
    print(json.dumps(comparison))
    return 0 if comparison["passed"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
