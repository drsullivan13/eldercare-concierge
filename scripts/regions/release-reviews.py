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
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
REGION = Path("research/north-jersey")
RELEASE = REGION / "review-release"
ADDENDUM = REGION / "listing-index/release"
OUTPUTS = (
    "locationResearch.json", "approvals-audit.json", "exclusions.json",
    "staging.json", "observation-registry.json", "experience-verification.json",
    "manifest.json", "excerpt-audit.json",
)
EXCERPTS = REGION / "review-excerpts/observations.json"
EXCERPT_ALGORITHM = "newest-per-provider-sentiment-v1"
EXCERPT_REASONS = {
    "privacy", "not-consumer", "wrong-care-unit", "no-safe-excerpt",
    "unsupported-sentiment", "duplicate-review",
}
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
        frozen_paths = [frozen_path]
        extra = (ADDENDUM / "source-observations.json").as_posix()
        if (inputs.root / extra).exists():
            frozen_paths.append(extra)
        for relative in frozen_paths:
            data = inputs.read(relative)
            walk(inputs.json(relative), relative)
            inventory.append({"path": relative, "sha256": digest(data), "bytes": len(data)})
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


def validate_approval(approval, inputs, observations, providers, crosswalk, aliases, assessment_date):
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
    require(valid_date(approval["checkedAt"]) and approval["checkedAt"] <= assessment_date,
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


def score(records, assessment_date):
    program = (
        "import {readFileSync} from 'node:fs';"
        "import {computeExperienceScore} from './src/lib/experience-score.ts';"
        "const records=JSON.parse(readFileSync(0,'utf8'));"
        "console.log(JSON.stringify(Object.fromEntries(Object.entries(records).map("
        "([id,r])=>[id,computeExperienceScore({...r,asOfDate:process.argv[1]})]))));"
    )
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", program, assessment_date],
        input=json.dumps(records), text=True, capture_output=True, cwd=ROOT, timeout=60,
    )
    require(result.returncode == 0, f"TypeScript scorer failed: {result.stderr.strip()}")
    return parse_json(result.stdout)


def normalized_whitespace(value):
    return " ".join(value.split())


class PublicReviewHTML(HTMLParser):
    voids = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
             "meta", "param", "source", "track", "wbr"}
    blocks = {"article", "p", "div", "section", "br", "li", "h1", "h2", "h3", "address"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden, self.parts, self.articles = [], [], []
        self.article = None
        self.body_paragraph = False
        self.headings, self.heading_parts = [], None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        hidden = (tag in {"script", "style", "head", "template", "noscript", "svg"}
                  or "hidden" in attrs or attrs.get("aria-hidden") == "true"
                  or re.search(r"display\s*:\s*none|visibility\s*:\s*hidden",
                               attrs.get("style", ""), re.I))
        if hidden or self.hidden:
            if tag not in self.voids:
                self.hidden.append(tag)
            return
        if tag in self.blocks:
            self.parts.append(" ")
        if tag == "h1":
            self.heading_parts = []
        if tag == "article":
            require(self.article is None, "Nested review articles are unsupported")
            self.article = {"id": f"article-{len(self.articles) + 1}", "sourceId": None, "body": [],
                            "metadata": [], "links": [], "dateAttributes": [], "bodyCount": 0}
            self.articles.append(self.article)
        if self.article is None:
            return
        if tag in self.blocks and self.body_paragraph:
            self.article["body"].append(" ")
        if tag == "p":
            self.body_paragraph = (attrs.get("itemprop") == "reviewBody"
                                   or "leading-6" in attrs.get("class", "").split())
            if self.body_paragraph:
                self.article["bodyCount"] += 1
        if tag == "a" and attrs.get("href"):
            link = attrs["href"]
            parsed = urlsplit(link)
            if parsed.hostname in {"google.com", "www.google.com", "maps.google.com"} and parsed.path.startswith("/maps/reviews"):
                self.article["links"].append(link)
            article_id = re.fullmatch(r"/reviews/report/external/(\d+)", parsed.path)
            if article_id:
                require(self.article["sourceId"] is None or self.article["sourceId"] == article_id[1],
                        "Ambiguous source review article ID")
                self.article["sourceId"] = article_id[1]
        if tag == "time" and attrs.get("datetime"):
            self.article["dateAttributes"].append(attrs["datetime"])

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.voids:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.hidden:
            if tag in self.hidden:
                del self.hidden[len(self.hidden) - 1 - self.hidden[::-1].index(tag):]
            return
        if tag in self.blocks:
            self.parts.append(" ")
            if self.article is not None:
                self.article["body" if self.body_paragraph else "metadata"].append(" ")
        if tag == "p":
            self.body_paragraph = False
        if tag == "h1" and self.heading_parts is not None:
            self.headings.append(normalized_whitespace("".join(self.heading_parts)))
            self.heading_parts = None
        if tag == "article":
            self.article = None

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)
            if self.heading_parts is not None:
                self.heading_parts.append(value)
            if self.article is not None:
                self.article["body" if self.body_paragraph else "metadata"].append(value)

    def reviews(self):
        require(self.article is None and not self.hidden, "Incomplete retained review HTML")
        result = {}
        months = {name: number for number, name in enumerate(
            ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}
        for article in self.articles:
            require(article["bodyCount"] == 1, "Unrecognized original review article body")
            require(article["sourceId"] is not None and article["id"] not in result,
                    "Missing or duplicate source review article ID")
            published = set(article["dateAttributes"])
            metadata = normalized_whitespace("".join(article["metadata"]))
            for month, year in re.findall(
                    r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b", metadata):
                published.add(f"{year}-{months[month]:02}")
            require(len(published) <= 1, "Ambiguous original review publication date")
            links = set(article["links"])
            require(len(links) <= 1, "Ambiguous original review permalink")
            result[article["id"]] = {
                "text": normalized_whitespace("".join(article["body"])),
                "sourceReviewId": article["sourceId"],
                "publishedAt": next(iter(published), None), "reviewUrl": next(iter(links), None),
            }
        return result


def published_order(value):
    return date.fromisoformat(value + "-01" if len(value) == 7 else value).toordinal()


def public_release_text(value):
    require(text_value(value), "Missing excerpt or paraphrase")
    require(not re.search(
        r"https?://|[\w.+-]+@[\w.-]+\.\w+|\b\d{3}[-. ]\d{2}[-. ]\d{4}\b|"
        r"(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b|"
        r"\b(?:diagnos\w*|medicat\w*|prescri\w*|surgery|cancer|diabetes|"
        r"alzheimer\w*|dementia|medical record|patient id)\b", value, re.I),
        "Excerpt privacy screening failed")


def markdown_excerpt_articles(markdown, observed_name):
    sections = list(re.finditer(r"^## Reviews of (.+?)\s*$", markdown, re.M))
    matches = [section for section in sections if section[1] == observed_name]
    require(len(matches) == 1, "Missing or ambiguous exact Markdown reviews section")
    start = matches[0].end()
    end = re.search(r"^## ", markdown[start:], re.M)
    section = markdown[start:start + end.start()] if end else markdown[start:]
    images = list(re.finditer(r"^!\[\]\([^\s)]+\)[ \t]*$", section, re.M))
    require(images, "Missing Markdown review headers")
    require(not re.search(r"\[via Google|\[Report\]|/reviews/report/external/", section[:images[0].start()]),
            "Malformed Markdown review block")
    months = {name: number for number, name in enumerate(
        ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}
    result, source_ids, links = {}, set(), set()
    for index, image in enumerate(images):
        stop = images[index + 1].start() if index + 1 < len(images) else len(section)
        block = section[image.end():stop].lstrip("\n")
        header = re.match(
            r"([^\n]+)\n\s*\n([^\n]+)\n\s*\n"
            r"\[via Google(?: ↗)?\]\(([^\s)]+)\)[ \t]*·[ \t]*"
            r"\[Report\]\(([^\s)]+)\)[ \t]*(?:\n|$)", block)
        require(header is not None, "Malformed Markdown review block")
        author, publication, permalink, report = header.groups()
        require(not re.search(r"[\[\]<>!#]", author), "Malformed Markdown reviewer header")
        month = re.fullmatch(r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
                             r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) (\d{4})",
                             publication.strip())
        unknown = re.fullmatch(
            r"(?:(?:\d+|a|an) (?:day|week|month|year)s? ago|Yesterday|Today|Unknown)",
            publication.strip(), re.I)
        require(month is not None or unknown is not None, "Malformed Markdown publication date")
        published = f"{month[2]}-{months[month[1][:3]]:02}" if month else None
        google = urlsplit(permalink)
        native = urlsplit(report)
        source_id = re.fullmatch(r"/reviews/report/external/(\d+)", native.path)
        require(google.scheme == "https" and google.hostname in
                {"google.com", "www.google.com", "maps.google.com"}
                and google.path.startswith("/maps/reviews") and not google.username
                and not google.password and native.scheme == "https"
                and native.hostname in {"www.mylivingchoice.com", "mylivingchoice.com"}
                and not native.username and not native.password and not native.query
                and not native.fragment and source_id is not None,
                "Malformed Markdown original review links")
        require(source_id[1] not in source_ids and permalink not in links,
                "Duplicate Markdown source review identity")
        source_ids.add(source_id[1])
        links.add(permalink)
        body = block[header.end():]
        require(not re.search(r"\[via Google|\[Report\]|/reviews/report/external/|^!\[\]", body, re.M),
                "Malformed Markdown review body boundary")
        result[f"article-{index + 1}"] = {
            "text": normalized_whitespace(body), "sourceReviewId": source_id[1],
            "publishedAt": published, "reviewUrl": permalink,
        }
    return result


def original_excerpt_articles(inputs, page, category):
    raw = inputs.bound(page["retainedPage"])
    require(page["receipt"]["path"] != page["retainedPage"]["path"],
            "Excerpt receipt must be separate from capture")
    inputs.bound(page["receipt"])
    receipt = inputs.json(page["receipt"]["path"])
    require(isinstance(receipt, dict) and receipt.get("url") == page["url"]
            and type(receipt.get("httpStatus")) is int and receipt["httpStatus"] == 200
            and text_value(receipt.get("observedAt"))
            and receipt["observedAt"][:10] == page["checkedAt"]
            and receipt.get("source") == page["source"] and receipt.get("sha256") == digest(raw)
            and type(receipt.get("bytes")) is int and receipt["bytes"] == len(raw)
            and receipt.get("status") != "access_restricted",
        "Excerpt page receipt mismatch")
    try:
        capture = raw.decode("utf-8")
    except UnicodeError as error:
        raise ReleaseError("Excerpt capture must be UTF-8") from error
    if capture.lstrip().startswith("{"):
        fetched = parse_json(capture)
        metadata = fetched.get("metadata")
        require(isinstance(metadata, dict) and isinstance(fetched.get("markdown"), str)
                and type(metadata.get("statusCode")) is int and metadata["statusCode"] == 200
                and metadata.get("error") is None and metadata.get("url") == page["url"]
                and fetched.get("effectiveUrl") == page["url"],
                "Unverified original FetchUrl capture")
        body = fetched["markdown"]
        headings = re.findall(r"^# (.+?)\s*$", body, re.M)
        original_rows = markdown_excerpt_articles(body, page["identity"]["name"])
    else:
        parser = PublicReviewHTML()
        parser.feed(capture)
        parser.close()
        original_rows = parser.reviews()
        body = normalized_whitespace(" ".join(parser.parts))
        headings = parser.headings

    require(any(comparable_name(heading, category) == comparable_name(page["identity"]["name"], category)
                for heading in headings), "Excerpt capture location heading mismatch")
    for key in ("name", "address", "city", "state", "zip", "careUnit"):
        value = page["identity"][key]
        require(value is None or words(value).replace("new jersey", "nj") in
                words(body).replace("new jersey", "nj"),
                "Excerpt capture identity evidence mismatch")
    for item in original_rows.values():
        item["bodySha256"] = digest(item["text"].encode())
    return original_rows


def public_excerpt_articles(inputs, page, ref):
    receipt = parse_json(inputs.bound(ref))
    require(receipt.get("schemaVersion") == 1 and receipt.get("kind") == "privacy-safe-derived-article-receipt",
            "Invalid public excerpt receipt")
    require(all(receipt.get(k) == page[k] for k in ("providerId", "officialId", "source", "sourceFamily",
                "url", "checkedAt", "identity", "population")), "Public excerpt receipt location or population mismatch")
    require(receipt.get("parentHtmlSha256") == page["retainedPage"]["sha256"]
            and receipt.get("parentCacheReceiptSha256") == page["receipt"]["sha256"], "Public excerpt parent mismatch")
    decisions = {row["articleId"]: row for row in page["rows"]}
    original_rows = {}
    for row in receipt["rows"]:
        aid = row["articleId"]
        require(aid in decisions and aid not in original_rows, "Invalid public excerpt article membership")
        decision = decisions[aid]
        native_id = row["externalReviewId"]
        require(isinstance(native_id, str) and native_id and decision["id"] == "mlc-external-" + native_id,
                "Public receipt source-native review identity mismatch")
        require(re.fullmatch(r"[0-9a-f]{64}", row["originalBodySha256"]) and
                row["originalExcerpt"] == decision["originalExcerpt"] and row["exclusionReasons"] == decision["exclusionReasons"],
                "Public excerpt fragment or exclusion mismatch")
        require(row["originalReviewUrl"] == decision["reviewUrl"] and row["publishedAt"] == decision["publishedAt"],
                "Public excerpt permalink or publication precision mismatch")
        original_rows[aid] = {"sourceReviewId": native_id, "text": row["originalExcerpt"] or "",
                              "bodySha256": row["originalBodySha256"], "reviewUrl": row["originalReviewUrl"],
                              "publishedAt": row["publishedAt"]}
    require(len(original_rows) == len(decisions) == page["population"]["retainedRowCount"],
            "Public excerpt receipt article count mismatch")
    return original_rows


def excerpt_release(inputs, providers, crosswalk, aliases, records, assessment_date, audit_private=False):
    relative = EXCERPTS.as_posix()
    if not (inputs.root / relative).exists():
        return None
    document = inputs.json(relative)
    fields(document, "schemaVersion assessmentDate pages", "excerpt input")
    require(type(document["schemaVersion"]) is int and document["schemaVersion"] == 1
            and valid_date(document["assessmentDate"])
            and assessment_date <= document["assessmentDate"] <= date.today().isoformat()
            and isinstance(document["pages"], list), "Malformed excerpt input")
    policy = inputs.json((REGION / "reviews/source-access.json").as_posix())
    require(isinstance(policy, dict) and isinstance(policy.get("sources"), list),
            "Malformed excerpt source policy")
    public_index = (EXCERPTS.parent / "source-checks-manifest.json").as_posix()
    receipt_refs = None
    if (inputs.root / public_index).is_file():
        index = inputs.json(public_index)
        require(index["schemaVersion"] == 1 and index["observationsSha256"] == digest(inputs.read(relative))
                and set(index["pages"]) == {page["id"] for page in document["pages"]},
                "Public excerpt receipt manifest mismatch")
        receipt_refs = index["pages"]
    else:
        require(not any(p["retainedPage"]["path"].startswith((REGION / "listing-index/raw").as_posix() + "/")
                        for p in document["pages"]), "Missing published excerpt receipt manifest")
    population, candidates, audit, seen_pages, seen_rows = [], [], [], set(), set()
    owners, duplicate_bodies, duplicate_links = {}, {}, {}
    for page in sorted(document["pages"], key=lambda p: str(p.get("id", "")) if isinstance(p, dict) else ""):
        fields(page, "id providerId officialId source sourceFamily url checkedAt identity "
               "retainedPage receipt population rows", "excerpt page")
        require(text_value(page["id"]) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", page["id"])
                and page["id"] not in seen_pages, "Malformed or duplicate excerpt page ID")
        seen_pages.add(page["id"])
        permitted = [p for p in policy["sources"] if p.get("source") == page["source"]]
        require(len(permitted) == 1
                and str(permitted[0].get("access_decision", "")).startswith("permitted")
                and permitted[0].get("retain_as_eligible") is not False, "Forbidden excerpt source")
        access = permitted[0]
        host = access.get("host") or urlsplit(access.get("terms_url", "")).hostname
        page_url = canonical_url(page["url"])
        require(host and page_url.split("/")[0] == re.sub(r"^www\.", "", host.lower()),
                "Excerpt source host mismatch")
        family = "google" if page["source"] == "MyLivingChoice" else access.get("review_source_family")
        require(text_value(family) and page["sourceFamily"] == family,
                "Excerpt source family is not established")
        require(valid_date(page["checkedAt"]) and page["checkedAt"] <= document["assessmentDate"],
                "Invalid excerpt check date")
        observed = {"providerId": page["providerId"], "officialId": page["officialId"],
                    "identity": page["identity"]}
        validate_identity(page, observed, providers, crosswalk, aliases)
        require(page_url not in owners or owners[page_url] == page["providerId"],
                "Excerpt page assigned to multiple care units")
        owners[page_url] = page["providerId"]
        category = providers[page["providerId"]]["category"]
        if receipt_refs is None:
            original_rows = original_excerpt_articles(inputs, page, category)
        else:
            original_rows = public_excerpt_articles(inputs, page, receipt_refs[page["id"]])
            if audit_private:
                # Private evidence is independently checked and never enters the public dependency manifest.
                private = original_excerpt_articles(Inputs(inputs.root), page, category)
                require(private.keys() == original_rows.keys(), "Public and private article sets differ")
                for aid, public in original_rows.items():
                    original = private[aid]
                    require(all(public[k] == original[k] for k in ("sourceReviewId", "bodySha256", "reviewUrl", "publishedAt"))
                            and normalized_whitespace(public["text"]) in original["text"],
                            "Public receipt differs from private source article")
        fields(page["population"], "scope complete retainedRowCount", "excerpt population")
        require(isinstance(page["rows"], list)
                and page["population"]["scope"] == "all-review-rows-in-retained-page"
                and page["population"]["complete"] is True
                and type(page["population"]["retainedRowCount"]) is int
                and page["population"]["retainedRowCount"] == len(page["rows"]),
                "Incomplete excerpt candidate population")
        require(len(page["rows"]) == len(original_rows)
                and all(isinstance(r, dict) and isinstance(r.get("articleId"), str) for r in page["rows"])
                and {r["articleId"] for r in page["rows"]} == set(original_rows),
                "Excerpt population does not match every retained article")
        population.append({**page, "rows": sorted(page["rows"], key=lambda r: str(r.get("id", "")) if isinstance(r, dict) else "")})
        sample_observations = []
        for row in population[-1]["rows"]:
            fields(row, "id articleId reviewUrl publishedAt role sentiment experienceStage "
                   "originalExcerpt paraphrase exclusionReasons privacyRelease", "excerpt candidate")
            require(text_value(row["id"]) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", row["id"])
                    and row["id"] not in seen_rows, "Malformed or duplicate excerpt row ID")
            seen_rows.add(row["id"])
            original = original_rows[row["articleId"]]
            require(row["reviewUrl"] == original["reviewUrl"],
                    "Review permalink differs from original article")
            if row["reviewUrl"] is not None:
                canonical_url(row["reviewUrl"])
            require(row["publishedAt"] is None or (
                isinstance(row["publishedAt"], str)
                and (valid_date(row["publishedAt"]) or
                     (re.fullmatch(r"\d{4}-\d{2}", row["publishedAt"])
                      and valid_date(row["publishedAt"] + "-01")))
                and published_order(row["publishedAt"]) <= date.fromisoformat(page["checkedAt"]).toordinal()),
                "Invalid review published date")
            require(row["publishedAt"] == original["publishedAt"],
                    "Review publication precision differs from original article")
            require(row["role"] in ("family", "resident", "staff", "visitor", "unknown")
                    and row["sentiment"] in ("positive", "critical", "mixed", "unknown")
                    and row["experienceStage"] in ("tour", "move-in", "current-resident",
                                                   "former-resident", "discharge", "unknown"),
                    "Unsupported excerpt role, sentiment or experience stage")
            reasons = row["exclusionReasons"]
            require(isinstance(reasons, list) and all(isinstance(r, str) and r in EXCERPT_REASONS for r in reasons)
                    and len(reasons) == len(set(reasons)), "Malformed excerpt exclusion reasons")
            require(original["bodySha256"] != digest(b"") or "no-safe-excerpt" in reasons,
                    "Empty original body requires no-safe-excerpt exclusion")
            privacy = row["privacyRelease"]
            fields(privacy, "reviewed containsNames containsMedicalInformation containsIdentifiers publicConsumerReview",
                   "excerpt privacy attestation")
            require(all(type(v) is bool for v in privacy.values()), "Malformed excerpt privacy attestation")
            safe = privacy == dict(reviewed=True, containsNames=False,
                                   containsMedicalInformation=False, containsIdentifiers=False,
                                   publicConsumerReview=True)
            require(safe or bool(reasons), "Missing privacy release attestation")
            require(row["sentiment"] != "unknown" or bool(reasons),
                    "Unknown sentiment requires exclusion")
            require(row["role"] != "staff" or "not-consumer" in reasons, "Staff review requires exclusion")
            quote = row["originalExcerpt"]
            if quote is not None:
                require(text_value(quote), "Malformed original excerpt")
                quote = normalized_whitespace(quote)
                require(quote in original["text"], "Original excerpt is not a quoted substring")
                require(len(quote) <= 240 and len(quote.split()) <= 40, "Original excerpt exceeds cap")
            require(bool(reasons) or (quote is not None and text_value(row["paraphrase"])),
                    "Eligible row needs separate original excerpt and paraphrase")
            require(not reasons or (row["originalExcerpt"] is None and row["paraphrase"] is None),
                    "Excluded rows must not retain private narrative text")
            if not reasons:
                public_release_text(quote)
                public_release_text(row["paraphrase"])
                body_key = (page["providerId"], original["bodySha256"])
                link_key = row["reviewUrl"]
                require(body_key not in duplicate_bodies, "Duplicate eligible review body")
                require(not link_key or link_key not in duplicate_links, "Duplicate eligible review permalink")
                duplicate_bodies[body_key] = row["id"]
                if link_key:
                    duplicate_links[link_key] = row["id"]
            entry = {
                "rowId": row["id"], "articleId": row["articleId"],
                "sourceReviewId": original["sourceReviewId"],
                "pageId": page["id"], "providerId": page["providerId"],
                "officialId": page["officialId"], "identity": page["identity"],
                "source": page["source"], "sourceFamily": family, "sourceUrl": page["url"],
                "reviewUrl": row["reviewUrl"], "publishedAt": row["publishedAt"],
                "checkedAt": page["checkedAt"], "role": row["role"], "sentiment": row["sentiment"],
                "experienceStage": row["experienceStage"], "retainedPage": page["retainedPage"],
                "receipt": page["receipt"], "privacyRelease": privacy,
                "disposition": "excluded" if reasons else "eligible", "reasons": sorted(reasons),
                "scoreEligible": False,
            }
            # Eligibility to expose sentiment metadata is distinct from permission to quote a passage.
            if (privacy["reviewed"] and privacy["publicConsumerReview"] and row["role"] != "staff"
                    and row["sentiment"] in {"positive", "critical", "mixed"}
                    and not (set(reasons) - {"privacy", "no-safe-excerpt"})):
                sample_observations.append({
                    "id": row["id"], "date": row["publishedAt"],
                    "sentiment": "negative" if row["sentiment"] == "critical" else row["sentiment"],
                })
            audit.append(entry)
            if not reasons:
                candidates.append((page, row, quote, entry))
        record = records.get(page["providerId"])
        if record is not None:
            urls = {s["id"]: canonical_url(s["url"]) for s in record["sources"]}
            matches = [a["sourceId"] for a in record["reviewAggregates"]
                       if a["sourceFamily"] == family and urls[a["sourceId"]] == page_url]
            require(len(matches) <= 1, "Visible sample has ambiguous aggregate source")
            if matches:
                record.setdefault("reviewSamples", []).append({
                    "sourceId": matches[0], "sourceFamily": family, "selection": "all-visible-before-highlighting",
                    "visibleCount": len(original_rows), "observations": sample_observations,
                })
    population_digest = digest(encoded(population))
    ranks = {}
    for page, row, quote, entry in sorted(candidates, key=lambda c: (
            c[0]["providerId"], c[1]["sentiment"],
            -published_order(c[1]["publishedAt"]) if c[1]["publishedAt"] else 0,
            c[1]["id"])):
        group = (page["providerId"], row["sentiment"])
        ranks[group] = ranks.get(group, 0) + 1
        entry["selection"] = {"algorithm": EXCERPT_ALGORITHM, "populationSha256": population_digest,
                              "rowId": row["id"], "stratum": row["sentiment"], "rank": ranks[group]}
        if ranks[group] > 1:
            entry.update(disposition="not-selected", reasons=["older-in-stratum"])
            continue
        entry["disposition"] = "published"
        pid = page["providerId"]
        record = records.setdefault(pid, {
            "providerId": pid, "checkedAt": page["checkedAt"], "providerDetailsReviewed": False,
            "sources": [], "facts": [], "reviews": [], "reviewAggregates": [],
            "availability": {"status": "not-published", "sourceId": None, "asOf": None,
                             "text": "Current availability has not been independently researched. Contact the provider."},
            "notes": ["Selected original public consumer excerpts are qualitative, not clinical evidence or a prevalence sample."],
        })
        source_id = "review-excerpt-" + page["id"]
        if not any(source["id"] == source_id for source in record["sources"]):
            record["sources"].append({
                "id": source_id, "url": page["url"], "title": page["source"] + " public consumer reviews",
                "publisher": "Google via MyLivingChoice" if page["source"] == "MyLivingChoice" and page["sourceFamily"] == "google" else page["source"],
                "kind": "review-platform", "checkedAt": page["checkedAt"],
                "publishedAt": None, "access": "full-page",
            })
        record["checkedAt"] = max(record["checkedAt"], page["checkedAt"])
        record["notes"] = [n for n in record["notes"] if
                           n != "No provider offerings, prices, individual reviews or availability claims are released by this transformer."]
        record["reviews"].append({
            "id": "review-excerpt-" + row["id"], "sourceId": source_id,
            "url": row["reviewUrl"] or page["url"],
            "date": row["publishedAt"],
            "rating": None, "scale": None, "relationship": row["role"], "excerpt": quote,
            "summary": row["paraphrase"], "aspects": [{
                "aspect": "consumer experience", "sentiment": "negative" if row["sentiment"] == "critical" else row["sentiment"],
            }],
            "notes": [
                "Original public consumer quotation. Summary is a separate editorial paraphrase. Not scored.",
                "Selected from the complete retained visible population, not a representative sample.",
                f"Source family is {page['sourceFamily']}. {page['source']} is the carrier, not an additional independent source.",
                ("Published " + ("month " if len(row["publishedAt"]) == 7 else "date ")
                 + row["publishedAt"] + ".") if row["publishedAt"] else "Publication date is unknown.",
                "Supported experience stage is " + row["experienceStage"].replace("-", " ") + ".",
            ],
        })
    return {"schemaVersion": 1, "assessmentDate": document["assessmentDate"],
            "algorithm": EXCERPT_ALGORITHM, "populationSha256": population_digest,
            "populationScope": "all-review-rows-in-retained-pages", "scoreEligible": False,
            "rows": sorted(audit, key=lambda r: r["rowId"])}


def build(root=ROOT, approvals_path=None, audit_private=False):
    inputs = Inputs(root)
    scorer_path = ROOT / "src/lib/experience-score.ts"
    scorer_bytes = scorer_path.read_bytes()
    approvals_path = approvals_path or (RELEASE / "approvals.json").as_posix()
    ledger = inputs.json(approvals_path)
    fields(ledger, "schemaVersion assessmentDate approvals", "approval ledger")
    require(type(ledger["schemaVersion"]) is int and ledger["schemaVersion"] == 1
            and valid_date(ledger["assessmentDate"])
            and isinstance(ledger["approvals"], list), "Malformed approval ledger")
    assessment_date = ledger["assessmentDate"]
    extra_ledger = ADDENDUM / "approvals.json"
    extra_rows = ADDENDUM / "source-observations.json"
    require((root / extra_ledger).exists() == (root / extra_rows).exists(),
            "Incomplete listing review addendum")
    if (root / extra_ledger).exists():
        extra = inputs.json(str(extra_ledger))
        fields(extra, "schemaVersion assessmentDate approvals", "listing review addendum")
        require(extra["schemaVersion"] == ledger["schemaVersion"] and
                extra["assessmentDate"] == assessment_date and isinstance(extra["approvals"], list)
                and all(a["observation"]["path"] == str(extra_rows) for a in extra["approvals"]),
                "Invalid listing addendum date or evidence path")
        ledger = {**ledger, "approvals": ledger["approvals"] + extra["approvals"]}
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
        observed, resolution = validate_approval(approval, inputs, observations, providers, crosswalk, aliases, assessment_date)
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
    verification = score(records, assessment_date)
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
    released_verification = score(records, assessment_date)
    for provider_id, summary in released_verification.items():
        require(summary["includedSources"] == verification[provider_id]["includedSources"]
                and summary["reviewCount"] == verification[provider_id]["reviewCount"]
                and summary["value"] == verification[provider_id]["value"]
                and not summary["excludedSources"], "Released score changed after exclusion")
    excerpt_audit = excerpt_release(inputs, providers, crosswalk, aliases, records, assessment_date, audit_private)
    if excerpt_audit is not None:
        with_excerpts = score(records, assessment_date)
        numeric_fields = ("reviewCount", "independentSourceCount", "platformCount", "includedSources")
        require(all(all(with_excerpts[pid][key] == summary[key] for key in numeric_fields)
                    for pid, summary in released_verification.items()),
                "Visible observations or excerpts changed aggregate votes")
        require(all(with_excerpts[pid]["value"] == summary["value"] or
                    (with_excerpts[pid]["value"] is None and any(s["conflicts"] for s in
                     with_excerpts[pid].get("sampleDiagnostics", [])))
                    for pid, summary in released_verification.items()), "Unexplained change in released score")
        require(all(summary["value"] is None and summary["reviewCount"] == 0
                    and summary["independentSourceCount"] == 0
                    for pid, summary in with_excerpts.items() if pid not in released_verification),
                "Original-only provider was scored")
        released_verification = with_excerpts
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
        "approvals-audit.json": {"assessmentDate": assessment_date, "approvals": audit},
        "exclusions.json": exclusions,
        "staging.json": staging,
        "observation-registry.json": {"schemaVersion": 1, "observations": normalized},
        "experience-verification.json": {
            "assessmentDate": assessment_date, "approvedInput": verification,
            "releasedOutput": released_verification,
        },
    }
    outputs["excerpt-audit.json"] = excerpt_audit or {
        "schemaVersion": 1, "assessmentDate": assessment_date, "algorithm": EXCERPT_ALGORITHM,
        "populationSha256": digest(encoded([])), "populationScope": "all-review-rows-in-retained-pages",
        "scoreEligible": False, "rows": [],
    }
    require(scorer_path.read_bytes() == scorer_bytes, "Scorer changed during release; rerun")
    outputs["manifest.json"] = {
        "schemaVersion": 1, "assessmentDate": assessment_date,
        "inputs": [{"path": path, "sha256": digest(data), "bytes": len(data)}
                   for path, data in sorted(inputs.bytes.items()) if not path.endswith("/runtime/providers.json")],
        "rosterIdentitySha256": digest(encoded([{k:p[k] for k in ("id","name","address","city","state","zip","category")}
            for p in sorted(providers.values(),key=lambda p:p["id"])])),
        "collectionInventory": inventory,
        "scorer": {"path": "src/lib/experience-score.ts", "sha256": digest(scorer_bytes)},
        "transformer": {"path": "scripts/regions/release-reviews.py",
                        "sha256": digest(Path(__file__).read_bytes())},
        "outputs": {name: digest(encoded(value)) for name, value in sorted(outputs.items())},
        "counts": {"approved": len(audit), "included": len(included),
                   "excluded": len(exclusions), "providers": len(records),
                   "observations": len(normalized), "pendingOrInventory": len(staging),
                   "excerptCandidates": len(outputs["excerpt-audit.json"]["rows"]),
                   "publishedExcerpts": sum(r["disposition"] == "published"
                                            for r in outputs["excerpt-audit.json"]["rows"])},
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
    parser.add_argument("--audit-private-captures", action="store_true", help="Also compare public excerpt receipts with every original private capture")
    args = parser.parse_args(argv)
    try:
        destination = args.output_dir.resolve()
        require(destination.is_relative_to((ROOT / RELEASE).resolve()),
                "Outputs must stay inside review-release")
        approval_path = args.approvals.resolve().relative_to(ROOT).as_posix()
        outputs = build(ROOT, approval_path, audit_private=args.audit_private_captures)
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
