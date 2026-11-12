#!/usr/bin/env python3
"""Release reviewed NJ qualitative threads and coverage without numeric scoring."""

import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "research/north-jersey"
OUTPUT = RESEARCH / "facebook/reconciliation"
ORIGINAL = "0041ba3fa1c111f630865834d765206c3280e002"
FOLLOWUP = "ac85b0b0654ad709ea4c429feeae264b35d21fde"
CORRECTION = "1a52d72a7c415ed5318527543fccf2c371decd66"
REVIEWS = ["d2097ac834897265a38ed1a44b2b536b5807778e",
           "e6c005b93af906afde37441644fb40693adbb361"]
FOLLOWUP_PATH = "followup-2026-11-12/"
CEDAR = "north-jersey-campus-cedar-crest-village-07444"
APPROVAL = "facebook/reconciliation/reviewed-family-threads.json"
RECEIPT = "facebook/reconciliation/cedar-crest-public-source-check-2026-11-12.json"
PINNED_REVIEWS = {
    APPROVAL: "51dc231ca167830b30cd866785a1f8ce3c339ba0658176219b1ac0f4a8a3c909",
    RECEIPT: "eb1c16d298c9b06f186147511be18422e4a5f7d1c7923ac6263d144cdc7ac899",
}
TRUSTED_INPUTS = ["facebook/kit/kit.csv", "facebook/first-facility-assignments.csv",
                  "facebook/campus-and-office-assignments.csv",
                  "facebook/reconciliation/followup-review-2026-11-12.md",
                  *PINNED_REVIEWS]
REVIEWED_EXCLUSIONS = {"fb-njfu-a-001": "index_only", "fb-njfu-a-002": "index_only"}
spec = importlib.util.spec_from_file_location("facebook_batch", Path(__file__).with_name("facebook-batch.py"))
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n").encode()


def address_tokens(value):
    aliases = {"road": "rd", "floor": "fl"}
    return [aliases.get(word, word) for word in re.findall(r"[a-z0-9]+", value.lower())]


def disposition(row, provider_id):
    if not row["provider_id"]:
        return "unassigned", "no_exact_provider_identity"
    if not provider_id or row["match_status"] != "exact":
        return "quarantined", "untrusted_or_nonexact_identity"
    if row.get("observation_id") in REVIEWED_EXCLUSIONS:
        return "excluded", REVIEWED_EXCLUSIONS[row["observation_id"]]
    if row.get("observation_id") in {"fb-nju-b-001", "fb-nju-b-002"}:
        return "withheld", "personal_profile_permalink_withheld"
    if row["experience_stage"] == "employment" or row["relationship"] == "staff":
        return "excluded", "employment"
    if row["account_type"] == "provider_promotion":
        return "excluded", "provider_promotion"
    if row["account_type"] != "firsthand":
        return "excluded", "not_firsthand"
    if row["relationship"] not in {"resident", "family"}:
        return "excluded", "firsthand_relationship_unverified"
    if row["experience_stage"] not in {"receiving_care", "previous_care"}:
        return "excluded", "post_care_experience_unverified"
    return "withheld", "underlying_first_person_source_unverified"


def finding_projection(selection):
    return {
        **{key: selection[key] for key in
           ("id", "sourceObservationIds", "summary", "date", "threadUrl", "topics")},
        "kind": "resident-family", "relationship": "family", "sourceUrl": selection["threadUrl"],
        "excerpt": selection["quote"]["text"],
        "limitations": selection["limitations"] + [
            "Relationships are self-reported in the reviewed source, not independently authenticated.",
            "Selected qualitative context only. This finding never contributes to a numeric experience score.",
        ],
    }


def approved_inputs(read):
    reviewed = {}
    for name, expected in PINNED_REVIEWS.items():
        body = read(name)
        batch.require(sha(body) == expected, "Facebook pinned review hash mismatch")
        reviewed[name] = json.loads(body)
    selections, receipt = reviewed[APPROVAL], reviewed[RECEIPT]
    validate_public_receipt(selections, receipt)
    return selections, receipt


def public_thread_key(value):
    url = urlsplit(value)
    batch.require(url.scheme == "https" and url.hostname in {"facebook.com", "www.facebook.com"}
                  and not url.username and not url.password and not url.port
                  and not url.query and not url.fragment
                  and re.fullmatch(r"/groups/[A-Za-z0-9._-]+/(?:posts|permalink)/[A-Za-z0-9]+/?", url.path),
                  "public_thread_url_invalid")
    return url.path.rstrip("/"), url.query


def validate_public_receipt(selections, receipt):
    cedar = CEDAR
    batch.require(set(selections) == {cedar, "north-jersey-doh-nj60a004"},
                  "reviewed_thread_provider_set_invalid")
    batch.require(receipt["schemaVersion"] == 1 and receipt["providerId"] == cedar
                  and receipt["scope"] == "campus_only" and receipt["numericScoreEligible"] is False,
                  "public_source_receipt_invalid")
    checks = receipt["checks"]
    batch.require(checks["renderedBrowser"] == "public_thread_and_underlying_comments_visible"
                  and checks["authenticationUsed"] is False and checks["privateGroupAccessUsed"] is False
                  and checks["commentPaginationExpanded"] is True
                  and checks["retainedExcerptMatchedRenderedSource"] is True,
                  "underlying_public_source_unverified")
    selection = selections[cedar]
    batch.require(public_thread_key(receipt["threadUrl"]) == public_thread_key(selection["threadUrl"])
                  and receipt["qualitativeSelection"]["observationIds"] == selection["sourceObservationIds"]
                  and receipt["qualitativeSelection"]["originalThreadCount"] == 1,
                  "public_source_selection_mismatch")
    for selection in selections.values():
        public_thread_key(selection["threadUrl"])


def reviewed_threads(selections, receipt, raw_rows, rows, coverage, source_notes):
    validate_public_receipt(selections, receipt)
    by_id = {row["observationId"]: row for row in rows}
    findings = {}
    selected_ids = set()
    for pid, selection in selections.items():
        ids = selection["sourceObservationIds"]
        batch.require(ids and len(set(ids)) == len(ids) and not selected_ids.intersection(ids),
                      "reviewed_thread_observation_ids_invalid")
        for oid in ids:
            batch.require(oid in raw_rows and oid in by_id, "reviewed_thread_observation_missing")
            raw, retained = raw_rows[oid], by_id[oid]
            batch.require(retained["providerId"] == pid and retained["disposition"] == "withheld"
                          and raw["account_type"] == "firsthand" and raw["relationship"] == "family"
                          and raw["experience_stage"] in {"receiving_care", "previous_care"}
                          and raw["match_status"] == "exact" and not raw["duplicate_of"]
                          and raw["source_visibility"] == "public" and raw["concern_type"] == "none"
                          and raw["retrieved_at_utc"][:10] == "2026-11-12" and raw["posted_at"] == selection["date"]
                          and raw["thread_url"] == selection["threadUrl"]
                          and raw["source_url"].split("?")[0] == selection["threadUrl"],
                          "reviewed_thread_not_exact_firsthand_post_care")
        quote = selection["quote"]
        batch.require(quote["observationId"] in ids and 1 <= len(quote["text"].split()) <= 12
                      and quote["text"] in raw_rows[quote["observationId"]].get("supporting_public_excerpt", ""),
                      "selected_quote_does_not_match_original")
        aid = raw_rows[ids[0]]["provider_id"]
        text = json.dumps(coverage[aid]).casefold()
        if pid == CEDAR:
            batch.require("complete (13/13)" in source_notes.casefold(), "retained_direct_comment_access_unverified")
        batch.require(coverage[aid]["status"] == "evidence_found",
                      "reviewed_thread_coverage_changed")
        batch.require(selection["coverageMarkers"]
                      and all(marker.casefold() in text for marker in selection["coverageMarkers"]),
                      "retained_direct_comment_access_unverified")
        for oid in ids:
            by_id[oid].update(disposition="published", reason="reviewed_exact_family_thread",
                              underlyingSourceVerified=True, firstPersonPostCareVerified=True)
        selected_ids.update(ids)
        findings[pid] = [finding_projection(selection)]
    return findings


def build():
    trusted, exact, headers, _, _ = batch.load_kit(RESEARCH / "facebook/kit")
    source_hashes = {}

    def read(commit, name):
        body = batch.git_body(commit, name)
        source_hashes[f"{commit}:{name}"] = sha(body.encode())
        return body

    names = ["assignments.csv", "supplied-first-facility-assignments.csv", "batch-manifest.json",
             "coverage.csv", "observations.csv", "aggregate-candidates.csv"]
    original = {name: read(ORIGINAL, name) for name in names}
    identity_review = batch.reconcile(trusted, exact, headers, original)
    mapping = {row["assignmentId"]: row["providerId"] for row in identity_review["ledger"]
               if row["file"] == "assignments.csv" and row["disposition"] == "identity_only"}
    for name in ("observations.csv", "coverage.csv"):
        batch.require(read(FOLLOWUP, name) == original[name]
                      and read(CORRECTION, name) == original[name], "base_source_changed")
    followup = {}
    for name in ("assignments.csv", "coverage.csv", "observations.csv", "aggregate-candidates.csv"):
        before = read(FOLLOWUP, FOLLOWUP_PATH + name)
        after = read(CORRECTION, FOLLOWUP_PATH + name)
        if name != "assignments.csv":
            batch.require(before == after, "followup_evidence_changed")
        followup[name] = after
    assignments = batch.parse_csv(followup["assignments.csv"], batch.ASSIGNMENT_COLUMNS)
    expected_followups = set(trusted) - set(identity_review["acceptedAssignmentIds"])
    batch.require({row["assignment_id"] for _, _, row in assignments} == expected_followups
                  and len(assignments) == len(expected_followups), "followup_assignment_set_invalid")
    for _, _, row in assignments:
        aid = row["assignment_id"]
        target = trusted[aid]
        pid, reasons = batch.identity(aid, row["harbor_id"], trusted, exact)
        batch.require(pid and not reasons, "followup_provider_identity_invalid")
        for source, key in [("licensed_name", "name"), ("municipality", "municipality"), ("county", "county")]:
            batch.require(row[source].casefold() == target[key].casefold(),
                          "followup_assignment_identity_mismatch")
        expected_address = f"{target['address']}, {target['municipality']}, NJ {target['zip']}"
        batch.require(row["zip"] == target["zip"][:5]
                      and address_tokens(row["address_as_published"]) == address_tokens(expected_address),
                      "followup_assignment_address_mismatch")
        mapping[aid] = pid
    batch.require(set(mapping.values()) == set(exact), "release_assignment_set_invalid")
    rows = []
    raw_rows = {}
    coverage = {}
    coverage_batches = {}
    seen_ids = set()
    for label, bodies in (("original", original), ("followup", followup)):
        observations = batch.parse_csv(bodies["observations.csv"], headers["observations.csv"])
        for _, _, row in batch.parse_csv(bodies["coverage.csv"], headers["coverage.csv"]):
            aid = row["provider_id"]
            if aid not in mapping:
                continue
            canonical = next(key for key, target in trusted.items()
                             if target["result"].get("providerId") == mapping[aid])
            batch.require(canonical not in coverage, "duplicate_exact_coverage")
            batch.require(row["status"] in batch.COVERAGE_STATUSES, "coverage_status_invalid")
            coverage[canonical] = row
            coverage_batches[canonical] = label
        for first, last, row in observations:
            oid = row["observation_id"]
            batch.require(oid and oid not in seen_ids, "duplicate_observation_id")
            seen_ids.add(oid)
            raw_rows[oid] = row
            batch.require(row["use_status"] == "internal_review_pending"
                          and row["needs_human_review"] == "true", "private_review_contract_changed")
            pid = mapping.get(row["provider_id"], "")
            decision, reason = disposition(row, pid)
            rows.append({
                "batch": label, "row": len([r for r in rows if r["batch"] == label]) + 1,
                "firstLine": first, "lastLine": last, "observationId": oid,
                "providerId": pid if row["match_status"] == "exact" else "",
                "threadGroup": "thread-" + sha(row["thread_url"].encode())[:16],
                "disposition": decision, "reason": reason,
                "underlyingSourceVerified": False, "firstPersonPostCareVerified": False,
                "scoreEligible": False,
            })
    batch.require(set(coverage) == set(trusted), "exact_coverage_incomplete")
    selections, receipt = approved_inputs(lambda name: (RESEARCH / name).read_bytes())
    source_notes = read(FOLLOWUP, FOLLOWUP_PATH + "scratch/morris-b-notes.md")
    finding_by_provider = reviewed_threads(selections, receipt, raw_rows, rows, coverage, source_notes)
    locations = {}
    coverage_audit = []
    for aid, target in trusted.items():
        pid = target["result"]["providerId"]
        retained = [row for row in rows if row["providerId"] == pid]
        count = len(retained)
        findings = finding_by_provider.get(pid, [])
        published_count = sum(len(finding["sourceObservationIds"]) for finding in findings)
        source_coverage = coverage[aid]
        if findings:
            status = "findings-available"
            explanation = (f"{count} exact-location candidate observations were retained. "
                           f"{published_count} reviewed family observations are grouped into one original "
                           "discussion. Other candidates remain unpublished. A shared thread does not "
                           "establish independent households. No Facebook material contributes to a numeric score.")
        elif count:
            status = "withheld"
            explanation = (f"{count} exact-location candidate observations were retained. None is cleared "
                           "for publication. Original first-person evidence remains unverified, or the "
                           "material is promotional, employment-related, or ambiguous. Facebook never "
                           "contributes to the numeric experience score.")
        elif source_coverage["status"] == "searched_no_relevant_result":
            status = "no-relevant-result"
            explanation = ("The retained location-specific search reported no relevant public result. "
                           "This limited search does not establish an absence of reviews or describe care quality.")
        else:
            status = "partial"
            explanation = ("The search retained ambiguous or non-family candidates, with no exactly linked "
                           "observation. These candidates remain unassigned. No finding or rating is published.")
        if aid == "nj-doh-NJ82472":
            explanation = ("Family accounts were retrieved from a personal-profile thread. Its permalink identifies "
                           "the individual account, so Harbor is withholding those accounts from public display.")
        if aid == "nj-campus-cedar-crest-village":
            explanation += (" Twelve of the sixteen candidates share one thread, not twelve independent sources. "
                            "The seven published family accounts concern the campus in 2022. "
                            "A public-browser check corroborated access to the underlying thread and comments. "
                            "Campus material does not establish evidence for a licensed care unit.")
        locations[pid] = {
            "status": status, "searchedAt": source_coverage["searched_at_utc"][:10],
            "foundCount": count, "publishedObservationCount": published_count,
            "withheldCount": count - published_count,
            "coverageExplanation": explanation, "findings": findings,
        }
        coverage_audit.append({
            "assignmentId": aid, "providerId": pid, "batch": coverage_batches[aid],
            "sourceStatus": source_coverage["status"],
            "declaredCandidateCount": int(source_coverage["observations_found"]),
            "exactlyLinkedCount": count,
            "dispositions": dict(Counter(row["disposition"] for row in retained)),
            "threadGroupSizes": sorted(Counter(row["threadGroup"] for row in retained).values()),
        })
    review_path = "research/north-jersey/facebook/reconciliation/followup-review-2026-11-12.md"
    review_hashes = {}
    for commit in REVIEWS:
        result = subprocess.run(["git", "-C", str(ROOT), "show", f"{commit}:{review_path}"],
                                capture_output=True)
        batch.require(result.returncode == 0, "retained_review_unavailable")
        review_hashes[commit] = sha(result.stdout)
    batch.require(review_hashes[REVIEWS[0]] == sha((ROOT / review_path).read_bytes()),
                  "retained_review_changed")
    aggregates = [row for bodies in (original, followup)
                  for _, _, row in batch.parse_csv(bodies["aggregate-candidates.csv"], batch.AGGREGATE_COLUMNS)]
    batch.require(all(not row[key] for _, _, row in batch.parse_csv(
        followup["aggregate-candidates.csv"], batch.AGGREGATE_COLUMNS)
                      for key in ("rating_value", "rating_scale", "review_count")),
                  "unconfirmed_rating_candidate_changed")
    dataset = {
        "schemaVersion": 1, "runId": "nj-facebook-reviewed-coverage-2026-11-12",
        "checkedAt": "2026-11-12",
        "reviewBasis": ("Reviewed exact assignment identities and redacted row dispositions from the retained "
                        "original and corrected follow-up batches. Public visibility labels are collector "
                        "metadata alone, not verification of original comments. Selected exact firsthand family "
                        "rows have separate retained direct-source review. Cedar Crest public browser access "
                        "corroborates underlying comments without authenticating relationships or households. "
                        "One finding per original thread. No numeric scoring."),
        "locations": locations,
    }
    audit = {
        "schemaVersion": 1, "publication": "reviewed_qualitative", "scoreEligible": False,
        "commits": {"original": ORIGINAL, "followup": FOLLOWUP, "correction": CORRECTION,
                    "retainedReviews": REVIEWS},
        "sourceArtifactSha256": source_hashes,
        "retainedReviewSha256": review_hashes,
        "editorialApprovalSha256": PINNED_REVIEWS,
        "collectionVisibility": {
            "basis": "Source-reported collector metadata, not independent access or relationship verification.",
            "states": dict(Counter(row["source_visibility"] for row in raw_rows.values())),
        },
        "visibilityCheck": {
            "httpFetch": "blocked_http_403", "renderedBrowser": receipt["checks"]["renderedBrowser"],
            "checkedAt": receipt["checkedAt"],
            "basis": "Retained row review and public-browser access corroboration, not exhaustive present-day row revalidation.",
            "relationships": "Self-reported in reviewed source, not independently authenticated.",
        },
        "summary": {"observations": len(rows), "exactlyLinked": sum(bool(r["providerId"]) for r in rows),
                    "dispositions": dict(Counter(r["disposition"] for r in rows)),
                    "reasons": dict(Counter(r["reason"] for r in rows)),
                    "coverageStates": dict(Counter(r["status"] for r in locations.values())),
                    "publishedObservations": sum(row["disposition"] == "published" for row in rows),
                    "publishedFindings": sum(len(items) for items in finding_by_provider.values()),
                    "scoreEligibleObservations": 0},
        "aggregateCandidates": {"count": len(aggregates),
                                "distinctLocations": len({mapping[row["assignment_id"]] for row in aggregates}),
                                "disposition": "excluded",
                                "reason": "unconfirmed_page_rating_never_eligible"},
        "coverage": coverage_audit,
        "rows": rows,
    }
    files = {"reviewed-coverage.json": encode(dataset), "release-audit.json": encode(audit)}
    files["release-manifest.json"] = encode({
        "schemaVersion": 1, "publication": "reviewed_qualitative", "scoreEligible": False,
        "trustedInputs": {name: sha((RESEARCH / name).read_bytes()) for name in TRUSTED_INPUTS},
        "outputs": {name: sha(body) for name, body in files.items()},
    })
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    files = build()
    for name, body in files.items():
        path = OUTPUT / name
        if args.check:
            batch.require(path.read_bytes() == body, "release_output_stale")
        elif not path.exists() or path.read_bytes() != body:
            path.write_bytes(body)
    print(json.dumps(json.loads(files["release-audit.json"])["summary"], sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f"Facebook release failed: {error}", file=sys.stderr)
        sys.exit(1)
