#!/usr/bin/env python3
"""Audit a private Git-object batch against the trusted first-20 Facebook kit."""

import argparse
from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
COMMIT = "0041ba3fa1c111f630865834d765206c3280e002"
BATCH = "research/north-jersey/facebook/fb-nj-union-morris-2026-11-12"
KIT = ROOT / "research/north-jersey/facebook/kit"
OUTPUT = ROOT / "research/north-jersey/facebook/reconciliation"
RUN = "fb-nj-union-morris-2026-11-12"
KIT_COLUMNS = "provider_id assignment_id name care_category address city state zip".split()
ASSIGNMENT_COLUMNS = (
    "assignment_id harbor_id nj_facility_id license licensed_name address_as_published municipality zip county "
    "licensed_care_setting care_setting care_unit former_names_or_aliases source_url source_identifier "
    "source_type selection_notes"
).split()
PROVIDER_COLUMNS = (
    "provider_id assignment_id harbor_id name former_names_or_aliases care_setting care_unit licensed_care_setting "
    "address municipality county state zip source_url source_identifier source_type market"
).split()
AGGREGATE_COLUMNS = (
    "assignment_id harbor_id source_url page_name rating_value rating_scale review_count population checked_at_utc notes"
).split()
SUPPLIED_COLUMNS = ASSIGNMENT_COLUMNS[:10] + ["source_url"]
COVERAGE_STATUSES = {"evidence_found", "searched_no_relevant_result", "ambiguous_only", "partial",
                     "not_searched", "blocked"}
MATCH_STATUSES = {"exact", "probable", "unresolved"}
DISPOSITIONS = {"identity_only", "quarantine", "private_review_only", "excluded"}
REASONS = {
    "unknown_assignment_id", "trusted_identity_unresolved", "provider_id_disagreement",
    "unassigned_observation", "source_uses_assignment_id_namespace",
    "declared_observation_count_not_exactly_linked", "observation_match_not_exact", "content_not_reviewed",
    "aggregate_not_eligible_for_publication_or_scoring",
    *("assignment_" + field + "_mismatch" for field in [
        "officialId", "license", "name", "address", "municipality", "zip", "county", "setting"]),
}
LEDGER_COLUMNS = ["file", "firstLine", "lastLine", "row", "assignmentId", "providerId",
                  "disposition", "reasons", "sourceStatus", "declaredObservationCount", "linkedObservationCount"]


class Invalid(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Invalid(code)


def encode(value):
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def csv_text(columns, rows):
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return stream.getvalue()


def parse_csv(body, columns):
    reader = csv.reader(io.StringIO(body), strict=True)
    require(next(reader, None) == list(columns), "csv_header_invalid")
    result = []
    previous = reader.line_num
    for cells in reader:
        require(len(cells) == len(columns), "csv_width_invalid")
        result.append((previous + 1, reader.line_num, dict(zip(columns, cells))))
        previous = reader.line_num
    return result


def unique_json(body):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "json_duplicate_key")
            result[key] = value
        return result
    return json.loads(body, object_pairs_hook=pairs)


def load_kit(path):
    require(path.is_dir() and not path.is_symlink(), "trusted_kit_path_invalid")
    names = ["kit.csv", "assigned.json", "assignment-manifest.json", "observations.csv", "coverage.csv"]
    require(all((path / name).is_file() and not (path / name).is_symlink() for name in names),
            "trusted_artifact_missing")
    manifest = unique_json((path / "assignment-manifest.json").read_text("utf-8"))
    require(manifest.get("schemaVersion") == 1 and manifest.get("market") == "north-jersey"
            and manifest.get("publication") == "none", "trusted_manifest_invalid")
    records = manifest.get("assignments")
    require(isinstance(records, list), "trusted_manifest_invalid")
    trusted = {}
    for record in records:
        require(isinstance(record, dict), "trusted_assignment_invalid")
        aid = record.get("assignmentId")
        result = record.get("result")
        require(isinstance(aid, str) and aid and aid not in trusted and isinstance(result, dict),
                "trusted_assignment_invalid")
        if result.get("status") == "exact":
            require(isinstance(result.get("providerId"), str) and result["providerId"], "trusted_result_invalid")
        else:
            require(result.get("status") == "unresolved" and bool(result.get("reason"))
                    and "providerId" not in result, "trusted_result_invalid")
        trusted[aid] = record
    exact = {}
    for record in trusted.values():
        if record["result"]["status"] == "exact":
            pid = record["result"]["providerId"]
            require(pid not in exact, "trusted_provider_id_shared")
            exact[pid] = record
    require(len(records) == len(trusted) == 20, "trusted_assignment_count_invalid")
    require(len(exact) in {18, 20}, "trusted_resolution_count_changed")
    unresolved = [r for r in trusted.values() if r["result"]["status"] == "unresolved"]
    require(all(r.get("kind") == "cms_home_health_office" for r in unresolved), "trusted_unresolved_identity_invalid")
    summary = manifest.get("summary", {})
    require(summary.get("assignments") == 20 and summary.get("exact") == len(exact)
            and summary.get("unresolved") == 20 - len(exact), "trusted_summary_invalid")
    assigned = unique_json((path / "assigned.json").read_text("utf-8"))
    catalog = [r for _, _, r in parse_csv((path / "kit.csv").read_text("utf-8"), KIT_COLUMNS)]
    require(assigned == {"providerIds": sorted(exact),
                         "geography": {"state": "NJ", "zips": sorted({r["zip"] for r in catalog})}},
            "trusted_allowlist_invalid")
    require(len(catalog) == len(exact) == len({r["provider_id"] for r in catalog}), "trusted_catalog_count_invalid")
    for row in catalog:
        require(row["assignment_id"] in trusted
                and trusted[row["assignment_id"]]["result"].get("providerId") == row["provider_id"],
                "trusted_catalog_id_disagreement")
    importer = (ROOT / "src/lib/research-pipeline/import.ts").read_text("utf-8")
    headers = {}
    for name, constant in (("observations.csv", "OBSERVATION_COLUMNS"), ("coverage.csv", "COVERAGE_COLUMNS")):
        match = re.search(rf"export const {constant} = \[(.*?)\] as const;", importer, re.S)
        require(match is not None, "trusted_template_invalid")
        expected = re.findall(r'"([a-z_]+)"', match.group(1))
        body = (path / name).read_text("utf-8")
        require(len(body.splitlines()) == 1 and next(csv.reader(io.StringIO(body))) == expected,
                "trusted_template_invalid")
        headers[name] = expected
    hashes = {name: hashlib.sha256((path / name).read_bytes()).hexdigest() for name in names}
    provenance = {"sourceKitSummary": dict(summary),
                  "policy": "kit_supplied_allowlist_internal_consistency_status_drives_actionable_vs_blocked"}
    return trusted, exact, headers, hashes, provenance


def git_body(commit, name):
    require(bool(re.fullmatch(r"[0-9a-f]{40}", commit)), "commit_must_be_full_hash")
    result = subprocess.run(["git", "-C", str(ROOT), "show", f"{commit}:{BATCH}/{name}"],
                            capture_output=True)
    require(result.returncode == 0, "git_object_unavailable")
    return result.stdout.decode("utf-8")


def manifest_rows(body):
    value = unique_json(body)
    require(isinstance(value, dict) and set(value) == {
        "run_id", "protocol_version", "selection_method", "providers"}, "batch_manifest_shape_invalid")
    require(value["run_id"] == RUN and isinstance(value["protocol_version"], str)
            and isinstance(value["selection_method"], str), "batch_manifest_run_invalid")
    require(isinstance(value["providers"], list), "batch_manifest_providers_invalid")
    match = re.search(r'"providers"\s*:\s*\[', body)
    require(match is not None, "batch_manifest_providers_invalid")
    cursor = match.end()
    rows = []
    decoder = json.JSONDecoder()
    for provider in value["providers"]:
        require(isinstance(provider, dict) and set(provider) == set(PROVIDER_COLUMNS)
                and all(isinstance(v, str) for v in provider.values()), "batch_provider_shape_invalid")
        cursor = re.compile(r"[\s,]*").match(body, cursor).end()
        parsed, end = decoder.raw_decode(body, cursor)
        require(parsed == provider, "batch_provider_location_invalid")
        rows.append((body.count("\n", 0, cursor) + 1, body.count("\n", 0, end) + 1, provider))
        cursor = end
    return rows


def identity(aid, claimed, trusted, exact):
    if aid not in trusted:
        return "", ["unknown_assignment_id"]
    result = trusted[aid]["result"]
    if result["status"] != "exact":
        return "", ["trusted_identity_unresolved"]
    pid = result["providerId"]
    if claimed and (claimed not in exact or claimed != pid):
        return "", ["provider_id_disagreement"]
    return pid, []


def reconcile(trusted, exact, headers, bodies):
    assignments = parse_csv(bodies["assignments.csv"], ASSIGNMENT_COLUMNS)
    providers = manifest_rows(bodies["batch-manifest.json"])
    coverage = parse_csv(bodies["coverage.csv"], headers["coverage.csv"])
    observations = parse_csv(bodies["observations.csv"], headers["observations.csv"])
    aggregates = parse_csv(bodies["aggregate-candidates.csv"], AGGREGATE_COLUMNS)
    supplied = parse_csv(bodies["supplied-first-facility-assignments.csv"], SUPPLIED_COLUMNS)
    require(assignments and len(assignments) <= 20, "batch_assignment_count_invalid")
    by_assignment = {r["assignment_id"]: r for _, _, r in assignments}
    require(len(by_assignment) == len(assignments), "duplicate_assignment_id")
    require(len(providers) == len(assignments), "batch_manifest_count_disagreement")
    require(len(coverage) == len(assignments), "coverage_count_disagreement")
    supplied_ids = [r["assignment_id"] for _, _, r in supplied]
    licensed_ids = {aid for aid, a in trusted.items() if a["kind"] == "licensed_care_unit"}
    require(len(supplied_ids) == len(set(supplied_ids)) and set(supplied_ids) == licensed_ids,
            "supplied_assignment_set_invalid")
    for _, _, row in supplied:
        require(row["assignment_id"] in by_assignment
                and all(by_assignment[row["assignment_id"]][k] == row[k] for k in SUPPLIED_COLUMNS),
                "supplied_assignment_disagreement")
    source_ids = {}
    manifest_by_assignment = {}
    for _, _, row in providers:
        aid, sid = row["assignment_id"], row["provider_id"]
        require(aid in by_assignment and aid not in manifest_by_assignment, "batch_manifest_assignment_invalid")
        require(sid and sid not in source_ids, "batch_manifest_provider_duplicate")
        expected_pid = trusted.get(aid, {}).get("result", {}).get("providerId")
        require(sid == aid or sid == expected_pid, "batch_manifest_provider_id_disagreement")
        a = by_assignment[aid]
        for mk, ak in [("name", "licensed_name"), ("address", "address_as_published"),
                       ("municipality", "municipality"), ("zip", "zip"), ("county", "county"),
                       ("harbor_id", "harbor_id"), ("care_setting", "care_setting"),
                       ("care_unit", "care_unit"), ("licensed_care_setting", "licensed_care_setting")]:
            require(row[mk] == a[ak], "batch_manifest_identity_disagreement")
        require(row["state"] == "NJ" and row["market"] == row["county"].lower()
                and row["county"] in {"Union", "Morris"}, "batch_manifest_geography_invalid")
        source_ids[sid] = aid
        manifest_by_assignment[aid] = row
    coverage_by_source = {}
    for _, _, row in coverage:
        sid = row["provider_id"]
        require(sid in source_ids and sid not in coverage_by_source, "coverage_link_invalid")
        require(row["run_id"] == RUN, "coverage_run_invalid")
        require(row["status"] in COVERAGE_STATUSES, "coverage_status_invalid")
        require(bool(re.fullmatch(r"0|[1-9][0-9]*", row["observations_found"])), "coverage_observation_count_invalid")
        for key in ("queries_used", "sources_checked"):
            value = unique_json(row[key])
            require(isinstance(value, list), "coverage_array_invalid")
        coverage_by_source[sid] = row
    observation_ids = [r["observation_id"] for _, _, r in observations]
    require(all(observation_ids) and len(set(observation_ids)) == len(observation_ids), "observation_id_invalid")
    linked_counts = Counter(r["provider_id"] for _, _, r in observations if r["provider_id"])
    for _, _, row in observations:
        require(row["run_id"] == RUN, "observation_run_invalid")
        require(not row["provider_id"] or row["provider_id"] in coverage_by_source, "observation_coverage_link_invalid")
        require(row["match_status"] in MATCH_STATUSES, "observation_match_status_invalid")
        require(row["use_status"] == "internal_review_pending" and row["needs_human_review"] == "true",
                "observation_private_review_contract_invalid")
        require(not row["duplicate_of"] or (row["duplicate_of"] in observation_ids
                and row["duplicate_of"] != row["observation_id"]), "observation_duplicate_link_invalid")
    for _, _, row in aggregates:
        require(not row["review_count"] or bool(re.fullmatch(r"0|[1-9][0-9]*", row["review_count"])),
                "aggregate_count_invalid")
        require(all(not row[k] or re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", row[k])
                    for k in ("rating_value", "rating_scale")), "aggregate_numeric_shape_invalid")
    ledger = []
    decisions = {}
    canonical_ids = {}
    for first, last, row in assignments:
        aid = row["assignment_id"]
        canonical = aid
        if aid not in trusted and row["source_type"] == "cms_care_compare" and row["care_setting"] == "home_health":
            # A collector-local ID can identify a certified office via its official CCN and complete address.
            ccn = row["source_identifier"]
            target = trusted.get("nj-hha-" + ccn, {})
            full_address = "{address}, {municipality}, NJ {zip}".format(**target) if target else ""
            if (target.get("kind") == "cms_home_health_office" and row["license"] == ccn
                    and target["result"]["status"] == "exact"
                    and row["address_as_published"].casefold() == full_address.casefold()
                    and row["municipality"].casefold() == target["municipality"].casefold()
                    and row["zip"] == target["zip"] and row["county"] == target["county"]):
                canonical = target["assignmentId"]
        canonical_ids[aid] = canonical
        pid, reasons = identity(canonical, row["harbor_id"], trusted, exact)
        if pid and canonical != aid:
            pid, reasons = identity(canonical, manifest_by_assignment[aid]["harbor_id"], trusted, exact)
        elif pid:
            a = trusted[aid]
            for source, target in [("nj_facility_id", "officialId"), ("license", "license"),
                                   ("licensed_name", "name"), ("address_as_published", "address"),
                                   ("municipality", "municipality"), ("zip", "zip"),
                                   ("county", "county"), ("licensed_care_setting", "setting")]:
                if target in a and row[source] != a[target]:
                    reasons.append("assignment_" + target + "_mismatch")
            mpid, mreasons = identity(aid, manifest_by_assignment[aid]["harbor_id"], trusted, exact)
            if mpid != pid:
                reasons.extend(mreasons or ["provider_id_disagreement"])
        decisions[aid] = (pid if not reasons else "", reasons)
        ledger.append(entry("assignments.csv", first, last, len(ledger) + 1, aid,
                            pid if not reasons else "", "identity_only" if not reasons else "quarantine", reasons))
    accepted_assignments = {aid for aid, (pid, reasons) in decisions.items() if pid and not reasons}
    accepted_coverage = set()
    for name, rows in [("supplied-first-facility-assignments.csv", supplied),
                       ("batch-manifest.json", providers), ("coverage.csv", coverage),
                       ("observations.csv", observations), ("aggregate-candidates.csv", aggregates)]:
        for number, (first, last, row) in enumerate(rows, 1):
            sid = row.get("provider_id", "")
            aid = row.get("assignment_id", "") if "assignment_id" in row \
                else source_ids.get(sid, "")
            if name == "aggregate-candidates.csv":
                require(aid in by_assignment, "aggregate_assignment_link_invalid")
                pid, reasons = identity(canonical_ids[aid], row["harbor_id"], trusted, exact)
                if aid not in accepted_assignments:
                    pid, reasons = "", decisions[aid][1]
            else:
                pid, reasons = decisions.get(aid, ("", ["unassigned_observation"]))
            reasons = list(reasons)
            if sid and sid == aid:
                reasons.append("source_uses_assignment_id_namespace")
            disposition = "identity_only" if pid else "quarantine"
            if name == "coverage.csv":
                if pid:
                    accepted_coverage.add(aid)
                if int(row["observations_found"]) != linked_counts[sid]:
                    reasons.append("declared_observation_count_not_exactly_linked")
            elif name == "observations.csv":
                disposition = "private_review_only" if pid and row["match_status"] == "exact" else "quarantine"
                if row["match_status"] != "exact":
                    reasons.append("observation_match_not_exact")
                if pid:
                    reasons.append("content_not_reviewed")
            elif name == "aggregate-candidates.csv":
                disposition = "excluded"
                reasons.append("aggregate_not_eligible_for_publication_or_scoring")
            status = row.get("status", row.get("match_status", ""))
            ledger.append(entry(name, first, last, number, aid, pid, disposition, reasons, status,
                                int(row["observations_found"]) if name == "coverage.csv" else "",
                                linked_counts[sid] if name == "coverage.csv" else ""))
    accepted = {canonical_ids[aid] for aid in accepted_assignments & accepted_coverage}
    followups = [scope(a) for aid, a in trusted.items() if aid not in accepted]
    summary = {
        "trustedAssignments": len(trusted), "trustedExact": len(exact),
        "batchAssignments": len(assignments), "coverageRows": len(coverage),
        "suppliedAssignmentRows": len(supplied), "manifestProviderRows": len(providers),
        "observationRows": len(observations), "aggregateRows": len(aggregates),
        "acceptedAssignmentAndCoverageIds": len(accepted),
        "followups": len(followups),
        "actionableFollowups": sum(a["status"] == "actionable" for a in followups),
        "blockedFollowups": sum(a["status"] == "blocked" for a in followups),
        "coverageCountDiscrepancies": sum("declared_observation_count_not_exactly_linked" in r["reasons"] for r in ledger),
        "unassignedObservationRows": sum(not r["provider_id"] for _, _, r in observations),
    }
    contexts = {
        "nj-u-08": ("campus_unit_confusion", ["nj-campus-lantern-hill"]),
        "nj-u-09": ("office_address_and_registration_discrepancy", ["nj-hha-317020", "nj-reg-HP0015347"]),
        "nj-u-10": ("unassigned_union_office_substitution", ["nj-reg-HP0254700", "nj-reg-HP0364600"]),
        "nj-m-09": ("blocked_cms_office_local_id_not_trusted", ["nj-hha-317002"]),
        "nj-m-10": ("office_address_and_organization_discrepancy", ["nj-reg-HP0414500"]),
    }
    identity_metadata = []
    for aid, (reason, related) in contexts.items():
        if aid not in by_assignment or canonical_ids[aid] != aid:
            continue
        row = by_assignment[aid]
        metadata = {k: row[k] for k in ["licensed_name", "address_as_published", "municipality", "zip", "license"]}
        require(all(len(v) <= 300 and not re.search(r"[\r\n]|https?://", v, re.I)
                    for v in metadata.values()), "organization_metadata_invalid")
        identity_metadata.append({"sourceAssignmentId": aid, "reason": reason,
                                  "organizationIdentityMetadata": metadata,
                                  "trustedScopeContextNotMapping": [scope(trusted[k]) for k in related]})
    return {"summary": summary, "acceptedAssignmentIds": sorted(accepted), "ledger": ledger,
            "followups": followups, "identityMismatches": identity_metadata}


def entry(name, first, last, number, aid, pid, disposition, reasons, status="", declared="", linked=""):
    require(disposition in DISPOSITIONS and set(reasons) <= REASONS, "ledger_enum_invalid")
    require(not status or status in COVERAGE_STATUSES | MATCH_STATUSES, "ledger_status_invalid")
    safe_aid = aid if re.fullmatch(r"nj-(?:doh-[A-Za-z0-9]+|[um]-[0-9]+|reg-HP[0-9]+|hha-[0-9]+|campus-[a-z-]+)", aid) else ""
    return dict(zip(LEDGER_COLUMNS, [name, first, last, number, safe_aid, pid, disposition,
                                    sorted(set(reasons)), status, declared, linked]))


def scope(a):
    result = a["result"]
    return {"assignmentId": a["assignmentId"], "providerId": result.get("providerId", ""),
            "status": "actionable" if result["status"] == "exact" else "blocked",
            "reason": "missing_accepted_assignment_and_coverage" if result["status"] == "exact" else result["reason"],
            "name": a["name"], "kind": a["kind"], "setting": a["setting"],
            "address": a["address"], "municipality": a["municipality"], "zip": a["zip"],
            "officialId": a.get("officialId", ""), "license": a.get("license", "")}


def followup_prompt(followups):
    lines = [
        "# Private Facebook follow-up assignment",
        "",
        "Research only the actionable exact provider IDs below. The blocked records are context, not search assignments.",
        "Do not invent IDs, substitute a brand, infer a service area, or map a name or address to an ID.",
        "Confirm the exact office, campus, or licensed unit before retaining a candidate.",
        "Lantern Hill campus is 535 Mountain Avenue, not the care units at 537.",
        "Keep the Oaks at Denville assisted-living unit at 19 Pocono Road separate from nursing at 21.",
        "Keep BAYADA Morristown registration HP0015347 separate from Cranford CMS agency 317020.",
        "Do not substitute Visiting Angels offices for the assigned Union registrations or CSS Morris office.",
        "",
        "## Actionable exact kit assignments",
        "",
    ]
    for a in followups:
        if a["status"] == "actionable":
            official = f" Official ID {a['officialId']}." if a["officialId"] else ""
            lines.append(f"- `{a['assignmentId']}` -> `{a['providerId']}`. {a['name'].rstrip('.')}. "
                         f"{a['setting']}. {a['address']}, {a['municipality']}, NJ {a['zip']}."
                         + official)
    lines += ["", "## Blocked records, do not research or import", ""]
    blocked = [a for a in followups if a["status"] == "blocked"]
    if not blocked:
        lines.append("None under the current kit.")
    for a in blocked:
        lines.append(f"- `{a['assignmentId']}`. {a['name'].rstrip('.')}. {a['address']}, {a['municipality']}, NJ {a['zip']}. "
                     f"CCN {a['officialId']}. {a['reason']}. No allowlisted provider ID.")
    lines += [
        "", "## Verify existing leads", "",
        "Open the live pages for VNA of Northern New Jersey (reported 4.0/5 from 10) and Atria Cranford (reported 4.9/5 from 18). Record the location, permalink, check date, scale and count only if visible.",
        "Recheck the original Lantern Hill outage thread and Arbor Terrace nested reply if publicly accessible. Keep inaccessible and ambiguous claims as leads.",
        "", "## Required private output contract", "",
        "Use the trusted kit.csv identity rows and the unchanged kit observations.csv and coverage.csv headers.",
        "Return assignments.csv with exact assignment_id and provider_id pairs from the actionable list.",
        "Return one coverage.csv row per actionable provider_id, including zero findings and access limits.",
        "Use one run_id, UTC search dates, JSON arrays for queries_used and sources_checked, and explicit observation counts.",
        "Every assigned observation must link to that provider's coverage row. Leave ambiguous unit matches unassigned.",
        "Use stable observation IDs. Mark every observation internal_review_pending with needs_human_review=true.",
        "Inspect only permitted public underlying sources. Search snippets are leads, not evidence.",
        "Do not enter private groups, bypass access controls, contact anyone, or retain personal or medical identifiers.",
        "Keep tours, promotions, staff accounts, and provider-selected testimonials distinct from post-care family accounts.",
        "Record uncertainty and duplicate candidates. Do not infer independence from separate posts.",
        "Retain source links, neutral paraphrases, and any necessary evidence only in authorized private storage.",
        "Do not print raw content, social URLs, excerpts, or reviewer names in terminal output or the handoff.",
        "Return a separate redacted handoff with counts, exact IDs, coverage outcomes, and unresolved identity reasons.",
        "Keep rating candidates separate for eligibility review. Do not derive ratings, score providers, or publish anything.",
        "Do not update application data, create a PR, commit, or change branches.",
        "",
    ]
    return "\n".join(lines)


def build(commit=COMMIT, kit=KIT):
    trusted, exact, headers, hashes, provenance = load_kit(kit)
    names = ["assignments.csv", "supplied-first-facility-assignments.csv", "batch-manifest.json",
             "coverage.csv", "observations.csv", "aggregate-candidates.csv"]
    bodies = {name: git_body(commit, name) for name in names}
    report = reconcile(trusted, exact, headers, bodies)
    report.update({"schemaVersion": 1, "commit": commit, "batchPath": BATCH,
                   "publication": "none", "acceptance": "identity_and_coverage_scope_only_not_content_or_import",
                   "trustedArtifactSha256": hashes,
                   "trustedValidation": provenance,
                   "ledgerContract": {"dispositions": sorted(DISPOSITIONS), "reasons": sorted(REASONS)},
                   "sourceArtifactSha256": {n: hashlib.sha256(b.encode()).hexdigest() for n, b in bodies.items()}})
    ledger = report["ledger"]
    scopes = report["followups"]
    return {
        "audit.json": encode(report),
        "row-audit.csv": csv_text(LEDGER_COLUMNS, [[json.dumps(r[k], separators=(",", ":"))
                                                  if k == "reasons" else r[k] for k in LEDGER_COLUMNS] for r in ledger]),
        "followup-assignments.json": encode({"publication": "none", "assignments": scopes}),
        "followup-assignments.csv": csv_text(list(scopes[0]) if scopes else ["assignmentId"],
                                            [list(a.values()) for a in scopes]),
        "followup-agent-prompt.md": followup_prompt(scopes),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", default=COMMIT)
    parser.add_argument("--kit", type=Path, default=KIT)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true", help="Compare deterministic redacted outputs without writing.")
    args = parser.parse_args(argv)
    try:
        require(args.output.resolve().is_relative_to(OUTPUT.resolve()), "output_outside_private_reconciliation")
        require(not OUTPUT.is_symlink() and not args.output.is_symlink(), "output_symlink_forbidden")
        files = build(args.commit, args.kit)
        if args.check:
            require(all((args.output / name).is_file() and not (args.output / name).is_symlink()
                        and (args.output / name).read_text("utf-8") == content for name, content in files.items()),
                    "redacted_outputs_stale")
        else:
            require(all(not (args.output / name).is_symlink() for name in files), "output_symlink_forbidden")
            args.output.mkdir(parents=True, exist_ok=True)
            for name, content in files.items():
                target = args.output / name
                if not target.exists() or target.read_text("utf-8") != content:
                    target.write_text(content, encoding="utf-8", newline="")
        summary = json.loads(files["audit.json"])["summary"]
        print(json.dumps(summary, sort_keys=True))
        if summary["coverageCountDiscrepancies"]:
            print("facebook-batch: source_counts_unverifiable_private_import_blocked", file=sys.stderr)
            return 2
        return 0
    except Invalid as error:
        print("facebook-batch: " + str(error), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, csv.Error, subprocess.SubprocessError):
        print("facebook-batch: input_or_output_invalid", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
