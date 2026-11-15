#!/usr/bin/env python3
"""Replay exact-office CAHC decisions without network access or transient inputs."""

import argparse
from collections import Counter, defaultdict
import csv
from dataclasses import dataclass
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REGISTRY = HERE.parent / "home-care-supply" / "providers.json"
PUBLISHER = "Commission on Accreditation for Home Care"
SOURCE_TITLE = "CAHC New Jersey directory"
LISTING_FIELDS = {"legalName", "city", "zip", "phone", "scope", "sourceUrl"}
PUBLIC_FIELDS = {
    "providerId", "title", "address", "sourceTitle", "publisher", "sourceUrl",
    "checkedAt", "services", "paymentOptions", "awards", "accounts",
}
SCOPES = json.loads((HERE / "cahc-scope-claims.json").read_text(encoding="utf-8"))
ACCREDITED = re.compile(r"Accredited(?: with Distinction)? for:\s*", re.I)
PHONE = re.compile(
    r"(?<!\d)(?:\+?1[- .]?)?\(?\d{3}\)?[- .]\d{3}[- .]\d{4}"
    r"(?:\s*(?:[xX]|ext\.?)\s*\d+)?"
)
SUFFIXES = {"inc", "incorporated", "llc", "llp", "corp", "corporation", "ltd"}
STREET_WORDS = {
    "st": "street", "rd": "road", "ave": "avenue", "blvd": "boulevard",
    "dr": "drive", "ln": "lane", "ct": "court", "pl": "place", "hwy": "highway",
    "pkwy": "parkway", "ter": "terrace", "cir": "circle", "ste": "suite",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact(value):
    return " ".join(value.split())


def words(value):
    value = unicodedata.normalize("NFKC", value).casefold().replace("&", " and ")
    value = value.replace("’", "").replace("'", "")
    return " ".join(re.findall(r"[a-z0-9]+", value))


def name_key(value):
    parts = words(value).split()
    while parts and parts[-1] in SUFFIXES:
        parts.pop()
    return " ".join(parts)


def name_parts(value):
    # A comma is part of a registered name, never an alias separator.
    return [compact(x) for x in re.split(r"\s+d\s*/?\s*b\s*/?\s*a\s+", value,
                                        flags=re.I) if compact(x)]


def name_keys(value):
    return {name_key(x) for x in [value, *name_parts(value)] if name_key(x)}


def phone_key(value):
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def street_key(value):
    return " ".join(STREET_WORDS.get(part, part) for part in words(value).split())


def building_key(value):
    return re.split(r" (?:suite|unit) | (?:\d+(?:st|nd|rd|th)? )?floor\b",
                    street_key(value), maxsplit=1)[0].strip()


def valid_url(value):
    return value == "https://www.cahcusa.org/archives/" or re.fullmatch(
        r"https://www\.cahcusa\.org/category/new-jersey/"
        r"(?:[a-z]+(?:-[a-z]+)*-county/)?(?:page/[1-9][0-9]*/)?", value
    ) is not None


def zip_status(value):
    if not value:
        return "missing"
    return "well-formed" if re.fullmatch(r"[0-9]{5}(?:-[0-9]{4})?", value) else "malformed"


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"duplicate JSON key {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


@dataclass(frozen=True)
class Listing:
    legalName: str
    city: str
    zip: str
    phone: str
    scope: tuple
    sourceUrl: str

    @classmethod
    def parse(cls, row):
        require(isinstance(row, dict) and set(row) == LISTING_FIELDS,
                "replay listing must contain only the six identity/scope fields")
        require(all(isinstance(row[k], str) for k in LISTING_FIELDS - {"scope"}),
                "listing identity fields must be strings")
        require(isinstance(row["scope"], list)
                and all(isinstance(s, str) and s for s in row["scope"]),
                "listing scope must be a string array")
        return cls(**{**row, "scope": tuple(row["scope"])})


@dataclass(frozen=True)
class Office:
    providerId: str
    legalName: str
    city: str
    state: str
    address: str
    primaryPhone: str
    registryZip: str
    registeredDba: str
    bridgeConsistent: bool

    def names(self):
        result = name_keys(self.legalName)
        if self.bridgeConsistent and self.registeredDba:
            result |= name_keys(self.registeredDba)
        return result


def offices_from(registry, bridge):
    require(isinstance(registry, list) and isinstance(bridge, list), "expected input arrays")
    ids = [p["id"] for p in registry]
    require(len(ids) == len(set(ids)), "duplicate registry providerId")
    ids = [p["providerId"] for p in bridge]
    require(len(ids) == len(set(ids)), "duplicate DBA bridge providerId")
    by_id = {p["providerId"]: p for p in bridge}
    result = []
    for row in registry:
        if row.get("category") != "home-care":
            continue
        b = by_id.get(row["id"])
        consistent = not b or (
            words(b["legalName"]) == words(row["name"])
            and words(b["city"]) == words(row["city"])
            and words(b["address"]) == words(row["address"])
            and phone_key(b["phone"]) is not None
            and phone_key(b["phone"]) == phone_key(row.get("phone", ""))
        )
        result.append(Office(
            row["id"], row["name"], row["city"], row["state"], row["address"],
            row.get("phone", ""), row.get("zip", ""),
            b["stateRegisteredTradeNames"] if b else "",
            consistent,
        ))
    return sorted(result, key=lambda o: o.providerId)


def extract_discoveries(rows, registry, bridge):
    require(isinstance(rows, list), "discoveries must be an array")
    cities = {compact(p["city"]).casefold() for p in [*registry, *bridge]}
    for row in rows:
        require(set(row) - {"officeUrl"} == {"name", "sourceText", "county", "indexUrl"},
                "unexpected raw discovery schema")
        text, heading = compact(row["sourceText"]), compact(row["name"])
        prefix = text.split(", NJ")[0].rstrip(",")
        if prefix.startswith(heading + " "):
            city = prefix[len(heading) + 1:]
            if (re.fullmatch(r"[A-Za-z.' -]+", city) and len(city.split()) <= 4
                    and city.split()[0].lower().rstrip(".") not in SUFFIXES):
                cities.add(city.casefold())
    replay, audit = [], []
    for order, row in enumerate(rows):
        text = compact(row["sourceText"])
        markers = list(ACCREDITED.finditer(text))
        boundary = re.fullmatch(r"(.*), NJ(?:\s+(.*?))?\s*", text[:markers[0].start()]
                                if markers else "")
        name, city, zipcode = "", "", ""
        issues = []
        prefix = ""
        if boundary and text.count(", NJ") == 1:
            prefix, zipcode = boundary[1].rstrip(","), compact(boundary[2] or "")
            choices = [(prefix[:-len(c)-1], prefix[-len(c):]) for c in cities
                       if prefix.casefold().endswith(" " + c)]
            longest = max((len(c) for n, c in choices), default=0)
            choices = sorted(set((n, c) for n, c in choices if len(c) == longest))
            if len(choices) == 1:
                name, city = choices[0]
            else:
                issues.append("uncertain-name-city-boundary")
        else:
            issues.append("uncertain-listing-boundary")
        scopes = []
        for i, marker in enumerate(markers):
            end = markers[i + 1].start() if i + 1 < len(markers) else len(text)
            scope = re.split(r"\b(?:Phone|Email|Fax):|https?://|www\.", text[marker.end():end],
                             maxsplit=1, flags=re.I)[0]
            scope = PHONE.split(scope, maxsplit=1)[0].strip()
            if scope:
                scopes.append(scope)
        contact_tail = text[markers[-1].end():] if markers else ""
        phones = list(dict.fromkeys(m.group() for m in PHONE.finditer(contact_tail)))
        phone = phones[0] if len(phones) == 1 else ""
        if len(phones) > 1:
            issues.append("multiple-directory-phones")
        if words(row["name"]) != words(name):
            issues.append("heading-body-conflict")
        elif compact(row["name"]) != name:
            issues.append("heading-punctuation-or-case-difference")
        if zip_status(zipcode) != "well-formed":
            issues.append(zip_status(zipcode) + "-zip")
        replay.append(dict(legalName=name, city=city, zip=zipcode, phone=phone,
                           scope=scopes, sourceUrl=row["indexUrl"]))
        audit.append(dict(
            inputOrder=order, headingName=row["name"], bodyPrefix=prefix,
            rawRowSha256=sha(encode(row)), sourceTextSha256=sha(row["sourceText"].encode()),
            boundaryRule="longest-literal-published-city-suffix" if name else "unresolved",
            issues=issues,
        ))
    return replay, audit


def decide(listing, offices, order, extraction, directory):
    evidence, eligible = [], []
    names = name_keys(listing.legalName)
    directory_names = {i: name_keys(row.legalName) for i, row in directory}
    for office in offices:
        same_city = bool(listing.city) and words(listing.city) == words(office.city)
        comparable = bool(names & office.names())
        same_phone = (phone_key(listing.phone) is not None
                      and phone_key(listing.phone) == phone_key(office.primaryPhone))
        raw_dba_match = bool(office.registeredDba
                             and names & name_keys(office.registeredDba))
        directory_matches = [i for i, keys in directory_names.items() if keys & office.names()]
        if not (comparable or same_phone or raw_dba_match or directory_matches):
            continue
        passes = (office.state == "NJ" and same_city and comparable
                  and same_phone and office.bridgeConsistent)
        evidence.append(dict(
            providerId=office.providerId, legalName=office.legalName,
            registeredDba=office.registeredDba, city=office.city, state=office.state,
            address=office.address, primaryPhone=office.primaryPhone,
            registryZip=office.registryZip,
            directoryZipMatchesRegistry=(listing.zip == office.registryZip
                                         if listing.zip and office.registryZip else None),
            sameCity=same_city, comparableName=comparable, exactPrimaryPhone=same_phone,
            registeredDbaNameMatch=raw_dba_match,
            bridgeConsistent=office.bridgeConsistent, eligible=passes,
            matchedNames=sorted(names & office.names()),
            directoryNameInputOrders=directory_matches,
        ))
        if passes:
            eligible.append(office)
    reference_ids = {e["providerId"] for e in evidence
                     if e["state"] == "NJ" and e["sameCity"] and e["comparableName"]
                     and e["bridgeConsistent"]}
    references = eligible or [o for o in offices if o.providerId in reference_ids]
    directory_evidence = []
    for i, other in directory:
        if i == order:
            continue
        comparable = (any(directory_names[i] & o.names() for o in references)
                      if references else bool(directory_names[i] & names))
        same_city = bool(listing.city) and words(other.city) == words(listing.city)
        directory_evidence.append(dict(
            inputOrder=i, listing=other.__dict__, sameCity=same_city,
            comparableName=comparable, identityConflict=same_city and not comparable,
        ))
    colocations = []
    if len(eligible) == 1:
        office = eligible[0]
        for other in offices:
            if (other.providerId == office.providerId or other.state != "NJ"
                    or words(other.city) != words(office.city)
                    or not building_key(office.address)
                    or building_key(other.address) != building_key(office.address)):
                continue
            exact_address = street_key(other.address) == street_key(office.address)
            same_phone = phone_key(other.primaryPhone) == phone_key(office.primaryPhone)
            colocations.append(dict(
                providerId=other.providerId, legalName=other.legalName,
                registeredDba=other.registeredDba, bridgeConsistent=other.bridgeConsistent,
                city=other.city, state=other.state, address=other.address,
                primaryPhone=other.primaryPhone, comparableName=bool(other.names() & office.names()),
                exactOfficeAddress=exact_address, samePrimaryPhone=same_phone,
                identityConflict=exact_address and same_phone,
            ))
    status, reason, selected = "rejected", "no-comparable-registry-name", None
    if not listing.legalName or not listing.city or any(
            s.startswith("uncertain-") for s in extraction["issues"]):
        status, reason = "ambiguous", "uncertain-directory-listing-boundary"
    elif not valid_url(listing.sourceUrl):
        reason = "not-an-official-cahc-index-url"
    elif not listing.scope or any(s not in SCOPES for s in listing.scope):
        reason = "unknown-or-missing-scope"
    elif phone_key(listing.phone) is None:
        reason = "missing-or-nonexact-directory-phone-no-verified-street"
    elif any(e["identityConflict"] for e in directory_evidence):
        status, reason = "ambiguous", "directory-shared-phone-identity-conflict"
    elif any(e["state"] == "NJ" and e["sameCity"] and e["exactPrimaryPhone"]
             and (e["comparableName"] or e["registeredDbaNameMatch"])
             and not e["bridgeConsistent"] for e in evidence):
        status, reason = "ambiguous", "registry-dba-bridge-identity-conflict"
    elif len(eligible) > 1:
        status, reason = "ambiguous", "multiple-same-city-name-primary-phone-offices"
    elif len(eligible) == 1:
        office = eligible[0]
        conflicts = [e for e in colocations if e["identityConflict"]]
        if conflicts:
            status, reason = "ambiguous", "colocated-conflicting-registrations"
            existing = {e["providerId"] for e in evidence}
            for other in conflicts:
                if other["providerId"] not in existing:
                    raise ValueError("co-located primary-phone conflict missing from candidate audit")
        elif (zip_status(listing.zip) == "well-formed" and office.registryZip
              and listing.zip != office.registryZip):
            status, reason = "ambiguous", "directory-registry-zip-conflict"
        else:
            status, reason, selected = "accepted", "unique-city-name-primary-phone", office.providerId
    elif any(not e["bridgeConsistent"] and (e["comparableName"] or
             names & name_keys(e["registeredDba"])) for e in evidence):
        status, reason = "ambiguous", "registry-dba-bridge-identity-conflict"
    elif any(e["sameCity"] and e["comparableName"] for e in evidence):
        reason = "primary-phone-mismatch-no-verified-street"
    elif any(e["comparableName"] for e in evidence):
        reason = "wrong-city-or-non-nj-office"
    elif any(e["exactPrimaryPhone"] for e in evidence):
        reason = "primary-phone-only-without-comparable-name"
    return dict(inputOrder=order, status=status, reason=reason, providerId=selected,
                listing=dict(legalName=listing.legalName, city=listing.city, zip=listing.zip,
                             phone=listing.phone, scope=list(listing.scope),
                             sourceUrl=listing.sourceUrl),
                zipStatus=zip_status(listing.zip), extractionIssues=extraction["issues"],
                candidateEvidence=evidence, directoryPhoneEvidence=directory_evidence,
                registryColocationEvidence=colocations)


def build(replay, bridge, registry, extraction, checked_at):
    require(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", checked_at) is not None,
            "checkedAt must be YYYY-MM-DD")
    date.fromisoformat(checked_at)
    require(len(replay) == len(extraction), "extraction/replay row count mismatch")
    offices = offices_from(registry, bridge)
    listings = [Listing.parse(raw) for raw in replay]
    directory_phones = defaultdict(list)
    for order, listing in enumerate(listings):
        phone = phone_key(listing.phone)
        if phone:
            directory_phones[phone].append((order, listing))
    decisions, groups = [], defaultdict(list)
    for order, listing in enumerate(listings):
        require(extraction[order]["inputOrder"] == order, "extraction input order mismatch")
        decision = decide(listing, offices, order, extraction[order],
                          directory_phones.get(phone_key(listing.phone), []))
        decisions.append(decision)
        if decision["status"] == "accepted":
            groups[(decision["providerId"], tuple(sorted(set(listing.scope))))].append(decision)
    branches, public_evidence, accepted_colocations = [], [], {}
    for (pid, scope), rows in sorted(groups.items()):
        chosen = min(rows, key=lambda d: (
            d["zipStatus"] != "well-formed", d["listing"]["sourceUrl"],
            d["listing"]["legalName"], d["inputOrder"],
        ))
        listing = chosen["listing"]
        address = f"{listing['city']}, NJ"
        branch = dict(
            providerId=pid, title=listing["legalName"], address=address,
            sourceTitle=SOURCE_TITLE, publisher=PUBLISHER, sourceUrl=listing["sourceUrl"],
            checkedAt=checked_at, services=[SCOPES[s] for s in scope],
            paymentOptions=[], awards=[], accounts=[],
        )
        public_text = " ".join([branch["title"], branch["address"], *branch["services"]])
        require(not PHONE.search(public_text)
                and not re.search(r"@|https?://|www\.", public_text, re.I),
                "contact information in public content")
        branches.append(branch)
        public_evidence.append(dict(providerId=pid, scopes=list(scope),
                                    selectedInputOrder=chosen["inputOrder"],
                                    inputOrders=[r["inputOrder"] for r in rows]))
        accepted_colocations[pid] = dict(
            providerId=pid,
            registryOffice=next(e for e in chosen["candidateEvidence"] if e["providerId"] == pid),
            colocations=chosen["registryColocationEvidence"],
        )
    audit = dict(
        inputRows=len(replay), decisions=dict(sorted(Counter(d["status"] for d in decisions).items())),
        reasons=dict(sorted(Counter(d["reason"] for d in decisions).items())),
        publicRecords=len(branches), publicOffices=len({b["providerId"] for b in branches}),
        headingBodyConflicts=[a["inputOrder"] for a in extraction
                              if "heading-body-conflict" in a["issues"]],
        missingZip=[d["inputOrder"] for d in decisions if d["zipStatus"] == "missing"],
        malformedZip=[dict(inputOrder=d["inputOrder"], value=d["listing"]["zip"])
                      for d in decisions if d["zipStatus"] == "malformed"],
        acceptedZipConflicts=[dict(inputOrder=d["inputOrder"], directoryZip=d["listing"]["zip"],
                                  registryZip=e["registryZip"])
                              for d in decisions if d["status"] == "accepted"
                              for e in d["candidateEvidence"] if e["eligible"]
                              and e["directoryZipMatchesRegistry"] is False],
        sharedDirectoryPhones=[
            dict(normalizedPhone=phone, inputOrders=[i for i, row in rows],
                 rows=[dict(inputOrder=i, listing=decisions[i]["listing"],
                            status=decisions[i]["status"], reason=decisions[i]["reason"],
                            providerId=decisions[i]["providerId"],
                            directoryPhoneEvidence=decisions[i]["directoryPhoneEvidence"],
                            candidateEvidence=decisions[i]["candidateEvidence"])
                       for i, row in rows])
            for phone, rows in sorted(directory_phones.items()) if len(rows) > 1
        ],
        acceptedRegistryColocations=list(accepted_colocations.values()),
        publicEvidence=public_evidence,
    )
    return {"cahc-decisions.json": decisions, "cahc-branches.json": branches,
            "cahc-audit.json": audit}


def capture(discoveries, bridge_path, checked_at):
    require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", checked_at) is not None,
            "checkedAt must be YYYY-MM-DD")
    date.fromisoformat(checked_at)
    raw = read_json(discoveries)
    with bridge_path.open(newline="", encoding="utf-8") as stream:
        bridge = list(csv.DictReader(stream))
    registry = read_json(REGISTRY)
    replay, extraction = extract_discoveries(raw, registry, bridge)
    names = set().union(*(name_keys(r["legalName"]) for r in replay))
    retained = [{k: r[k] for k in (
        "providerId", "sourceRow", "legalName", "stateRegisteredTradeNames",
        "address", "city", "phone",
    )} for r in bridge if r["stateRegisteredTradeNames"] and
        (names & (name_keys(r["legalName"]) | name_keys(r["stateRegisteredTradeNames"])))]
    retained.sort(key=lambda r: r["providerId"])
    artifacts = {"cahc-replay.json": replay, "cahc-dba-bridge.json": retained,
                 "cahc-extraction-audit.json": extraction}
    provenance = dict(
        checkedAt=checked_at, discoveryRows=len(raw),
        publisher=PUBLISHER,
        publisherEvidence=dict(sourceUrl="https://www.cahcusa.org/", checkedAt=checked_at,
                               quotation="Commission on Accreditation for Home Care"),
        originalInputs=[
            dict(name=discoveries.name, sha256=sha(discoveries.read_bytes()), rows=len(raw)),
            dict(name=bridge_path.name, sha256=sha(bridge_path.read_bytes()), rows=len(bridge)),
        ],
        replayInputSha256={name: sha(encode(value)) for name, value in artifacts.items()},
        registryInput=dict(path="../home-care-supply/providers.json",
                           sha256=sha(REGISTRY.read_bytes()), rows=len(registry)),
        registrySource=dict(publisher="New Jersey Division of Consumer Affairs",
                            sourceUrl="https://rgbportal.dca.njoag.gov/public-view/",
                            bridgeEvidence="sourceRow and registered DBA from the supplied CSV"),
        contactPolicy="Identity-only phones. No directory email or agency website retained.",
        streetPolicy="No verified directory street in these inputs. Primary-phone path only.",
        zipPolicy="Published ZIP strings are unchanged. Missing or malformed ZIP is audit data.",
        publicAddressPolicy="Only the directory city and NJ are public. No ZIP correction or postal verification.",
    )
    for name, value in {**artifacts, "cahc-provenance.json": provenance}.items():
        (HERE / name).write_bytes(encode(value))


def replay_outputs():
    provenance = read_json(HERE / "cahc-provenance.json")
    require(provenance["publisher"] == PUBLISHER, "publisher mismatch")
    require(sha(REGISTRY.read_bytes()) == provenance["registryInput"]["sha256"],
            "registry hash changed; review and explicitly recapture before replay")
    for name, expected in provenance["replayInputSha256"].items():
        require(name in {"cahc-replay.json", "cahc-dba-bridge.json",
                         "cahc-extraction-audit.json"}, "unexpected replay input")
        require(sha((HERE / name).read_bytes()) == expected, f"replay input hash changed: {name}")
    require(set(provenance["replayInputSha256"]) == {
        "cahc-replay.json", "cahc-dba-bridge.json", "cahc-extraction-audit.json"
    }, "missing replay input hash")
    replay = read_json(HERE / "cahc-replay.json")
    require(len(replay) == provenance["discoveryRows"], "discovery count changed")
    return build(replay, read_json(HERE / "cahc-dba-bridge.json"), read_json(REGISTRY),
                 read_json(HERE / "cahc-extraction-audit.json"), provenance["checkedAt"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare retained outputs; write nothing")
    parser.add_argument("--capture", type=Path, metavar="DISCOVERIES_JSON",
                        help="explicitly minimize raw discovery inputs for offline replay")
    parser.add_argument("--bridge", type=Path, help="original exact-office CSV, capture only")
    parser.add_argument("--checked-at", help="fixed review date, required for capture")
    args = parser.parse_args()
    try:
        if args.capture:
            require(not args.check and args.bridge and args.checked_at,
                    "--capture requires --bridge and --checked-at, without --check")
            capture(args.capture, args.bridge, args.checked_at)
        else:
            require(not args.bridge and not args.checked_at, "capture-only options without --capture")
        outputs = replay_outputs()
        for name, value in outputs.items():
            data, path = encode(value), HERE / name
            if args.check:
                require(path.is_file() and path.read_bytes() == data, f"output differs: {name}")
            else:
                path.write_bytes(data)
        print(json.dumps(outputs["cahc-audit.json"]["decisions"], sort_keys=True))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"CAHC replay failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
