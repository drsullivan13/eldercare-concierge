#!/usr/bin/env python3
"""Validate reviewed normalized market artifacts and atomically build runtime JSON."""

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
REGISTRATIONS = ROOT / "src/data/market-registrations.json"
DEFAULT_OUTPUT = ROOT / "src/data/regional-markets.json"
CATEGORIES = {
    "nursing-home", "assisted-living", "home-care", "home-health", "staffing", "life-plan"
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, path):
    require(isinstance(value, str) and bool(value.strip()), f"{path}: expected nonempty string")


def string(value, path):
    require(isinstance(value, str), f"{path}: expected string")


def number(value, path):
    require(type(value) in (int, float) and math.isfinite(value), f"{path}: expected finite number")


def count(value, path):
    require(type(value) is int and value >= 0, f"{path}: expected nonnegative integer")


def boolean(value, path):
    require(type(value) is bool, f"{path}: expected boolean")


def iso_date(value, path):
    text(value, path)
    require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), f"{path}: expected ISO date YYYY-MM-DD")
    try:
        calendar_date = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{path}: invalid calendar date {value}") from exc
    require(calendar_date <= date.today(), f"{path}: future source date")


def publication_date(value, path):
    # Month-only metadata remains a month in the published artifact.
    iso_date(value + "-01" if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}", value) else value, path)


def url(value, path):
    text(value, path)
    parsed = urlparse(value)
    require(parsed.scheme in ("https", "http") and parsed.netloc, f"{path}: expected HTTP URL")


def pattern(regex):
    def validate(value, path):
        text(value, path)
        require(re.fullmatch(regex, value), f"{path}: invalid identifier")
    return validate


def choice(*values):
    def validate(value, path):
        require(any(type(value) is type(item) and value == item for item in values), f"{path}: expected one of {values}")
    return validate


def nullable(validator):
    return lambda value, path: None if value is None else validator(value, path)


def array(validator):
    def validate(value, path):
        require(isinstance(value, list), f"{path}: expected array")
        for index, item in enumerate(value):
            validator(item, f"{path}[{index}]")
    return validate


def mapping(validator):
    def validate(value, path):
        require(isinstance(value, dict), f"{path}: expected object")
        for key, item in value.items():
            text(key, path)
            validator(item, f"{path}.{key}")
    return validate


def shape(fields, extra=False):
    def validate(value, path):
        require(isinstance(value, dict), f"{path}: expected object")
        allowed = {key.removesuffix("?") for key in fields}
        require(extra or set(value) <= allowed, f"{path}: unknown fields {sorted(set(value) - allowed)}")
        for key, validator in fields.items():
            name = key.removesuffix("?")
            if name not in value:
                require(key.endswith("?"), f"{path}.{name}: required field")
            else:
                validator(value[name], f"{path}.{name}")
    return validate


ID = pattern(r"[a-z0-9]+(?:-[a-z0-9]+)*")
CCN = pattern(r"\d{6}")
ZIP = pattern(r"\d{5}")
STRINGS = array(string)
N = nullable(number)
D = nullable(iso_date)
S = nullable(string)
B = nullable(boolean)
CATEGORY = choice(*sorted(CATEGORIES))
PROVIDER_SOURCE = shape({
    "title": text, "publisher": text, "url": url,
    "kind": choice("regulatory", "inspection", "staffing", "provider", "directory", "experience"),
    "checkedAt": iso_date, "dataAsOf?": iso_date, "supports": text,
})
CMS = shape({
    "ccn": CCN, "overall": N, "inspections": N, "staffing": N, "quality": N,
    "totalNurseHours": N, "rnHours": N, "turnover": N, "fines": N,
    "fineAmount": N, "paymentDenials": N, "healthDeficiencies": N,
    "lastInspection?": iso_date, "abuse": boolean, "specialFocus": S, "dataAsOf": iso_date,
})
PROVIDER = shape({
    "id": ID, "name": text, "category": CATEGORY, "searchCategories?": array(CATEGORY),
    "address": text, "city": text, "state": pattern(r"[A-Z]{2}"), "zip": ZIP,
    "lat": N, "lng": N, "locationKind": choice("facility", "office", "zip"),
    "phone?": string, "website?": url, "description": string, "services": STRINGS,
    "serviceArea?": string, "capacity?": count, "ownership?": string,
    "officialRecord": boolean, "cms?": CMS, "sources": array(PROVIDER_SOURCE),
    "warnings": STRINGS, "limitations": STRINGS,
})
RESEARCH_SOURCE = shape({
    "id": text, "url": url, "title": text, "publisher": text,
    "kind": choice("provider", "regulator", "review-platform", "public-discussion"),
    "checkedAt": iso_date, "publishedAt": D,
    "access": choice("full-page", "search-result", "pdf"), "excerpt?": string,
})
AMOUNT = shape({
    "min": number, "max": N, "currency": choice("USD"),
    "period": choice("month", "day", "hour", "one-time"),
    "type": choice("base-rent", "care-fee", "entrance-fee", "other"), "asOf": D,
})
FACT = shape({
    "id": text, "kind": choice("care", "amenity", "activity", "dining", "room", "cost", "availability", "capacity"),
    "text": text, "sourceId": text, "numericValue?": N, "unit?": string,
    "asOf?": D, "amount?": nullable(AMOUNT),
})
AVAILABILITY = shape({
    "status": choice("opening-published", "waitlist-published", "inquiry-only", "not-published"),
    "text": string, "sourceId": S, "asOf": D,
})
AGGREGATE = shape({
    "sourceId": text, "platform": text, "sourceFamily": text, "rating": N, "scale": N,
    "count": nullable(count), "asOf": D, "scope": text, "notes": STRINGS,
})
REVIEW = shape({
    "id": text, "sourceId": text, "url": url, "date": nullable(publication_date), "rating": N, "scale": N,
    "relationship": choice("family", "resident", "staff", "visitor", "unknown"),
    "excerpt": text, "summary": text,
    "aspects": array(shape({"aspect": text, "sentiment": choice("positive", "negative", "mixed")})),
    "notes": STRINGS,
})
LOCATION = shape({
    "providerId": ID, "checkedAt": D, "providerDetailsReviewed": boolean,
    "sources": array(RESEARCH_SOURCE), "facts": array(FACT), "availability": AVAILABILITY,
    "reviewAggregates": array(AGGREGATE), "reviews": array(REVIEW), "notes": STRINGS,
    "admissionRestriction?": shape({"text": text, "sourceId": text}),
    "reviewSamples?": array(shape({
        "sourceId": text, "sourceFamily": text, "selection": choice("all-visible-before-highlighting"),
        "visibleCount": count, "observations": array(shape({
            "id": text, "date": nullable(publication_date), "sentiment": choice("positive", "negative", "mixed", "neutral"),
        })),
    })),
    "reviewLinks?": array(shape({"publisher": text, "url": url})),
})
FINDING = shape({
    "id": text, "sourceObservationIds": array(text),
    "kind": choice("resident-family", "recommendation", "tour", "provider-promotion", "employment"),
    "relationship": S, "summary": text, "date": D, "sourceUrl": url,
    "excerpt?": text, "sourceUrls?": array(url), "threadUrl": url, "topics": STRINGS, "limitations": STRINGS,
})
FACEBOOK = shape({
    "schemaVersion": choice(1), "runId": text, "checkedAt": iso_date, "reviewBasis": text,
    "locations": mapping(shape({
        "status": choice("findings-available", "no-relevant-result", "withheld", "partial"),
        "searchedAt": D, "foundCount": count, "publishedObservationCount": count,
        "withheldCount": count, "coverageExplanation": text, "findings": array(FINDING),
    })),
})
CITATION = shape({
    "id": text, "surveyDate": D, "tag": text, "category": text, "description": text,
    "scopeSeverityCode": nullable(choice(*"ABCDEFGHIJKL")), "scopeSeverityLabel?": S,
    "standard": B, "complaint": B, "infectionControl": B, "correctionStatus": S,
    "correctionDate": D, "inspectionCycle": S, "underIDR": B, "underIIDR": B,
    "surveyFootnote": S, "processingDate": D,
})
PENALTY = shape({
    "id": text, "date": D, "type": choice("Fine", "Payment Denial"),
    "fineId": S, "fineAmount": N, "paymentDenialStartDate": D,
    "paymentDenialLengthDays": nullable(count), "processingDate": D,
})
INSPECTION = shape({
    "version?": choice(1), "retrieved": iso_date, "maxRecordsPerCollection?": count,
    "sourceFileSha256?": pattern(r"[a-f0-9]{64}"), "dictionaryUrl": url,
    "sources": array(shape({
        "datasetId": text, "title": text, "url": url, "downloadUrl": url,
        "modified": D, "released": D,
    })),
    "facilities": mapping(shape({
        "healthCitations": nullable(shape({"total": count, "records": array(CITATION)})),
        "penalties": nullable(shape({
            "total": count, "fineCount": count, "paymentDenialCount": count,
            "records": array(PENALTY),
        })),
    })),
})
METRIC = shape({
    "value": N, "unit": text, "sourceColumn": text, "rawValue": S,
    "footnoteCodes": STRINGS, "rawFootnote": string,
    "status": choice("published", "not published"),
})
PERIOD = shape({"start": iso_date, "end": iso_date, "label": text})
HH_SOURCE = shape({
    "url": url, "publisher": text, "checkedAt": iso_date, "releasedAt": iso_date,
    "datasetId?": text, "title?": text, "downloadUrl?": url, "modified?": D,
})
SURVEY = shape({"id": text, "label": text, "percent": METRIC, "starRating?": nullable(METRIC)})
COMPONENT = shape({
    "id": text, "label": text, "rate": METRIC, "period": PERIOD,
    "betterDirection": choice("higher", "lower"), "dateSourceMeasureName": text,
    "dateSourceRawRange": text, "publishedNumerator?": METRIC,
    "publishedDenominator?": METRIC, "calculationNote?": string,
    "observedRate?": METRIC, "riskStandardizedLowerLimit?": METRIC,
    "riskStandardizedUpperLimit?": METRIC, "cmsPerformanceCategorization?": string,
})
COMPARATOR = shape({
    "period": PERIOD, "releasedAt": iso_date, "measures": array(SURVEY),
    "completedSurveys": METRIC, "responseRate": METRIC, "sourceFile": text,
})


def comparators(value, path):
    require(isinstance(value, dict), f"{path}: expected object")
    for key, item in value.items():
        if key == "state":
            shape({
                "code": pattern(r"[A-Z]{2}"), "label": text,
                "period": PERIOD, "releasedAt": iso_date, "measures": array(SURVEY),
                "completedSurveys": METRIC, "responseRate": METRIC, "sourceFile": text,
            })(item, f"{path}.{key}")
        else:
            COMPARATOR(item, f"{path}.{key}")


HOME_HEALTH = shape({
    "schemaVersion": choice(1), "retrieved": iso_date, "releasedAt": iso_date,
    "sources": array(HH_SOURCE),
    "agencies": array(shape({
        "ccn": CCN, "organizationId": ID, "organizationName": text, "cmsProviderName": text,
        "cmsAddress": shape({"street": text, "city": text, "state": text, "zip": ZIP}),
        "scope": text, "releasedAt": iso_date, "checkedAt": iso_date,
        "qualityOfPatientCare": shape({
            "starRating": METRIC, "starComponentPeriod": PERIOD, "components": array(COMPONENT),
            "datasetId": text, "measurementPeriodNote": text, "measureDateRangesFile": text,
            "rawUnitRowFile": text, "componentDefinitionSource?": text, "componentPeriodSource?": text,
        }),
        "patientExperience": shape({
            "datasetId": text, "period": PERIOD, "summaryStarRating": METRIC,
            "completedSurveys": METRIC, "responseRate": METRIC,
            "generalFootnoteCodes": STRINGS, "rawGeneralFootnote": string,
            "measures": array(SURVEY), "rawUnitRowFile": text,
        }),
        "sources": array(HH_SOURCE), "warnings": STRINGS,
    })),
    "clinicalMeasureDateRanges": array(shape({"measure": text, "rawPeriod": text})),
    "surveyMeasureDateRanges": array(shape({"measure": text, "rawPeriod": text})),
    "patientExperienceComparators": comparators,
    "footnoteDefinitions": mapping(string), "interpretationRules": STRINGS,
})
ARTIFACTS = {
    "zips": mapping(shape({"city": text, "lat": number, "lng": number})),
    "meta": shape({"asOf": iso_date, "catalogTotal": count, "categories": mapping(count)}, extra=True),
    "providers": array(PROVIDER),
    "locationResearch": mapping(LOCATION), "facebookResearch": FACEBOOK,
    "inspectionHistory": INSPECTION, "homeHealthEvidence": HOME_HEALTH,
}
REFERENCE = shape({"path": text, "sha256": pattern(r"[a-f0-9]{64}"), "count": count})
ENTRY = shape({
    "id": ID, "label": text, "state": pattern(r"[A-Z]{2}"), "defaultZip": ZIP,
    "review": shape({"status": choice("reviewed"), "reviewedAt": iso_date, "reviewer": text}),
    "artifacts": shape({key + ("" if key in ("zips", "meta", "providers") else "?"): REFERENCE for key in ARTIFACTS}),
})
MANIFEST = shape({"schemaVersion": choice(1), "markets": array(ENTRY)})


def unique(values, path):
    require(len(values) == len(set(values)), f"{path}: duplicate IDs")
    return set(values)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def decode(data):
    return json.loads(data, object_pairs_hook=pairs, parse_constant=reject_constant)


def reject_constant(value):
    raise ValueError(f"Non-JSON number: {value}")


def point(lat, lng, path):
    require((lat is None) == (lng is None), f"{path}: coordinates must both be null or present")
    if lat is not None:
        require(-90 <= lat <= 90 and -180 <= lng <= 180, f"{path}: coordinates out of range")


def dates(value, ceiling, path, publication_months=False):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {
                "asOf", "checkedAt", "dataAsOf", "publishedAt", "searchedAt", "retrieved",
                "released", "releasedAt", "modified", "date", "surveyDate", "processingDate",
                "lastInspection", "correctionDate", "paymentDenialStartDate",
            } and item is not None:
                validator = publication_date if key == "date" and publication_months else iso_date
                validator(item, f"{path}.{key}")
                require(item <= ceiling, f"{path}.{key}: source date after snapshot asOf")
            else:
                dates(item, ceiling, f"{path}.{key}", publication_months or key in {"reviews", "reviewSamples"})
    elif isinstance(value, list):
        for index, item in enumerate(value):
            dates(item, ceiling, f"{path}[{index}]", publication_months)


def validate_market(market, review, prefixes):
    region = market["id"]
    providers, zips = market["providers"], market["zips"]
    require(providers and zips, f"{region}: reviewed market must contain providers and ZIPs")
    require(market["defaultZip"] in zips, f"{region}: defaultZip is outside market ZIPs")
    require(market["meta"]["asOf"] <= review["reviewedAt"], f"{region}: review predates snapshot")
    for code, location in zips.items():
        ZIP(code, f"{region}.zips")
        require(market["state"] in prefixes.get(code[:3], []), f"{region}: ZIP {code} is outside state")
        point(location["lat"], location["lng"], code)
    by_id = {p["id"]: p for p in providers}
    unique([p["id"] for p in providers], f"{region}.providers")
    cms = {}
    for provider in providers:
        pid = provider["id"]
        require(provider["state"] == market["state"], f"{pid}: provider state differs from market")
        require(provider["zip"] in zips, f"{pid}: provider ZIP is outside market ZIPs")
        point(provider["lat"], provider["lng"], pid)
        require(provider["sources"], f"{pid}: provider requires source provenance")
        if "cms" in provider:
            ccn = provider["cms"]["ccn"]
            require(pid == f"cms-{ccn}", f"{pid}: CMS provider ID must be cms-CCN")
            require(provider["category"] == "nursing-home", f"{pid}: CMS ratings require nursing-home category")
        if pid.startswith("cms-"):
            ccn = pid.removeprefix("cms-")
            CCN(ccn, f"{pid}.ccn")
            require(provider["category"] in ("nursing-home", "home-health"), f"{pid}: unsupported CMS category")
            require(ccn not in cms, f"{pid}: duplicate CCN")
            cms[ccn] = provider
        else:
            require(pid.startswith(region + "-"), f"{pid}: non-CMS ID requires region namespace")
    meta = market["meta"]
    require(meta["catalogTotal"] == len(providers), f"{region}: catalogTotal mismatch")
    expected = dict(Counter(p["category"] for p in providers))
    require(set(meta["categories"]) <= CATEGORIES, f"{region}: unknown category count")
    require({k: v for k, v in meta["categories"].items() if v} == expected, f"{region}: category counts mismatch")
    for pid, research in market.get("locationResearch", {}).items():
        require(pid in by_id and research["providerId"] == pid, f"{region}: cross-market locationResearch join {pid}")
        sources = unique([s["id"] for s in research["sources"]], f"{pid}.sources")
        require(not research["sources"] or research["checkedAt"] is not None, f"{pid}: research checkedAt missing")
        for collection in ("facts", "reviews"):
            unique([r["id"] for r in research[collection]], f"{pid}.{collection}")
        linked = research["facts"] + research["reviewAggregates"] + research["reviews"]
        linked += [research["availability"]]
        if "admissionRestriction" in research:
            linked += [research["admissionRestriction"]]
        for item in linked:
            source = item["sourceId"]
            require(source in sources or (source is None and item is research["availability"]), f"{pid}: unknown research sourceId")
        aggregates = {(a["sourceId"], a["sourceFamily"]) for a in research["reviewAggregates"]}
        samples = research.get("reviewSamples", [])
        unique([s["sourceId"] for s in samples], f"{pid}.reviewSamples")
        unique([o["id"] for s in samples for o in s["observations"]], f"{pid}.sampleObservations")
        for sample in samples:
            require((sample["sourceId"], sample["sourceFamily"]) in aggregates and
                    len(sample["observations"]) <= sample["visibleCount"], f"{pid}: invalid visible review sample")
        for item in research["reviewAggregates"] + research["reviews"]:
            rating, scale = item["rating"], item["scale"]
            require(rating is None or (scale is not None and scale > 0 and 0 <= rating <= scale), f"{pid}: invalid rating scale")
    fb = market.get("facebookResearch")
    if fb is not None:
        for pid, location in fb["locations"].items():
            require(pid in by_id, f"{region}: cross-market Facebook join {pid}")
            unique([f["id"] for f in location["findings"]], f"{pid}.findings")
            observed = set()
            for finding in location["findings"]:
                require(finding["sourceObservationIds"], f"{pid}: finding has no source observations")
                observed.update(unique(finding["sourceObservationIds"], f"{pid}.sourceObservationIds"))
            require(len(observed) == location["publishedObservationCount"], f"{pid}: publishedObservationCount mismatch")
            require(location["foundCount"] >= location["publishedObservationCount"] + location["withheldCount"], f"{pid}: foundCount mismatch")
            require(not location["findings"] or location["searchedAt"] is not None, f"{pid}: findings lack search date")
            require(location["status"] not in ("no-relevant-result", "withheld") or not location["findings"], f"{pid}: status contradicts findings")
    inspection = market.get("inspectionHistory")
    if inspection is not None:
        require(inspection["sources"], f"{region}: inspection sources missing")
        cap = inspection.get("maxRecordsPerCollection", 25)
        require(1 <= cap <= 25, f"{region}: inspection record cap must be 1..25")
        for ccn, facility in inspection["facilities"].items():
            require(ccn in cms and cms[ccn]["category"] == "nursing-home", f"{region}: cross-market inspection join {ccn}")
            for name, collection in facility.items():
                if collection is None:
                    continue
                records = collection["records"]
                unique([row["id"] for row in records], f"{ccn}.{name}")
                require(len(records) == min(collection["total"], cap), f"{ccn}: bounded collection count mismatch")
                if name == "penalties":
                    require(collection["fineCount"] + collection["paymentDenialCount"] == collection["total"], f"{ccn}: penalty counts mismatch")
                    require(sum(r["type"] == "Fine" for r in records) <= collection["fineCount"], f"{ccn}: fine count mismatch")
                    require(sum(r["type"] == "Payment Denial" for r in records) <= collection["paymentDenialCount"], f"{ccn}: payment denial count mismatch")
    hh = market.get("homeHealthEvidence")
    if hh is not None:
        require(hh["sources"], f"{region}: home-health sources missing")
        unique([a["ccn"] for a in hh["agencies"]], f"{region}.agencies")
        comparison = hh["patientExperienceComparators"]
        require("national" in comparison and set(comparison) <= {"national", "state", region}, f"{region}: cross-market home-health comparator")
        require(not ("state" in comparison and region in comparison), f"{region}: duplicate state comparators")
        if "state" in comparison:
            require(comparison["state"]["code"] == market["state"], f"{region}: home-health comparator state mismatch")
        for agency in hh["agencies"]:
            pid, ccn = agency["organizationId"], agency["ccn"]
            require(pid in by_id and by_id[pid]["category"] == "home-health", f"{region}: cross-market home-health join {pid}")
            require(pid == f"cms-{ccn}", f"{pid}: home-health CCN identity mismatch")
            require(agency["cmsAddress"]["state"] == market["state"] and agency["cmsAddress"]["zip"] in zips, f"{pid}: home-health address outside market")
            require(agency["sources"], f"{pid}: home-health agency sources missing")
    dates(market, meta["asOf"], region)


def artifact_count(key, value):
    if key == "meta":
        return value["catalogTotal"]
    if key == "facebookResearch":
        return len(value["locations"])
    if key == "inspectionHistory":
        return len(value["facilities"])
    if key == "homeHealthEvidence":
        return len(value["agencies"])
    return len(value)


def registrations():
    rows = decode(REGISTRATIONS.read_bytes())
    require(isinstance(rows, list), "Market registrations must be an array")
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get("id"), str)
                and re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", row["id"])
                and isinstance(row.get("state"), str) and re.fullmatch(r"[A-Z]{2}", row["state"])
                and all(isinstance(row.get(k), str) and row[k].strip() for k in ("label", "stateLabel"))
                and isinstance(row.get("defaultZip"), str) and re.fullmatch(r"\d{5}", row["defaultZip"]),
                "Invalid market registration")
    unique([r["id"] for r in rows], "registered IDs")
    unique([r["defaultZip"] for r in rows], "registered default ZIPs")
    require(any(r["id"] == "massachusetts" for r in rows), "Missing legacy market registration")
    return {r["id"]: r for r in rows}


def build(manifest_path, output):
    return build_markets([(manifest_path, None)], output, registrations())


def build_markets(manifests, output, registered):
    entries = []
    for path, expected_id in manifests:
        require(output != path, "Output must not overwrite the input manifest")
        manifest = decode(path.read_bytes())
        MANIFEST(manifest, "manifest")
        if expected_id is not None:
            require([e["id"] for e in manifest["markets"]] == [expected_id],
                    f"Default manifest must contain its registered market {expected_id}")
        entries.extend((entry, path.parent.resolve()) for entry in manifest["markets"])
    unique([entry["id"] for entry, _ in entries], "manifest.markets")
    prefixes = decode((ROOT / "src/data/us-zip-prefix-states.json").read_bytes())
    existing = decode((ROOT / "src/data/providers.json").read_bytes())
    ids = {provider["id"] for provider in existing}
    ccns = {provider["cms"]["ccn"] for provider in existing if "cms" in provider}
    ma_home_health = decode((ROOT / "src/data/home-health-evidence.json").read_bytes())
    ccns.update(agency["ccn"] for agency in ma_home_health["agencies"])
    used_zips = set(decode((ROOT / "src/data/ma-zips.json").read_bytes()))
    markets = []
    for entry, base in entries:
        registration = registered.get(entry["id"])
        require(entry["id"] != "massachusetts" and registration and registration["state"] == entry["state"], f"{entry['id']}/{entry['state']}: unsupported market identity")
        market = {key: entry[key] for key in ("id", "label", "state", "defaultZip")}
        for key, ref in entry["artifacts"].items():
            require(not Path(ref["path"]).is_absolute(), f"{key}: artifact path must be relative")
            path = (base / ref["path"]).resolve()
            require(path.is_relative_to(base), f"{key}: artifact path escapes manifest directory")
            require(path != output, f"{key}: output must not overwrite an input artifact")
            data = path.read_bytes()
            require(hashlib.sha256(data).hexdigest() == ref["sha256"], f"{key}: artifact SHA-256 mismatch")
            value = decode(data)
            ARTIFACTS[key](value, key)
            require(artifact_count(key, value) == ref["count"], f"{key}: artifact count mismatch")
            market[key] = value
        validate_market(market, entry["review"], prefixes)
        require(entry["label"] == registration["label"] and entry["defaultZip"] == registration["defaultZip"],
                f"{entry['id']}: label/defaultZip differ from registration")
        require(not (set(market["zips"]) & used_zips), f"{entry['id']}: ZIP collision across markets")
        used_zips.update(market["zips"])
        for provider in market["providers"]:
            require(provider["id"] not in ids, f"{provider['id']}: provider ID collision across markets")
            ids.add(provider["id"])
            if provider["id"].startswith("cms-"):
                ccn = provider["id"].removeprefix("cms-")
                require(ccn not in ccns, f"{ccn}: CCN collision across markets")
                ccns.add(ccn)
        market["providers"].sort(key=lambda provider: provider["id"])
        if "homeHealthEvidence" in market:
            market["homeHealthEvidence"]["agencies"].sort(key=lambda agency: agency["ccn"])
        markets.append(market)
    return sorted(markets, key=lambda market: market["id"])


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, help="Reviewed normalized manifest, paths relative to its directory")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Compare deterministic bytes without writing")
    args = parser.parse_args()
    output = args.output.absolute()
    resolved = output.resolve()
    require(not output.is_symlink(), "Output must not be a symlink")
    require(not resolved.is_relative_to(ROOT) or resolved == DEFAULT_OUTPUT, "Only src/data/regional-markets.json may be written inside the checkout")
    registered = registrations()
    if args.manifest:
        markets = build_markets([(args.manifest.resolve(), None)], resolved, registered)
        status = "reviewed"
    else:
        manifests = [(ROOT / "research" / mid / "runtime-manifest.json", mid)
                     for mid in registered if mid != "massachusetts"]
        available = [(p, mid) for p, mid in manifests if p.is_file()]
        if output.exists():
            published = {m["id"] for m in decode(output.read_bytes())}
            require(published <= {mid for _, mid in available},
                    "Missing default manifest must not erase published markets")
        markets = build_markets(available, resolved, registered) if available else []
        status = "reviewed" if available else "pending-reviewed-manifest"
    if args.manifest and resolved == DEFAULT_OUTPUT and output.is_file():
        published = {m["id"] for m in decode(output.read_bytes())}
        require(published <= {m["id"] for m in markets}, "A partial manifest must not erase published markets")
    data = (json.dumps(markets, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode()
    if args.check:
        require(output.read_bytes() == data, "Regional output differs from reviewed artifacts")
    else:
        write_atomic(output, data)
    print(json.dumps({
        "status": status, "mode": "check" if args.check else "build",
        "marketCount": len(markets),
        "markets": [{"id": m["id"], "providers": len(m["providers"]), "zips": len(m["zips"])} for m in markets],
    }, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(f"Regional build failed: {error}", file=sys.stderr)
        sys.exit(1)
