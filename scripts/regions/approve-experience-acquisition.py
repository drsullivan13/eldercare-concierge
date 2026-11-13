#!/usr/bin/env python3
"""Compile immutable reviewed acquisition batches into canonical release inputs."""

import argparse
import copy
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("acquisition_release", ROOT / "scripts/regions/release-reviews.py")
release = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = release
spec.loader.exec_module(release)
BASE = release.ACQUISITION
ARCHIVE = BASE / "wave-two"
INDEX = ARCHIVE / "batches.json"
ALIASES = release.RELEASE / "identity-corroboration.json"


def build(root=ROOT):
    inputs = release.Inputs(root)
    index = inputs.json(str(INDEX))
    release.fields(index, "schemaVersion baselineAliases batches", "immutable batch index")
    release.require(index["schemaVersion"] == 1 and isinstance(index["batches"], list),
                    "Malformed immutable batch index")

    def bound(reference):
        data = inputs.bound(reference)
        release.require(Path(reference["path"]).is_relative_to(ARCHIVE),
                        "Immutable inputs must stay inside wave-two")
        return release.parse_json(data)

    aliases = bound(index["baselineAliases"])
    outputs, batches, seen_ids, seen_providers, batch_ids = {}, [], set(), set(), set()
    documents = [(reference, bound(reference)) for reference in index["batches"]]
    for batch_reference, batch in sorted(documents, key=lambda item: item[1]["id"]):
        bid = batch["id"]
        release.require(isinstance(bid, str) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", bid)
                        and bid not in batch_ids, "Duplicate or invalid immutable batch ID")
        batch_ids.add(bid)
        mode = batch["mode"]
        release.require(mode in ("released", "reviewed"), "Unknown immutable batch mode")
        decisions = bound(batch["reviewed"])
        proposals_document = bound(batch["proposals"])
        proposals = (proposals_document["batches"][0]["approvals"] if mode == "released"
                     else proposals_document["approvals"])
        if mode == "released":
            release.require(len(proposals_document["batches"]) == 1
                            and proposals_document["batches"][0]["id"] == bid
                            and proposals_document["batches"][0]["assessmentDate"] == decisions["assessmentDate"],
                            "Archived release batch identity mismatch")
        by_id = {a["providerId"]: a for a in proposals}
        release.require(len(by_id) == len(proposals), "Duplicate immutable proposal")
        access_rows = bound(batch["access"])
        release.require(any(r.get("propertyPathAllowed") is True and r.get("httpStatus") == 200
                            for r in access_rows)
                        and any(r.get("decision") == "permitted_low_volume" and r.get("httpStatus") == 200
                                for r in access_rows)
                        and all(r["checkedAt"] == decisions["assessmentDate"] for r in access_rows),
                        "Collection access assessment is not permitted for this batch")
        approved_ids = [values[1] for values in decisions["approvals"]]
        withheld_ids = [row["providerId"] for row in decisions.get("withheld", [])]
        release.require(len(set(approved_ids + withheld_ids)) == len(approved_ids + withheld_ids)
                        and set(approved_ids + withheld_ids) == set(by_id),
                        "Duplicate or unreviewed immutable proposal")
        batch_aliases = bound(batch["aliases"])["locations"] if mode == "reviewed" else []
        receipts, approvals = [], []
        directory = ARCHIVE / "compiled" / bid
        receipt_path = directory / "collector-receipts.json"
        for values in decisions["approvals"]:
            release.require(len(values) == len(decisions["columns"]), "Malformed direct review")
            row = dict(zip(decisions["columns"], values))
            pid, slug = row["providerId"], row["slug"]
            proposal = by_id[pid]
            release.require(pid not in seen_providers and proposal["id"] not in seen_ids,
                            "Duplicate acquisition approval across immutable batches")
            seen_providers.add(pid)
            seen_ids.add(proposal["id"])
            release.require(proposal["url"].endswith("/" + slug), "Direct review URL mismatch")
            source_reference = batch["sources"][slug]
            source_document = bound(source_reference)
            evidence = [source_reference, batch["access"], batch_reference,
                        batch["proposals"], batch["reviewed"]]
            if mode == "released":
                source = release.receipt_at(source_document, proposal["observation"]["pointer"])
                original_check_reference = batch["checks"][slug]
                original_check = bound(original_check_reference)
                release.require(source_reference["sha256"] == proposal["observation"]["sha256"]
                                and original_check_reference["sha256"] == proposal["material"]["sha256"]
                                and any(ref["sha256"] == batch["reviewed"]["sha256"]
                                        for ref in original_check["evidence"])
                                and source["providerId"] == pid
                                and source["officialId"] == proposal["officialId"]
                                and source["access_decision"] == "permitted_low_volume",
                                "Archived inputs disagree with original release hashes or identity")
                release.require(source == {**original_check, "evidence": source["evidence"]},
                                "Archived independent reading disagrees with released receipt")
                evidence.append(original_check_reference)
                collected_sample = source["reviewSample"]
            else:
                source = source_document
                release.require(source["scopeHold"] is None, "Direct review has an unresolved source hold")
                collected_sample = {
                    "sourceFamily": source["aggregate"]["sourceFamily"],
                    "selection": "all-visible-before-highlighting",
                    "visibleCount": source["population"]["visibleCount"],
                    "observations": [{key: item[key] for key in ("id", "date", "sentiment")}
                                     for item in source["population"]["rows"]],
                }
                identity_reference = batch["identities"][slug]
                identity_check = bound(identity_reference)
                proof = [a for a in batch_aliases if a["providerId"] == pid
                         and a["officialId"] == proposal["officialId"]]
                release.require(len(proof) == 1 and proof[0]["sourceUrl"] == identity_check["sourceUrl"]
                                and identity_check["httpStatus"] == 200
                                and identity_check["inspection"] == "full-page"
                                and identity_check["checkedAt"] == decisions["assessmentDate"]
                                and identity_check["matchedPublishedFacts"],
                                "Missing independently witnessed care-unit alias")
                alias = {**proof[0], "receipt": identity_reference}
                aliases.append(alias)
                evidence.extend([identity_reference, batch["aliases"]])
            release.require(source["inspection"] == "full-page" and source["httpStatus"] == 200
                            and source["checkedAt"] == proposal["checkedAt"] == decisions["assessmentDate"]
                            and source["url"] == proposal["url"],
                            "Direct review retrieval mismatch")
            identity = {key: row[key] for key in ("name", "address", "city", "careUnit")}
            identity.update(state="New Jersey", zip=None)
            aggregate = dict(rating=row["rating"], count=row["count"], scale=5, asOf=None,
                             scope="consumer", sourceFamily="google")
            sample = {
                "sourceFamily": "google", "selection": "all-visible-before-highlighting",
                "visibleCount": len(row["rows"]),
                "observations": [{"id": "mlc-google-" + item[0], "date": item[1], "sentiment": item[2]}
                                 for item in row["rows"]],
            }
            release.require(identity == source["identity"] == proposal["identity"]
                            and aggregate == source["aggregate"] == proposal["aggregate"]
                            and sample == collected_sample,
                            "Independent source reading disagrees with collection")
            common = {
                "providerId": pid, "officialId": proposal["officialId"], "url": source["url"],
                "platform": "MyLivingChoice", "sourceType": "review-platform",
                "inspection": "full-page", "httpStatus": 200, "checkedAt": decisions["assessmentDate"],
                "access_decision": "permitted_low_volume",
            }
            receipt = {**common, "identity": source["identity"], "aggregate": source["aggregate"],
                       "reviewSample": collected_sample, "evidence": evidence}
            check = {**common, "identity": identity, "aggregate": aggregate,
                     "reviewSample": sample, "evidence": evidence}
            check_path = directory / f"independent-checks/{slug}.json"
            outputs[check_path] = release.encoded(check)
            approval = copy.deepcopy(proposal)
            approval["observation"] = {"pointer": f"/receipts/{len(receipts)}"}
            approval["material"] = {"path": str(check_path), "sha256": release.digest(outputs[check_path])}
            if mode == "reviewed":
                approval["reason"] = (
                    "Second-wave reviewer read the original full-page witness, About and every visible "
                    "Google row before highlighting. Independent published facility/office identity "
                    "corroborates the unique official care unit. Original Google mean and count remain "
                    "unchanged. All visible dates and sentiments, including critical and mixed rows, "
                    "accompany the aggregate. This is a platform-selected window, not all ratings or "
                    "a verified resident survey. Visitors and tours can appear. Reviewer identities "
                    "are not verified. Observed ZIP and aggregate publication date remain unknown. "
                    + decisions.get("populationNotes", {}).get(slug, "")
                ).strip()
            receipts.append(receipt)
            approvals.append(approval)
        outputs[receipt_path] = release.encoded({"receipts": receipts})
        for approval in approvals:
            approval["observation"].update(path=str(receipt_path),
                                           sha256=release.digest(outputs[receipt_path]))
        batches.append({"id": bid, "assessmentDate": decisions["assessmentDate"], "approvals": approvals})
    alias_keys = [(a["providerId"], release.token(a["listingName"])) for a in aliases]
    release.require(len(set(alias_keys)) == len(alias_keys), "Duplicate immutable care-unit alias")
    outputs[ALIASES] = release.encoded(aliases)
    outputs[release.ACQUISITION_LEDGER] = release.encoded({"schemaVersion": 1, "batches": batches})
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        outputs = build()
        for path, data in outputs.items():
            target = ROOT / path
            if args.check:
                release.require(target.is_file() and target.read_bytes() == data,
                                f"Acquisition input drift: {path}")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        count = sum(len(batch["approvals"]) for batch in
                    release.parse_json(outputs[release.ACQUISITION_LEDGER])["batches"])
        print(f"{'Verified' if args.check else 'Compiled'} {count} approvals from immutable batches.")
        return 0
    except (release.ReleaseError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"acquisition approval failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
