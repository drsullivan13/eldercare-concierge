#!/usr/bin/env python3
"""Replay the supplied June 2026 UHC NJ MLTSS PCA extraction offline."""

import argparse
import collections
import csv
from functools import cache
import hashlib
import io
import json
from pathlib import Path
import re


if not __debug__:
    raise SystemExit("Run without -O. Research checks must remain enabled.")

ROOT = Path(__file__).resolve().parent
CHECKED = "2026-11-14"
SOURCE_DATE = "2026-06"
SOURCE_URL = "https://www.uhc.com/communityplan/assets/plandocuments/providerdirectory/NJ_MLTSS_Provider_List_by_County.pdf"
LANDING_URL = "https://www.uhc.com/communityplan/new-jersey/plans/medicaid/familycare/mltss"
COUNTIES = {
    "Bergen": 95, "Essex": 127, "Hudson": 92, "Middlesex": 83,
    "Monmouth": 80, "Morris": 89, "Passaic": 103, "Somerset": 98, "Union": 119,
}
SPECIALTY = "Personal Care Assistant"
CAVEAT = (
    "Historical June 2026 UnitedHealthcare Community Plan NJ MLTSS directory "
    "listing evidence from the supplied page-and-line extraction only. "
    "The official PDF could not be independently retrieved during this review. "
    "Not evidence of current participation, eligibility, an active contract, "
    "authorization, availability, or guaranteed insurance coverage. "
    "Named servicing county is not the office county or a coverage promise. "
    "Not found is not nonparticipation."
)
ADDRESS_WORDS = {
    "STREET": "ST", "ROAD": "RD", "AVENUE": "AVE", "BOULEVARD": "BLVD",
    "DRIVE": "DR", "LANE": "LN", "COURT": "CT", "PLACE": "PL",
    "PLAZA": "PLZ", "HIGHWAY": "HWY", "ROUTE": "RTE", "TURNPIKE": "TPKE",
    "PARKWAY": "PKWY", "TERRACE": "TER", "SUITE": "STE", "FLOOR": "FL",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "FIRST": "1", "SECOND": "2", "THIRD": "3",
}
REGISTERED_COMPONENTS = {
    "PRIORITY NURSING SERVICES, WESTERN MEDICAL SERVICES A DIV. OF":
        ("PRIORITY NURSING SERVICES", "WESTERN MEDICAL SERVICES A DIV. OF"),
    "ALWAYS THERE, INC., ALWAYS THERE HOME HEALTH CARE":
        ("ALWAYS THERE, INC.", "ALWAYS THERE HOME HEALTH CARE"),
}
REASONS = {
    "accepted_exact_branch": "One exact office identity passes all release checks.",
    "unresolved_source_wrap": "The supplied body or city continuation is incomplete or wrapped. No boundary is guessed.",
    "uncertain_source_text": "The source name contains an unresolved question mark.",
    "wrong_population": "An explicit pediatric, children, or kids identity is outside this adult eldercare release.",
    "ambiguous_colocation": "Distinct organization identities share this complete office address. No branch is released from that address.",
    "ambiguous_roster_identity": "More than one distinct registered organization passes the identity checks.",
    "office_discrepancy": "An exact legal or registered DBA name exists, but full street including unit, city, ZIP, or phone differs. This includes possible old or moved offices, not a confirmed move.",
    "organization_discrepancy": "A location or phone anchor exists, but no specific legal or registered DBA name matches.",
    "not_in_published_roster": "No exact organization, full office address, or phone anchor exists in the full published roster.",
    "roster_location_hold": "The supplied bridge has an unresolved location hold.",
    "bridge_identity_conflict": "The bridge does not agree with the published full office identity and independently retained registration identity.",
    "not_branch_office": "Explicit headquarters-only, service-area-only, or non-office identity cannot support a branch release.",
    "not_found_in_supplied_counties": "No exact identity anchor was found in the supplied nine-county PCA extract. This is not a nonparticipation finding.",
    "source_or_quality_exclusion": "Anchored source rows exist but are excluded by source parsing, population, location, or ambiguity checks.",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def compact(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


@cache
def organization(value):
    return re.sub(r"[^A-Z0-9]", "", value.upper().replace("&", " AND "))


@cache
def street(value):
    value = value.upper().replace("&", " AND ")
    value = re.sub(r"\bFL(\d+)\b", r"FL \1", value)
    value = re.sub(r"\b(\d+)(?:ST|ND|RD|TH)\b", r"\1", value)
    value = re.sub(r"[^A-Z0-9#/-]+", " ", value)
    value = " ".join(ADDRESS_WORDS.get(token, token) for token in value.split())
    return re.sub(r"\b(\d+) FL\b", r"FL \1", value)


@cache
def phone(value):
    return re.sub(r"\D", "", value or "")


def bridge_zip(value):
    value = value.strip()
    return value[:5] if re.fullmatch(r"\d{5}(?:-\d{4})?", value) else None


def address_key(item):
    return street(item["address"]), organization(item["city"]), item["state"], item["zip"]


def legal_key(value):
    return organization(value.split(" DBA ", 1)[0])


def identity_names(bridge, registration):
    values = [("legalName", bridge["legalName"], "businessName")]
    registered = bridge["stateRegisteredTradeNames"]
    if registered:
        values.append(("stateRegisteredTradeNames", registered, "dbas"))
    for field, value, proof in list(values):
        if " DBA " in value:
            for part in value.split(" DBA ", 1):
                values.append((field + " explicit DBA component", part, proof))
    for part in REGISTERED_COMPONENTS.get(registered, ()):
        assert ", ".join(REGISTERED_COMPONENTS[registered]) == registered
        values.append(("stateRegisteredTradeNames reviewed component", part, "dbas"))
    return [{
        "field": field, "value": value,
        "registrationField": proof, "registrationValue": registration.get(proof, ""),
        "registration": registration["registration"],
        "sourceRows": registration["sourceRows"],
        "bridgeSourceRow": int(bridge["sourceRow"]),
        "proofFile": "uhc-registration-identities.json",
    } for field, value, proof in values]


def bridge_agrees(office, bridge, registration):
    return (
        organization(office["name"]) == organization(bridge["legalName"])
        == organization(registration["businessName"])
        and bridge["stateRegisteredTradeNames"] == registration.get("dbas", "")
        and all((
            street(office["address"]) == street(bridge["address"]),
            organization(office["city"]) == organization(bridge["city"]),
            office["zip"] == bridge_zip(bridge["zip"]),
            phone(office["phone"]) == phone(bridge["phone"]),
        ))
        and int(bridge["sourceRow"]) in registration["sourceRows"]
    )


def parse_row(row, index):
    prefix = re.fullmatch(r"([A-Za-z]+) Personal Care Assistant (.+)", row["body"])
    assert prefix and prefix[1] in COUNTIES, (index, row)
    result = {
        "listingId": f"uhc:p{row['page']}:l{row['line']}:r{index}",
        "sourceRow": index, "servicingCounty": prefix[1],
        "directorySection": SPECIALTY, "specialty": SPECIALTY,
        "physicalPage": row["page"], "printedPage": None,
        "sourceLine": row["line"], "sourceUrl": SOURCE_URL, "sourceDate": SOURCE_DATE,
        "sourceEvidence": dict(row), "directoryProviderId": None, "practiceName": None,
        "parseExclusion": None,
    }
    body = re.fullmatch(r"(.+?) (\(\d{3}\) \d{3}-\d{4}) (.+)", prefix[2])
    city = re.fullmatch(r"([A-Za-z][A-Za-z .'-]*), (NJ) (\d{5})", row["continuation"])
    if not body or not city or not re.match(r"^\d", body[3]):
        result["parseExclusion"] = "unresolved_source_wrap"
        result["listingName"] = body[1] if body else prefix[2]
        return result
    result.update({
        "listingName": body[1], "phone": body[2], "address": body[3],
        "city": city[1], "state": city[2], "zip": city[3],
    })
    if "?" in body[1]:
        result["parseExclusion"] = "uncertain_source_text"
    return result


def office_exclusion(office, bridge, registration):
    if not bridge_agrees(office, bridge, registration):
        return "bridge_identity_conflict"
    if bridge["locationHold"]:
        return "roster_location_hold"
    if re.search(r"pediatr|children|\bkids\b", office["name"], re.I):
        return "wrong_population"
    if (
        office["category"] != "home-care" or office["state"] != "NJ"
        or office["locationKind"] not in {"office", "zip"}
        or re.search(r"\bheadquarters\b|\bhq\b|\bservice[- ]area[- ]only\b|\bmoved\b", office.get("description") or "", re.I)
    ):
        return "not_branch_office"
    return None


def compare(office, listing, names):
    basis = next((name for name in names if organization(name["value"]) == organization(listing["listingName"])), None)
    checks = {
        "organization": basis is not None,
        "streetAndUnit": street(office["address"]) == street(listing["address"]),
        "city": organization(office["city"]) == organization(listing["city"]),
        "state": office["state"] == listing["state"],
        "zip": office["zip"] == listing["zip"],
        "phone": phone(office["phone"]) == phone(listing["phone"]),
    }
    return checks, basis


def load(root=ROOT):
    manifest = json.loads((root / "uhc-manifest.json").read_bytes())
    assert manifest["sourceUrl"] == SOURCE_URL and manifest["discoveryUrl"] == LANDING_URL
    assert manifest["checkedDate"] == CHECKED and manifest["sourceDate"] == SOURCE_DATE
    assert manifest["sourceDatePrecision"] == "month"
    assert manifest["pdfPageCount"] == 373 and manifest["printedPage"] is None
    assert manifest["pdfSha256"] is None and manifest["pdfRetrieval"]["status"] == "blocked"
    payloads = {}
    assert set(manifest["files"]) == {
        "uhc-source-rows.json", "uhc-roster.json", "uhc-bridge.csv", "uhc-registration-identities.json",
    }
    for name, proof in manifest["files"].items():
        data = (root / name).read_bytes()
        assert digest(data) == proof["sha256"] and len(data) == proof["bytes"], f"Input drift: {name}"
        payloads[name] = data
    rows = json.loads(payloads["uhc-source-rows.json"])
    roster = json.loads(payloads["uhc-roster.json"])
    bridge_rows = list(csv.DictReader(io.StringIO(payloads["uhc-bridge.csv"].decode())))
    bridge = {item["providerId"]: item for item in bridge_rows}
    identities = json.loads(payloads["uhc-registration-identities.json"])
    assert len(rows) == manifest["sourceRowCount"] == 886
    assert len(roster) == len(bridge) == len(bridge_rows) == manifest["rosterCount"] == 1074
    assert set(roster) == set(bridge) == set(identities["providers"])
    pages = collections.defaultdict(list)
    seen = set()
    previous = (0, 0)
    for index, row in enumerate(rows, 1):
        assert set(row) == {"page", "line", "body", "continuation"}
        assert type(row["page"]) is int and 1 <= row["page"] <= 373
        assert type(row["line"]) is int and row["line"] > 0
        key = row["page"], row["line"]
        assert key not in seen and key > previous
        seen.add(key)
        previous = key
        pages[str(row["page"])].append({"sourceRow": index, **row})
    assert set(pages) == set(manifest["pages"])
    for page, items in pages.items():
        proof = manifest["pages"][page]
        assert digest(compact(items)) == proof["sha256"], f"Page binding drift: {page}"
        assert len(items) == proof["rows"]
        assert items[0]["line"] == proof["firstLine"] and items[-1]["line"] == proof["lastLine"]
    assert identities["source"]["publisher"] == "New Jersey Division of Consumer Affairs"
    return rows, roster, bridge, identities, manifest


def build(root=ROOT):
    rows, roster, bridge, identities, manifest = load(root)
    listings = [parse_row(row, index) for index, row in enumerate(rows, 1)]
    assert dict(collections.Counter(item["servicingCounty"] for item in listings)) == COUNTIES
    names = {i: identity_names(bridge[i], identities["providers"][i]) for i in roster}
    gates = {i: office_exclusion(office, bridge[i], identities["providers"][i]) for i, office in roster.items()}
    name_index, phone_index, address_index = (collections.defaultdict(set) for _ in range(3))
    for provider_id, office in roster.items():
        for name in names[provider_id]:
            name_index[organization(name["value"])].add(provider_id)
        phone_index[phone(office["phone"])].add(provider_id)
        address_index[address_key(office)].add(provider_id)
    source_address_names = collections.defaultdict(set)
    for listing in listings:
        if not listing["parseExclusion"]:
            source_address_names[address_key(listing)].add(organization(listing["listingName"]))

    verified, decisions = {}, {}
    provider_candidates = collections.defaultdict(list)
    accepted_ids = collections.defaultdict(list)
    quality = []
    for listing in listings:
        listing_id = listing["listingId"]
        decision = {
            "sourceRow": listing["sourceRow"], "listingId": listing_id,
            "physicalPage": listing["physicalPage"], "sourceLine": listing["sourceLine"],
            "servicingCounty": listing["servicingCounty"], "status": "excluded",
            "reason": listing["parseExclusion"], "providerIds": [], "candidates": [],
        }
        if not listing["parseExclusion"]:
            key = address_key(listing)
            candidate_ids = (
                name_index[organization(listing["listingName"])]
                | phone_index[phone(listing["phone"])] | address_index[key]
            )
            exact, eligible = [], []
            for provider_id in sorted(candidate_ids):
                checks, basis = compare(roster[provider_id], listing, names[provider_id])
                candidate = {
                    "providerId": provider_id, "checks": checks,
                    "discrepancies": [field for field, passed in checks.items() if not passed],
                    "organizationBasis": basis, "officeExclusion": gates[provider_id],
                }
                decision["candidates"].append(candidate)
                provider_candidates[provider_id].append({
                    "listingId": listing_id, "checks": checks, "officeExclusion": gates[provider_id],
                })
                if all(checks.values()):
                    exact.append(candidate)
                    if gates[provider_id] is None:
                        eligible.append(candidate)
            allowed_names = {organization(n["value"]) for c in eligible for n in names[c["providerId"]]}
            co_roster = {legal_key(bridge[i]["legalName"]) for i in address_index[key]}
            collocated = len(co_roster) > 1 or bool(source_address_names[key] - allowed_names)
            if re.search(r"pediatr|children|\bkids\b", listing["listingName"], re.I):
                reason = "wrong_population"
            elif exact and not eligible:
                reason = exact[0]["officeExclusion"]
            elif eligible and collocated:
                reason = "ambiguous_colocation"
            elif len({legal_key(bridge[c["providerId"]]["legalName"]) for c in eligible}) > 1:
                reason = "ambiguous_roster_identity"
            elif eligible:
                reason = "accepted_exact_branch"
            elif any(c["checks"]["organization"] for c in decision["candidates"]):
                reason = "office_discrepancy"
            elif candidate_ids:
                reason = "organization_discrepancy"
            else:
                reason = "not_in_published_roster"
            decision["reason"] = reason
            if reason == "accepted_exact_branch":
                decision["status"] = "accepted"
                decision["providerIds"] = [c["providerId"] for c in eligible]
                for candidate in eligible:
                    provider_id = candidate["providerId"]
                    accepted_ids[provider_id].append(listing_id)
                    record = verified.setdefault(provider_id, {
                        "evidenceType": "historical_public_payer_directory_listing",
                        "payer": "UnitedHealthcare Community Plan",
                        "program": "NJ FamilyCare Medicaid MLTSS",
                        "checkedDate": CHECKED, "caveat": CAVEAT, "listings": [],
                    })
                    record["listings"].append({
                        k: v for k, v in listing.items() if k != "parseExclusion"
                    } | {
                        "organizationBasis": candidate["organizationBasis"] | {
                            "source": identities["source"],
                            "registeredDateCaveat": "Later registration snapshot establishes the identity tie only, not its June 2026 effective date.",
                        },
                        "sourcePdfSha256": None,
                        "sourceExtractSha256": manifest["files"]["uhc-source-rows.json"]["sha256"],
                        "sourcePageExtractSha256": manifest["pages"][str(listing["physicalPage"])]["sha256"],
                    })
                    quality.append({
                        "providerId": provider_id, "listingId": listing_id,
                        "checks": candidate["checks"], "noLocationHold": True,
                        "adultIdentity": True, "noAmbiguousColocation": True,
                        "pageEvidenceExact": listing["sourceEvidence"] == rows[listing["sourceRow"] - 1],
                        "physicalPage": listing["physicalPage"], "printedPage": None,
                        "sourceLine": listing["sourceLine"],
                        "organizationProof": candidate["organizationBasis"],
                    })
        assert decision["reason"] in REASONS, decision
        decision["rationale"] = REASONS[decision["reason"]]
        decisions[listing_id] = decision

    provider_decisions = {}
    for provider_id in sorted(roster):
        candidates = provider_candidates[provider_id]
        exact = accepted_ids[provider_id]
        if exact:
            reason = "accepted_exact_branch"
        elif gates[provider_id]:
            reason = gates[provider_id]
        elif any(c["checks"]["organization"] for c in candidates):
            reason = "source_or_quality_exclusion" if any(
                all(c["checks"].values()) for c in candidates
            ) else "office_discrepancy"
        elif candidates:
            reason = "organization_discrepancy"
        else:
            reason = "not_found_in_supplied_counties"
        provider_decisions[provider_id] = {
            "status": "verified" if exact else "hold", "reason": reason,
            "rationale": REASONS[reason], "checkedDate": CHECKED,
            "scannedServicingCounties": list(COUNTIES), "scannedSourceRows": len(rows),
            "acceptedListingIds": exact, "candidates": candidates,
            "locationHold": bridge[provider_id]["locationHold"] or None,
        }
    by_county = {}
    for county, total in COUNTIES.items():
        county_decisions = [d for d in decisions.values() if d["servicingCounty"] == county]
        ids = {i for d in county_decisions for i in d["providerIds"]}
        accepted = [d for d in county_decisions if d["status"] == "accepted"]
        by_county[county] = {
            "sourceRows": total, "acceptedBranches": len(ids),
            "acceptedListingOccurrences": len(accepted),
            "providerKeyedListings": sum(len(d["providerIds"]) for d in accepted),
            "excludedRows": total - len(accepted),
            "exclusionReasons": dict(sorted(collections.Counter(d["reason"] for d in county_decisions if d["status"] != "accepted").items())),
        }
    counts = {
        "checkedDate": CHECKED, "sourceDate": SOURCE_DATE, "sourceRows": len(rows),
        "retainedPhysicalPages": len(manifest["pages"]), "rosterProviders": len(roster),
        "verifiedProviders": len(verified),
        "distinctAcceptedOfficeIdentities": len({(legal_key(roster[i]["name"]), address_key(roster[i])) for i in verified}),
        "acceptedSourceRows": sum(d["status"] == "accepted" for d in decisions.values()),
        "providerKeyedListings": len(quality),
        "rowDispositionReasons": dict(sorted(collections.Counter(d["reason"] for d in decisions.values()).items())),
        "rosterDispositionReasons": dict(sorted(collections.Counter(d["reason"] for d in provider_decisions.values()).items())),
        "byServicingCounty": by_county, "reasonDefinitions": REASONS,
        "caveat": CAVEAT,
    }
    outputs = {
        "uhc-directory-listings.json": listings, "uhc-verified.json": dict(sorted(verified.items())),
        "uhc-row-dispositions.json": decisions, "uhc-roster-dispositions.json": provider_decisions,
        "uhc-quality-checks.json": quality, "uhc-counts.json": counts,
    }
    validate(outputs, rows, roster)
    return outputs


def validate(outputs, rows, roster):
    listings = outputs["uhc-directory-listings.json"]
    decisions = outputs["uhc-row-dispositions.json"]
    verified = outputs["uhc-verified.json"]
    providers = outputs["uhc-roster-dispositions.json"]
    assert len(listings) == len(decisions) == len(rows) == 886
    assert set(providers) == set(roster) and len(providers) == 1074
    assert set(verified) == {i for i, d in providers.items() if d["status"] == "verified"}
    accepted_pairs = {(i, key) for key, d in decisions.items() for i in d["providerIds"]}
    observed_pairs = set()
    by_id = {listing["listingId"]: listing for listing in listings}
    for provider_id, record in verified.items():
        assert record["listings"] and record["checkedDate"] == CHECKED
        for listing in record["listings"]:
            source = rows[listing["sourceRow"] - 1]
            parsed = parse_row(source, listing["sourceRow"])
            assert all(listing[k] == v for k, v in parsed.items() if k != "parseExclusion")
            assert by_id[listing["listingId"]] == parsed
            assert listing["physicalPage"] == source["page"] and listing["printedPage"] is None
            assert listing["sourceEvidence"] == source
            assert listing["sourceDate"] == SOURCE_DATE and listing["sourceUrl"] == SOURCE_URL
            assert listing["specialty"] == SPECIALTY
            assert not parsed["parseExclusion"]
            assert address_key(roster[provider_id]) == address_key(listing)
            assert phone(roster[provider_id]["phone"]) == phone(listing["phone"])
            assert organization(listing["organizationBasis"]["value"]) == organization(listing["listingName"])
            observed_pairs.add((provider_id, listing["listingId"]))
    assert observed_pairs == accepted_pairs
    quality = outputs["uhc-quality-checks.json"]
    assert len(quality) == len(accepted_pairs)
    assert {(q["providerId"], q["listingId"]) for q in quality} == accepted_pairs
    assert all(all(q["checks"].values()) and all(q[k] for k in (
        "noLocationHold", "adultIdentity", "noAmbiguousColocation", "pageEvidenceExact",
    )) for q in quality)
    counts = outputs["uhc-counts.json"]
    assert sum(counts["rowDispositionReasons"].values()) == 886
    assert sum(counts["rosterDispositionReasons"].values()) == 1074
    assert sum(v["acceptedListingOccurrences"] for v in counts["byServicingCounty"].values()) == counts["acceptedSourceRows"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify exact output bytes without writing.")
    args = parser.parse_args()
    outputs = build()
    for name, value in outputs.items():
        payload = encoded(value)
        path = ROOT / name
        if args.check:
            assert path.read_bytes() == payload, f"Stale output: {name}"
        else:
            path.write_bytes(payload)
    counts = outputs["uhc-counts.json"]
    print(json.dumps({k: counts[k] for k in (
        "sourceRows", "rosterProviders", "verifiedProviders", "distinctAcceptedOfficeIdentities",
        "acceptedSourceRows", "providerKeyedListings", "rowDispositionReasons", "byServicingCounty",
    )}, indent=2))


if __name__ == "__main__":
    main()
