"""Release exact-provider supplemental facts through the existing research contract."""

import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from contextlib import redirect_stdout


ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = "supplemental-release"
SOURCES = ("home-care-first-party", "association-directory", "nppes-organizations", "campus-offerings")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def empty_record(pid):
    return {
        "providerId": pid, "checkedAt": None, "providerDetailsReviewed": False,
        "sources": [], "facts": [], "reviewAggregates": [], "reviews": [], "notes": [],
        "availability": {
            "status": "not-published", "text": "Current availability is not verified. Contact the provider.",
            "sourceId": None, "asOf": None,
        },
    }


def merge_research(baseline, patches):
    result = deepcopy(baseline)
    for pid, patch in sorted(patches.items()):
        require(patch["providerId"] == pid, f"Supplemental provider mismatch: {pid}")
        require(not patch.get("reviews") and not patch.get("reviewAggregates")
                and not patch.get("reviewSamples"), f"Supplemental review evidence is forbidden: {pid}")
        target = result.setdefault(pid, empty_record(pid))
        for collection in ("sources", "facts"):
            indexed = {item["id"]: item for item in target[collection]}
            require(len(indexed) == len(target[collection]), f"Duplicate {collection}: {pid}")
            for item in patch[collection]:
                previous = indexed.get(item["id"])
                require(previous is None or previous == item,
                        f"Conflicting supplemental {collection} ID: {pid}/{item['id']}")
                if previous is None:
                    target[collection].append(deepcopy(item))
                    indexed[item["id"]] = item
        source_ids = {item["id"] for item in target["sources"]}
        require(all(fact["sourceId"] in source_ids for fact in target["facts"]),
                f"Supplemental fact has no source: {pid}")
        for note in patch["notes"]:
            if note not in target["notes"]:
                target["notes"].append(note)
        for field in ("availability", "admissionRestriction"):
            incoming = patch.get(field)
            if incoming and incoming.get("sourceId"):
                require(incoming["sourceId"] in source_ids, f"Unknown {field} source: {pid}")
                current = target.get(field)
                if current and current.get("sourceId") and current != incoming:
                    note = f"Additional source-reported {field}: {incoming['text']}"
                    if note not in target["notes"]:
                        target["notes"].append(note)
                    fact = {
                        "id": f"supplemental-{field}-{incoming['sourceId']}",
                        "kind": "availability" if field == "availability" else "care",
                        "text": note, "sourceId": incoming["sourceId"],
                    }
                    existing = next((item for item in target["facts"] if item["id"] == fact["id"]), None)
                    require(existing is None or existing == fact, f"Conflicting {field} assertion: {pid}")
                    if existing is None:
                        target["facts"].append(fact)
                else:
                    target[field] = deepcopy(incoming)
        dates = [value for value in (target["checkedAt"], patch["checkedAt"]) if value]
        target["checkedAt"] = max(dates) if dates else None
        target["providerDetailsReviewed"] |= patch["providerDetailsReviewed"]
    return result


def load_release(inputs, records, roster, counties):
    path = f"{DIRECTORY}/manifest.json"
    if not (inputs.root / path).exists():
        require(not (inputs.root / DIRECTORY).exists(),
                "Supplemental artifacts exist without a verified manifest")
        return records
    require((inputs.root / path).resolve().is_relative_to(inputs.root.resolve()),
            "Supplemental source escapes research root")
    manifest = inputs.json(path)
    require(manifest["schemaVersion"] == 1 and manifest["status"] == "verified",
            "Supplemental release is not verified")
    require(set(manifest["sources"]) == set(SOURCES), "Supplemental source roster changed")
    snapshot_path = f"{DIRECTORY}/public-snapshot.json"
    public = (inputs.root / snapshot_path).exists()
    require(public or set(manifest["outputs"]) == {"locationResearch.json"},
            "Supplemental public snapshot is required for the compact release")
    if public:
        require((inputs.root / snapshot_path).resolve().is_relative_to(inputs.root.resolve()),
                "Supplemental source escapes research root")
        snapshot = inputs.json(snapshot_path)
        require(snapshot["schemaVersion"] == 1 and snapshot["status"] == "reviewed-public-snapshot",
                "Supplemental public snapshot is not reviewed")
        require(hashlib.sha256(inputs.read(path)).hexdigest() == snapshot["releaseManifestSha256"],
                "Supplemental public snapshot manifest mismatch")
        require(set(manifest["outputs"]) == {
            "locationResearch.json", "coverage.json", "first-party-upgrades.json",
            "source-verification.json",
        }, "Supplemental public output roster changed")
    for relative, expected in manifest["inputs"].items():
        require(not Path(relative).is_absolute()
                and (inputs.root / relative).resolve().is_relative_to(inputs.root.resolve()),
                "Supplemental source escapes research root")
        require(isinstance(expected, str) and len(expected) == 64
                and all(char in "0123456789abcdef" for char in expected),
                f"Invalid supplemental evidence hash: {relative}")
        if not public:
            require(hashlib.sha256(inputs.read(relative)).hexdigest() == expected,
                    f"Supplemental input changed: {relative}. Rebuild supplemental release.")
    outputs = {}
    for name, expected in manifest["outputs"].items():
        relative = f"{DIRECTORY}/{name}"
        require(Path(name).name == name
                and (inputs.root / relative).resolve().is_relative_to(inputs.root.resolve()),
                "Supplemental source escapes research root")
        body = inputs.read(relative)
        require(hashlib.sha256(body).hexdigest() == expected,
                f"Supplemental release hash mismatch: {name}")
        outputs[name] = json.loads(body)
    patches = outputs["locationResearch.json"]
    identities = manifest["identities"]
    require(set(patches) == set(identities), "Supplemental identity roster mismatch")
    if public:
        report = outputs["coverage.json"]
        require(report["sources"] == manifest["sources"]
                and report["combined"]["providerIds"] == sorted(patches)
                and report["combined"]["uniqueProviders"] == len(patches)
                and {pid for source in manifest["sources"].values() for pid in source["providerIds"]}
                == set(patches), "Supplemental coverage roster mismatch")
    validator = module(ROOT / "scripts/regions/build-region.py", "supplemental_public_validator")
    selected = {}
    for pid, patch in patches.items():
        require(pid in roster, f"Unknown supplemental provider: {pid}")
        require(patch["providerId"] == pid, f"Supplemental provider mismatch: {pid}")
        validator.LOCATION(patch, f"supplemental.{pid}")
        for collection in ("sources", "facts"):
            require(len({item["id"] for item in patch[collection]}) == len(patch[collection]),
                    f"Duplicate supplemental {collection}: {pid}")
        row = roster[pid]
        identity = identities[pid]
        require(identity == {
            "name": row["name"], "category": row["setting"],
            **row["suppliedAddress"],
        }, f"Supplemental identity changed: {pid}")
        if row["county"] in counties:
            selected[pid] = patch
    merge_research({}, patches)
    return merge_research(records, selected)


def coverage(records, baseline, providers):
    categories = {p["id"]: p["category"] for p in providers}
    fresh = set(records) - set(baseline)
    return {
        "uniqueProviders": len(records),
        "providersByType": dict(sorted(Counter(categories[pid] for pid in records).items())),
        "newResearchProviders": len(fresh),
        "newResearchProvidersByType": dict(sorted(Counter(categories[pid] for pid in fresh).items())),
        "newProvidersWithDetailsByType": dict(sorted(Counter(
            categories[pid] for pid, row in records.items()
            if row.get("providerDetailsReviewed") and not baseline.get(pid, {}).get("providerDetailsReviewed")).items())),
        "providerIds": sorted(records),
    }


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def research_source(identifier, url, title, publisher, checked, *, kind="provider", access="full-page"):
    return {
        "id": identifier, "url": url, "title": title, "publisher": publisher,
        "kind": kind, "checkedAt": checked[:10], "publishedAt": None, "access": access,
    }


def add_fact(record, identifier, kind, text, source_id, amount=None):
    fact = {"id": identifier, "kind": kind, "text": text, "sourceId": source_id}
    if amount is not None:
        fact["amount"] = amount
    record["facts"].append(fact)


def identity(provider):
    return {key: provider[key] for key in ("name", "category", "address", "city", "state", "zip")}


def clean(value):
    return " ".join(value.split())


def home_care(inputs, providers):
    directory = "home-care-first-party"
    validator = module(inputs.root / directory / "validate.py", "home_care_verifier")
    report = validator.validate()
    report.pop("checked_at", None)
    require(report["valid"], f"First-party verification failed: {report['errors']}")
    inputs.read(f"{directory}/validate.py")
    saved = inputs.json(f"{directory}/validation.json")
    saved.pop("checked_at", None)
    require(saved == report, "First-party validation report differs from retained evidence")
    rows = inputs.json(f"{directory}/records.json")
    inputs.read(f"{directory}/README.md")
    inputs.read(f"{directory}/unmatched.json")
    inputs.read(f"{directory}/discovery.json")
    for county in validator.COUNTIES:
        inputs.read(f"state/{county.lower()}/home-care-firms.json")
    for name in ("coverage.json", "provider-page-checks.json", "manifest.json"):
        inputs.read("offerings/" + name)
    require(report["artifact_set_complete"], "First-party artifact set is incomplete")
    for relative, expected in report["receipt_sha256"].items():
        require(hashlib.sha256(inputs.read(f"{directory}/{relative}")).hexdigest() == expected,
                f"First-party receipt changed: {relative}")
    inventory = inputs.json(f"{directory}/inventory.json")
    for row in inventory:
        inputs.read("state/" + row["source"]["file"])
    patches, upgrades = {}, {}
    for row in rows:
        pid = row["provider_id"]
        provider = providers[pid]
        require(provider["category"] == "home-care"
                and provider["name"] == row["registered_name"]
                and provider["address"] == clean(row["registered_address"])
                and provider["city"] == row["registered_city"]
                and provider["zip"] == row["registered_zip"]
                and provider["state"] == row["registered_state"]
                and pid == "north-jersey-hp-" + row["official_registration_id"].lower(),
                f"First-party exact office changed: {pid}")
        record = empty_record(pid)
        record.update(checkedAt=row["checked_at"][:10], providerDetailsReviewed=True)
        source_ids = {}
        for item in row["sources"]:
            receipt = item["receipt"]
            relative = receipt.removeprefix("research/north-jersey/") if receipt.startswith("research/") else f"{directory}/{receipt}"
            retained = inputs.json(relative)
            require(retained["url"] == item["url"], f"First-party receipt changed: {pid}")
            sid = "supp-home-" + hashlib.sha256(item["url"].encode()).hexdigest()[:16]
            source_ids[item["url"]] = sid
            record["sources"].append(research_source(
                sid, item["url"], f"{row['office_name']} official office information",
                row["office_name"], item["checked_at"]))
        for collection in ("services", "service_areas", "primary_observations"):
            for index, claim in enumerate(row[collection]):
                urls = validator.source_references(claim)
                text = claim.get("text", claim.get("statement", claim.get("label", claim.get("name"))))
                if collection == "services":
                    text = "Provider-reported service: " + text.rstrip(".") + ". Confirm current staffing and availability."
                elif collection == "service_areas":
                    text = "Provider-reported service area: " + text + ". " + claim.get(
                        "scope", "Confirm coverage for the individual address; office location alone is not service coverage.")
                for key in ("qualifier", "scope", "limitation"):
                    if collection != "service_areas" and claim.get(key):
                        text += " " + claim[key]
                add_fact(record, f"supp-home-{row['record_id']}-{collection}-{index}", "care", text, source_ids[urls[0]])
                for url in urls[1:]:
                    require(url in source_ids, f"Unknown first-party supporting source: {pid}")
        record["notes"] = list(row["limitations"]) + [
            "Registered office address is retained separately from the provider's observed address.",
            "Provider-published office address: " + row["observed_address"] + ".",
            "Identity verification basis: " + row["match_basis"],
        ]
        statement = row["publishable_statement"]
        if isinstance(statement, str):
            statement = {"text": statement, "source_urls": row["publishable_statement_source_urls"]}
        upgrades[pid] = {
            "providerId": pid, "identity": identity(provider), "statement": statement,
            "checkedAt": row["checked_at"][:10], "limitations": record["notes"],
            "sourceUrls": [item["url"] for item in row["sources"]],
            "scope": "Exact local office. No catalog address, service-area or licensing override.",
        }
        require(pid not in patches, f"Duplicate first-party provider: {pid}")
        patches[pid] = record
    report["releaseStatus"] = "verified_retained_records_only"
    report["collectorReadme"] = "README.md"
    return patches, report, upgrades


def nppes(inputs, providers):
    directory = "nppes-organizations"
    replay = module(inputs.root / directory / "replay.py", "nppes_verifier")
    inputs.read(f"{directory}/replay.py")
    inputs.read(f"{directory}/README.md")
    outputs = replay.results()
    with redirect_stdout(io.StringIO()):
        replay.replay(True)
    for name, value in outputs.items():
        require(inputs.json(f"{directory}/{name}") == value, f"NPPES output does not reproduce: {name}")
    for path, expected in outputs["evidence-manifest.json"].items():
        require(hashlib.sha256(inputs.read(f"{directory}/{path}")).hexdigest() == expected,
                f"NPPES retained receipt changed: {path}")
    attempts = outputs["query-attempts.json"]
    for attempt in attempts:
        require(not attempt.get("error"), "NPPES retained query failed")
        if attempt["resultCount"] == 200:
            require(attempt["skip"] < 1000 and any(
                other["id"] == attempt["id"] and other["skip"] == attempt["skip"] + 200
                and not other.get("error") for other in attempts),
                "NPPES retained query pagination incomplete")
    patches = {}
    for row in outputs["matches.json"]:
        pid = row["providerId"]
        provider = providers[pid]
        require(provider["category"] == "home-care" and all(
            provider[key] == row[field] for key, field in (
                ("name", "catalogName"), ("address", "catalogAddress"),
                ("city", "catalogCity"), ("zip", "catalogZip"))),
                f"NPPES exact practice office changed: {pid}")
        record = empty_record(pid)
        record.update(checkedAt=row["checkedAt"][:10], providerDetailsReviewed=True)
        sid = "supp-nppes-" + row["npi"]
        record["sources"] = [research_source(
            sid, row["sourceUrl"], "NPPES organization and practice-address record",
            "Centers for Medicare & Medicaid Services, NPI Registry", row["checkedAt"], kind="regulator")]
        text = (
            row["blurb"] + f" NPI {row['npi']}. NPPES last updated {row['nppesLastUpdated']}. "
            "Taxonomy labels are provider-reported classifications, not verified staffed services. "
            "NPI issuance does not establish licensing, Medicare certification, payment acceptance, "
            "service coverage, availability or current staffing."
        )
        add_fact(record, sid + "-registry-classification", "care", text, sid)
        record["notes"] = row["limitations"] + [
            "Exact identity match within the retained NPPES query evidence. Query coverage is bounded, not an exhaustive NPI census.",
        ]
        if row.get("phoneAgreement") == "different_or_missing_phone_do_not_replace_without_review":
            record["notes"].append(
                "NPPES practice phone differs from the catalog phone. Neither is confirmed as a current intake line.")
        patches[pid] = record
    return patches, {
        "releaseStatus": "verified_retained_exact_matches_only",
        "matchedProviders": len(patches), "catalogRecords": len(replay.load(replay.ROOT / "catalog-input.json")),
        "retainedPages": sum(not row.get("error") for row in attempts),
        "unattemptedQueryGroups": sum(row.get("error") == "not_attempted" for row in attempts),
        "collectionComplete": not any(row.get("error") for row in attempts),
        "collectorReadme": "README.md",
        "scope": "No absent-NPI claim. Only exact active NPI-2 organization and full practice-address matches.",
    }


def campus(inputs, providers):
    directory = "campus-offerings"
    manifest = inputs.json(f"{directory}/manifest.json")
    inputs.read(f"{directory}/README.md")
    for name, receipt in manifest["files"].items():
        expected = receipt["sha256"] if isinstance(receipt, dict) else receipt
        require(hashlib.sha256(inputs.read(f"{directory}/{name}")).hexdigest() == expected,
                f"Campus source hash changed: {name}")
    raw = inputs.json(f"{directory}/locationResearch.patch.json")
    proof = inputs.json(f"{directory}/fact-evidence.json")
    ledger = {row["factId"]: row for row in proof}
    patches = {}
    for pid, sparse in raw.items():
        require(pid in providers and sparse["providerId"] == pid, f"Unknown campus provider: {pid}")
        if not sparse["facts"]:
            continue
        record = empty_record(pid)
        record.update(deepcopy(sparse))
        record.update(
            checkedAt=max(source["checkedAt"] for source in record["sources"]),
            providerDetailsReviewed=True)
        sources = {row["id"]: row for row in record["sources"]}
        for fact in record["facts"]:
            item = ledger[fact["id"]]
            source = sources[fact["sourceId"]]
            require(item["providerId"] == pid and item["sourceId"] == source["id"]
                    and item["url"] == source["url"], f"Campus evidence identity changed: {fact['id']}")
            retained = inputs.json(f"{directory}/{item['evidenceFile']}")[item["recordIndex"]]
            require(retained["metadata"]["statusCode"] == 200
                    and retained["effectiveUrl"] == source["url"]
                    and all(clean(quote) in clean(retained["markdown"]) for quote in item["quotes"]),
                    f"Campus evidence quotation changed: {fact['id']}")
        patches[pid] = record
    require(set(ledger) == {fact["id"] for row in patches.values() for fact in row["facts"]},
            "Campus fact ledger differs from released facts")
    return patches, {
        "releaseStatus": "verified_approved_patches",
        "reviewedProviders": len(raw), "providersWithFacts": len(patches),
        "heldProviderIds": sorted(set(raw) - set(patches)),
        "factCount": len(ledger), "collectorReadme": "README.md",
    }


def association(inputs, providers):
    directory = "association-directory"
    extractor = module(inputs.root / directory / "extract.py", "association_verifier")
    inputs.read(f"{directory}/extract.py")
    inputs.read(f"{directory}/.source.pdf")
    original = extractor.extract(inputs.root / directory / ".source.pdf")
    retained = inputs.json(f"{directory}/extracted-facts.json")
    require(original == retained, "Association PDF extraction changed")
    inputs.read(f"{directory}/README.md")
    manifest = inputs.json(f"{directory}/manifest.json")
    for relative, expected in manifest["inputHashes"].items():
        if relative.startswith("runtime/"):
            continue
        require(hashlib.sha256(inputs.read(relative)).hexdigest() == expected,
                f"Association source hash changed: {relative}")
    builder = module(inputs.root / directory / "build.py", "association_builder")
    inputs.read(f"{directory}/build.py")
    regenerated = {}
    builder.write = lambda name, value: regenerated.__setitem__(name, value)
    with redirect_stdout(io.StringIO()):
        builder.build()
    for name in ("accepted-services.json", "provider-coverage.json", "listing-coverage.json"):
        require(inputs.json(f"{directory}/{name}") == regenerated[name],
                f"Association output does not reproduce: {name}")
    approvals = inputs.json(f"{directory}/accepted-services.json")
    patches = {}
    for approval in approvals:
        pid = approval["providerId"]
        require(providers[pid]["category"] == approval["category"]
                and providers[pid]["address"] == approval["catalogAddress"],
                f"Association reviewed office changed: {pid}")
        listing = next(row for row in retained["listings"] if row["entryId"] == approval["directoryEntryId"])
        care_type = "HEALTH CARE SERVICE FIRM" if approval["category"] == "home-care" else "HOME HEALTH AGENCY"
        require(listing["name"] == approval["name"] and listing["address"] == approval["directoryAddress"]
                and listing["serviceScope"] == "single_care_type" and listing["kinds"] == [care_type],
                f"Association care scope changed: {pid}")
        record = empty_record(pid)
        checked = retained["publication"]["retrievedAt"]
        sid = "supp-association-" + approval["directoryEntryId"]
        record.update(checkedAt=checked, providerDetailsReviewed=True)
        record["sources"] = [research_source(
            sid, listing["sourceUrl"], retained["publication"]["title"] + ", 2026-2027",
            retained["publication"]["publisher"], checked, access="pdf")]
        for index, statement in enumerate(listing["serviceStatements"]):
            add_fact(record, f"{sid}-services-{index}", "care",
                     "Association directory, provider-reported " + care_type.lower()
                     + " services: " + statement + ". Confirm the individual care needs and current local availability.", sid)
        for index, statement in enumerate(listing["countyStatements"]):
            add_fact(record, f"{sid}-counties-{index}", "care",
                     "Association directory reports counties served: " + statement
                     + ". Provider-reported coverage, not an office-location claim. Confirm the individual address.", sid)
        payments = approval["paymentFacts"]
        for row in payments:
            labels = [retained["legend"][code] for code in row["codes"]]
            require(labels == row["labels"], f"Association payment qualifier changed: {pid}")
            payment_sid = f"{sid}-index-page-{row['pdfPage']}"
            if not any(source["id"] == payment_sid for source in record["sources"]):
                record["sources"].append(research_source(
                    payment_sid, row["sourceUrl"], "Association directory county payment legend and listing",
                    retained["publication"]["publisher"], checked, access="pdf"))
            add_fact(record, f"{sid}-payment-{row['county'].lower()}", "cost",
                     f"2026-2027 association directory lists {', '.join(labels)} for {row['county']} County. "
                     "PCA means personal care assistance; PDN means private duty nursing. "
                     "These are service-specific directory payment categories, not a quoted price, "
                     "insurance enrollment check, eligibility decision or guarantee of acceptance. "
                     "Confirm payer authorization, the individual service and current acceptance.", payment_sid)
        record["notes"] = approval["limitations"] + [
            "Identity verification basis: " + approval["matchBasis"],
            "Source edition is 2026-2027. No day-level publication or fee-effective date is supplied.",
            "Directory members report services. Association membership is not regulatory certification.",
        ]
        patches[pid] = record
    return patches, {
        "releaseStatus": "reviewed_exact_office_mappings",
        "publicationSha256": retained["publication"]["sha256"],
        "sourceListings": len(retained["listings"]), "reviewedProviders": len(patches),
        "sourceCountyPaymentRows": len(retained["countyPaymentIndex"]),
        "collectorReadme": "README.md",
        "excludedScope": "Brand-only, mixed-care, conflicting or ambiguous office mappings remain unreleased.",
    }


def build(root):
    normalizer = module(ROOT / "scripts/regions/normalize-nj.py", "supplemental_normalizer")
    inputs = normalizer.Inputs(root)
    provider_list = json.loads((root / "runtime/providers.json").read_bytes())
    providers = {row["id"]: row for row in provider_list}
    baseline = inputs.json("offerings/locationResearch.json")
    home, home_report, upgrades = home_care(inputs, providers)
    registry, registry_report = nppes(inputs, providers)
    directory, directory_report = association(inputs, providers)
    campus_patches, campus_report = campus(inputs, providers)
    batches = dict(zip(SOURCES, (home, directory, registry, campus_patches)))
    combined = {}
    reports = {}
    for name, batch in batches.items():
        combined = merge_research(combined, batch)
        reports[name] = coverage(batch, baseline, provider_list)
    builder = module(ROOT / "scripts/regions/build-region.py", "supplemental_region_validator")
    for pid, record in combined.items():
        builder.LOCATION(record, f"supplemental.{pid}")
    files = {
        "locationResearch.json": encode(combined),
        "first-party-upgrades.json": encode(upgrades),
        "source-verification.json": encode({
            "home-care-first-party": home_report, "association-directory": directory_report,
            "nppes-organizations": registry_report,
            "campus-offerings": campus_report,
        }),
        "coverage.json": encode({
            "sources": reports, "combined": coverage(combined, baseline, provider_list),
            "newProvidersWithFactsByType": dict(sorted(Counter(
                providers[pid]["category"] for pid in combined
                if combined[pid]["facts"] and not baseline.get(pid, {}).get("facts")).items())),
            "newProvidersWithPublishedAmountByType": dict(sorted(Counter(
                providers[pid]["category"] for pid, row in combined.items()
                if any(fact.get("amount") for fact in row["facts"])
                and not any(fact.get("amount") for fact in baseline.get(pid, {}).get("facts", []))).items())),
            "meaning": "Unique stable catalog provider IDs, not brands or physical facilities. No providers are added to the catalog.",
        }),
    }
    manifest = {
        "schemaVersion": 1, "status": "verified",
        "sources": {name: reports[name] for name in SOURCES},
        "identities": {pid: identity(providers[pid]) for pid in sorted(combined)},
        "inputs": dict(sorted(inputs.hashes.items())),
        "outputs": {name: hashlib.sha256(body).hexdigest() for name, body in files.items()},
    }
    files["manifest.json"] = encode(manifest)
    inputs.verify()
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    files = build(ROOT / "research/north-jersey")
    output = ROOT / "research/north-jersey" / DIRECTORY
    for name, body in files.items():
        path = output / name
        if args.check:
            require(path.read_bytes() == body, f"Supplemental output differs: {name}")
        else:
            path.write_bytes(body)
    report = json.loads(files["coverage.json"])
    for item in [report["combined"], *report["sources"].values()]:
        item.pop("providerIds")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, AssertionError) as error:
        print(f"Supplemental release failed: {error}", file=sys.stderr)
        sys.exit(1)
