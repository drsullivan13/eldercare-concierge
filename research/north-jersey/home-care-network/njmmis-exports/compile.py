#!/usr/bin/env python3
"""Compile exact registered offices from original offline NJMMIS county exports."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent
NETWORK = ROOT.parent
IDENTITY_FIELDS = ("name", "address", "city", "state", "zip", "phone")
ADDRESS_WORDS = {
    "STREET": "ST", "ROAD": "RD", "AVENUE": "AVE", "BOULEVARD": "BLVD",
    "DRIVE": "DR", "LANE": "LN", "COURT": "CT", "PLACE": "PL",
    "HIGHWAY": "HWY", "ROUTE": "RTE", "TURNPIKE": "TPKE", "PARKWAY": "PKWY",
    "SUITE": "STE", "UNIT": "STE", "FLOOR": "FL", "FLR": "FL",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
    "FIRST": "1", "SECOND": "2", "THIRD": "3",
}


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def name_key(value):
    return re.sub(r"[^A-Z0-9]", "", value.upper().replace("&", " AND "))


def street_key(value):
    value = value.upper().replace("#", " STE ").replace("&", " AND ")
    value = re.sub(r"\b(\d+)(?:ST|ND|RD|TH)\b", r"\1", value)
    value = re.sub(r"\bFL(\d+)\b", r"FL \1", value)
    words = re.sub(r"[^A-Z0-9/-]+", " ", value).split()
    value = " ".join(ADDRESS_WORDS.get(word, word) for word in words)
    return re.sub(r"\b(\d+) FL\b(?! \d)", r"FL \1", value)


def phone_key(value):
    digits = re.sub(r"\D", "", value or "")
    return digits if re.fullmatch(r"[2-9]\d{9}", digits) else None


def office_key(office):
    return (street_key(office["address"]), name_key(office["city"]),
            office["state"], office["zip"][:5])


def registered_names(office, registration):
    if name_key(office["name"]) != name_key(registration["businessName"]):
        raise ValueError("Roster and registration legal names differ")
    values = [registration["businessName"]]
    if registration.get("dbas"):
        values.append(registration["dbas"])
    for value in list(values):
        values.extend(re.split(r"\s+(?:DBA|D/B/A)\s+", value, flags=re.I))
    return {name_key(value) for value in values}


COUNTIES = ("Bergen", "Essex", "Hudson", "Middlesex", "Monmouth", "Morris",
            "Passaic", "Somerset", "Union")
SPECIALTIES = {
    "pca": ("Personal Care Assistance - Aged & Disabled", "personal care assistance"),
    "pdn": ("Private Duty Nursing", "private duty nursing"),
    "respite": ("Respite", "respite care"),
    "homemaker": ("Homemaker - CCPED", "homemaker services"),
}
SERVICES = dict(SPECIALTIES.values())
CHECKED = "2026-11-15"
SEARCH = "https://www.njmmis.com/providerDirectory.aspx?nonBilling=False"
ACTIVE = "Open To New Patients"
HEADER = re.compile(r"^(.*?)\s*,\s*Status:\s*(.*?)\s*$")
CITY = re.compile(r"^(.+?)\s+(NJ)\s+(\d{5}(?:-\d{4})?)$")



def inputs():
    paths = {
        "uhc-roster.json": NETWORK / "uhc-roster.json",
        "uhc-registration-identities.json": NETWORK / "uhc-registration-identities.json",
    }
    bodies = {name: path.read_bytes() for name, path in paths.items()}
    return (json.loads(bodies["uhc-roster.json"]),
            json.loads(bodies["uhc-registration-identities.json"])["providers"],
            {name: digest(body) for name, body in bodies.items()})


def name_index(roster, registrations):
    index = defaultdict(set)
    for pid, office in roster.items():
        for name in registered_names(office, registrations[pid]):
            index[name].add(pid)
    return index


def page_records(text, heading):
    """Keep page numbers while removing only the actual first-line page heading."""
    records, current = [], []
    pages = text.split("\f")
    if not pages[-1].strip():
        pages.pop()
    for page, body in enumerate(pages, 1):
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        if not lines or lines.pop(0) != heading:
            raise ValueError(f"Unexpected directory heading on page {page}")
        for line in lines:
            if HEADER.fullmatch(line):
                if current:
                    records.append(current)
                current = []
            if not current and not HEADER.fullmatch(line):
                raise ValueError(f"Orphan text on page {page}")
            current.append((page, line))
    if current:
        records.append(current)
    if (len(records) != text.count("Status:")
            or len(records) != text.count("Phone:")
            or len(records) != text.count("Specialties:")):
        raise ValueError("Unaccounted status, phone, or specialty boundary")
    return records, len(pages)


def parse_record(lines):
    page, header = lines[0]
    match = HEADER.fullmatch(header)
    name, status = match.groups()
    errors = []
    city_rows = [(i, CITY.fullmatch(line)) for i, (_, line) in enumerate(lines)
                 if CITY.fullmatch(line)]
    phone_rows = [(i, value.removeprefix("Phone:").strip())
                  for i, (_, value) in enumerate(lines) if value.startswith("Phone:")]
    specialty_rows = [i for i, (_, value) in enumerate(lines)
                      if value.startswith("Specialties:")]
    office = {"name": name.strip(), "address": "", "city": "", "state": "", "zip": "",
              "phone": phone_rows[0][1] if len(phone_rows) == 1 else ""}
    location_pages = []
    if len(city_rows) == 1:
        i, city = city_rows[0]
        address_lines = lines[1:i]
        if not address_lines or any(re.search(r"(?:Phone|Fax|Email|Specialties|Status):", s)
                                    for _, s in address_lines):
            errors.append("invalid_address")
        # Some exports repeat the municipality alone after a fully specified street/suite.
        if len(address_lines) > 1 and address_lines[-1][1].casefold() == city[1].strip().casefold():
            address_lines = address_lines[:-1]
        office.update(address=" ".join(s for _, s in address_lines),
                      city=city[1].strip(), state=city[2], zip=city[3])
        location_pages = sorted({p for p, _ in lines[1:i + 1]})
    else:
        errors.append("invalid_city_state_zip")
    if (len(phone_rows) != 1 or len(specialty_rows) != 1 or len(city_rows) != 1
            or not (city_rows[0][0] < phone_rows[0][0] < specialty_rows[0])):
        errors.append("invalid_field_order")
    specialties, evidence = [], {}
    if len(specialty_rows) == 1:
        start = specialty_rows[0]
        chunks = [(p, s.removeprefix("Specialties:").strip() if i == start else s)
                  for i, (p, s) in enumerate(lines) if i >= start]
        joined, positions = "", []
        for p, s in chunks:
            if re.search(r"(?:Phone|Fax|Email|Status):", s):
                errors.append("invalid_specialty_continuation")
                break
            joined += (" " if joined else "") + s
            positions.extend([p] * (len(s) + (1 if positions else 0)))
        for token in re.finditer(r"[^,]+", joined):
            label = token[0].strip()
            if label in SERVICES:
                specialties.append(label)
                left = token.start() + len(token[0]) - len(token[0].lstrip())
                right = token.end() - len(token[0]) + len(token[0].rstrip())
                evidence[label] = sorted(set(positions[left:right]))
    return {
        "sourceOffice": office, "status": status.strip(),
        "sourceSpecialties": sorted(set(specialties)), "specialtyPages": evidence,
        "page": page, "recordPages": sorted({p for p, _ in lines}),
        "locationPages": location_pages,
        "phonePage": lines[phone_rows[0][0]][0] if len(phone_rows) == 1 else None,
        "parseErrors": sorted(set(errors)),
    }


def capture(folder, roster, registrations):
    index = name_index(roster, registrations)
    receipts, sources, excluded = [], [], Counter()
    for kind, (heading, _) in SPECIALTIES.items():
        for county in COUNTIES:
            filename = f"harbor-njmmis-{kind}-{county}.pdf"
            path = folder / filename
            body = path.read_bytes()
            if not body.startswith(b"%PDF-"):
                raise ValueError(f"Not an original PDF: {filename}")
            text = subprocess.run(["pdftotext", "-layout", str(path), "-"],
                                  check=True, capture_output=True, text=True).stdout
            records, pages = page_records(text, heading)
            sha = digest(body)
            sources.append({
                "file": filename, "sha256": sha, "pages": pages, "records": len(records),
                "county": county, "providerFilter": "Home Care Provider",
                "specialtyFilter": heading, "checkedAt": CHECKED, "sourceUrl": SEARCH,
                "button": "Download Provider Directory",
            })
            for ordinal, lines in enumerate(records, 1):
                record = parse_record(lines)
                receipt_id = f"{filename}:p{record['page']}:r{ordinal}"
                office = record["sourceOffice"]
                candidates = index.get(name_key(office["name"]), ())
                if not candidates:
                    excluded["no_exact_registered_organization"] += 1
                    continue
                if not any(office_key(office) == office_key(roster[pid]) for pid in candidates):
                    excluded["office_identity_mismatch"] += 1
                    continue
                receipts.append({
                    "receiptId": receipt_id, "sourceFile": filename, "sourceSha256": sha,
                    "checkedAt": CHECKED, **record,
                })
    return {"sources": sources, "receipts": receipts, "excludedCounts": dict(excluded)}


def eligible(pid, office, registration):
    return (
        office["category"] == "home-care" and office["state"] == "NJ"
        and office["locationKind"] in ("office", "zip") and not office.get("warnings")
        and registration["registration"].lower() == pid.removeprefix("north-jersey-hp-")
        and registration["status"] == "Active"
        and not re.search(r"\bpediatr|\bchildren|\bkids\b|\bheadquarters\b|"
                          r"\bservice.area.only\b|\bPO BOX\b",
                          office["name"] + " " + office["address"] + " "
                          + office.get("description", ""), re.I)
    )


def project(bundle, roster, registrations):
    index = name_index(roster, registrations)
    checks, status_groups = {}, defaultdict(list)
    for row in bundle["receipts"]:
        source = row["sourceOffice"]
        candidates = []
        for pid in sorted(index[name_key(source["name"])]):
            office = roster[pid]
            address = office_key(source) == office_key(office)
            phone = phone_key(source["phone"])
            candidates.append({
                "providerId": pid, "fullAddress": address,
                "phone": phone is not None and phone == phone_key(office["phone"]),
                "office": eligible(pid, office, registrations[pid]),
            })
            if address:
                for label in row["sourceSpecialties"]:
                    status_groups[pid, label].append(row)
        checks[row["receiptId"]] = candidates

    decisions, accepted = [], defaultdict(list)
    specialty_decisions = []
    for (pid, label), rows in sorted(status_groups.items()):
        statuses = sorted({row["status"] for row in rows})
        if statuses != [ACTIVE]:
            reason = "conflicting_statuses" if len(statuses) > 1 else "not_explicitly_active"
        else:
            reason = "eligible_status"
        specialty_decisions.append({
            "providerId": pid, "specialty": label, "statuses": statuses, "decision": reason,
            "receiptIds": sorted(row["receiptId"] for row in rows),
        })
    status_allowed = {(d["providerId"], d["specialty"])
                      for d in specialty_decisions if d["decision"] == "eligible_status"}
    for row in bundle["receipts"]:
        candidates = checks[row["receiptId"]]
        exact = [c["providerId"] for c in candidates if c["fullAddress"] and c["phone"]]
        decision = {"receiptId": row["receiptId"], "checks": candidates}
        if row["parseErrors"]:
            reason = "malformed_record"
        elif len(exact) != 1:
            reason = "ambiguous_office" if len(exact) > 1 else "office_identity_mismatch"
        elif not eligible(exact[0], roster[exact[0]], registrations[exact[0]]):
            reason = "ineligible_office"
        elif row["status"] != ACTIVE:
            reason = "not_explicitly_active"
        elif not row["sourceSpecialties"]:
            reason = "no_explicit_supported_specialty"
        else:
            pid = exact[0]
            labels = [label for label in row["sourceSpecialties"] if (pid, label) in status_allowed]
            reason = "accepted_exact_office" if labels else "specialty_status_hold"
            for label in labels:
                accepted[pid, label].append(row)
            decision.update(providerId=pid, acceptedSpecialties=labels)
        decision["decision"] = reason
        decisions.append(decision)

    by_identity = defaultdict(list)
    for (pid, label), rows in sorted(accepted.items()):
        for row in rows:
            source = row["sourceOffice"]
            identity = (pid, name_key(source["name"]), office_key(source),
                        phone_key(source["phone"]))
            by_identity[identity].append((label, row))
    verified = []
    for identity, values in sorted(by_identity.items()):
        pid = identity[0]
        labels = sorted({label for label, _ in values})
        rows = sorted((row for _, row in values), key=lambda r: encode(r["sourceOffice"]))
        source = rows[0]["sourceOffice"]
        verified.append({
            "providerId": pid, "decision": "accepted_exact_office",
            "evidenceId": digest(encode([identity, labels]))[:16],
            "registryOffice": {key: roster[pid][key] for key in IDENTITY_FIELDS},
            "sourceOffice": source, "sourceSpecialties": labels,
            "careServices": sorted(SERVICES[label] for label in labels),
            "checkedAt": CHECKED, "sourceUrl": SEARCH, "directoryUrl": SEARCH, "searchUrl": SEARCH,
            "receiptIds": sorted({row["receiptId"] for row in rows}),
        })
    counts = {
        "sourceFiles": len(bundle["sources"]),
        "pages": sum(source["pages"] for source in bundle["sources"]),
        "pdfRecords": sum(source["records"] for source in bundle["sources"]),
        "retainedOrganizationRecords": len(bundle["receipts"]),
        "uniqueOffices": len({row["providerId"] for row in verified}),
        "verifiedRows": len(verified), "officeSpecialties": len(accepted),
        "officesBySpecialty": dict(sorted(Counter(label for _, label in accepted).items())),
        "decisions": dict(sorted((Counter(row["decision"] for row in decisions) + Counter(bundle["excludedCounts"])).items())),
        "statusHolds": dict(sorted(Counter(d["decision"] for d in specialty_decisions
                                         if d["decision"] != "eligible_status").items())),
    }
    return verified, {"counts": counts, "officeSpecialtyDecisions": specialty_decisions,
                      "decisions": sorted(decisions, key=lambda r: r["receiptId"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, help="Read all 36 original PDFs from this folder")
    parser.add_argument("--verify-pdfs", type=Path, help="Compare originals with retained receipts")
    parser.add_argument("--check", action="store_true", help="Compare without writing")
    args = parser.parse_args()
    roster, registrations, hashes = inputs()
    bundle = (capture(args.capture, roster, registrations) if args.capture else
              json.loads((ROOT / "receipts.json").read_bytes()))
    if args.verify_pdfs:
        if capture(args.verify_pdfs, roster, registrations) != bundle:
            raise ValueError("Original PDFs differ from retained receipts")
    verified, audit = project(bundle, roster, registrations)
    outputs = {"receipts.json": encode(bundle), "verified.json": encode(verified),
               "audit.json": encode(audit)}
    outputs["manifest.json"] = encode({
        "schemaVersion": 1, "checkedAt": CHECKED, "sourceUrl": SEARCH, "inputs": hashes,
        "compilerSha256": digest(Path(__file__).read_bytes()),
        "outputs": {name: digest(body) for name, body in sorted(outputs.items())},
        "availabilityInference": False,
    })
    for name, body in outputs.items():
        path = ROOT / name
        if args.check:
            if path.read_bytes() != body:
                raise ValueError(f"Output differs: {path}")
        else:
            path.write_bytes(body)
    print(json.dumps(audit["counts"], sort_keys=True))


if __name__ == "__main__":
    main()
