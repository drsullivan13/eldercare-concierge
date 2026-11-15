#!/usr/bin/env python3
"""Replay exact-office directory research from retained source pages."""

import argparse
import collections
import csv
import gzip
from functools import cache
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET


if not __debug__:
    raise SystemExit("Run without -O. Research validation must stay enabled.")


ROOT = Path(__file__).resolve().parent
CHECKED = "2026-11-14"
LANDING = "https://www.fideliscarenj.com/members/medicaid/nj-familycare/provider-directories.html"
PREFIX = "https://www.fideliscarenj.com/content/dam/centene/wellcare/nj/pdfs/directories/NJ_Caid_Provider_Directory_Region_"
REGIONS = {
    "1_1": ["Bergen", "Warren"],
    "1_2": ["Passaic", "Sussex"],
    "2_1": ["Essex"],
    "2_2": ["Hudson"],
    "3_1": ["Middlesex"],
    "3_2": ["Morris", "Union"],
    "4_2": ["Monmouth", "Somerset"],
}
ANCILLARY_ALL_PAGES = {
    "1_1": 204, "1_2": 125, "2_1": 162, "2_2": 98,
    "3_1": 180, "3_2": 170, "4_2": 158,
}
SECTIONS = {"Ancillary Providers", "Managed Long Term Services and Supports"}
HOME_SECTIONS = {
    "Home Health Care",
    "Licensed Home Care Service Agency",
    "Personal Care Services",
    "Respite Care Services",
    "Chore/Housekeeping Services",
    "Private Duty Nursing",
    "Adult Family Home Care",
    "Attendant Care",
}
CAVEAT = (
    "Historical Fidelis Care NJ FamilyCare directory listing evidence only. "
    "Not evidence of current eligibility, an active contract, authorization, "
    "availability, unlisted services, or guaranteed insurance coverage. "
    "Not found is not nonparticipation. Other NJ FamilyCare plans were not searched."
)
PHONE = re.compile(r"^\(\d{3}\) \d{3}-\d{4}$")
CITY = re.compile(r"^(.+), NJ (\d{5}(?:-\d{4})?)$")
ADDRESS_WORDS = {
    "STREET": "ST", "ROAD": "RD", "AVENUE": "AVE", "BOULEVARD": "BLVD",
    "DRIVE": "DR", "LANE": "LN", "COURT": "CT", "PLACE": "PL",
    "PLAZA": "PLZ", "HIGHWAY": "HWY", "ROUTE": "RTE", "TURNPIKE": "TPKE",
    "PARKWAY": "PKWY", "TERRACE": "TER", "SUITE": "STE", "FLOOR": "FL",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "FIRST": "1", "SECOND": "2", "THIRD": "3",
}
DBA_PARTITIONS = {
    "PRIORITY NURSING SERVICES, WESTERN MEDICAL SERVICES A DIV. OF":
        ("PRIORITY NURSING SERVICES", "WESTERN MEDICAL SERVICES A DIV. OF"),
    "ALWAYS THERE, INC., ALWAYS THERE HOME HEALTH CARE":
        ("ALWAYS THERE, INC.", "ALWAYS THERE HOME HEALTH CARE"),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def url(region):
    return PREFIX + region + "_Eng_Spa_R.PDF"


def capture():
    """Retain original page text and XML, never just match projections."""
    sources = ROOT / "sources"
    previous = json.loads((sources / "manifest.json").read_text()) if (sources / "manifest.json").exists() else None
    manifest = {
        "checkedDate": CHECKED,
        "discoveryUrl": LANDING,
        "rosterSha256": digest((sources / "roster.csv").read_bytes()),
        "rosterOrigin": "/tmp/harbor-agency-exact-office-dba-bridge.csv",
        "extractor": subprocess.check_output(["pdftotext", "-v"], stderr=subprocess.STDOUT).decode().splitlines()[0],
        "sources": {},
    }
    ancillary = {}
    full_raw = {}
    with tempfile.TemporaryDirectory(prefix=".capture-", dir=sources) as temporary:
        for region, counties in REGIONS.items():
            data = subprocess.check_output([
                "curl", "--fail", "--location", "--silent", "--show-error",
                "--max-time", "180", url(region),
            ], timeout=195)
            assert data.startswith(b"%PDF-"), region
            source_hash = digest(data)
            if previous:
                assert source_hash == previous["sources"][region]["pdfSha256"], "Source changed; do not relabel a new snapshot."
            pdf = Path(temporary) / "source.pdf"
            pdf.write_bytes(data)
            layout = subprocess.check_output(["pdftotext", "-layout", str(pdf), "-"]).decode()
            pages = layout.split("\f")
            assert not pages[-1].strip()
            pages.pop()
            raw_pages = subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"]).decode().split("\f")
            assert not raw_pages.pop().strip()
            assert len(raw_pages) == len(pages)
            full_raw[region] = {
                "sourceUrl": url(region), "sourcePdfSha256": source_hash,
                "sourceDate": "2026-10-06", "checkedDate": CHECKED,
                "pages": raw_pages,
            }
            excluded = [
                number for number, page in enumerate(pages, 1)
                if page.strip().splitlines()
                and page.strip().splitlines()[0].strip() == "Ancillary Providers"
                and "Provider ID:" not in page
            ]
            assert excluded == [ANCILLARY_ALL_PAGES[region]], (region, excluded)
            number = excluded[0]
            page, raw = pages[number - 1], raw_pages[number - 1]
            ancillary[region] = {
                "sourceUrl": url(region), "checkedDate": CHECKED,
                "sourceDate": "2026-10-06", "sourcePdfSha256": source_hash,
                "physicalPage": number,
                "printedPage": re.findall(r"www\.fideliscarenj\.com\s+(\d+)", page)[-1],
                "layout": page, "raw": raw,
                "layoutSha256": digest(page.encode()), "rawSha256": digest(raw.encode()),
            }
            selected = [1, 3, 5]
            for number, page in enumerate(pages, 1):
                lines = page.strip().splitlines()
                if lines and lines[0].strip() in SECTIONS and "Provider ID:" in page:
                    selected.append(number)
            evidence = []
            for number in selected:
                xml = subprocess.check_output([
                    "pdftohtml", "-i", "-f", str(number), "-l", str(number),
                    "-xml", "-stdout", str(pdf),
                ]).decode()
                page = pages[number - 1]
                printed = re.findall(r"www\.fideliscarenj\.com\s+(\d+|[IVX]+)", page)
                evidence.append({
                    "physicalPage": number,
                    "printedPage": printed[-1] if printed else None,
                    "layout": page,
                    "raw": raw_pages[number - 1],
                    "xml": xml,
                })
            payload = encoded(evidence)
            dates = re.findall(r"This directory is updated as of (\d{2}/\d{2}/\d{4})", pages[0])
            assert dates == ["10/06/2026"], dates
            name = f"region-{region}.pages.json"
            item = {
                "url": url(region), "countiesAsPublished": counties,
                "pdfSha256": source_hash, "pdfBytes": len(data),
                "pdfPageCount": len(pages), "sourceDate": "2026-10-06",
                "sourceDateText": "This directory is updated as of 10/06/2026.",
                "editionText": re.search(r"NJ6JMDDIR\S+", pages[0]).group(),
                "retainedPages": selected, "evidenceFile": name,
                "evidenceSha256": digest(payload),
                "coverage": "All listing pages under Ancillary Providers and Managed Long Term Services and Supports, plus cover, contents and English introduction.",
            }
            if previous:
                assert item == previous["sources"][region], "Extraction changed; review rather than overwrite."
                assert payload == (sources / name).read_bytes()
            else:
                (sources / name).write_bytes(payload)
            manifest["sources"][region] = item
    if previous:
        assert manifest == previous
    else:
        (sources / "manifest.json").write_bytes(encoded(manifest))
    ancillary_path = sources / "ancillary-all-pages.json"
    payload = encoded(ancillary)
    if ancillary_path.exists():
        assert ancillary_path.read_bytes() == payload, "Ancillary All extraction changed."
    else:
        ancillary_path.write_bytes(payload)
    raw_payload = gzip.compress(encoded(full_raw), mtime=0)
    raw_path = sources / "full-raw-pages.json.gz"
    if raw_path.exists():
        assert gzip.decompress(raw_path.read_bytes()) == gzip.decompress(raw_payload), "Full raw extraction changed."
    else:
        raw_path.write_bytes(raw_payload)
        (sources / "full-raw-manifest.json").write_bytes(encoded({
            "evidenceFile": raw_path.name,
            "uncompressedSha256": digest(encoded(full_raw)),
            "rosterSha256": manifest["rosterSha256"],
        }))


def validate_ancillary(manifest):
    ancillary = json.loads((ROOT / "sources/ancillary-all-pages.json").read_bytes())
    assert set(ancillary) == set(ANCILLARY_ALL_PAGES)
    for region, page in ancillary.items():
        source = manifest["sources"][region]
        assert page["sourceUrl"] == source["url"] == url(region)
        assert page["checkedDate"] == manifest["checkedDate"] == CHECKED
        assert page["sourceDate"] == source["sourceDate"] == "2026-10-06"
        assert page["sourcePdfSha256"] == source["pdfSha256"]
        assert page["physicalPage"] == ANCILLARY_ALL_PAGES[region]
        assert page["physicalPage"] not in source["retainedPages"]
        assert 1 <= page["physicalPage"] <= source["pdfPageCount"]
        assert page["printedPage"] == str(page["physicalPage"] - 15)
        for field in ("layout", "raw"):
            text = page[field]
            assert digest(text.encode()) == page[field + "Sha256"]
            assert text.strip().splitlines()[0].strip() == "Ancillary Providers"
            assert source["sourceDateText"] in text
            assert not re.search(r"Provider\s+ID\s*:", text, re.IGNORECASE)
        assert re.search(r"www\.fideliscarenj\.com\s+" + page["printedPage"] + r"\s*$", page["layout"])


def raw_phone_audit(manifest, rows):
    sources = ROOT / "sources"
    metadata = json.loads((sources / "full-raw-manifest.json").read_bytes())
    assert metadata["evidenceFile"] == "full-raw-pages.json.gz"
    assert metadata["rosterSha256"] == manifest["rosterSha256"]
    payload = gzip.decompress((sources / metadata["evidenceFile"]).read_bytes())
    assert digest(payload) == metadata["uncompressedSha256"]
    assert metadata["uncompressedSha256"] == "3fd24ee253150c9fff713e8d0e565ec4ae3fd0f7518bb5b54a9a897ae6f7a245"
    regions = json.loads(payload)
    assert set(regions) == set(REGIONS)
    phones = {phone_digits(row["phone"])[:10] for row in rows}
    assert all(re.fullmatch(r"\d{10}", value) for value in phones)
    pattern = re.compile(r"(?<!\d)\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)")
    hits = []
    for region, evidence in regions.items():
        source = manifest["sources"][region]
        assert evidence["sourceUrl"] == source["url"] == url(region)
        assert evidence["sourcePdfSha256"] == source["pdfSha256"]
        assert evidence["sourceDate"] == source["sourceDate"]
        assert evidence["checkedDate"] == manifest["checkedDate"] == CHECKED
        assert len(evidence["pages"]) == source["pdfPageCount"]
        for number, raw in enumerate(evidence["pages"], 1):
            for match in pattern.finditer(raw):
                phone = phone_digits(match.group())
                if phone in phones:
                    line_number = raw.count("\n", 0, match.start()) + 1
                    column = match.start() - raw.rfind("\n", 0, match.start()) - 1
                    hits.append({
                        "hitId": f"{region}:p{number}:l{line_number}:c{column}",
                        "region": region, "physicalPage": number,
                        "line": line_number, "column": column,
                        "phone": phone, "rawLine": raw.splitlines()[line_number - 1],
                    })
    return regions, hits


def broader_listings(regions, hits, home):
    reviews = json.loads((ROOT / "sources/broader-review.json").read_bytes())
    broader = []
    for review in reviews:
        region, number = review["region"], review["physicalPage"]
        lines = regions[region]["pages"][number - 1].splitlines()
        start, end = review["startLine"], review["endLine"]
        assert 1 <= start < end <= len(lines)
        block = lines[start - 1:end]
        heading_start, heading_end = review["headingLines"]
        assert 1 <= heading_start <= heading_end < start
        heading = " ".join(lines[heading_start - 1:heading_end])
        section = re.sub(r"\s*- cont\.$", "", heading)
        assert section not in HOME_SECTIONS
        city = CITY.fullmatch(block[-2])
        assert city and PHONE.fullmatch(block[-1])
        provider = next((i for i, line in enumerate(block) if line.startswith("Provider ID:")), None)
        address = next(i for i, line in enumerate(block) if re.match(r"^\d", line))
        assert address < len(block) - 2
        name_lines = block[:provider] if provider is not None else block[:address]
        assert name_lines
        practice_start = provider + 1 if provider is not None else address
        practitioner = any(line.startswith("Gender:") for line in block)
        assert review["providerKind"] == ("practitioner" if practitioner else "organization")
        practice = [line for line in block[practice_start:address] if not line.startswith("Gender:")]
        printed = re.findall(r"www\.fideliscarenj\.com\s+(\d+)", "\n".join(lines))
        assert len(printed) == 1
        broader.append({
            "listingId": f"{region}:p{number}:raw{start}", "region": region,
            "physicalPage": number, "printedPage": printed[0],
            "directoryProviderId": block[provider].split(":", 1)[1].strip() if provider is not None else None,
            "listingName": " ".join(name_lines), "listingNameLines": name_lines,
            "practiceName": " ".join(practice) or None,
            "address": " ".join(block[address:-2]), "addressLines": block[address:-2],
            "city": city.group(1), "state": "NJ", "zip": city.group(2),
            "phone": block[-1], "directorySection": section, "specialty": None,
            "directoryGroup": lines[0], "providerKind": review["providerKind"],
            "rawListingLines": block, "sourceLineRange": [start, end],
            "sourceHeadingLines": [heading_start, heading_end],
        })
    assert len({item["listingId"] for item in broader}) == len(broader)
    consumed = set()
    for hit in hits:
        lines = regions[hit["region"]]["pages"][hit["physicalPage"] - 1].splitlines()
        prefix = " ".join(" ".join(lines[:hit["line"]]).split())
        matches = [
            item for item in home + broader
            if item["region"] == hit["region"] and item["physicalPage"] == hit["physicalPage"]
            and item["listingId"] not in consumed
            and phone_digits(item["phone"]) == hit["phone"]
            and (item.get("sourceLineRange", [0, 0])[1] == hit["line"]
                 if "sourceLineRange" in item else prefix.endswith(" ".join(" ".join(
                     item["rawListingLines"][:item["rawListingLines"].index(item["phone"]) + 1]
                 ).split())))
        ]
        assert matches, ("Unreviewed phone hit", hit)
        hit["listingId"] = matches[0]["listingId"]
        hit["scope"] = "broader_directory" if "sourceLineRange" in matches[0] else "home_care"
        consumed.add(hit["listingId"])
    phones = {hit["phone"] for hit in hits}
    assert consumed == {
        item["listingId"] for item in home + broader if phone_digits(item["phone"]) in phones
    }
    assert {hit["listingId"] for hit in hits if hit["scope"] == "broader_directory"} == {
        item["listingId"] for item in broader
    }
    return broader


def parse_page(region, page, inherited):
    elements = ET.fromstring(page["xml"]).find("page").findall("text")
    body = []
    for element in elements:
        text = "".join(element.itertext()).strip()
        top, left = int(element.get("top")), int(element.get("left"))
        if text and 130 <= top < 1090:
            body.append((text, element.find("b") is not None, left, top))
    records = []
    section = inherited
    pending = []
    index = 0
    while index < len(body):
        text, bold, left, top = body[index]
        if bold:
            pending.append((text, left, top))
        elif text.startswith("Provider ID:"):
            assert pending, (region, page["physicalPage"], text)
            name_lines = []
            while pending and abs(pending[-1][1] - left) <= 2 and pending[-1][0] != "- cont.":
                name_lines.insert(0, pending.pop()[0])
            assert name_lines, (region, page["physicalPage"], pending, text)
            if pending:
                section = " ".join(part[0] for part in pending)
                section = re.sub(r"\s*- cont\.$", "", section)
            pending = []
            after = []
            j = index + 1
            while j < len(body) and not body[j][1]:
                after.append(body[j][0])
                j += 1
            cities = [(k, CITY.fullmatch(line)) for k, line in enumerate(after) if CITY.fullmatch(line)]
            phones = [(k, line) for k, line in enumerate(after) if PHONE.fullmatch(line)]
            if section in HOME_SECTIONS:
                assert len(cities) == 1 and len(phones) == 1, (region, page["physicalPage"], name_lines, after)
                city_index, city = cities[0]
                phone_index, phone = phones[0]
                assert city_index < phone_index
                before_city = after[:city_index]
                address_start = next((k for k, line in enumerate(before_city) if re.match(r"^\d", line)), None)
                assert address_start is not None, (name_lines, before_city)
                specialty_lines = []
                specialty_indexes = set()
                for k, line in enumerate(after):
                    if line.startswith("Subspecialty:"):
                        specialty_indexes.add(k)
                        specialty_lines.append(line.removeprefix("Subspecialty:").strip())
                        m = k + 1
                        while m < len(after) and not re.match(r"^\d|^Fax:|^Languages:|^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b", after[m]):
                            specialty_indexes.add(m)
                            specialty_lines.append(after[m])
                            m += 1
                records.append({
                    "listingId": f"{region}:p{page['physicalPage']}:{len(records) + 1}",
                    "region": region, "physicalPage": page["physicalPage"],
                    "printedPage": page["printedPage"],
                    "directoryProviderId": text.removeprefix("Provider ID:").strip(),
                    "listingName": " ".join(name_lines),
                    "listingNameLines": name_lines,
                    "practiceName": " ".join(line for k, line in enumerate(before_city[:address_start])
                                             if k not in specialty_indexes) or None,
                    "address": " ".join(before_city[address_start:]),
                    "addressLines": before_city[address_start:],
                    "city": city.group(1), "state": "NJ", "zip": city.group(2),
                    "phone": phone, "directorySection": section,
                    "specialty": " ".join(specialty_lines) or None,
                    "rawListingLines": [*name_lines, text, *after],
                })
        index += 1
    return records, section


@cache
def organization(value):
    value = value.upper().replace("&", " AND ")
    return re.sub(r"[^A-Z0-9]", "", value)


@cache
def street(value):
    value = value.upper().replace("&", " AND ")
    value = re.sub(r"\bFL(\d+)\b", r"FL \1", value)
    value = re.sub(r"\b(\d+)(?:ST|ND|RD|TH)\b", r"\1", value)
    value = re.sub(r"[^A-Z0-9]+", " ", value)
    tokens = [ADDRESS_WORDS.get(token, token) for token in value.split()]
    value = " ".join(tokens)
    return re.sub(r"\b(\d+) FL\b", r"FL \1", value)


@cache
def phone_digits(value):
    return re.sub(r"\D", "", value)


def names(row):
    values = [("legalName", row["legalName"])]
    if row["stateRegisteredTradeNames"]:
        values.append(("stateRegisteredTradeNames", row["stateRegisteredTradeNames"]))
    for field in ("legalName", "stateRegisteredTradeNames"):
        if " DBA " in row[field]:
            values.append((field + " before DBA", row[field].split(" DBA ", 1)[0]))
            values.append((field + " DBA", row[field].split(" DBA ", 1)[1]))
    for part in DBA_PARTITIONS.get(row["stateRegisteredTradeNames"], ()):
        values.append(("stateRegisteredTradeNames reviewed component", part))
    return values


def identity(row, listing):
    accepted_names = names(row)
    matched_name = next(({"field": field, "value": value}
                         for field, value in accepted_names
                         if organization(value) == organization(listing["listingName"])), None)
    checks = {
        "organization": matched_name is not None,
        "streetAndUnit": street(row["address"]) == street(listing["address"]),
        "city": organization(row["city"]) == organization(listing["city"]),
        "zip": row["zip"][:5] == listing["zip"][:5],
        "phone": phone_digits(row["phone"]) == phone_digits(listing["phone"]),
    }
    if "providerKind" in listing:
        checks["organizationProvider"] = listing["providerKind"] == "organization"
    return checks, matched_name


def build():
    sources = ROOT / "sources"
    manifest = json.loads((sources / "manifest.json").read_text())
    assert manifest["checkedDate"] == CHECKED and manifest["discoveryUrl"] == LANDING
    assert set(manifest["sources"]) == set(REGIONS)
    assert manifest["rosterSha256"] == digest((sources / "roster.csv").read_bytes())
    validate_ancillary(manifest)
    with (sources / "roster.csv").open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    for original, parts in DBA_PARTITIONS.items():
        assert ", ".join(parts) == original
        assert any(row["stateRegisteredTradeNames"] == original for row in rows)
    assert len({row["providerId"] for row in rows}) == len(rows)
    listings, coverage = [], {}
    for region, source in manifest["sources"].items():
        assert source["url"] == url(region)
        assert source["sourceDate"] == "2026-10-06" and source["sourceDate"] <= CHECKED
        assert source["countiesAsPublished"] == REGIONS[region]
        assert re.fullmatch(r"[0-9a-f]{64}", source["pdfSha256"])
        payload = (sources / source["evidenceFile"]).read_bytes()
        assert digest(payload) == source["evidenceSha256"]
        pages = json.loads(payload)
        assert [page["physicalPage"] for page in pages] == source["retainedPages"]
        assert source["sourceDateText"] in pages[0]["layout"]
        assert source["editionText"] in pages[0]["layout"]
        assert "most current directory information" in pages[2]["layout"]
        inherited = None
        count = 0
        for page in pages[3:]:
            assert 1 <= page["physicalPage"] <= source["pdfPageCount"]
            assert page["layout"].strip().splitlines()[0].strip() in SECTIONS
            section_title = page["layout"].strip().splitlines()[0].strip()
            offset = 15 if section_title == "Ancillary Providers" else 16
            assert page["physicalPage"] - int(page["printedPage"]) == offset
            assert source["sourceDateText"] in page["layout"]
            assert re.search(r"www\.fideliscarenj\.com\s+" + re.escape(page["printedPage"]) + r"\s*$", page["layout"])
            xml_page = ET.fromstring(page["xml"]).find("page")
            assert int(xml_page.get("number")) == page["physicalPage"]
            assert source["sourceDateText"] in "".join(xml_page.itertext())
            found, inherited = parse_page(region, page, inherited)
            listings.extend(found)
            count += len(found)
        coverage[region] = {
            "countiesAsPublished": REGIONS[region], "sourceUrl": source["url"],
            "sourceDate": source["sourceDate"], "pdfPageCount": source["pdfPageCount"],
            "retainedListingPages": len(pages) - 3, "homeCareListings": count,
            "homeCarePhysicalPages": sorted({item["physicalPage"] for item in listings if item["region"] == region}),
        }
    raw_regions, hits = raw_phone_audit(manifest, rows)
    broader = broader_listings(raw_regions, hits, listings)
    all_listings = listings + broader
    verified, ledger = {}, {}
    for row in rows:
        candidates, exact = [], []
        for listing in all_listings:
            checks, matched_name = identity(row, listing)
            same_street = street(row["address"]).split(" STE ")[0] == street(listing["address"]).split(" STE ")[0]
            if checks["organization"] or phone_digits(row["phone"])[:10] == phone_digits(listing["phone"]) or (same_street and checks["city"]):
                candidates.append({
                    "listingId": listing["listingId"], "checks": checks,
                    "organizationBasis": matched_name,
                    "discrepancies": [field for field, passed in checks.items() if not passed],
                })
            if all(checks.values()) and not row["locationHold"]:
                exact.append((listing, matched_name))
        disposition = {
            "status": "verified" if exact else "hold",
            "reason": "exact_office_identity" if exact else (
                "roster_location_hold" if row["locationHold"] else
                "identity_discrepancy" if candidates else "not_found_in_full_directory_phone_audit"
            ),
            "checkedDate": CHECKED, "scannedRegions": list(REGIONS),
            "scannedListingCount": len(listings), "locationHold": row["locationHold"] or None,
            "broaderDirectoryCandidateCount": len(broader),
            "fullDirectoryPhoneAudit": {
                "pagesScanned": sum(len(item["pages"]) for item in raw_regions.values()),
                "rosterPhone": row["phone"], "basePhoneScanned": phone_digits(row["phone"])[:10],
                "hitIds": [hit["hitId"] for hit in hits if hit["phone"] == phone_digits(row["phone"])[:10]],
            },
            "candidates": candidates,
        }
        ledger[row["providerId"]] = disposition
        if exact:
            verified[row["providerId"]] = {
                "evidenceType": "historical_public_payer_directory_listing",
                "payer": "Fidelis Care New Jersey", "program": "NJ FamilyCare Medicaid",
                "checkedDate": CHECKED, "caveat": CAVEAT,
                "listings": [{
                    **{key: listing[key] for key in (
                        "listingId", "directoryProviderId", "listingName", "practiceName",
                        "address", "city", "state", "zip", "phone", "directorySection",
                        "specialty", "physicalPage", "printedPage",
                    )},
                    "organizationBasis": basis,
                    "sourceUrl": url(listing["region"]),
                    "sourceDate": manifest["sources"][listing["region"]]["sourceDate"],
                    "sourcePdfSha256": manifest["sources"][listing["region"]]["pdfSha256"],
                    **({
                        "providerKind": listing["providerKind"],
                        "directoryGroup": listing["directoryGroup"],
                        "serviceEvidenceLimitation": (
                            "Historical " + listing["directorySection"] + "-only listing fact. "
                            "NOT a PCA/home-care payer claim. Does not establish care-unit or "
                            "service-specific payer eligibility, hospice eligibility, current "
                            "participation, authorization, or guaranteed insurance coverage."
                        ),
                    } if "providerKind" in listing else {}),
                } for listing, basis in exact],
            }
    counts = collections.Counter(item["reason"] for item in ledger.values())
    assert len(ledger) == len(rows) == sum(counts.values())
    assert set(verified) == {key for key, item in ledger.items() if item["status"] == "verified"}
    report = {
        "checkedDate": CHECKED, "rosterProviders": len(rows),
        "verifiedProviders": len(verified), "heldProviders": len(rows) - len(verified),
        "verifiedDistinctOfficeIdentities": len({
            (organization(item["listings"][0]["listingName"]),
             street(item["listings"][0]["address"]),
             item["listings"][0]["city"], item["listings"][0]["phone"])
            for item in verified.values()
        }),
        "dispositionReasons": dict(sorted(counts.items())),
        "homeCareListingOccurrences": len(listings),
        "broaderDirectoryListingOccurrences": len(broader),
        "totalAuditedDirectoryListingOccurrences": len(all_listings),
        "verifiedListingOccurrences": sum(len(item["listings"]) for item in verified.values()),
        "comparisonCount": len(rows) * len(all_listings),
        "homeCareComparisonCount": len(rows) * len(listings),
        "phoneAudit": {
            "scope": "All original raw pages, every section, all seven PDFs.",
            "pagesScanned": sum(len(item["pages"]) for item in raw_regions.values()),
            "rosterRowsScanned": len(rows),
            "distinctBasePhonesScanned": len({phone_digits(row["phone"])[:10] for row in rows}),
            "rosterRowsWithExtensions": sum(len(phone_digits(row["phone"])) > 10 for row in rows),
            "phoneHits": len(hits), "homeCarePhoneHits": sum(hit["scope"] == "home_care" for hit in hits),
            "broaderDirectoryPhoneHits": sum(hit["scope"] == "broader_directory" for hit in hits),
            "unexaminedPhoneHits": 0, "unexaminedSourcePages": 0,
            "coverageByRegion": {
                region: {"pagesScanned": len(raw_regions[region]["pages"]),
                         "phoneHits": sum(hit["region"] == region for hit in hits),
                         "broaderDirectoryOccurrences": sum(item["region"] == region for item in broader)}
                for region in REGIONS
            },
        },
        "holdReasonDefinitions": {
            "roster_location_hold": "The input roster flags an unresolved location. This blocks verification even if all identity fields match.",
            "identity_discrepancy": "At least one exact organization, base phone, or street-and-city anchor exists, but no organization listing passes every identity field. Base-phone discovery does not drop extensions for verification.",
            "not_found_in_full_directory_phone_audit": "No anchor exists in home-care listings and no roster base phone occurs anywhere in all seven PDFs. Every strict match must share a phone. This is not a nonparticipation finding.",
        },
        "coverage": coverage, "caveat": CAVEAT,
    }
    return {
        "directory-listings.json": listings, "verified.json": verified,
        "dispositions.json": ledger, "counts.json": report,
        "broader-directory-listings.json": broader, "phone-audit.json": hits,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="store_true", help="Capture official PDF page evidence, or verify the pinned source snapshot.")
    parser.add_argument("--check", action="store_true", help="Compare replay with retained outputs without writing.")
    args = parser.parse_args()
    if args.capture:
        capture()
    outputs = build()
    for name, value in outputs.items():
        payload = encoded(value)
        if args.check:
            assert (ROOT / name).read_bytes() == payload, f"Stale output: {name}"
        else:
            (ROOT / name).write_bytes(payload)
    print(json.dumps({key: outputs["counts.json"][key] for key in (
        "rosterProviders", "verifiedProviders", "heldProviders", "homeCareListingOccurrences", "dispositionReasons",
    )}, indent=2))


if __name__ == "__main__":
    main()
