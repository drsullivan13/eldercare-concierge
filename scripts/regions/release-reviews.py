#!/usr/bin/env python3
"""Release independently approved North Jersey review aggregates, never collect pages."""

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
REGION = Path("research/north-jersey")
RELEASE = REGION / "review-release"
ASSESSMENT_DATE = "2026-11-12"
OUTPUTS = (
    "locationResearch.json", "approvals-audit.json", "exclusions.json",
    "staging.json", "observation-registry.json", "experience-verification.json",
    "manifest.json",
)
STREET_WORDS = {
    "avenue": "ave", "av": "ave", "street": "st", "road": "rd", "drive": "dr",
    "boulevard": "blvd", "lane": "ln", "place": "pl", "court": "ct",
    "parkway": "pkwy", "route": "rt", "rte": "rt", "highway": "hwy",
    "floor": "fl", "north": "n", "south": "s", "east": "e", "west": "w", "suite": "ste",
}


class ReleaseError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_json(data):
    return json.loads(data, object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ReleaseError(f"Nonfinite JSON value: {value}")))


def fields(value, names, label):
    require(isinstance(value, dict) and set(value) == set(names.split()),
            f"Malformed {label}; expected exactly {names}")


def text_value(value):
    return isinstance(value, str) and bool(value.strip())


def valid_date(value):
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def token(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def words(value):
    return " ".join(STREET_WORDS.get(w, w) for w in
                    re.findall(r"[a-z0-9]+", str(value).lower()))


def canonical_url(value):
    require(text_value(value), "Missing URL")
    parsed = urlsplit(value)
    require(parsed.scheme in ("http", "https") and parsed.hostname
            and not parsed.username and not parsed.password, f"Invalid public URL: {value}")
    return re.sub(r"^www\.", "", parsed.hostname.lower()) + parsed.path.rstrip("/")


class Inputs:
    def __init__(self, root):
        self.root = root.resolve()
        self.bytes = {}

    def read(self, relative):
        require(isinstance(relative, str), "Source path must be a string")
        path = Path(relative)
        require(not path.is_absolute() and ".." not in path.parts,
                f"Source must be repository-relative: {relative}")
        full = self.root / path
        require(full.resolve().is_relative_to((self.root / REGION).resolve()),
                f"Source outside North Jersey: {relative}")
        require(full.is_file() and not full.is_symlink(),
                f"Missing source material or nonregular file: {relative}")
        if relative not in self.bytes:
            self.bytes[relative] = full.read_bytes()
        return self.bytes[relative]

    def json(self, relative):
        try:
            return parse_json(self.read(relative))
        except (json.JSONDecodeError, UnicodeError) as error:
            raise ReleaseError(f"Malformed JSON in {relative}: {error}") from error

    def bound(self, reference, pointer=False):
        fields(reference, "path sha256 pointer" if pointer else "path sha256", "source reference")
        require(isinstance(reference["sha256"], str) and
                re.fullmatch(r"[0-9a-f]{64}", reference["sha256"]), "Malformed source SHA-256")
        data = self.read(reference["path"])
        require(digest(data) == reference["sha256"],
                f"Source hash drift: {reference['path']}")
        return data


@dataclass(frozen=True)
class Observation:
    path: str
    pointer: str
    value: dict
    context: dict

    @property
    def key(self):
        return self.path + "#" + self.pointer

    def normalized(self, inputs):
        value = self.value
        identity = value.get("identity") or {}
        aggregate = value.get("aggregate") or value.get("rating") or {}
        if not isinstance(aggregate, dict):
            aggregate = {}
        families = aggregate.get("underlying_source_families") or []
        family = (aggregate.get("source_family") or aggregate.get("sourceFamily")
                  or aggregate.get("family") or value.get("sourceFamily"))
        if not family and len(families) == 1:
            family = families[0].get("family")
        population = aggregate.get("reviewer_population", "")
        scope = aggregate.get("scope") or value.get("population")
        if not scope and "consumer" in population.lower():
            scope = "consumer"
        ambiguity = aggregate.get("ambiguity")
        if ambiguity and not ambiguity.startswith("none"):
            scope = "ambiguous"
        inspection = value.get("inspection")
        if value.get("kind") == "property_page_check" and value.get("transport") == "FetchUrl":
            inspection = "full-page"
        return {
            "key": self.key,
            "observation": {"path": self.path, "pointer": self.pointer,
                            "sha256": digest(inputs.read(self.path))},
            "officialId": value.get("official_id") or value.get("officialId") or self.context.get("official_id"),
            "providerId": value.get("providerId"),
            "url": next((value[k] for k in ("canonical_url", "canonicalUrl", "url",
                                          "source_url", "requested_url", "effectiveUrl")
                         if text_value(value.get(k))), None),
            "platform": value.get("platform") or value.get("source"),
            "kind": value.get("sourceType") or value.get("source_type") or
                    ("review-platform" if value.get("kind") == "property_page_check" else None),
            "inspection": inspection,
            "checkedAt": value.get("checkedAt") or value.get("checked_at")
                         or (value.get("observedAt") or "")[:10]
                         or self.context.get("checked_at"),
            "identity": {
                "name": identity.get("observed_name", identity.get("name")),
                "address": identity.get("observed_street", identity.get(
                    "observed_address", identity.get("street", identity.get("address")))),
                "city": identity.get("observed_city", identity.get("city")),
                "state": identity.get("observed_state", identity.get("state")),
                "zip": identity.get("observed_zip", identity.get("zip")),
                "careUnit": identity.get("observed_care_unit", identity.get(
                    "careUnitText", identity.get("careUnit"))),
            },
            "aggregate": {
                "rating": aggregate.get("rating", aggregate.get("value")),
                "scale": aggregate.get("scale"),
                "count": aggregate.get("review_count", aggregate.get("count")),
                "asOf": aggregate.get("published_as_of", aggregate.get("asOf")),
                "scope": scope, "sourceFamily": family,
            } if aggregate else None,
            "status": value.get("outcome") or value.get("status") or value.get("kind"),
        }


def registry(inputs):
    observations = {}
    inventory = []

    def walk(value, path, pointer="", context=None):
        context = dict(context or {})
        if isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, path, f"{pointer}/{index}", context)
        elif isinstance(value, dict):
            location = value.get("location")
            if isinstance(location, dict):
                context.update(location)
            for key in ("official_id", "checked_at"):
                if key in value:
                    context[key] = value[key]
            if (any(text_value(value.get(k)) for k in (
                    "url", "source_url", "requested_url", "canonical_url",
                    "canonicalUrl", "effectiveUrl")) or
                    str(value.get("kind") or "").startswith("discovery_search")):
                observation = Observation(path, pointer, value, context)
                observations[observation.key] = observation
            for key, item in value.items():
                if isinstance(item, (dict, list)) and key not in (
                        "identity", "aggregate", "rating", "official_source",
                        "metadata", "official_roster_match", "cms_crosswalk"):
                    escaped = key.replace("~", "~0").replace("/", "~1")
                    walk(item, path, f"{pointer}/{escaped}", context)

    frozen_path = (RELEASE / "source-observations.json").as_posix()
    if (inputs.root / frozen_path).is_file():
        data = inputs.read(frozen_path)
        walk(inputs.json(frozen_path), frozen_path)
        inventory.append({"path": frozen_path, "sha256": digest(data), "bytes": len(data)})
        return observations, inventory
    for folder in ("reviews", "listing-index"):
        base = inputs.root / REGION / folder
        require(base.is_dir(), f"Missing collection directory: {base}")
        for file in sorted(base.rglob("*")):
            if not file.is_file() or "__pycache__" in file.parts:
                continue
            path = file.relative_to(inputs.root).as_posix()
            data = inputs.read(path)
            inventory.append({"path": path, "sha256": digest(data), "bytes": len(data)})
            if file.suffix == ".json":
                walk(inputs.json(path), path)
    return observations, inventory


def provider_street(provider):
    address = words(provider["address"])
    suffix = words(f"{provider['city']} {provider['state']} {provider['zip']}")
    if address.endswith(suffix):
        address = address[:-len(suffix)].strip()
    return re.sub(r" po box [0-9]+$", "", address)


def compatible_unit(care_unit, category):
    care = words(care_unit)
    terms = {
        "nursing-home": ("skilled nursing", "long term care", "snf", "nursing home"),
        "assisted-living": ("assisted living",),
        "memory-care": ("memory care", "dementia"),
        "home-care": ("home care", "health care services", "at home care"),
        "home-health": ("home health",),
        "ccrc": ("continuing care", "ccrc"),
    }
    return any(term in care for term in terms.get(category, ()))


def comparable_name(value, category):
    name = str(value).lower().replace("&", " and ")
    name = re.sub(r"\s+member of [a-z ]+ care group$", "", name)
    name = re.sub(r"(?:\s*[:–-]\s*(?:nursing home|assisted senior living facility))? in new jersey$", "", name)
    name = re.sub(r"(?:,?\s+)(?:llc|inc)[. ]*$", "", name)
    name = re.sub(r"\brehabilitation\b", "rehab", name)
    if category == "assisted-living":
        name = re.sub(r"^sunrise assisted living of ", "sunrise of ", name)
        name = re.sub(r"^spring hills at ", "spring hills ", name)
    return token(name)


def validate_identity(approval, observed, providers, crosswalk, aliases=()):
    provider_id, official_id = approval["providerId"], approval["officialId"]
    require(provider_id in providers, f"Unknown runtime identity: {provider_id}")
    matches = [row for row in crosswalk if row.get("officialId") == official_id
               and row.get("status") == "included"]
    require(len(matches) == 1 and matches[0].get("providerId") == provider_id,
            f"Unknown or ambiguous official identity: {official_id} / {provider_id}")
    require(not observed["officialId"] or observed["officialId"] == official_id,
            "Observation official identity mismatch")
    require(not observed["providerId"] or observed["providerId"] == provider_id,
            "Observation runtime identity mismatch")
    identity = approval["identity"]
    fields(identity, "name address city state zip careUnit", "observed identity")
    require(identity == observed["identity"], "Approval observed identity mismatch")
    require(all(text_value(identity[key]) for key in
                ("name", "address", "city", "state", "careUnit")), "Incomplete observed identity")
    require(identity["zip"] is None or (
        isinstance(identity["zip"], str) and re.fullmatch(r"\d{5}(?:-\d{4})?", identity["zip"])),
        "Malformed observed ZIP")
    provider = providers[provider_id]
    expected_name = re.sub(r"\s*\([^()]+\)\s*$", "", matches[0].get("licensedName", ""))
    name = comparable_name(identity["name"], provider["category"])
    exact_names = {comparable_name(n, provider["category"]) for n in (provider["name"], expected_name)}
    if name not in exact_names:
        proof = [r for r in aliases if r["providerId"] == provider_id and r["officialId"] == official_id
                 and token(r["listingName"]) == token(identity["name"])
                 and r["category"] == provider["category"] and words(r["officeOrFacility"]) == provider_street(provider)
                 and token(r["city"]) == token(provider["city"]) and r["zip"] == provider["zip"][:5]
                 and r["state"] == provider["state"] and valid_date(r["checkedAt"])
                 and canonical_url(r["sourceUrl"]) and text_value(r["operatorName"])]
        require(len(proof) == 1, "Observed name does not match exact runtime or corroborated location name")
    require(words(identity["address"]) == provider_street(provider)
            and token(identity["city"]) == token(provider["city"])
            and token(provider["state"]) == "nj"
            and token(identity["state"]) in {"nj", "newjersey"},
            "Observed street/city/state identity mismatch")
    require(compatible_unit(identity["careUnit"], provider["category"]),
            "Observed care unit mismatch")
    require(identity["zip"] is None or identity["zip"][:5] == provider["zip"][:5],
            "Observed ZIP identity mismatch")
    if identity["zip"] is None:
        siblings = {
            row["providerId"] for row in crosswalk if row.get("status") == "included"
            and row.get("providerId") in providers
            and provider_street(providers[row["providerId"]]) == provider_street(provider)
            and token(providers[row["providerId"]]["city"]) == token(provider["city"])
            and compatible_unit(identity["careUnit"], providers[row["providerId"]]["category"])
        }
        require(siblings == {provider_id}, "Missing observed ZIP has ambiguous official care-unit crosswalk")
    return {"observedZip": identity["zip"], "officialZip": provider["zip"],
            "zipResolution": "exact-official-crosswalk" if identity["zip"] is None else "observed"}


def checked_listing_aggregate(approval, material):
    qa = material.get("scopeQa", {})
    require(qa.get("reviewSectionInspected") is True and qa.get("googlePlaceIdCount") in (0,1)
            and len(set(qa.get("googlePlaceIds", []))) == qa["googlePlaceIdCount"], "Ambiguous underlying review population")
    header = re.search(r"^# (.+?)\n+\[([^\]]+)\]\(",material["identityText"])
    identity = approval["identity"]
    location_parts = [identity[k] for k in ("address","city","state","zip") if identity[k]]
    require(header and token(header[1]) == token(identity["name"])
            and words(header[2]).replace("new jersey", "nj") == words(" ".join(location_parts)).replace("new jersey", "nj")
            and token(material["careUnitText"]) == token(identity["careUnit"]), "Raw listing identity fields disagree")
    google = re.search(r"([0-5](?:\.\d+)?)★ on Google \(([0-9,]+)\)", material["aggregateText"])
    require(google is not None and "overall" in material["aggregateText"], "Missing location-specific Google aggregate")
    require(qa.get("assessment", "").startswith("Approved."), "Independent scope QA did not approve")
    return dict(rating=float(google[1]),scale=5,count=int(google[2].replace(",","")),
                asOf=None,scope="consumer",sourceFamily="google")


def raw_listing_observation(approval, original, inputs):
    raw = original.value
    body = raw["markdown"]
    material = inputs.json(approval["material"]["path"])
    require(urlsplit(raw["effectiveUrl"]).hostname in {"www.mylivingchoice.com", "mylivingchoice.com"}
            and canonical_url(raw["effectiveUrl"]) == canonical_url(approval["url"])
            and raw.get("metadata", {}).get("statusCode") == 200, "Unverified raw listing fetch")
    require(all(material.get(field) and material[field] in body for field in
                ("identityText", "careUnitText", "aggregateText")), "Underlying listing disagrees with independent material")
    aggregate = checked_listing_aggregate(approval, material)
    identity = approval["identity"]
    return dict(key=original.key, officialId=None,providerId=None,url=raw["effectiveUrl"],
                platform="MyLivingChoice",kind="review-platform",inspection="full-page",
                checkedAt=raw["retrievedAt"][:10],identity=identity,
                aggregate=aggregate)


def validate_approval(approval, inputs, observations, providers, crosswalk, aliases=()):
    fields(approval, "id providerId officialId observation material url checkedAt access "
           "platform identity aggregate reason" + (" reconciliation" if "reconciliation" in approval else ""), "approval")
    if "reconciliation" in approval:
        fields(approval["reconciliation"], "name address", "editorial reconciliation note")
    require(all(text_value(approval[key]) for key in
                ("id", "providerId", "officialId", "platform", "reason")), "Malformed approval text")
    require(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", approval["id"]), "Malformed approval ID")
    inputs.bound(approval["observation"], pointer=True)
    pointer = approval["observation"]["pointer"]
    require(isinstance(pointer, str) and (not pointer or pointer.startswith("/")),
            "Malformed observation JSON pointer")
    key = approval["observation"]["path"] + "#" + pointer
    require(key in observations, f"Unknown retained observation: {key}")
    original = observations[key]
    raw_listing = isinstance(original.value.get("markdown"), str)
    observed = raw_listing_observation(approval, original, inputs) if raw_listing else original.normalized(inputs)
    require(observed["aggregate"] is not None, "Observation has no published aggregate")
    fields(approval["aggregate"], "rating scale count asOf scope sourceFamily", "aggregate")
    require(approval["aggregate"] == observed["aggregate"], "Approval aggregate mismatch")
    for key in ("rating", "scale", "count"):
        value = approval["aggregate"][key]
        require(value is None or (type(value) in (int, float) and math.isfinite(value)),
                f"Malformed aggregate {key}")
    require(text_value(approval["aggregate"]["scope"])
            and text_value(approval["aggregate"]["sourceFamily"]), "Missing scope or source family")
    require(approval["aggregate"]["asOf"] is None or
            valid_date(approval["aggregate"]["asOf"]), "Malformed aggregate snapshot date")
    require(valid_date(approval["checkedAt"]) and approval["checkedAt"] <= ASSESSMENT_DATE,
            "Invalid or future independent check date")
    require(valid_date(observed["checkedAt"]) and
            observed["checkedAt"] <= approval["checkedAt"], "Invalid observation check chronology")
    require(approval["access"] == "full-page" and observed["inspection"] == "full-page",
            "Approval requires a retained full-page observation")
    require(canonical_url(approval["url"]) == canonical_url(observed["url"]),
            "Approval URL mismatch")
    require(approval["platform"] == observed["platform"], "Approval platform mismatch")
    require(text_value(observed["kind"]), "Observation lacks source type")
    access = original.value.get("access_decision") or original.value.get("access")
    if isinstance(access, dict):
        access = access.get("decision")
    if not access:
        access = (original.value.get("access_basis") or {}).get("access_decision")
    if raw_listing:
        policy = inputs.json((REGION / "reviews/source-access.json").as_posix())
        access = next((r["access_decision"] for r in policy["sources"] if r["source"]=="MyLivingChoice"), None)
    require(isinstance(access, str) and access.startswith("permitted"),
            "Observation lacks permitted source access")
    if "mylivingchoice.com/" in canonical_url(approval["url"]):
        require(token(approval["aggregate"]["sourceFamily"]) == "google",
                "MyLivingChoice Google republication must use google family")
    resolution = validate_identity(approval, observed, providers, crosswalk, aliases)
    material = inputs.bound(approval["material"])
    require(approval["material"]["path"] != approval["observation"]["path"],
            "Independent full-page material cannot be the observation registry")
    try:
        page = material.decode("utf-8")
    except UnicodeError as error:
        raise ReleaseError("Independent full-page material must be UTF-8") from error
    page_text = re.sub(r"https?://[^\s\"<>]+", "", page)
    require(approval["url"] in page and
            token(approval["identity"]["name"]) in token(page_text), "Independent page URL/name mismatch")
    for key in ("rating", "count"):
        value = approval["aggregate"][key]
        if value is not None:
            require(re.search(rf"(?<![\d.]){re.escape(str(value))}(?![\d.])", page),
                    f"Independent page missing aggregate {key}")
    if approval["material"]["path"].endswith(".json"):
        retained_check = inputs.json(approval["material"]["path"])
        require(isinstance(retained_check, dict), "Malformed independent check material")
        if "scopeQa" in retained_check:
            require(checked_listing_aggregate(approval, retained_check) == approval["aggregate"],
                    "Independent source family, scope, rating or count mismatch")
        metadata = retained_check.get("metadata") or {}
        material_url = retained_check.get("url") or retained_check.get("effectiveUrl") or metadata.get("url")
        if material_url is not None:
            require(canonical_url(material_url) == canonical_url(approval["url"]),
                    "Independent check material URL mismatch")
        if "inspection" in retained_check:
            require(retained_check["inspection"] == "full-page",
                    "Independent material is not a full-page check")
        if "checkedAt" in retained_check:
            require(retained_check["checkedAt"] == approval["checkedAt"],
                    "Independent material check date mismatch")
        status = retained_check.get("httpStatus", metadata.get("statusCode"))
        if status is not None:
            require(type(status) is int and status == 200,
                    "Independent material HTTP check failed")
    retained = original.value.get("retainedPage")
    retained_hash = original.value.get("retainedSha256")
    if retained and retained_hash:
        inputs.bound({"path": retained, "sha256": retained_hash})
    return observed, resolution


def score(records):
    program = (
        "import {readFileSync} from 'node:fs';"
        "import {computeExperienceScore} from './src/lib/experience-score.ts';"
        "const records=JSON.parse(readFileSync(0,'utf8'));"
        "console.log(JSON.stringify(Object.fromEntries(Object.entries(records).map("
        "([id,r])=>[id,computeExperienceScore({...r,asOfDate:'2026-11-12'})]))));"
    )
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", program],
        input=json.dumps(records), text=True, capture_output=True, cwd=ROOT, timeout=60,
    )
    require(result.returncode == 0, f"TypeScript scorer failed: {result.stderr.strip()}")
    return parse_json(result.stdout)


def build(root=ROOT, approvals_path=None):
    inputs = Inputs(root)
    approvals_path = approvals_path or (RELEASE / "approvals.json").as_posix()
    ledger = inputs.json(approvals_path)
    fields(ledger, "schemaVersion assessmentDate approvals", "approval ledger")
    require(type(ledger["schemaVersion"]) is int and ledger["schemaVersion"] == 1
            and ledger["assessmentDate"] == ASSESSMENT_DATE
            and isinstance(ledger["approvals"], list), "Malformed approval ledger")
    provider_rows = inputs.json((REGION / "runtime/providers.json").as_posix())
    crosswalk = inputs.json((REGION / "runtime/crosswalk.json").as_posix())
    require(isinstance(provider_rows, list) and isinstance(crosswalk, list),
            "Malformed runtime identity files")
    providers = {p["id"]: p for p in provider_rows}
    require(len(providers) == len(provider_rows), "Duplicate runtime provider identity")
    alias_path = (RELEASE / "identity-corroboration.json").as_posix()
    aliases = inputs.json(alias_path) if (root / alias_path).is_file() else []
    observations, inventory = registry(inputs)
    records, audit, approved_keys = {}, [], set()
    seen_ids = set()
    url_owners = {}
    for approval in sorted(ledger["approvals"], key=lambda a: str(a.get("id", "")) if isinstance(a, dict) else ""):
        observed, resolution = validate_approval(approval, inputs, observations, providers, crosswalk, aliases)
        require(approval["id"] not in seen_ids, f"Duplicate approval ID: {approval['id']}")
        seen_ids.add(approval["id"])
        approved_keys.add(observed["key"])
        source_id = "review-release-" + approval["id"]
        provider_id = approval["providerId"]
        page = canonical_url(approval["url"])
        require(page not in url_owners or url_owners[page] == provider_id,
                "One review page cannot approve multiple runtime care units")
        url_owners[page] = provider_id
        record = records.setdefault(provider_id, {
            "providerId": provider_id, "checkedAt": approval["checkedAt"],
            "providerDetailsReviewed": False, "sources": [], "facts": [], "reviews": [],
            "reviewAggregates": [], "availability": {
                "status": "not-published", "sourceId": None, "asOf": None,
                "text": "Current availability has not been independently researched. Contact the provider.",
            }, "notes": [
                "Approved published consumer aggregates only. Consumer sentiment is not clinical quality or safety.",
                "Reported counts are not unique people. Unknown cross-posting may remain.",
                "No provider offerings, prices, individual reviews or availability claims are released by this transformer.",
            ],
        })
        record["checkedAt"] = max(record["checkedAt"], approval["checkedAt"])
        record["sources"].append({
            "id": source_id, "url": approval["url"], "title": f"{approval['platform']} consumer aggregate",
            "publisher": approval["platform"], "kind": observed["kind"],
            "checkedAt": approval["checkedAt"], "publishedAt": None, "access": "full-page",
        })
        aggregate = dict(approval["aggregate"])
        aggregate.update(sourceId=source_id, platform=approval["platform"], notes=[
            approval["reason"],
            "Observed ZIP is missing; exact official care-unit crosswalk supplies identity resolution, not an observed ZIP."
            if resolution["observedZip"] is None else "Observed ZIP matches the exact official care unit.",
        ])
        record["reviewAggregates"].append(aggregate)
        audit.append({"approval": approval, "sourceId": source_id,
                      "identityResolution": resolution, "observationKey": observed["key"]})
    verification = score(records)
    included = {source["sourceId"] for summary in verification.values()
                for source in summary["includedSources"]}
    excluded_reasons = {row["sourceId"]: row["reason"] for summary in verification.values()
                        for row in summary["excludedSources"]}
    exclusions = []
    for entry in audit:
        source_id = entry["sourceId"]
        entry["disposition"] = "included" if source_id in included else "excluded"
        if source_id not in included:
            require(source_id in excluded_reasons, "Scorer omitted an approved source disposition")
            entry["reason"] = excluded_reasons[source_id]
            exclusions.append({"sourceId": source_id, "providerId": entry["approval"]["providerId"],
                               "reason": excluded_reasons[source_id]})
    for provider_id, record in list(records.items()):
        record["sources"] = [s for s in record["sources"] if s["id"] in included]
        record["reviewAggregates"] = [a for a in record["reviewAggregates"] if a["sourceId"] in included]
        if not record["reviewAggregates"]:
            del records[provider_id]
        else:
            record["checkedAt"] = max(s["checkedAt"] for s in record["sources"])
    released_verification = score(records)
    for provider_id, summary in released_verification.items():
        require(summary["includedSources"] == verification[provider_id]["includedSources"]
                and summary["reviewCount"] == verification[provider_id]["reviewCount"]
                and summary["value"] == verification[provider_id]["value"]
                and not summary["excludedSources"], "Released score changed after exclusion")
    normalized = [o.normalized(inputs) for _, o in sorted(observations.items())]
    approved_groups = {
        (a["providerId"], canonical_url(a["url"]), token(a["aggregate"]["sourceFamily"]))
        for a in ledger["approvals"]
    }
    official_providers = {}
    for row in crosswalk:
        if row.get("status") == "included":
            official_providers.setdefault(row.get("officialId"), set()).add(row.get("providerId"))
    staging_groups = {}
    for observed in normalized:
        if observed["key"] in approved_keys:
            continue
        group = None
        resolved_provider = observed["providerId"]
        official_matches = official_providers.get(observed["officialId"], set())
        if not resolved_provider and len(official_matches) == 1:
            resolved_provider = next(iter(official_matches))
        if observed["url"] and observed["aggregate"] and observed["aggregate"]["sourceFamily"]:
            group = (resolved_provider, canonical_url(observed["url"]),
                     token(observed["aggregate"]["sourceFamily"]))
        group_key = group if group else observed["key"]
        entry = staging_groups.setdefault(group_key, {
            "observationKeys": [], "url": observed["url"],
            "providerId": resolved_provider, "officialId": observed["officialId"],
            "status": "pending-unapproved" if observed["aggregate"] else "inventory-only",
            "reason": "Repeated approved URL/family observation; not an additional vote."
            if group in approved_groups else
            "Independent approval required." if observed["aggregate"] else
            "Discovery, access gap, provider facts or source material, not an approved review aggregate.",
        })
        entry["observationKeys"].append(observed["key"])
    staging = list(staging_groups.values())
    withheld_path = (RELEASE / "withheld-checks.json").as_posix()
    if (root / withheld_path).exists():
        for item in inputs.json(withheld_path):
            require(canonical_url(item["url"]) not in url_owners and item["providerId"] is None
                    and item["status"] in ("pending", "excluded") and text_value(item["reason"]),
                    "Withheld source incorrectly attributed")
            staging.append(item)
    outputs = {
        "locationResearch.json": records,
        "approvals-audit.json": {"assessmentDate": ASSESSMENT_DATE, "approvals": audit},
        "exclusions.json": exclusions,
        "staging.json": staging,
        "observation-registry.json": {"schemaVersion": 1, "observations": normalized},
        "experience-verification.json": {
            "assessmentDate": ASSESSMENT_DATE, "approvedInput": verification,
            "releasedOutput": released_verification,
        },
    }
    scorer_path = ROOT / "src/lib/experience-score.ts"
    outputs["manifest.json"] = {
        "schemaVersion": 1, "assessmentDate": ASSESSMENT_DATE,
        "inputs": [{"path": path, "sha256": digest(data), "bytes": len(data)}
                   for path, data in sorted(inputs.bytes.items()) if not path.endswith("/runtime/providers.json")],
        "rosterIdentitySha256": digest(encoded([{k:p[k] for k in ("id","name","address","city","state","zip","category")}
            for p in sorted(providers.values(),key=lambda p:p["id"])])),
        "collectionInventory": inventory,
        "scorer": {"path": "src/lib/experience-score.ts", "sha256": digest(scorer_path.read_bytes())},
        "transformer": {"path": "scripts/regions/release-reviews.py",
                        "sha256": digest(Path(__file__).read_bytes())},
        "outputs": {name: digest(encoded(value)) for name, value in sorted(outputs.items())},
        "counts": {"approved": len(audit), "included": len(included),
                   "excluded": len(exclusions), "providers": len(records),
                   "observations": len(normalized), "pendingOrInventory": len(staging)},
    }
    for path, data in inputs.bytes.items():
        require((inputs.root / path).read_bytes() == data,
                f"Input changed during release: {path}")
    return outputs


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approvals", type=Path, default=ROOT / RELEASE / "approvals.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / RELEASE)
    parser.add_argument("--check", action="store_true", help="Verify outputs without writing")
    args = parser.parse_args(argv)
    try:
        destination = args.output_dir.resolve()
        require(destination.is_relative_to((ROOT / RELEASE).resolve()),
                "Outputs must stay inside review-release")
        approval_path = args.approvals.resolve().relative_to(ROOT).as_posix()
        outputs = build(ROOT, approval_path)
        for name in OUTPUTS:
            path = destination / name
            require(not path.is_symlink(), f"Refusing output symlink: {path}")
            if path.exists():
                require(path.is_file(), f"Output is not a regular file: {path}")
        if args.check:
            require(all((destination / name).is_file() and
                        (destination / name).read_bytes() == encoded(value)
                        for name, value in outputs.items()), "Release outputs are missing or stale")
        else:
            destination.mkdir(parents=True, exist_ok=True)
            for name, value in outputs.items():
                (destination / name).write_bytes(encoded(value))
        print(json.dumps(outputs["manifest.json"]["counts"], sort_keys=True))
        return 0
    except (ReleaseError, ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f"Review release failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
