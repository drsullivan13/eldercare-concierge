#!/usr/bin/env python3
"""Build the reviewed NJ nonmedical office patch from retained sources, offline."""

import argparse
from collections import Counter
from datetime import date
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[2]
BASE = Path("research/north-jersey/home-care-supply/operator-evidence")
PRIOR = Path("research/north-jersey/home-care-first-party")
WORKBOOK = BASE.parent / "source/firms.xlsx"
COUNTIES = {"Bergen", "Essex", "Hudson", "Morris", "Passaic", "Union", "Somerset", "Middlesex", "Monmouth"}
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
PHONE = re.compile(r"(?<!\d)(?:\+?1[-. (]*)?(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})(?!\d)")
BRANDS = (
    "visiting angels", "home instead", "senior helpers", "brightstar",
    "homewell", "synergy homecare", "comfort keepers", "bayada",
    "right at home", "life home care", "life homecare", "caring people",
)
UNSAFE = re.compile(
    r"\b(private.pay|medicare|medicaid|insurance|eligib|capacity|staffing|"
    r"skilled nursing|private duty nursing|reviews?|testimonials?|stars?|"
    r"my (?:mom|dad|mother|father)|response from|thank you|dear \w+)\b", re.I
)
UNSAFE_EXCERPT = re.compile(
    r"\b(?:reviews?|testimonials?|stars?|my (?:mom|dad|mother|father)|response from|thank you|dear \w+)\b", re.I
)
NEGATED_ASSERTION = re.compile(
    r"\b(?:do not|don't|does not|doesn't|cannot|can't|won't)\s+"
    r"(?:provide|offer|assist|help|include|serve|support|deliver)\b", re.I
)
SERVICE_TERMS = {
    "bath": r"\bbath", "dress": r"\bdress", "companion": r"\bcompanion",
    "personal": r"\bpersonal care|\b(?:bathing|grooming|hygiene|daily living)\b",
    "meal": r"\bmeal (?:prep|preparation|planning)|\bcooking and planning meals",
    "housekeeping": r"\bhousekeep|\bhousework",
    "respite": r"\brespite|\btemporary relief|\bfamily caregivers.*(?:break|time off)|\bfamily members.*rest",
    "hourly": r"\bhourly", "live-in": r"\blive.in", "24-hour": r"\b24.hour",
    "homemaker": r"\bhomemaker", "aide": r"\bhome health aide",
    "in-home": r"\bin.home|\bhome care",
    "transport": r"\btransport|\bdriving.*appointments", "errand": r"\berrand",
    "appointment": r"\bappointment", "groom": r"\bgroom", "toilet": r"\btoilet",
    "laundry": r"\blaundry", "medication": r"\bmedication reminders?|\breminders? about medication",
    "dementia": r"\bdementia", "alzheimer": r"\balzheimer",
    "mobility": r"\bmobility|\bambulation", "hospice": r"\bhospice",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encode(value, compact=False):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       **({"separators": (",", ":")} if compact else {"indent": 2})) + "\n").encode()


def clean(value):
    return " ".join(str(value or "").split())


def visible(value):
    value = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", value)
    return clean(re.sub(r"https?://\S+", "", value).replace("\\", ""))


def words(value):
    value = unicodedata.normalize("NFKD", visible(value)).lower()
    return re.findall(r"[a-z0-9]+", value)


def key(value):
    return "".join(words(value))


def address_key(value):
    value = " ".join(words(value))
    value = re.sub(r"\b(?:u s|us|new jersey|state route|route|rt)\s+(\d+)\b", r"route \1", value)
    aliases = {
        "street": "st", "avenue": "ave", "boulevard": "blvd", "road": "rd",
        "drive": "dr", "lane": "ln", "place": "pl", "turnpike": "tpke",
        "tpk": "tpke", "north": "n", "south": "s", "east": "e", "west": "w",
        "suite": "unit", "ste": "unit", "floor": "fl", "second": "2nd",
        "center": "ctr", "one": "1",
    }
    return "".join(aliases.get(word, word) for word in value.split())


def street_base(value):
    value = visible(value).upper()
    value = re.split(r",|\b(?:SUITE|STE\.?|UNIT|LOWER LEVEL|\d+(?:ST|ND|RD|TH)\s+FL(?:OOR)?|SECOND\s+FL(?:OOR)?)\b|#",
                     value, maxsplit=1)[0]
    value = re.sub(r"(\b(?:ROUTE|RT\.?|U\.?S\.?)\s+\d+)\s+(?:EAST|WEST|E|W)$", r"\1", value)
    return address_key(value)


def url(value):
    require(isinstance(value, str) and not re.search(r"\s", value), "Invalid source URL")
    parsed = urlsplit(value)
    require(parsed.scheme in ("https", "http") and parsed.hostname and
            not parsed.username and not parsed.password, f"Invalid source URL: {value}")
    return value


def domain(value):
    return urlsplit(url(value)).hostname.removeprefix("www.")


def local_url(value):
    parsed = urlsplit(url(value))
    path = parsed.path.lower().rstrip("/")
    return not (
        re.search(r"(?:locator|find-a|find-care|senior-home-care-new-jersey-nj)", path)
        or path in ("/locations", "/offices", "/home-care/usa/nj", "/nj", "/new-jersey",
                    "/hourly-care", "/services", "/home-care-services")
    )


def branch_url(value):
    parsed = urlsplit(value)
    host, path = domain(value), parsed.path.lower().rstrip("/")
    patterns = {
        "visitingangels.com": r"/[^/]+/(?:home|contact-us|home-care-[^/]+)$",
        "homeinstead.com": r"/home-care/usa/nj/[^/]+/\d+(?:/.*)?$",
        "seniorhelpers.com": r"/nj/[^/]+(?:/.*)?$",
        "brightstarcare.com": r"/locations/[^/]+(?:/.*)?$",
        "homewellcares.com": r"/in-home-care-[^/]+(?:/.*)?$",
        "synergyhomecare.com": r"/nj-[^/]+(?:/.*)?$",
        "comfortkeepers.com": r"/offices/new-jersey/[^/]+(?:/.*)?$",
        "rightathome.net": r"/[^/]+(?:/.*)?$",
        "bayada.com": r"/(?:offices?|personal-care-and-companionship)/.*",
    }
    return local_url(value) and host in patterns and bool(re.fullmatch(patterns[host], path))


def linked_branch(website, receipt, numbers):
    if any(website in receipt["lines"][n] for n in numbers):
        return True
    if not local_url(receipt["effective_url"]):
        return False
    left = urlsplit(website).path.rstrip("/")
    right = urlsplit(receipt["effective_url"]).path.rstrip("/")
    left = re.sub(r"/(?:contact-us|contact|home)$", "", left)
    right = re.sub(r"/(?:contact-us|contact|home)$", "", right)
    return bool(left and right) and (left == right or right.startswith(left + "/") or left.startswith(right + "/"))


def phone_key(value):
    digits = re.sub(r"\D", "", value)
    return digits[1:] if len(digits) == 11 and digits.startswith("1") else digits


def workbook_rows(body):
    """Read the single-sheet registry, following normalize-nj.py's stdlib parser."""
    with ZipFile(io.BytesIO(body)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(node.itertext()) for node in
                      ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        sheets = [name for name in archive.namelist()
                  if re.fullmatch(r"xl/worksheets/[^/]+\.xml", name)]
        require(len(sheets) == 1, "Expected exactly one registry worksheet")
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
        self.root = Path(root).resolve()
        self.hashes = {}
        self.receipts = {}

    def read(self, relative):
        path = (self.root / relative).resolve()
        require(not Path(relative).is_absolute() and path.is_relative_to(self.root),
                f"Input escapes repository: {relative}")
        body = path.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        name = path.relative_to(self.root).as_posix()
        require(self.hashes.get(name, digest) == digest, f"Input changed during build: {name}")
        self.hashes[name] = digest
        return body

    def json(self, relative):
        def unique(pairs):
            result = {}
            for k, v in pairs:
                require(k not in result, f"Duplicate JSON key {k} in {relative}")
                result[k] = v
            return result
        return json.loads(self.read(relative), object_pairs_hook=unique)

    def receipt(self, reference, prior=False, source=None):
        require(isinstance(reference, str) and reference, "Missing receipt reference")
        path = Path(reference)
        require(not path.is_absolute(), "Receipt must be repository-relative or collection-relative")
        path = path if reference.startswith("research/") else (PRIOR if prior else BASE) / path
        resolved = (self.root / path).resolve()
        require(any(resolved.is_relative_to((self.root / p / "receipts").resolve())
                    for p in (PRIOR, BASE)), f"Receipt outside retained receipts: {reference}")
        name = resolved.relative_to(self.root).as_posix()
        if name not in self.receipts:
            receipt = self.json(name)
            require(isinstance(receipt, dict), f"Receipt must be an object: {name}")
            require(type(receipt.get("status")) is int and 200 <= receipt["status"] < 300,
                    f"Receipt requires successful HTTP status: {name}")
            url(receipt.get("url"))
            url(receipt.get("effective_url"))
            require(domain(receipt["url"]) == domain(receipt["effective_url"]),
                    f"Receipt redirects outside publisher: {name}")
            require(isinstance(receipt.get("checked_at"), str), f"Missing checked_at: {name}")
            date.fromisoformat(receipt["checked_at"][:10])
            require(clean(receipt.get("title")), f"Missing receipt title: {name}")
            excerpts = receipt.get("excerpts")
            require(isinstance(excerpts, list) and excerpts, f"Missing receipt excerpts: {name}")
            lines = {}
            for entry in excerpts:
                require(type(entry.get("line")) is int and entry["line"] > 0 and
                        isinstance(entry.get("text"), str) and entry["text"].strip() and
                        entry["line"] not in lines, f"Invalid or duplicate excerpt line: {name}")
                lines[entry["line"]] = entry["text"]
            self.receipts[name] = {**receipt, "path": name, "lines": lines,
                                   "sha256": self.hashes[name]}
        receipt = self.receipts[name]
        if source is not None:
            require(all(source.get(k) == receipt.get(k)
                        for k in ("url", "effective_url", "checked_at")),
                    f"Source/receipt metadata mismatch: {name}")
        return receipt

    def evidence(self, receipt, numbers):
        require(isinstance(numbers, list) and numbers and
                all(type(n) is int and n in receipt["lines"] for n in numbers),
                f"Missing evidence lines: {receipt['path']} {numbers}")
        return {
            "receipt": receipt["path"], "sha256": receipt["sha256"],
            "url": receipt["effective_url"], "checkedAt": receipt["checked_at"][:10],
            "lines": sorted(set(numbers)),
        }

    def verify(self):
        for name, digest in list(self.hashes.items()):
            require(hashlib.sha256((self.root / name).read_bytes()).hexdigest() == digest,
                    f"Input changed during build: {name}")


def registry(inputs):
    metadata = inputs.json(str(WORKBOOK) + ".json")
    body = inputs.read(WORKBOOK)
    require(hashlib.sha256(body).hexdigest() == metadata["sha256"], "Registry SHA-256 mismatch")
    require(len(body) == metadata["bytes"], "Registry byte count mismatch")
    rows = workbook_rows(body)
    require(len(rows) == metadata["displayed_rows"] == metadata["exported_rows"] == 3628,
            "Current registry must contain all 3628 displayed/exported rows")
    grouped = {}
    for row in rows:
        hp = row["License/Registration"]
        grouped.setdefault(hp, []).append(row)
    by_hp = {}
    exceptions = []
    for hp, group in grouped.items():
        if not re.fullmatch(r"HP\d{7}", hp):
            exceptions.append({"reason": "malformed_registration_not_matchable",
                               "sourceRows": group})
            continue
        variants = {}
        for row in group:
            signature = encode({k: v for k, v in row.items() if k != "source_row"})
            variants.setdefault(signature, []).append(row)
        active = [items for items in variants.values() if items[0]["License Status"] == "Active"]
        selected = active[0] if len(active) == 1 else next(iter(variants.values()))
        by_hp[hp] = {**selected[0], "_source_rows": [r["source_row"] for r in selected],
                     "_ambiguous": len(variants) > 1 and len(active) != 1}
        if len(group) > 1:
            exceptions.append({
                "registrationID": hp, "sourceRows": group,
                "reason": "identical_duplicate_rows" if len(variants) == 1 else
                          "unique_active_variant_selected_inactive_variants_retained" if len(active) == 1 else
                          "ambiguous_registry_variants_no_release",
                "selectedSourceRows": by_hp[hp]["_source_rows"],
            })
    return by_hp, metadata, exceptions


def identity(row):
    return {
        "registrationID": row["License/Registration"], "sourceRow": row["source_row"],
        "sourceRows": row.get("_source_rows", [row["source_row"]]),
        "name": row["Business Name"], "dba": row["DBAs"],
        "address": row["Business Address"], "city": row["Business City"],
        "state": row["Business USA State"], "zip": row["Business Zipcode"],
        "status": row["License Status"], "expirationExcelSerial": row["Expiration Date"],
        "phone": row["Business Phone"],
    }


def name_matches(office, row):
    office_key = key(office)
    registered = " ".join((row["Business Name"], row["DBAs"]))
    for brand in BRANDS:
        if key(brand) in key(registered) and key(brand) in office_key:
            return True
    for name in (row["Business Name"], row["DBAs"]):
        name = re.split(r"\bDBA\b", name, flags=re.I)[-1]
        tokens = [t for t in words(name) if t not in {"llc", "inc", "the", "corp", "corporation", "and"}]
        candidate = "".join(tokens)
        office_without_and = "".join(t for t in words(office) if t != "and")
        if len(candidate) >= 10 and candidate in office_without_and:
            return True
    return False


def observed_match(observed, row):
    match = re.fullmatch(r"(.+?)[,\s]+NJ\s+(\d{5})(?:-\d{4})?", clean(observed), re.I)
    if not match or match[2] != row["Business Zipcode"][:5]:
        return False, "published_address_state_or_zip_mismatch"
    before = match[1].rstrip(" ,")
    city = row["Business City"]
    city_pattern = re.escape(city).replace(r"\ ", r"\s+")
    if key(city) == "parsippany":
        city_pattern = r"Parsippany(?:-Troy\s+Hills)?"
    city_match = re.search(rf"(?:,\s*|\s+)({city_pattern})$", before, re.I)
    if city_match is None:
        return False, "published_address_city_mismatch"
    street = before[:city_match.start()].rstrip(" ,")
    if street_base(street) != street_base(row["Business Address"]):
        return False, "published_address_street_mismatch"
    observed_units = units(street)
    registry_units = units(row["Business Address"])
    if observed_units and registry_units and not set(observed_units) & set(registry_units):
        return False, "published_address_unit_conflict"
    return True, ("normalized_address_exact" if address_key(street) == address_key(row["Business Address"])
                  else "street_city_zip_match_unit_or_floor_detail_differs")


def units(value):
    found = re.findall(r"(?:SUITE|STE\.?|UNIT|#)\s*#?\s*([A-Z0-9]+(?:-[A-Z0-9]+)?)", value.upper())
    found.extend(re.findall(r",\s*([A-Z]-?\d+[A-Z]?(?:-[A-Z0-9]+)?)\s*$", value.upper()))
    return [re.sub(r"[^A-Z0-9]", "", v) for v in found]


def address_lines(receipt, row):
    """Return a nearby address block, never combine separate offices on a locator."""
    lines = receipt["lines"]
    street = street_base(row["Business Address"])
    for n, text in sorted(lines.items()):
        if not re.search(r"(?<!\d)" + re.escape(street), address_key(visible(text))):
            continue
        block = []
        for i in sorted(lines):
            if not n <= i <= n + 9:
                continue
            block.append(i)
            joined = " ".join(visible(lines[j]) for j in block)
            if key(row["Business City"]) in key(joined) and re.search(
                    rf"(?<!\d){re.escape(row['Business Zipcode'][:5])}(?:-\d{{4}})?(?!\d)", joined):
                separated = re.sub(re.escape(row["Business City"]), " " + row["Business City"] + " ",
                                   joined, flags=re.I)
                published_units, registered_units = units(separated), units(row["Business Address"])
                if published_units and registered_units and not set(published_units) & set(registered_units):
                    break
                return block
    return []


def context_lines(receipt, numbers, field):
    result = set(numbers)
    for n in numbers:
        previous = [(i, t) for i, t in receipt["lines"].items() if 0 < n - i <= 15]
        previous.sort(reverse=True)
        for i, text in previous:
            plain = visible(text).lower()
            if UNSAFE_EXCERPT.search(plain) or re.search(r"form|select|interested|looking for", plain):
                break
            if ((text.startswith("#") or re.fullmatch(r"\*\*[^*]+\*\*\s*\\*", text))
                and n - i <= 4) or re.search(
                    r"\b(?:we (?:offer|provide)|include|help with|services.*(?:offer|support)|"
                    r"areas we serve|service area|proud.*serve|following (?:areas|counties))\b", plain):
                result.add(i)
                break
    return sorted(result)


def supported(receipt, numbers, field, value):
    if UNSAFE.search(value):
        return False, numbers, "outside_nonmedical_fact_scope"
    expanded = context_lines(receipt, numbers, field)
    text = " ".join(visible(receipt["lines"][n]) for n in expanded).lower()
    if UNSAFE_EXCERPT.search(text) or re.search(r"\b(?:select (?:a|the|your)|form options?|i am interested)\b", text):
        return False, expanded, "unsafe_or_form_evidence"
    if NEGATED_ASSERTION.search(text):
        return False, expanded, "negated_service_assertion"
    assertion = re.search(
        r"\b(?:offer|provid\w*|assist\w*|help\w*|include\w*|serv\w*|"
        r"caregivers|receive|support\w*|bring|deliver|companion caregivers)\b", text
    )
    narrative = any(len(words(receipt["lines"][n])) >= 8 and
                    not re.fullmatch(r"[-#*\s]*\[[^\]]+\]\([^)]*\)[\s*]*",
                                     receipt["lines"][n]) for n in expanded)
    area_heading = field == "serviceArea" and bool(re.search(
        r"areas we serve|service area|serving .+|providing home care services in", text))
    if (not assertion or not narrative) and not area_heading:
        return False, expanded, "navigation_or_label_without_assertion"
    if field == "serviceArea":
        label = re.split(r"\.?\s*Confirm\b", value, flags=re.I)[0]
        label = re.sub(r"^Provider[- ]reported areas include\s+|^Provider reports serving\s+|"
                       r"and explicitly advertises home care in\s+", "", label, flags=re.I)
        area_words = [w for w in words(label) if w not in {"and", "the", "county", "counties"}]
        if not area_words or not all(w in words(text) for w in area_words):
            return False, expanded, "area_not_explicit_in_excerpt"
        if not re.search(r"\b(?:serv\w*|areas?|counties|throughout|care in)\b", text):
            return False, expanded, "coverage_not_asserted"
    else:
        allowed_words = {
            "bathing", "dressing", "grooming", "toileting", "assistance", "and", "companion",
            "companionship", "care", "personal", "meal", "preparation", "planning", "light",
            "housekeeping", "respite", "hourly", "live", "in", "24", "hour", "homemaker",
            "home", "health", "aide", "services", "transportation", "transport", "to",
            "appointments", "appointment", "accompaniment", "errand", "errands", "medication",
            "reminders", "for", "family", "caregivers", "mobility", "laundry", "dementia",
            "alzheimer", "s", "hospice",
        }
        if set(words(value)) - allowed_words:
            return False, expanded, "unrecognized_service_label_requires_review"
        terms = [pattern for label, pattern in SERVICE_TERMS.items()
                 if label in value.lower()]
        if not terms or not all(re.search(pattern, text) for pattern in terms):
            return False, expanded, "service_not_explicit_in_excerpt"
    return True, expanded, None


def fact(inputs, receipt, numbers, field, value):
    evidence = inputs.evidence(receipt, numbers)
    if field == "website":
        valid = value in (receipt["url"], receipt["effective_url"]) and local_url(value)
        return ({"value": value, **evidence} if valid else None), "not_a_retained_local_office_url"
    if field == "phone":
        digits = phone_key(value)
        cited = " ".join(receipt["lines"][n] for n in numbers)
        valid = len(digits) == 10 and digits in {"".join(m.groups()) for m in PHONE.finditer(cited)}
        return ({"value": digits, **evidence} if valid else None), "phone_not_in_cited_excerpt"
    ok, expanded, reason = supported(receipt, numbers, field, value)
    return ({"value": value, **inputs.evidence(receipt, expanded)} if ok else None), reason


def prior_record(inputs, record, rows):
    hp = record["official_registration_id"]
    require(re.fullmatch(r"HP\d{7}", hp), f"Invalid prior registration ID: {hp}")
    require(record["provider_id"] == "north-jersey-hp-" + hp.lower(), "Prior provider ID mismatch")
    row = rows.get(hp)
    audit = {
        "origin": "prior", "recordID": record["record_id"], "registrationID": hp,
        "providerID": record["provider_id"], "officeName": record["office_name"],
        "county": record["county"], "observedAddress": record["observed_address"],
        "priorIdentity": {k: record[k] for k in (
            "registered_name", "registered_address", "registered_city", "registered_state", "registered_zip")},
        "priorRegistrySource": record["registry_source"],
        "currentRegistry": identity(row) if row else None,
        "matchNotes": record.get("match_basis"), "facts": {}, "gaps": [], "receipts": [],
    }
    sources = {}
    for source in record["sources"]:
        receipt = inputs.receipt(source.get("receipt"), prior=True, source=source)
        require(source["url"] not in sources, f"Duplicate prior source URL: {hp}")
        sources[source["url"]] = receipt
        audit["receipts"].append({"path": receipt["path"], "sha256": receipt["sha256"]})
    address = record["office_address_evidence"]
    require(address["source_url"] in sources, f"Missing prior address receipt: {hp}")
    address_receipt = sources[address["source_url"]]
    audit["identityEvidence"] = inputs.evidence(address_receipt, address["evidence_lines"])
    reasons = []
    if row is None:
        reasons.append("registration_absent_from_current_registry")
    else:
        if row.get("_ambiguous"):
            reasons.append("ambiguous_current_registry_variants")
        comparisons = (
            ("registered_name", "Business Name", key),
            ("registered_address", "Business Address", address_key),
            ("registered_city", "Business City", key),
            ("registered_state", "Business USA State", key),
            ("registered_zip", "Business Zipcode", lambda v: v[:5]),
        )
        reasons.extend("current_registry_" + old + "_changed" for old, new, normalize in comparisons
                       if normalize(record[old]) != normalize(row[new]))
        if row["License Status"] != "Active":
            reasons.append("registration_not_active")
        if row["Business USA State"] != "NJ":
            reasons.append("registry_office_not_nj")
        matched, note = observed_match(record["observed_address"], row)
        audit["addressComparison"] = note
        if not matched:
            reasons.append(note)
        cited_address = " ".join(address_receipt["lines"][n] for n in address["evidence_lines"])
        if not address_lines({**address_receipt, "lines": {
                n: address_receipt["lines"][n] for n in address["evidence_lines"]}}, row):
            reasons.append("cited_address_does_not_match_registry")
        if not name_matches(record["office_name"], row):
            reasons.append("office_brand_identity_not_established")
        audit["publishedAddressTextKey"] = address_key(cited_address)
    audit["status"] = "excluded" if reasons else "verified"
    audit["gaps"].extend(reasons)
    if reasons:
        return audit
    for source_field, field in (("services", "services"), ("service_areas", "serviceArea")):
        for claim in record[source_field]:
            require(claim["source_url"] in sources, f"Missing prior fact source: {hp}")
            receipt = sources[claim["source_url"]]
            value, reason = fact(inputs, receipt, claim.get("evidence_lines"), field, claim["text"])
            if value is not None:
                audit["facts"].setdefault(field, []).append(value)
            else:
                audit["gaps"].append({"field": field, "value": claim["text"], "reason": reason,
                                      "evidence": inputs.evidence(receipt, claim["evidence_lines"])})
    candidates = [r for r in sources.values() if local_url(r["effective_url"])]
    for receipt in candidates:
        numbers = address_lines(receipt, row)
        if not numbers and branch_url(receipt["effective_url"]):
            numbers = sorted({n for values in audit["facts"].values() for f in values
                              if f["receipt"] == receipt["path"] for n in f["lines"]})
        if numbers:
            audit["facts"]["website"] = [{
                "value": receipt["effective_url"], **inputs.evidence(receipt, numbers)}]
            break
    if "website" not in audit["facts"]:
        audit["gaps"].append("no_retained_local_office_url_not_a_brand_locator")
    add_prior_phone(inputs, audit, row, sources.values(), address_receipt, address["evidence_lines"])
    return audit


def add_prior_phone(inputs, audit, row, receipts, identity_receipt, identity_numbers):
    candidates = {}
    registry_phone = phone_key(row["Business Phone"])
    for receipt in receipts:
        if not local_url(receipt["effective_url"]):
            continue
        lines = receipt["lines"]
        addresses = address_lines(receipt, row)
        for n, text in sorted(lines.items()):
            if UNSAFE.search(visible(text)):
                continue
            for match in PHONE.finditer(text):
                digits = "".join(match.groups())
                # A different phone needs an adjacent exact office address block.
                if digits != registry_phone and not (addresses and min(abs(n - i) for i in addresses) <= 6):
                    continue
                if addresses:
                    other_zip = any(re.search(r"\bNJ\s+\d{5}\b", visible(t), re.I) and
                                    row["Business Zipcode"][:5] not in t
                                    for i, t in lines.items() if min(n, min(addresses)) <= i <= max(n, max(addresses)))
                    if other_zip:
                        continue
                candidates.setdefault(digits, (receipt, n))
    if len(candidates) == 1:
        digits, (receipt, n) = next(iter(candidates.items()))
        audit["facts"]["phone"] = [{"value": digits, **inputs.evidence(receipt, [n]),
                                     "officeIdentityEvidence": inputs.evidence(
                                         identity_receipt, identity_numbers)}]
    elif candidates:
        audit["gaps"].append({"field": "phone", "reason": "multiple_published_branch_numbers",
                              "candidates": sorted(candidates)})
    else:
        audit["gaps"].append("branch_phone_not_established_by_retained_receipts")


def new_record(inputs, record, rows):
    hp = record["registrationID"]
    require(re.fullmatch(r"HP\d{7}", hp), f"Invalid new registration ID: {hp}")
    require(record["county"] in COUNTIES and clean(record["officeName"]) and
            clean(record["observedAddress"]), f"Missing new branch identity: {hp}")
    raw_facts = record["facts"]
    require(isinstance(raw_facts, dict) and {"website", "services"} <= raw_facts.keys() and
            set(raw_facts) <= {"website", "services", "serviceArea", "phone"}, f"Invalid facts: {hp}")
    row = rows.get(hp)
    audit = {
        "origin": "new", "registrationID": hp, "providerID": "north-jersey-hp-" + hp.lower(),
        "county": record["county"], "officeName": record["officeName"],
        "observedAddress": record["observedAddress"], "matchNotes": record.get("matchNotes"),
        "currentRegistry": identity(row) if row else None,
        "facts": {}, "gaps": list(record.get("gaps", [])), "receipts": [],
    }
    parsed = []
    for field, item in raw_facts.items():
        require(isinstance(item, dict) and set(item) == {"value", "receipt", "lines"},
                f"Invalid {field} fact shape: {hp}")
        receipt = inputs.receipt(item["receipt"])
        inputs.evidence(receipt, item["lines"])
        values = item["value"] if field == "services" else [item["value"]]
        require(isinstance(values, list) and values and all(isinstance(v, str) and clean(v) for v in values),
                f"Invalid {field} value: {hp}")
        require(len(values) == len(set(values)), f"Duplicate {field} value: {hp}")
        audit["receipts"].append({"path": receipt["path"], "sha256": receipt["sha256"]})
        for value in values:
            parsed.append((field, value, receipt, item["lines"]))
    website = inputs.receipt(raw_facts["website"]["receipt"])
    identity_claim = record.get("identityEvidence")
    if identity_claim is not None:
        require(isinstance(identity_claim, dict) and set(identity_claim) == {"receipt", "lines"},
                f"Invalid identityEvidence shape: {hp}")
        identity_receipt = inputs.receipt(identity_claim["receipt"])
        identity_numbers = identity_claim["lines"]
        inputs.evidence(identity_receipt, identity_numbers)
        audit["receipts"].append({"path": identity_receipt["path"], "sha256": identity_receipt["sha256"]})
    else:
        identity_receipt = website
        identity_numbers = list(website["lines"])
    reasons = []
    if row is None:
        reasons.append("registration_absent_from_current_registry")
    else:
        if row.get("_ambiguous"):
            reasons.append("ambiguous_current_registry_variants")
        if row["License Status"] != "Active":
            reasons.append("registration_not_active")
        if row["Business USA State"] != "NJ":
            reasons.append("registry_office_not_nj")
        matched, note = observed_match(record["observedAddress"], row)
        audit["addressComparison"] = note
        if not matched:
            reasons.append(note)
        if not name_matches(record["officeName"], row):
            reasons.append("office_brand_identity_not_established")
        cited_identity = {**identity_receipt, "lines": {
            n: identity_receipt["lines"][n] for n in identity_numbers}}
        evidence = address_lines(cited_identity, row)
        if not evidence:
            reasons.append("identity_receipt_missing_exact_office_address")
        else:
            audit["identityEvidence"] = inputs.evidence(identity_receipt, identity_numbers)
        if (domain(website["effective_url"]) != domain(identity_receipt["effective_url"])
                or not linked_branch(website["url"], identity_receipt, identity_numbers)):
            reasons.append("local_website_not_linked_to_identity_receipt")
        if not name_matches(website["title"] + " " + " ".join(
                visible(t) for t in website["lines"].values() if not UNSAFE.search(visible(t))), row):
            reasons.append("receipt_brand_identity_not_established")
    audit["status"] = "excluded" if reasons else "verified"
    audit["gaps"].extend(reasons)
    if reasons:
        return audit
    for field, value, receipt, numbers in parsed:
        require(domain(receipt["effective_url"]) == domain(website["effective_url"]) and
                linked_branch(website["url"], receipt, numbers),
                f"Fact publisher or branch differs from office website: {hp}")
        retained, reason = fact(inputs, receipt, numbers, field, value)
        if retained is None:
            audit["gaps"].append({"field": field, "value": value, "reason": reason,
                                  "evidence": inputs.evidence(receipt, numbers)})
        else:
            audit["facts"].setdefault(field, []).append(retained)
    if "website" not in audit["facts"]:
        audit["status"] = "excluded"
        audit["facts"] = {}
        audit["gaps"].append("new_branch_requires_verified_local_website")
    if "phone" in audit["facts"]:
        phone = audit["facts"]["phone"][0]
        receipt = inputs.receipts[phone["receipt"]]
        address = address_lines(receipt, row)
        linked_identity_phone = (
            linked_branch(receipt["url"], identity_receipt, identity_numbers)
            and phone["value"] in {
                "".join(m.groups()) for n in identity_numbers
                for m in PHONE.finditer(identity_receipt["lines"][n])})
        if not linked_identity_phone and (
                not address or min(abs(n - a) for n in phone["lines"] for a in address) > 10):
            del audit["facts"]["phone"]
            audit["gaps"].append("phone_not_adjacent_to_exact_branch_address")
    return audit


def project(inputs, audits):
    release = {}
    for audit in audits:
        if audit["status"] != "verified":
            continue
        facts = audit["facts"]
        patch = {"services": [], "sources": []}
        provenance = {}
        for field in ("website", "serviceArea", "services", "phone"):
            claims = facts.get(field, [])
            if not claims:
                continue
            values = list(dict.fromkeys(f["value"] for f in claims))
            if field in ("website", "phone") and len(values) != 1:
                audit["gaps"].append({"field": field, "reason": "conflicting_published_values",
                                      "values": values})
                continue
            patch[field] = values if field == "services" else "; ".join(values)
            provenance[field] = claims
        if set(patch) == {"services", "sources"} and not patch["services"]:
            audit["status"] = "withheld_no_supported_fields"
            continue
        sources = {}
        for field, claims in provenance.items():
            for claim in claims:
                sources.setdefault(claim["receipt"], {}).setdefault(field, set()).update(claim["lines"])
        for path, fields in sorted(sources.items()):
            receipt = inputs.receipts[path]
            patch["sources"].append({
                "title": clean(receipt["title"]), "publisher": audit["officeName"],
                "url": receipt["effective_url"], "kind": "provider",
                "checkedAt": receipt["checked_at"][:10],
                "supports": "Provider-reported " + "; ".join(
                    f"{field} (retained {path}, lines {', '.join(map(str, sorted(lines)))})"
                    for field, lines in sorted(fields.items())) + ". Not independent quality or availability evidence.",
            })
        audit["publishedFields"] = provenance
        registry_phone = audit["currentRegistry"]["phone"]
        if "phone" in patch and phone_key(registry_phone) != phone_key(patch["phone"]):
            audit["phoneConflict"] = {
                "registryPhone": registry_phone, "publishedBranchPhone": patch["phone"],
                "resolution": "prefer_explicitly_sourced_branch_phone_in_patch_only",
                "warning": "Published branch phone differs from current registry phone. Confirm directly.",
            }
        pid = audit["providerID"]
        require(pid not in release, f"Duplicate verified registration across prior/new inputs: {pid}")
        release[pid] = patch
    return {"schemaVersion": 1, "byProviderID": release}


def build(root=ROOT, include_new=True):
    inputs = Inputs(root)
    rows, metadata, exceptions = registry(inputs)
    previous = inputs.json(PRIOR / "records.json")
    require(isinstance(previous, list) and len(previous) == 39, "Expected all 39 prior records")
    require(len({r["official_registration_id"] for r in previous}) == 39, "Duplicate prior registration")
    audits = [prior_record(inputs, record, rows) for record in previous]
    new_path = BASE / "new-branches.json"
    new = {"records": [], "attempts": []}
    present = include_new and (inputs.root / new_path).is_file()
    if present:
        new = inputs.json(new_path)
        require(isinstance(new, dict) and {"records", "attempts"} <= set(new)
                and set(new) <= {"records", "attempts", "limits"} and
                isinstance(new["records"], list) and isinstance(new["attempts"], list),
                "new-branches.json must have records and attempts arrays")
        audits.extend(new_record(inputs, record, rows) for record in new["records"])
    require(len({a["registrationID"] for a in audits}) == len(audits),
            "Duplicate registration across prior/new inputs; reconcile explicitly, do not overwrite")
    predecessor = rows["HP0166900"]
    require(predecessor["License Status"] != "Active",
            "HP0166900 predecessor status changed; review before releasing")
    release = project(inputs, audits)
    require("north-jersey-hp-hp0166900" not in release["byProviderID"], "Inactive predecessor published")
    audit = {
        "schemaVersion": 1, "registry": {"path": str(WORKBOOK), "metadata": metadata,
                                        "rows": metadata["exported_rows"],
                                        "exceptions": exceptions},
        "newBranches": "included" if present else "absent_treated_as_empty" if include_new else "excluded_prior_only",
        "records": audits, "attempts": new["attempts"], "newInputLimits": new.get("limits", []),
        "separateRegistrations": [
            {"currentRegistry": identity(predecessor), "status": "excluded_inactive_predecessor",
             "notRematchedTo": "HP0374000",
             "reason": "Shared brand or premises do not transfer evidence between registrations."},
            {"currentRegistry": identity(rows["HP0374000"]),
             "status": "released" if "north-jersey-hp-hp0374000" in release["byProviderID"] else "no_verified_patch",
             "notCollapsedWith": "HP0166900"},
        ],
        "limitations": [
            "First-party claims are not quality, safety, staffing, capacity, eligibility or availability verification.",
            "Registry Active status is retained as published, not inferred from its expiration date.",
            "Office county is not service coverage. No private-pay or family-review claims are published.",
            "Unpublished or rejected fields remain unknown. Prior receipts are retained by reference, not rewritten.",
        ],
    }
    body = encode(release, compact=True)
    validation = {
        "schemaVersion": 1, "registryRows": metadata["exported_rows"],
        "registryMatchableIDs": len(rows), "registryExceptions": len(exceptions),
        "priorRecordsReconciled": len(previous),
        "newRecords": len(new["records"]), "newBranches": audit["newBranches"],
        "releasedProviders": len(release["byProviderID"]),
        "recordStatuses": dict(sorted(Counter(a["status"] for a in audits).items())),
        "publishedFieldCounts": dict(sorted(Counter(
            field for patch in release["byProviderID"].values()
            for field in patch if field != "sources" and patch[field]).items())),
        "phoneConflicts": [a["registrationID"] for a in audits if "phoneConflict" in a],
        "retainedReceipts": len(inputs.receipts), "inputSha256": dict(sorted(inputs.hashes.items())),
        "releaseSha256": hashlib.sha256(body).hexdigest(),
        "errors": [],
    }
    inputs.verify()
    return {"release.json": body, "reconciliation.json": encode(audit),
            "validation.json": encode(validation)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare all three outputs byte for byte, without writing")
    parser.add_argument("--prior-only", action="store_true", help="Ignore new-branches.json for the initial prior-only handoff")
    args = parser.parse_args()
    files = build(include_new=not args.prior_only)
    for name, body in files.items():
        path = ROOT / BASE / name
        if args.check:
            require(path.is_file() and path.read_bytes() == body, f"Output differs: {path}. Rebuild.")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
    report = json.loads(files["validation.json"])
    print(json.dumps({k: report[k] for k in (
        "registryRows", "priorRecordsReconciled", "newRecords", "releasedProviders",
        "recordStatuses", "phoneConflicts", "retainedReceipts")}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"Home-care office evidence failed: {error}", file=sys.stderr)
        sys.exit(1)
