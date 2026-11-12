#!/usr/bin/env python3
"""Build source-linked North Jersey release inputs without publishing app data."""

import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timedelta
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "research/north-jersey"
OUTPUT = RESEARCH / "runtime"
COUNTIES = ("Union", "Morris", "Essex", "Bergen", "Hudson", "Passaic")
MARKET = "north-jersey"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
TYPES = {
    "ASSISTED LIVING RESIDENCE": "assisted-living",
    "COMPREHENSIVE PERSONAL CARE HOME": "assisted-living",
    "RESIDENTIAL DEMENTIA CARE HOME": "assisted-living",
    "LONG TERM CARE FACILITY": "nursing-home",
    "LONG TERM CARE FACILITY SNF/NF": "nursing-home",
    "LONG TERM CARE FACILITY - HOME FOR THE AGED SNF/NF": "nursing-home",
    "LONG TERM CARE FACILITY LTC-PRIV": "nursing-home",
    "LONG TERM CARE FACILITY - HOME FOR THE AGED LTC-PRIV": "nursing-home",
    "LONG TERM CARE FACILITY S/NF DP": "nursing-home",
    "HOSPITAL BASED - LONG TERM CARE FACILITY SNF/NF": "nursing-home",
    "HOSPITAL BASED - LONG TERM CARE SUB ACUTE FACILITY SNF": "nursing-home",
}
CCN = "cms_certification_number_ccn"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def clean(value):
    return " ".join(str(value or "").split())


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def excel_date(value):
    return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()


def workbook_rows(body):
    import io
    with ZipFile(io.BytesIO(body)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(node.itertext()) for node in
                      ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        sheets = [name for name in archive.namelist()
                  if re.fullmatch(r"xl/worksheets/[^/]+\.xml", name)]
        require(len(sheets) == 1, "Expected exactly one worksheet")
        records = []
        for row in ET.fromstring(archive.read(sheets[0])).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row:
                column = re.sub(r"\d", "", cell.attrib["r"])
                value = cell.findtext("s:v", "", NS)
                if cell.get("t") == "s":
                    value = shared[int(value)]
                elif cell.get("t") == "inlineStr":
                    value = "".join(cell.find("s:is", NS).itertext())
                cells[column] = value
            records.append((int(row.attrib["r"]), cells))
    headers = records[0][1]
    return [{"source_row": number, **{name: cells.get(col, "") for col, name in headers.items()}}
            for number, cells in records[1:] if any(cells.values())]


class Inputs:
    def __init__(self, root):
        self.root = root
        self.hashes = {}
        self.bodies = {}

    def read(self, relative):
        if relative in self.bodies:
            return self.bodies[relative]
        path = self.root / relative
        data = path.read_bytes()
        self.hashes[relative] = digest(data)
        self.bodies[relative] = data
        return data

    def json(self, relative):
        return json.loads(self.read(relative))

    def receipt(self, relative):
        metadata = self.json(relative + ".json")
        require(digest(self.read(relative)) == metadata["sha256"],
                f"Source receipt hash mismatch: {relative}")
        return metadata

    def verify(self):
        for relative, expected in self.hashes.items():
            require(digest((self.root / relative).read_bytes()) == expected,
                    f"Source changed during normalization: {relative}. Rerun.")


def source(receipt, title, publisher, supports, as_of=None):
    result = {
        "title": title, "publisher": publisher, "url": receipt["url"],
        "kind": "regulatory", "checkedAt": receipt["retrieved_at"][:10],
        "supports": supports,
    }
    if as_of is not None:
        result["dataAsOf"] = as_of
    return result


def base_provider(pid, name, category, address, city, zip_code, provenance):
    return {
        "id": pid, "name": name, "category": category, "address": address,
        "city": city, "state": "NJ", "zip": zip_code, "lat": None, "lng": None,
        "locationKind": "zip", "description": "", "services": [],
        "officialRecord": True, "sources": [provenance], "warnings": [], "limitations": [],
    }


def location_point(provider, zips, lat=None, lng=None, kind="facility"):
    if lat not in (None, "", "0") and lng not in (None, "", "0"):
        lat, lng = float(lat), float(lng)
        if 38 <= lat <= 42 and -76 <= lng <= -73:
            provider.update(lat=lat, lng=lng, locationKind=kind)
            return
    point = zips[provider["zip"]]
    provider.update(lat=point["lat"], lng=point["lng"], locationKind="zip")
    provider["limitations"].append(
        "Coordinates are an approximate ZIP representative point, not a verified facility or office entrance."
    )


def address_key(address):
    address = clean(address).upper()
    address = re.sub(r"\bONE\b", "1", address)
    replacements = {
        "STREET": "ST", "AVENUE": "AVE", "BOULEVARD": "BLVD", "ROAD": "RD",
        "DRIVE": "DR", "LANE": "LN", "PLACE": "PL", "NORTH": "N",
        "SOUTH": "S", "EAST": "E", "WEST": "W",
    }
    for full, short in replacements.items():
        address = re.sub(rf"\b{full}\b", short, address)
    return re.sub(r"[^A-Z0-9]", "", address)


def number(value):
    value = clean(value).replace(",", "").replace("$", "")
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return None
    return float(value) if "." in value else int(value)


def cms_summary(row, as_of):
    fields = {
        "overall": "overall_rating", "inspections": "health_inspection_rating",
        "staffing": "staffing_rating", "quality": "qm_rating",
        "totalNurseHours": "reported_total_nurse_staffing_hours_per_resident_per_day",
        "rnHours": "reported_rn_staffing_hours_per_resident_per_day",
        "turnover": "total_nursing_staff_turnover",
        "fines": "number_of_fines", "fineAmount": "total_amount_of_fines_in_dollars",
        "paymentDenials": "number_of_payment_denials",
        "healthDeficiencies": "rating_cycle_1_total_number_of_health_deficiencies",
    }
    require(row.get("abuse_icon") in ("Y", "N"), "Unknown CMS abuse flag")
    result = {key: number(row.get(column)) for key, column in fields.items()}
    result.update(ccn=row[CCN], abuse=row["abuse_icon"] == "Y",
                  specialFocus=clean(row.get("special_focus_status")) or None, dataAsOf=as_of)
    inspection = clean(row.get("rating_cycle_1_standard_survey_health_date"))
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", inspection):
        result["lastInspection"] = inspection
    return result


def name_key(value):
    value = re.sub(r"\b(THE|LLC|INC)\b", "", clean(value).upper())
    return re.sub(r"[^A-Z0-9]", "", value)


def cms_dataset(inputs, manifest, dataset_id):
    metadata = manifest.get("sources", {}).get(dataset_id)
    if not metadata or not metadata.get("complete"):
        return None, None
    rows = []
    for partition in metadata["partitions"]:
        require(partition["complete"], f"Incomplete CMS partition: {dataset_id}")
        expected = partition["expected_count"]
        partition_rows = []
        require([page["offset"] for page in partition["pages"]] ==
                list(range(0, max(1, expected), partition["page_size"])),
                f"Missing CMS page: {dataset_id}")
        for receipt in [partition["probe"], *partition["pages"], partition["count_after"]]:
            body = inputs.read("cms/" + receipt["file"])
            require(digest(body) == receipt["sha256"], f"CMS page hash mismatch: {receipt['file']}")
            page = json.loads(body)
            require(page["count"] == expected, f"CMS source count changed: {dataset_id}")
            require(page["query"]["conditions"] == partition["conditions"],
                    f"CMS page filter mismatch: {dataset_id}")
            if receipt in partition["pages"]:
                require(len(page["results"]) == receipt["rows"], "CMS page row mismatch")
                partition_rows.extend(page["results"])
        require(len(partition_rows) == expected == partition["retrieved_rows"],
                f"CMS source pagination incomplete: {dataset_id}")
        rows.extend(partition_rows)
    if dataset_id == "m5eg-upu5":
        rows = list({json.dumps(row, sort_keys=True): row for row in rows}.values())
    require(len(rows) == metadata["retained_rows"], f"CMS retained row mismatch: {dataset_id}")
    receipt = metadata["metadata"]
    require(digest(inputs.read("cms/" + receipt["file"])) == receipt["sha256"],
            f"CMS metadata hash mismatch: {dataset_id}")
    return rows, metadata


def home_health_inputs(inputs, zips, counties, ledger):
    latest_path = inputs.root / "cms/pos/latest.json"
    if not latest_path.exists():
        return {"status": "pending_verified_pos_snapshot", "providers": [], "crosswalk": []}
    latest = inputs.json("cms/pos/latest.json")
    relative = "cms/pos/" + latest["snapshot"]
    snapshot = (inputs.root / relative).resolve()
    require(snapshot.is_relative_to((inputs.root / "cms/pos").resolve()), "POS snapshot escapes source root")
    manifest = inputs.json(relative + "/manifest.json")
    for path, receipt in manifest["receipts"].items():
        require(digest(inputs.read(relative + "/" + path)) == receipt["sha256"],
                f"POS source hash mismatch: {path}")
    supplement = inputs.json(relative + "/supplement.json")
    spec = importlib.util.spec_from_file_location("cms_pos_verifier", ROOT / "scripts/regions/cms_pos.py")
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    require(verifier.verify(snapshot) == supplement, "POS supplement differs from retained sources")
    pages = manifest["pdc_pages"]["home_health"]
    rows = [row for page in pages for row in inputs.json(relative + "/" + page["file"])["results"]]
    by_ccn = {row[CCN]: row for row in rows}
    metadata_file = manifest["pdc_metadata"]["home_health"]
    metadata = inputs.json(relative + "/" + metadata_file)
    pdc_receipt = manifest["receipts"][metadata_file]
    services = {
        "offers_nursing_care_services": "Nursing care",
        "offers_physical_therapy_services": "Physical therapy",
        "offers_occupational_therapy_services": "Occupational therapy",
        "offers_speech_pathology_services": "Speech pathology",
        "offers_medical_social_services": "Medical social services",
        "offers_home_health_aide_services": "Home health aide services",
    }
    providers, crosswalk = [], []
    for unit in supplement["records"]["home_health"]:
        if unit["selection"] != "certified_target_office_county" or unit["office_county"] not in counties:
            ledger.append({"source": "CMS POS home health", "officialId": unit["ccn"],
                           "officeCountyFips": unit["office_county_fips"], "status": "excluded",
                           "reason": "not_certified" if unit["source_record"]["fed_crtfctn_stus_name"] != "Certified"
                           else "office_outside_selected_counties"})
            continue
        row = by_ccn.get(unit["ccn"])
        original = unit["source_record"]
        identity = {"source": "CMS POS and PDC home health", "officialId": unit["ccn"],
                    "county": unit["office_county"], "officeCountyFips": unit["office_county_fips"],
                    "countyBasis": unit["county_assignment_basis"]}
        if row is None or row["zip_code"][:5] not in zips:
            ledger.append({**identity, "status": "unresolved", "reason": "home_health_office_missing_pdc_or_geography"})
            continue
        if (address_key(row["address"]) != address_key(original["st_adr"])
                or row["zip_code"][:5] != original["zip_cd"][:5]):
            ledger.append({**identity, "status": "unresolved", "reason": "pos_pdc_office_address_conflict",
                           "posAddress": original["st_adr"], "pdcAddress": row["address"]})
            continue
        provider = base_provider(
            f"cms-{unit['ccn']}", row["provider_name"], "home-health", row["address"],
            row["citytown"], row["zip_code"][:5],
            source({"url": metadata["landingPage"], "retrieved_at": pdc_receipt["retrieved_at"]},
                   metadata["title"], "Centers for Medicare & Medicaid Services",
                   "Exact agency CCN, physical business address, phone and explicitly offered services.",
                   metadata["released"][:10]))
        pos_receipt = manifest["receipts"][unit["source"]["file"]]
        provider["sources"].append(source(
            pos_receipt, "CMS iQIES Provider of Services, Q3 2026",
            "Centers for Medicare & Medicaid Services",
            f"Certified provider {unit['ccn']}. Reported office county FIPS "
            f"{unit['office_county_fips']}. This is not a service-area assertion.",
            original["processing_date"]))
        provider["description"] = (
            f"CMS certified home-health agency office in {unit['office_county']} County. "
            "Office location does not establish service coverage or current acceptance."
        )
        provider["services"] = [label for field, label in services.items() if row[field] == "Yes"]
        provider["phone"] = row["telephone_number"]
        provider["ownership"] = row["type_of_ownership"]
        provider["limitations"] = [
            "Nursing-home ratings, abuse flags, fines and inspection summaries do not apply to this agency record.",
            "Clinical stars and patient-experience surveys are not consumer review aggregates.",
            "No service area, current availability or private-pay acceptance is inferred from the office county.",
        ]
        location_point(provider, zips, kind="office")
        providers.append(provider)
        crosswalk.append({**identity, "providerId": provider["id"], "cmsCcn": unit["ccn"],
                          "sourceFile": relative + "/" + unit["source"]["file"],
                          "sourceRowIndex": unit["source"]["row_index"],
                          "sourceSha256": unit["source"]["response_sha256"],
                          "status": "included"})
    return {
        "status": "included_verified_offices",
        "limitation": "The stable cms-CCN provider ID identifies a home-health office. "
                      "The cms ratings object is nursing-home evidence and does not apply.",
        "providers": providers, "crosswalk": crosswalk,
    }


def clinical_inputs(inputs, providers, ledger):
    manifest = inputs.json("clinical/manifest.json")
    require(manifest["schemaVersion"] == 1, "Unsupported clinical manifest schema")
    prefix = "research/north-jersey/"
    for path, receipt in manifest["consumedArtifacts"].items():
        require(path.startswith(prefix), f"Clinical input outside NJ sources: {path}")
        relative = path.removeprefix(prefix)
        require((inputs.root / relative).resolve().is_relative_to(inputs.root.resolve()),
                f"Clinical input escapes source root: {path}")
        body = inputs.read(relative)
        require(len(body) == receipt["bytes"] and digest(body) == receipt["sha256"],
                f"Clinical consumed source mismatch: {path}. Rebuild clinical outputs.")
    artifacts = {}
    for key, name in (
        ("nursing", "nursing-cms-by-ccn.json"),
        ("inspectionHistory", "inspection-history.json"),
        ("homeHealthEvidence", "home-health-evidence.json"),
    ):
        body = inputs.read("clinical/" + name)
        receipt = manifest["outputs"][name]
        require(len(body) == receipt["bytes"] and digest(body) == receipt["sha256"],
                f"Clinical output hash mismatch: {name}")
        artifacts[key] = json.loads(body)
    nursing = {p["cms"]["ccn"]: p for p in providers if p["category"] == "nursing-home" and "cms" in p}
    for ccn, provider in nursing.items():
        require(ccn in artifacts["nursing"], f"Clinical nursing summary missing: {ccn}")
        provider["cms"] = artifacts["nursing"][ccn]
        require(provider["cms"]["ccn"] == ccn, f"Clinical nursing identity mismatch: {ccn}")
    history = artifacts["inspectionHistory"]
    require(set(nursing) <= set(history["facilities"]), "Clinical inspection history missing nursing units")
    history["facilities"] = {ccn: history["facilities"][ccn] for ccn in sorted(nursing)}
    offices = {p["id"]: p for p in providers if p["category"] == "home-health"}
    hh = artifacts["homeHealthEvidence"]
    agencies = {agency["organizationId"]: agency for agency in hh["agencies"]}
    require(len(agencies) == len(hh["agencies"]), "Duplicate clinical home-health office")
    require(set(offices) <= set(agencies), "Clinical evidence missing certified offices")
    for pid, provider in offices.items():
        agency = agencies[pid]
        require(pid == "cms-" + agency["ccn"], f"Clinical home-health identity mismatch: {pid}")
        address = agency["cmsAddress"]
        require(address["state"] == provider["state"] and address["zip"] == provider["zip"]
                and address_key(address["street"]) == address_key(provider["address"]),
                f"Clinical home-health office address mismatch: {pid}")
    hh["agencies"] = [agencies[pid] for pid in sorted(offices)]
    for name in sorted(set(manifest["outputs"]) - {
        "nursing-cms-by-ccn.json", "inspection-history.json", "home-health-evidence.json",
    }):
        ledger.append({"source": "Verified regional clinical research",
                       "sourceFile": "clinical/" + name, "sourceSha256": manifest["outputs"][name]["sha256"],
                       "status": "retained_separately",
                       "reason": "clinical_detail_outside_runtime_contract"})
    return history, hh


def publish_address_points(inputs, providers, county_by_id, counties):
    coverage = inputs.json("address-points/coverage.json")
    release = inputs.json("address-points/providers-by-id.json")
    require(coverage["releaseSha256"] == inputs.hashes["address-points/providers-by-id.json"],
            "Address point release hash mismatch")
    require({pid for pid, row in release.items() if row["county"] in counties}
            == {p["id"] for p in providers}, "Address release roster mismatch")
    labels = {"nj-address-point": "NJ address point",
              "nj-street-interpolated": "NJ interpolated street address",
              "census-street-interpolated": "Census interpolated street address"}
    for provider in providers:
        pid = provider["id"]
        row = release[pid]
        require(row["providerId"] == pid and row["name"] == provider["name"] and
                row["setting"] == provider["category"] and row["county"] == county_by_id[pid] and
                row["suppliedAddress"] == {k: provider[k] for k in ("address", "city", "state", "zip")} and
                row["suppliedCoordinate"] == {k: provider[k] for k in ("lat", "lng", "locationKind")},
                f"Address point identity or baseline changed for {pid}")
        if row["status"] == "fallback":
            require((row["lat"], row["lng"]) == (provider["lat"], provider["lng"]),
                    f"Unexpected fallback coordinate for {pid}")
            require(row["coordinateAccuracy"] in ("zip-representative-point", "supplied-coordinate-unverified"),
                    f"Invalid fallback precision for {pid}")
            if row["coordinateAccuracy"] == "supplied-coordinate-unverified":
                provider["limitations"].append("Map position uses the coordinates supplied in the official listing. An independent street-address match was unavailable.")
            continue
        accuracy = row["coordinateAccuracy"]
        match = row["match"]
        required_checks = ("exactStreetNumberAndName", "exactZip", "stateNJ", "countyAgrees",
                           "finiteNJCoordinates", "notZipRepresentativePoint", "streetLevelType")
        require(row["status"] == "matched" and accuracy in labels and match["accepted"] and
                all(match["checks"][key] is True for key in required_checks) and
                (row["lat"], row["lng"], accuracy) == (match["lat"], match["lng"], match["coordinateAccuracy"]),
                f"Unverified address for {pid}")
        provider.update(lat=row["lat"], lng=row["lng"],
                        locationKind="office" if provider["category"] in ("home-health", "home-care") else "facility")
        provider["limitations"] = [note for note in provider["limitations"]
                                   if note != "Coordinates are an approximate ZIP representative point, not a verified facility or office entrance."]
        provider["limitations"].append(f"Map position uses a {labels[accuracy]}. Entrance and suite are unverified.")
        provider["sources"].append({
            "title": labels[accuracy], "url": match["url"], "kind": "regulatory",
            "publisher": "U.S. Census Bureau" if accuracy.startswith("census") else "NJ Office of GIS",
            "checkedAt": match["checkedAt"], "supports": "Address-level map position. " + labels[accuracy] + ".",
        })
    return release


def add_public_review_context(inputs, records, roster, counties):
    """Project the checked-in editorial decisions. Restricted profiles supply links only."""
    for pid, decision in inputs.json("review-excerpts/reviewed.json").items():
        require(pid in roster and roster[pid]["suppliedAddress"]["address"] == decision["catalogAddress"],
                f"Review context provider identity changed: {pid}")
        if roster[pid]["county"] not in counties:
            continue
        require(pid in records, f"Missing researched location for reviewed context: {pid}")
        record = records[pid]
        if links := decision.get("reviewLinks"):
            record["reviewLinks"] = links
        page = decision.get("testimonials")
        if not page:
            continue
        require(re.fullmatch(r"[0-9a-f]{64}", page["retrievedPageSha256"]), f"Missing testimonial receipt: {pid}")
        excerpts = page["excerpts"]
        require(0 < sum(len(row["excerpt"].split()) for row in excerpts) <= 25,
                f"Invalid total excerpt length for {pid}")
        source_id = pid + "-operator-testimonials"
        record["sources"].append({"id": source_id, "title": "Patient and family testimonials",
                                  "publisher": page["publisher"], "url": page["url"], "kind": "provider",
                                  "checkedAt": page["checkedAt"], "publishedAt": None, "access": "full-page"})
        for row in excerpts:
            record["reviews"].append({
                "id": row["id"], "sourceId": source_id, "url": page["url"], "date": None,
                "relationship": row["relationship"], "excerpt": row["excerpt"], "summary": row["summary"],
                "rating": None, "scale": None, "aspects": [],
                "notes": ["Selected by the operator. The page gives no review date or rating.",
                          "The relationship is self-reported. This account does not contribute to the experience score."],
            })
        record["checkedAt"] = max(record["checkedAt"], page["checkedAt"])


def released_research(inputs, roster, counties):
    combined = {}
    for origin in ("offerings", "review-release"):
        name = "locationResearch.json"
        relative = f"{origin}/{name}"
        manifest_path = f"{origin}/manifest.json"
        records = inputs.json(relative)
        manifest = inputs.json(manifest_path)
        expected = manifest["outputs"][name]
        if origin == "offerings":
            expected = expected["sha256"]
        require(inputs.hashes[relative] == expected, f"{origin} release hash mismatch")
        for pid, record in records.items():
            require(pid in roster and record["providerId"] == pid, f"{origin}: unknown location {pid}")
            if roster[pid]["county"] not in counties:
                continue
            if pid not in combined:
                combined[pid] = record
                continue
            target = combined[pid]
            for field in ("sources", "facts", "reviewAggregates", "reviews", "notes"):
                for item in record[field]:
                    if item not in target[field]:
                        target[field].append(item)
            if "reviewSamples" in record:
                require("reviewSamples" not in target, f"Duplicate review sample producer for {pid}")
                target["reviewSamples"] = record["reviewSamples"]
            for field in ("availability", "admissionRestriction"):
                value = record.get(field)
                if value and value.get("sourceId"):
                    require(not target.get(field, {}).get("sourceId") or target[field] == value,
                            f"Conflicting {field} at {pid}")
                    target[field] = value
            target["checkedAt"] = max(target["checkedAt"], record["checkedAt"])
            target["providerDetailsReviewed"] |= record["providerDetailsReviewed"]
    add_public_review_context(inputs, combined, roster, counties)
    return combined


def reviewed_facebook(inputs, providers):
    directory = "facebook/reconciliation/"
    spec = importlib.util.spec_from_file_location("facebook_release", ROOT / "scripts/regions/facebook-release.py")
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    manifest = inputs.json(directory + "release-manifest.json")
    require(manifest["schemaVersion"] == 1 and manifest["publication"] == "reviewed_qualitative"
            and manifest["scoreEligible"] is False, "Unreviewed Facebook release")
    expected_inputs = set(release.TRUSTED_INPUTS)
    require(set(manifest["trustedInputs"]) == expected_inputs, "Facebook trusted input set mismatch")
    for name, expected in manifest["trustedInputs"].items():
        require(digest(inputs.read(name)) == expected, "Facebook trusted input hash mismatch")
    require(set(manifest["outputs"]) == {"reviewed-coverage.json", "release-audit.json"},
            "Facebook output set mismatch")
    for name, expected in manifest["outputs"].items():
        require(digest(inputs.read(directory + name)) == expected, "Facebook release hash mismatch")
    dataset = inputs.json(directory + "reviewed-coverage.json")
    catalog = list(csv.DictReader(io.StringIO(inputs.read("facebook/kit/kit.csv").decode())))
    require(len(catalog) == 20 and len({row["provider_id"] for row in catalog}) == 20,
            "Facebook assignment roster mismatch")
    require(set(dataset["locations"]) == {row["provider_id"] for row in catalog},
            "Facebook coverage assignment mismatch")
    by_id = {provider["id"]: provider for provider in providers}
    for row in catalog:
        pid = row["provider_id"]
        if pid not in by_id:
            continue
        provider = by_id[pid]
        require(all(row[key] == provider[key] for key in ("name", "address", "city", "state", "zip"))
                and row["care_category"] == provider["category"], "Facebook provider identity changed")
    selections, _ = release.approved_inputs(inputs.read)
    audit = inputs.json(directory + "release-audit.json")
    approved = {(pid, oid) for pid, selection in selections.items()
                for oid in selection["sourceObservationIds"]}
    rows = audit["rows"]
    require(set(selections) <= set(dataset["locations"])
            and audit["publication"] == manifest["publication"] and audit["scoreEligible"] is False
            and len(rows) == len({row["observationId"] for row in rows}) == 84
            and all(row["scoreEligible"] is False for row in rows)
            and {(row["providerId"], row["observationId"]) for row in rows
                 if row["disposition"] == "published"} == approved,
            "Facebook audit differs from reviewed selection")
    retained_counts = Counter(row["providerId"] for row in rows)
    for pid, location in dataset["locations"].items():
        expected = [release.finding_projection(selections[pid])] if pid in selections else []
        require(location["findings"] == expected, "Facebook finding differs from reviewed selection")
        published = sum(len(finding["sourceObservationIds"]) for finding in expected)
        statuses = {"findings-available"} if published else {"withheld", "partial", "no-relevant-result"}
        require(location["publishedObservationCount"] == published
                and location["foundCount"] == retained_counts[pid]
                and location["status"] in statuses
                and location["withheldCount"] >= 0
                and location["foundCount"] == published + location["withheldCount"],
                "Facebook reviewed counts or status invalid")
        require(location["status"] != "no-relevant-result" or location["foundCount"] == 0,
                "Facebook no-result state has observations")
    dataset["locations"] = {pid: row for pid, row in dataset["locations"].items() if pid in by_id}
    return dataset


def evidence_coverage(inputs, providers, addresses, research):
    scores = {}
    if "review-release/manifest.json" in inputs.hashes:
        path = "review-release/experience-verification.json"
        scores = inputs.json(path)["releasedOutput"]
        receipt = inputs.json("review-release/manifest.json")["outputs"]["experience-verification.json"]
        require(digest(inputs.read(path)) == receipt, "Review scorer receipt mismatch")
    groups = {}
    for provider in providers:
        pid = provider["id"]
        address = addresses[pid]
        category = provider["category"]
        bucket = groups.setdefault(address["county"], {}).setdefault(category, Counter())
        detail = research.get(pid, {})
        facts = detail.get("facts", [])
        bucket.update({
            "locations": 1, "streetMatched": address["status"] == "matched",
            "locationsWithFacts": bool(facts), "locationsWithPublishedRate": any(f.get("amount") for f in facts),
            "locationsWithReviewAggregate": bool(detail.get("reviewAggregates")),
            "scoredLocations": scores.get(pid, {}).get("value") is not None,
            "publishedWaitlists": detail.get("availability", {}).get("status") == "waitlist-published",
            "publishedOpenings": detail.get("availability", {}).get("status") == "opening-published",
        })
    return groups


def normalize(root, counties, *, source_only=False):
    inputs = Inputs(root)
    geography_manifest = inputs.json("geography/manifest.json")
    zips = inputs.json("geography/nj-zips.json")
    for name in ("nj-zips.json", "nj-county-zips.json", "nj-zips-provenance.json"):
        require(digest(inputs.read("geography/" + name)) ==
                geography_manifest["outputs"][name]["sha256"], f"Geography hash mismatch: {name}")
    receipt = inputs.receipt("state/raw/ltc.xlsx")
    rows = workbook_rows(inputs.read("state/raw/ltc.xlsx"))
    require(len({row["FacID"] for row in rows}) == len(rows), "Duplicate DOH facility ID")
    providers, crosswalk, ledger, raw_units = [], [], [], {}
    county_by_id = {}
    for row in rows:
        county = row["COUNTY"].title()
        identity = {"source": "NJ DOH All_LTC", "sourceRow": row["source_row"],
                    "sourceFile": "state/raw/ltc.xlsx", "officialId": row["FacID"],
                    "license": row["LIC#"], "licensedName": row["LICENSED_NAME"],
                    "licensedSetting": row["FACILITY_TYPE"], "county": county}
        if county not in counties:
            ledger.append({**identity, "status": "excluded", "reason": "outside_selected_counties"})
            continue
        category = TYPES.get(row["FACILITY_TYPE"])
        if category is None:
            ledger.append({**identity, "status": "excluded", "reason": "no_exact_runtime_care_category"})
            continue
        zip_code = row["ZIP"][:5]
        if zip_code not in zips:
            ledger.append({**identity, "status": "unresolved", "reason": "postal_zip_missing_from_geography"})
            continue
        pid = f"{MARKET}-doh-{slug(row['FacID'])}"
        as_of = excel_date(row["RunDate"])
        name = re.sub(r"\s*\(" + re.escape(row["FacID"]) + r"\)$", "", row["LICENSED_NAME"])
        address = clean(row["ADDRESS"])
        provider = base_provider(pid, name, category, address, row["FAC_CITY"], zip_code,
                                 source(receipt, "NJ DOH licensed long-term care facilities",
                                        "New Jersey Department of Health",
                                        f"Facility {row['FacID']}, license {row['LIC#']}, worksheet row "
                                        f"{row['source_row']}. Exact licensed unit, address, type, capacity "
                                        "and published coordinates. Not a campus-wide certification.", as_of))
        location_point(provider, zips, row["LAT"], row["LNG"])
        provider["description"] = f"NJ DOH listed licensed setting: {row['FACILITY_TYPE']}. Facility ID {row['FacID']}."
        provider["services"] = [row["FACILITY_TYPE"]]
        if clean(row["TELEPHONE"]) and row["TELEPHONE"] != "0":
            provider["phone"] = clean(row["TELEPHONE"])
        capacity = number(row["Lic_Beds_Slots"])
        if capacity is not None and capacity > 0:
            provider["capacity"] = int(capacity)
        if clean(row["OWNDESC"]):
            provider["ownership"] = clean(row["OWNDESC"])
        provider["limitations"].append(
            "Official listing, not a live license-status, admission, service availability or Medicare certification check."
        )
        if category == "assisted-living" and row["FACILITY_TYPE"] != "ASSISTED LIVING RESIDENCE":
            provider["limitations"].append(
                "Assisted living is a discovery grouping. The exact licensed setting is shown, not reclassified."
            )
        crosswalk.append({**identity, "providerId": pid, "status": "included",
                          "sourceSha256": receipt["sha256"], "sourceAsOf": as_of,
                          "cmsCcn": None, "cmsMatchBasis": None})
        raw_units[pid] = row
        county_by_id[pid] = county
        providers.append(provider)

    cms_manifest_path = root / "cms/manifest.json"
    if not cms_manifest_path.exists():
        cms_manifest_path = root / "cms/manifest.partial.json"
    cms_status = "pending_complete_cms_manifest"
    if cms_manifest_path.exists():
        cms_manifest = inputs.json(str(cms_manifest_path.relative_to(root)))
        nursing, metadata = cms_dataset(inputs, cms_manifest, "4pq5-n9py")
        cms_status = "complete" if cms_manifest["status"] == "complete" else "collecting"
    else:
        cms_manifest, nursing, metadata = {}, None, None
    if nursing is not None:
        nursing = [row for row in nursing if row["countyparish"] in counties]
        cms_row_sources = {}
        for partition in metadata["partitions"]:
            for receipt in partition["pages"]:
                for index, row in enumerate(inputs.json("cms/" + receipt["file"])["results"]):
                    cms_row_sources[row[CCN]] = {
                        "cmsSourceFile": "cms/" + receipt["file"],
                        "cmsSourceRowIndex": index, "cmsSourceSha256": receipt["sha256"],
                    }
        address_index = defaultdict(list)
        for provider in providers:
            if provider["category"] == "nursing-home":
                row = raw_units[provider["id"]]
                street = row["ADDRESS"].splitlines()[0]
                address_index[(provider["zip"], address_key(street))].append(provider)
        cms_keys = Counter((row["zip_code"][:5], address_key(row["provider_address"])) for row in nursing)
        for row in nursing:
            if row["countyparish"] not in counties:
                continue
            key = (row["zip_code"][:5], address_key(row["provider_address"]))
            matches = address_index.get(key, [])
            if (len(matches) == 1 and cms_keys[key] == 1
                    and name_key(matches[0]["name"]) == name_key(row["provider_name"])):
                provider = matches[0]
                old_id = provider["id"]
                provider["id"] = f"cms-{row[CCN]}"
                provider["cms"] = cms_summary(row, metadata["released"][:10])
                provider["sources"].append(source(
                    {"url": metadata["landing_url"], "retrieved_at": metadata["retrieved_at"]},
                    metadata["title"], "Centers for Medicare & Medicaid Services",
                    "Exact unique nursing-unit street address and ZIP match. CMS clinical evidence "
                    "belongs only to this CCN, not assisted living or a campus.", metadata["released"][:10]))
                for match in crosswalk:
                    if match["providerId"] == old_id:
                        match.update(providerId=provider["id"], cmsCcn=row[CCN],
                                     cmsMatchBasis="unique_nursing_unit_normalized_name_street_and_zip",
                                     cmsName=row["provider_name"], cmsAddress=row["provider_address"],
                                     cmsDataset="4pq5-n9py")
                        match.update(cms_row_sources[row[CCN]])
                county_by_id[provider["id"]] = county_by_id.pop(old_id)
                if provider["cms"]["abuse"]:
                    provider["warnings"].append("CMS abuse icon is present for this certified nursing unit.")
                if provider["cms"]["specialFocus"]:
                    provider["warnings"].append("CMS special-focus status: " + provider["cms"]["specialFocus"])
            else:
                ledger.append({"source": "CMS Provider Information", "officialId": row[CCN],
                               "county": row["countyparish"], "status": "unresolved",
                               "reason": "no_unique_exact_nursing_unit_address_match",
                               "cmsName": row["provider_name"], "cmsAddress": row["provider_address"],
                               "candidateProviderIds": [p["id"] for p in matches]})
                for candidate in matches:
                    candidate["limitations"].append(
                        f"Possible CMS identity {row[CCN]} remains unresolved. "
                        "Separate source records must not be counted as distinct physical facilities."
                    )
                if row["zip_code"][:5] not in zips:
                    continue
                provider = base_provider(
                    f"cms-{row[CCN]}", row["provider_name"], "nursing-home",
                    row["provider_address"], row["citytown"], row["zip_code"][:5],
                    source({"url": metadata["landing_url"], "retrieved_at": metadata["retrieved_at"]},
                           metadata["title"], "Centers for Medicare & Medicaid Services",
                           "Exact CMS certified nursing-home roster record. State-license identity unresolved.",
                           metadata["released"][:10]))
                provider["cms"] = cms_summary(row, metadata["released"][:10])
                location_point(provider, zips, row.get("latitude"), row.get("longitude"))
                provider["description"] = "CMS certified nursing-home record. State-license crosswalk is unresolved."
                provider["limitations"].append(
                    "Not merged with a state licensed unit or campus without an exact name and address match. "
                    "Separate source records may describe the same physical facility."
                )
                county_by_id[provider["id"]] = row["countyparish"]
                crosswalk.append({"source": "CMS Provider Information", "officialId": row[CCN],
                                  "providerId": provider["id"], "status": "included_cms_only",
                                  "cmsCcn": row[CCN], "county": row["countyparish"],
                                  "sourceAsOf": metadata["released"][:10],
                                  **cms_row_sources[row[CCN]]})
                providers.append(provider)
        for provider in providers:
            if "cms" not in provider:
                continue
            row = next(row for row in nursing if row[CCN] == provider["cms"]["ccn"])
            footnotes = {key: value for key, value in row.items()
                         if key.endswith("_footnote") and clean(value)}
            if footnotes:
                provider["limitations"].append(
                    "CMS published footnote codes retained with source field names: "
                    + "; ".join(f"{key}={value}" for key, value in sorted(footnotes.items())) + "."
                )
            provider["limitations"].append(
                "CMS release date is not a measurement period. Staffing and clinical measures can cover different periods."
            )
            if provider["cms"]["abuse"] and not provider["warnings"]:
                provider["warnings"].append("CMS abuse icon is present for this certified nursing unit.")
            if provider["cms"]["specialFocus"] and not any("special-focus" in w for w in provider["warnings"]):
                provider["warnings"].append("CMS special-focus status: " + provider["cms"]["specialFocus"])
    service_edges_path = root / "cms/home_health_service_zip_edges.json"
    if service_edges_path.exists() and cms_manifest.get("status") == "complete":
        reference = next(item for item in cms_manifest["artifacts"]
                         if item["file"] == "home_health_service_zip_edges.json")
        require(digest(inputs.read("cms/home_health_service_zip_edges.json")) == reference["sha256"],
                "Derived CMS service edge hash mismatch")
        for edge in inputs.json("cms/home_health_service_zip_edges.json"):
            ledger.append({"source": "CMS home-health service ZIPs", "officialId": edge["ccn"],
                           "status": "retained_separately",
                           "reason": "service_coverage_is_not_an_office_location", "edge": edge})

    state_status = {}
    seen_firms = {}
    firms_receipt = inputs.receipt("state/raw/firms.xlsx")
    firm_rows = workbook_rows(inputs.read("state/raw/firms.xlsx"))
    require(len(firm_rows) == firms_receipt["displayed_rows"], "Incomplete HP registry export")
    firm_rows_by_number = {row["source_row"]: row for row in firm_rows}
    for county in counties:
        for kind in ("home-care-firms", "ccrc-campuses"):
            relative = f"state/{county.lower()}/{kind}.json"
            if not (root / relative).exists():
                state_status[f"{county}/{kind}"] = "pending_source"
                continue
            records = inputs.json(relative)
            state_status[f"{county}/{kind}"] = len(records)
            for record in records:
                provenance = record["source"]
                require(digest(inputs.read("state/" + provenance["file"])) == provenance["sha256"],
                        f"State derived source hash mismatch: {relative}")
                if kind == "home-care-firms":
                    require(record["source_fields"] == firm_rows_by_number[provenance["row"]],
                            "Derived HP row differs from original XLSX row")
                    for reference in record["county_reference_sources"]:
                        require(digest(inputs.read("state/" + reference["file"])) == reference["sha256"],
                                "County reference source hash mismatch")
                    identity = {"source": "NJ HP registry", "sourceFile": relative,
                                "sourceRow": provenance["row"],
                                "officialId": record["official_registration_id"], "county": county}
                    if record["license_status"] != "Active":
                        ledger.append({**identity, "status": "excluded", "reason": "registration_not_active",
                                       "registrationStatus": record["license_status"]})
                        continue
                    if record["official_registration_id"] in seen_firms:
                        previous = seen_firms[record["official_registration_id"]]
                        require(all(record[k] == previous[k] for k in
                                    ("name", "address", "city", "state", "zip", "license_status")),
                                f"Conflicting active HP registration: {record['official_registration_id']}")
                        crosswalk.append({**identity, "providerId": f"{MARKET}-hp-{slug(record['official_registration_id'])}",
                                          "status": "duplicate_source_row", "sourceSha256": provenance["sha256"]})
                        continue
                    seen_firms[record["official_registration_id"]] = record
                    zip_code = clean(record["zip"])[:5]
                    if zip_code not in zips or not clean(record["address"]):
                        ledger.append({**identity, "status": "unresolved", "reason": "office_address_or_zip_missing"})
                        continue
                    pid = f"{MARKET}-hp-{slug(record['official_registration_id'])}"
                    provider = base_provider(
                        pid, record["name"], "home-care", clean(record["address"]),
                        record["city"], zip_code,
                        source(provenance, "NJ health care service firm registration",
                               "New Jersey Division of Consumer Affairs",
                               f"Registration {record['official_registration_id']}, source row {provenance['row']}. "
                               "Active registry status and business office address only."))
                    provider["description"] = (
                        f"Registered health care service firm. Registration {record['official_registration_id']} "
                        f"is listed Active. Business office in {record['city']}. Not a verified service area."
                    )
                    provider["limitations"] = [
                        "Registry source date is not published. checkedAt is retrieval date, not an effective date.",
                        "Registration does not establish Medicare certification, private-pay acceptance, current staffing, "
                        "home visits, specific services or availability.",
                        "Physical business address and county are not countywide service coverage.",
                    ]
                    if record.get("license_expires"):
                        provider["limitations"].append(
                            "Portal lists expiration " + record["license_expires"] +
                            ". Active status is retained as published; neither field overrides the other."
                        )
                    phone = clean(record["source_fields"].get("Business Phone"))
                    if phone and phone != "0":
                        provider["phone"] = phone
                    location_point(provider, zips, kind="office")
                    crosswalk.append({**identity, "providerId": pid, "status": "included",
                                      "sourceSha256": provenance["sha256"], "sourceAsOf": None,
                                      "countyBasis": record["county_basis"], "cmsCcn": None})
                else:
                    # The guide publishes only month precision and no campus certification ID.
                    match = re.fullmatch(r"(.+),\s*([^,]+),\s*NJ\s+(\d{5})", clean(record["address"]))
                    identity = {"source": "NJ DCA historical CCRC directory", "sourceFile": relative,
                                "sourcePdfPage": provenance["pdf_page"], "county": county,
                                "campusName": record["name"], "sourceAsOf": record["source_date"]}
                    if not match or match[3] not in zips:
                        ledger.append({**identity, "status": "unresolved", "reason": "historical_campus_address_not_parseable"})
                        continue
                    street, city, zip_code = match.groups()
                    pid = f"{MARKET}-campus-{slug(record['name'])}-{zip_code}"
                    provider = base_provider(
                        pid, record["name"], "life-plan", street, city, zip_code,
                        source(provenance, "NJ DCA CCRC consumer guide, revised January 2018",
                               "New Jersey Department of Community Affairs",
                               f"Historical named campus listing, PDF page {provenance['pdf_page']}. "
                               "Source date has month precision, 2018-01. No campus certificate ID is published."))
                    provider["description"] = (
                        "Named continuing-care campus in the January 2018 NJ DCA guide. "
                        "Historical discovery record, not confirmation of current operation or licensure."
                    )
                    provider["warnings"] = ["Historical January 2018 listing. Confirm current campus status directly."]
                    provider["limitations"] = [
                        "No current campus certificate or licensed care-unit linkage established. "
                        "Clinical ratings and unit capacity are not campus-wide evidence.",
                        "January 2018 is month precision. No day or current source date has been invented.",
                    ]
                    location_point(provider, zips)
                    crosswalk.append({**identity, "providerId": pid, "status": "included_historical",
                                      "officialId": None, "sourceSha256": provenance["sha256"],
                                      "cmsCcn": None})
                county_by_id[provider["id"]] = county
                providers.append(provider)

    unresolved = "state/unresolved-home-care-counties.json"
    if (root / unresolved).exists():
        for record in inputs.json(unresolved):
            ledger.append({"source": "NJ HP registry", "officialId": record["official_registration_id"],
                           "sourceRow": record["source"]["row"], "status": "unresolved",
                           "reason": "office_county_not_verified", "countyCandidates": record["county_candidates"]})
    disposed_firm_rows = {row["sourceRow"] for row in crosswalk + ledger if row["source"] == "NJ HP registry"}
    for row in firm_rows:
        if row["source_row"] not in disposed_firm_rows:
            ledger.append({"source": "NJ HP registry", "sourceFile": "state/raw/firms.xlsx",
                           "sourceRow": row["source_row"], "officialId": row["License/Registration"],
                           "status": "excluded", "reason": "registration_outside_retained_county_scope",
                           "officeCity": row["Business City"], "officeState": row["Business USA State"],
                           "officeZip": row["Business Zipcode"]})
    home_health = home_health_inputs(inputs, zips, counties, ledger)
    providers.extend(home_health["providers"])
    crosswalk.extend(home_health["crosswalk"])
    county_by_id.update({row["providerId"]: row["county"] for row in home_health["crosswalk"]})
    inspections, home_health_evidence = clinical_inputs(inputs, providers, ledger)
    providers.sort(key=lambda p: p["id"])
    require(len({p["id"] for p in providers}) == len(providers), "Duplicate provider ID")
    research = {}
    if not source_only:
        address_roster = publish_address_points(inputs, providers, county_by_id, counties)
        research = released_research(inputs, address_roster, counties)
    as_of = max(s["checkedAt"] for p in providers for s in p["sources"])
    meta = {
        "asOf": as_of, "catalogTotal": len(providers),
        "categories": dict(sorted(Counter(p["category"] for p in providers).items())),
        "countyCounts": {county: dict(Counter(p["category"] for p in providers
                                             if county_by_id[p["id"]] == county)) for county in counties},
        "scope": "Licensed care units, certified home-health offices, active registered business offices "
                 "and explicitly historical named campuses.",
        "limitations": [
            "Missing services, price, openings, reviews and certification links remain missing.",
            "CMS citation and penalty totals describe the retained reporting window, not lifetime safety histories.",
            "Record totals are source identities, not unique physical facilities or brands. "
            "Unresolved CMS/state pairs and separate active firm registrations can share premises.",
            "CMS home-health service coverage is not used to place an office in a county.",
            "ZIP locations from Census 2026 Gazetteer and GeoNames CC BY 4.0. "
            "County overlaps from Census 2020. ZIP fallback points are approximate.",
        ],
    }
    artifacts = {"providers": providers, "zips": zips, "meta": meta,
                 "inspectionHistory": inspections, "homeHealthEvidence": home_health_evidence}
    if research:
        artifacts["locationResearch"] = research
        as_of = max(as_of, max(row["checkedAt"] for row in research.values()))
        meta["asOf"] = as_of
    if not source_only:
        artifacts["facebookResearch"] = reviewed_facebook(inputs, providers)
    files = {f"{key}.json": encode(value) for key, value in artifacts.items()}
    manifest = {
        "schemaVersion": 1,
        "markets": [{
            "id": MARKET, "label": "North Jersey", "state": "NJ", "defaultZip": "07960",
            "review": {"status": "reviewed", "reviewedAt": as_of,
                       "reviewer": "NJ source and location identity verification; release-manifest checks"},
            "artifacts": {key: {"path": f"runtime/{key}.json", "sha256": digest(files[f"{key}.json"]),
                                "count": value["catalogTotal"] if key == "meta" else
                                len(value["facilities"]) if key == "inspectionHistory" else
                                len(value["agencies"]) if key == "homeHealthEvidence" else
                                len(value["locations"]) if key == "facebookResearch" else len(value)}
                          for key, value in artifacts.items()},
        }],
    }
    files["crosswalk.json"] = encode(crosswalk)
    files["home-health-release-inputs.json"] = encode(home_health)
    files["unresolved-exclusions.json"] = encode(ledger)
    coverage = evidence_coverage(inputs, providers, address_roster, research) if not source_only else {}
    files["source-inputs.json"] = encode({
        "schemaVersion": 1, "counties": list(counties),
        "files": inputs.hashes, "cmsStatus": cms_status, "stateStatus": state_status,
    })
    files["validation.json"] = encode({
        "providerCount": len(providers), "categories": meta["categories"], "evidenceByCountyAndSetting": coverage,
        "countyCounts": meta["countyCounts"], "cmsStatus": cms_status,
        "cmsLinkedCount": sum("cms" in p for p in providers),
        "verifiedHomeHealthOfficeInputs": len(home_health["providers"]),
        "publishedHomeHealthOffices": len(home_health_evidence["agencies"]),
        "inspectionFacilities": len(inspections["facilities"]) if inspections is not None else 0,
        "inspectionTotals": {
            collection: sum(facility[collection]["total"] for facility in inspections["facilities"].values()
                            if facility[collection] is not None)
            for collection in ("healthCitations", "penalties")
        } if inspections is not None else None,
        "dohSourceRows": len(rows), "crosswalkRows": len(crosswalk),
        "ledgerReasons": dict(sorted(Counter(item["reason"] for item in ledger).items())),
        "examples": {zip_code: [{"id": p["id"], "name": p["name"], "address": p["address"],
                                 "category": p["category"],
                                 "cmsCcn": p["id"].removeprefix("cms-") if p["id"].startswith("cms-") else None}
                                for p in providers if p["zip"] == zip_code]
                     for zip_code in ("07960", "07083")},
    })
    inputs.verify()
    return files, manifest


def validate_release(files, manifest):
    spec = importlib.util.spec_from_file_location("region_builder", ROOT / "scripts/regions/build-region.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    with tempfile.TemporaryDirectory(prefix="harbor-nj-normalize-") as temporary:
        directory = Path(temporary)
        (directory / "runtime").mkdir()
        for name, body in files.items():
            (directory / "runtime" / name).write_bytes(body)
        manifest_path = directory / "runtime-manifest.json"
        manifest_path.write_bytes(encode(manifest))
        markets = builder.build(manifest_path, builder.DEFAULT_OUTPUT)
    require(len(markets) == 1 and markets[0]["id"] == MARKET, "Unexpected runtime market")
    return markets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counties", nargs="+", choices=COUNTIES, default=list(COUNTIES))
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--base-output", type=Path, metavar="NEW_DIRECTORY",
                        help="Write the official location inputs for a fresh address/research capture")
    args = parser.parse_args()
    if args.base_output is not None:
        require(not args.check, "--check verifies the published release; omit --base-output")
        files, _ = normalize(RESEARCH, args.counties, source_only=True)
        args.base_output.mkdir(parents=True, exist_ok=False)
        for name in ("providers.json", "crosswalk.json", "zips.json", "meta.json"):
            (args.base_output / name).write_bytes(files[name])
        print(f"Wrote four original location inputs to {args.base_output}")
        return
    files, manifest = normalize(RESEARCH, args.counties)
    validate_release(files, manifest)
    files_to_write = {OUTPUT / name: body for name, body in files.items()}
    files_to_write[RESEARCH / "runtime-manifest.json"] = encode(manifest)
    for path, body in files_to_write.items():
        if args.check:
            require(path.read_bytes() == body, f"Output differs: {path}. Rerun normalizer.")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
    validation = json.loads(files["validation.json"])
    print(json.dumps({key: value for key, value in validation.items() if key != "examples"}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f"NJ normalization failed: {error}", file=sys.stderr)
        sys.exit(1)
