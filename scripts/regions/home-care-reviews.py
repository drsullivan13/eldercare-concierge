#!/usr/bin/env python3
"""Publish one independently reviewed HCSF batch offline, without collecting pages."""

import argparse
from collections import Counter
from copy import deepcopy
import csv
from datetime import date, datetime
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[2]
AREA = Path("research/north-jersey/home-care-reviews")
OUTPUT = Path("src/data/home-care-reviews.json")
NODE = Path("/Users/dansullivan/.nvm/versions/node/v24.20.0/bin/node")
NOTES = [
    "Selected public consumer accounts are not verified people, representative prevalence or clinical evidence.",
    "Published averages and reported counts are separate from retained individual accounts. Known source families and pages contribute once through the existing experience policy.",
    "A link grants no text rights. Missing evidence is not a negative rating.",
]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def parse(data):
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))


def fields(value, names, label):
    require(isinstance(value, dict) and set(value) == set(names.split()),
            f"Malformed {label}; expected exactly {names}")


def text(value, label):
    require(isinstance(value, str) and 0 < len(value.strip()) <= 4000
            and not any(ord(c) < 32 for c in value), f"Invalid {label}")
    return value


def day(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value),
            "Expected observed YYYY-MM-DD date")
    require(date.fromisoformat(value).isoformat() == value, "Invalid calendar date")
    return value


def observed_date(value, precision, checked):
    require(precision in ("day", "month", "year", "unknown"), "Invalid date precision")
    if precision == "unknown":
        require(value is None, "Unknown date must remain null")
        return
    require(isinstance(value, str), "Observed date must be a string")
    if precision == "day":
        first = day(value)
    elif precision == "month":
        require(re.fullmatch(r"\d{4}-\d{2}", value), "Invalid observed month")
        first = day(value + "-01")
    else:
        require(re.fullmatch(r"\d{4}", value), "Invalid observed year")
        first = day(value + "-01-01")
    require(first <= checked, "Account date is after check")


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value),
        "Expected observed ISO timestamp with time zone")
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


def receipt(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value),
            "Expected witness SHA-256")


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value),
            "Invalid stable observation/account ID")


def url(value):
    text(value, "URL")
    p = urlsplit(value)
    require(p.scheme == "https" and p.hostname and not p.username and not p.password
            and p.port in (None, 443) and "\\" not in value
            and not re.search(r"\s", value), "Expected safe public HTTPS URL")
    host = p.hostname.lower().rstrip(".").removeprefix("www.")
    require(re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}", host),
            "Expected public DNS host")
    require(not any(k.lower() in ("url", "redirect", "redirect_uri", "next", "target", "continue")
                    for k, _ in parse_qsl(p.query)), "Redirect URL is not a source")
    return p


def canonical(value):
    p = url(value)
    host = p.hostname.lower().rstrip(".").removeprefix("www.")
    query = urlencode(sorted((k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
                             if not k.lower().startswith("utm_")
                             and k.lower() not in ("tracking", "gclid", "fbclid")))
    return urlunsplit(("https", host, p.path.rstrip("/"), query, ""))


def source_family(value):
    text(value, "source family")
    key = re.sub(r"[^a-z0-9]", "", value.lower())
    return {"googlemaps": "google", "googlereviews": "google", "apfm": "aplaceformom",
            "senioradvisor": "aplaceformom", "senioradvisorcom": "aplaceformom",
            "caringcom": "caring"}.get(key, key)


def primary_family(value):
    host = url(value).hostname.lower().rstrip(".").removeprefix("www.")
    return {"google.com": "google", "maps.google.com": "google", "caring.com": "caring",
            "aplaceformom.com": "aplaceformom", "senioradvisor.com": "aplaceformom"}.get(host)


def listing_url(value):
    p = url(value)
    host = p.hostname.lower().rstrip(".").removeprefix("www.")
    if host in ("google.com", "maps.google.com"):
        return bool(re.match(r"^/maps/place/[^/]+", p.path) or
                    (p.path == "/maps" and any(dict(parse_qsl(p.query)).get(k)
                                             for k in ("cid", "ftid", "query_place_id"))))
    if host == "mylivingchoice.com":
        return bool(re.fullmatch(r"/property/[^/]+/?", p.path)) and not p.query
    if host in ("aplaceformom.com", "senioradvisor.com"):
        return bool(re.fullmatch(r"/community/[^/]+-\d+/?|/local/[^/]+/?", p.path))
    if host == "caring.com":
        return bool(re.fullmatch(r"/senior-(care|living)/[^/]+/[^/]+/[^/]+/?", p.path))
    return p.path not in ("", "/") and not p.query and not p.fragment


def account_key(value):
    p = url(value)
    if primary_family(value) == "google":
        match = re.search(r"!1s((?:Ci|Ch)[^!?#]+)", value)
        if match:
            return "google:" + match[1]
    return value


def historical():
    spec = importlib.util.spec_from_file_location("home_care_historical_reviews",
                                                  Path(__file__).with_name("reviews.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Inputs:
    def __init__(self, root):
        self.root = root.resolve()
        self.hashes = {}
        self.cache = {}

    def data(self, relative):
        if str(relative) in self.cache:
            return self.cache[str(relative)]
        path = self.root / relative
        require(path.resolve().is_relative_to(self.root) and not path.is_symlink(),
                "Dependency escapes repository or is a symlink")
        data = path.read_bytes()
        self.hashes[str(relative)] = sha(data)
        self.cache[str(relative)] = data
        return data

    def read(self, relative):
        return parse(self.data(relative))


def office_roster(inputs):
    markets = inputs.read("src/data/regional-markets.json")
    nj = [m for m in markets if m["id"] == "north-jersey"]
    require(len(nj) == 1, "One North Jersey runtime market required")
    providers = {p["id"]: p for p in nj[0]["providers"]
                 if p["id"].startswith("north-jersey-hp-") and p["category"] == "home-care"
                 and p["state"] == "NJ"}
    require(providers, "No HCSF runtime offices")
    crosswalk = inputs.read("research/north-jersey/runtime/crosswalk.json")
    offices = {}
    loaded = {}
    for pid, provider in sorted(providers.items()):
        matches = [r for r in crosswalk if r.get("providerId") == pid and r.get("status") == "included"]
        require(matches and len({r["officialId"] for r in matches}) == 1,
                "Missing or ambiguous HP crosswalk")
        official_id = matches[0]["officialId"]
        require(re.fullmatch(r"HP\d+", official_id) and pid == "north-jersey-hp-" + official_id.lower(),
                "HP provider identity mismatch")
        rows = []
        for match in matches:
            rel = Path("research/north-jersey") / match["sourceFile"]
            if match["sourceFile"] in ("state/raw/firms.xlsx", "home-care-supply/source/firms.xlsx"):
                from nj_collect import workbook_rows

                if str(rel) not in loaded:
                    inputs.data(rel)
                    loaded[str(rel)] = {
                        row["source_row"]: row for row in workbook_rows(inputs.root / rel)
                    }
                raw = loaded[str(rel)].get(match["sourceRow"])
                require(inputs.hashes[str(rel)] == match["sourceSha256"] and raw and
                        raw["License/Registration"] == official_id and raw["License Status"] == "Active" and
                        raw["License Type"] == "Health Care Services", "Direct registry office/source mismatch")
                rows.append({
                    key: raw[field].strip() for key, field in (
                        ("name", "Business Name"), ("address", "Business Address"),
                        ("city", "Business City"), ("state", "Business USA State"),
                        ("zip", "Business Zipcode"),
                    )
                })
                continue
            require(re.fullmatch(r"state/[a-z]+/home-care-firms\.json", match["sourceFile"]),
                    "Unexpected HP source file")
            if str(rel) not in loaded:
                loaded[str(rel)] = inputs.read(str(rel))
            candidates = [r for r in loaded[str(rel)]
                          if r["official_registration_id"] == official_id and
                          r["source"]["row"] == match["sourceRow"]]
            require(len(candidates) == 1, "Official HP source row missing or ambiguous")
            row = candidates[0]
            require(row["record_kind"] == "home_care_firm_registration" and
                    row["license_status"] == "Active" and
                    row["source"]["sha256"] == match["sourceSha256"] and
                    row["county"] == match["county"], "HP crosswalk/source drift")
            require(row["source"]["file"] == "raw/firms.xlsx" and
                    url(row["source"]["url"]).hostname == "rgbportal.dca.njoag.gov",
                    "Unexpected official HP provenance")
            raw_path = "research/north-jersey/state/" + row["source"]["file"]
            inputs.data(raw_path)
            require(inputs.hashes[raw_path] == row["source"]["sha256"],
                    "Official HP source hash mismatch")
            rows.append(row)
        expected = ("name", "address", "city", "state", "zip")
        require(len({tuple(r[k] for k in expected) for r in rows}) == 1,
                "Conflicting HP office identity")
        offices[pid] = {"provider": provider, "officialId": official_id,
                        "row": rows[0], "county": matches[0]["county"]}
    return offices


def identity_projection(provider):
    return {k: provider[k] for k in ("id", "name", "address", "city", "state", "zip", "category")}


def collector_intake(value, raw):
    fields(value, "schemaVersion collectedAt sourceFamily publisher publicationStatus methodology "
           "accessEvidence records held coverage audit", "sanitized-html collector envelope")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and
            value["publicationStatus"] == "requires-independent-review" and
            isinstance(value["methodology"], dict) and
            value["methodology"].get("collectorVersion") == "sanitized-html-v1",
            "Collector observations are not independently reviewed publication evidence")
    require(isinstance(value["records"], list) and isinstance(value["held"], list),
            "Collector record arrays required")
    collected = timestamp(value["collectedAt"])
    holds = []
    for row in value["records"] + value["held"]:
        fields(row, "aggregate currentEvidence disposition googlePanelUrl holdReasons identityMatch observedAt "
               "populationAssessment providerId registry registryCandidates sourceFamily sourceIdentity "
               "sourceUrl structural visibleReviewWindow", "sanitized collector row")
        require(row["providerId"] is None or
                re.fullmatch(r"north-jersey-hp-hp\d+", row["providerId"]), "Invalid collector provider ID")
        require(isinstance(row["holdReasons"], list) and
                all(isinstance(reason, str) and len(reason) <= 120 and
                    re.fullmatch(r"[a-z]+(?:-[a-z]+)*", reason)
                    for reason in row["holdReasons"]), "Invalid collector hold reason code")
        require(row["disposition"] in ("held", "candidate"), "Unknown collector disposition")
        require(listing_url(row["sourceUrl"]) and
                url(row["sourceUrl"]).hostname == "www.mylivingchoice.com",
                "Unexpected collector listing URL")
        observed = timestamp(row["observedAt"])
        evidence = row["currentEvidence"]
        receipt(evidence["bodySha256"])
        receipt(evidence["receiptSha256"])
        holds.append({"providerId": row["providerId"], "sourceUrl": row["sourceUrl"],
                      "observedAt": observed, "bodySha256": evidence["bodySha256"],
                      "receiptSha256": evidence["receiptSha256"],
                      "reasons": sorted(set(row["holdReasons"] + ["requires-independent-review"]))})
    intake = {"schemaVersion": 1, "kind": "unapproved-sanitized-html-v1",
              "originalInputSha256": sha(raw), "collectedAt": collected,
              "publicationStatus": "requires-independent-review", "held": holds,
              "candidateCount": len(value["records"]), "heldCount": len(value["held"])}
    data = encoded(intake)
    path = AREA / "intakes" / (sha(data) + ".json")
    batch = {"schemaVersion": 1, "batchId": "held-collector-" + sha(raw)[:24],
             "asOf": collected[:10], "independentReview": False, "observations": [],
             "intake": {"path": str(path), "sha256": sha(data)}}
    return batch, {path: data}


def validate_intake(value):
    fields(value, "schemaVersion kind originalInputSha256 collectedAt publicationStatus held candidateCount heldCount",
           "redacted collector intake")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and
            value["kind"] == "unapproved-sanitized-html-v1" and
            value["publicationStatus"] == "requires-independent-review",
            "Unknown redacted collector intake")
    receipt(value["originalInputSha256"])
    timestamp(value["collectedAt"])
    require(isinstance(value["held"], list) and type(value["candidateCount"]) is int and
            type(value["heldCount"]) is int and min(value["candidateCount"], value["heldCount"]) >= 0 and
            len(value["held"]) == value["candidateCount"] + value["heldCount"], "Invalid intake counts")
    for held in value["held"]:
        fields(held, "providerId sourceUrl observedAt bodySha256 receiptSha256 reasons", "redacted held receipt")
        require(held["providerId"] is None or
                re.fullmatch(r"north-jersey-hp-hp\d+", held["providerId"]), "Invalid held provider ID")
        require(listing_url(held["sourceUrl"]) and
                url(held["sourceUrl"]).hostname == "www.mylivingchoice.com", "Unexpected held listing URL")
        timestamp(held["observedAt"])
        receipt(held["bodySha256"])
        receipt(held["receiptSha256"])
        require(isinstance(held["reasons"], list) and "requires-independent-review" in held["reasons"]
                and all(isinstance(r, str) and len(r) <= 120 and
                        re.fullmatch(r"[a-z]+(?:-[a-z]+)*", r) for r in held["reasons"]),
                "Invalid redacted hold reasons")


def validate_batch(batch, offices, policy, old):
    fields(batch, "schemaVersion batchId asOf independentReview observations" +
           (" intake" if isinstance(batch, dict) and "intake" in batch else ""), "batch")
    require(type(batch["schemaVersion"]) is int and batch["schemaVersion"] == 1, "Unknown batch version")
    identifier(batch["batchId"])
    day(batch["asOf"])
    require(isinstance(batch["observations"], list), "Observations must be an array")
    require(type(batch["independentReview"]) is bool and
            (not batch["observations"] or batch["independentReview"]),
            "Independent editorial review required")
    if "intake" in batch:
        require(not batch["observations"] and not batch["independentReview"],
                "Unapproved collector intake cannot publish observations")
    safe = deepcopy(batch)
    providers, decisions, seen = {}, [], set()
    for index, obs in enumerate(safe["observations"]):
        fields(obs, "id providerId officialId checkedAt checkedUrl canonicalUrl originalUrl effectiveUrl "
               "publisher sourceFamily syndication sourceType population inspection access textRights "
               "identity aggregate accounts window", "observation")
        oid = obs["id"]
        identifier(oid)
        require(oid not in seen, "Duplicate observation ID")
        seen.add(oid)
        pid = obs["providerId"]
        require(pid in offices, "Observation must name a current exact HP runtime office")
        office = offices[pid]
        require(obs["officialId"] == office["officialId"], "Wrong official HP identity")
        checked = day(obs["checkedAt"])
        require(checked <= batch["asOf"], "Future source check")
        require((date.fromisoformat(batch["asOf"]) - date.fromisoformat(checked)).days <= 180,
                "Stale source check")
        text(obs["publisher"], "publisher")
        fields(obs["access"], "decision assessedAt basis evidenceSha256 metadata", "access assessment")
        day(obs["access"]["assessedAt"])
        require(obs["access"]["assessedAt"] <= checked, "Access assessed after source check")
        text(obs["access"]["basis"], "access basis")
        receipt(obs["access"]["evidenceSha256"])
        require(obs["access"]["metadata"] in ("permitted", "denied", "unknown"), "Invalid metadata decision")
        for key in ("checkedUrl", "canonicalUrl", "effectiveUrl"):
            url(obs[key])
            require(listing_url(obs[key]), "Requires identity-bearing office listing URL")
        require(canonical(obs["effectiveUrl"]) == canonical(obs["canonicalUrl"]),
                "Effective URL must resolve to the canonical office page")
        page_reasons = old.page_reasons(
            {"url": obs["checkedUrl"], "canonicalUrl": obs["canonicalUrl"],
             "inspection": obs["inspection"], "access": obs["access"]},
            date.fromisoformat(checked), date.fromisoformat(batch["asOf"]), policy)
        require(not page_reasons, "; ".join(page_reasons))
        require(obs["access"]["metadata"] == "permitted", "Metadata publication permission unknown or denied")
        family = source_family(obs["sourceFamily"])
        fields(obs["syndication"], "status family", "syndication")
        syn = obs["syndication"]
        require(syn["status"] in ("original", "syndicated"), "Unknown syndication")
        if syn["status"] == "syndicated":
            require(source_family(syn["family"]) == family, "Syndicated family mismatch")
        else:
            require(syn["family"] is None, "Original page cannot declare another family")
        for key in ("canonicalUrl", "originalUrl"):
            if obs[key] is not None:
                url(obs[key])
                known = primary_family(obs[key])
                require(not known or known == family, "Primary URL/source family mismatch")
        if obs["originalUrl"] is not None:
            require(listing_url(obs["originalUrl"]), "Original listing URL must identify the office")
        if url(obs["canonicalUrl"]).hostname.lower().removeprefix("www.") == "mylivingchoice.com":
            require(syn["status"] == "syndicated" and family in ("google", "caring", "aplaceformom"),
                    "MyLivingChoice must identify the underlying syndicated review family")
        require(obs["sourceType"] == "review-platform" and obs["population"] == "consumer",
                "Provider promotion, staff, brand and campus populations are not consumer office evidence")
        witness = obs["identity"]
        fields(witness, "checkedAt url evidenceSha256 officialId name address city state zip careUnit",
               "dated identity witness")
        day(witness["checkedAt"])
        require(witness["checkedAt"] <= checked and
                (date.fromisoformat(checked) - date.fromisoformat(witness["checkedAt"])).days <= 180,
                "Identity witness must be fresh and no later than source check")
        url(witness["url"])
        require(canonical(witness["url"]) == canonical(obs["canonicalUrl"]) or
                (url(witness["url"]).hostname == "rgbportal.dca.njoag.gov"
                 and url(witness["url"]).path == "/public-view/"),
                "Identity witness must be the checked office page or official HP registry")
        receipt(witness["evidenceSha256"])
        require(witness["officialId"] == office["officialId"] and witness["careUnit"] == "home-care-office",
                "Wrong care unit or official identity")
        row, provider = office["row"], office["provider"]
        for key in ("name", "address", "city", "state", "zip"):
            text(witness[key], "identity " + key)
            if key == "zip":
                # Runtime search uses the five-digit ZIP, including for ZIP+4 registry rows.
                normalize = lambda value: old.token(value.split("-", 1)[0])
            else:
                normalize = old.name_key if key == "name" else old.street_key if key == "address" else old.token
            require(normalize(witness[key]) == normalize(row[key]), "Identity witness disagrees with official " + key)
            require(normalize(provider[key]) == normalize(row[key]), "Runtime/official identity drift " + key)
        rights = obs["textRights"]
        fields(rights, "decision assessedAt basis evidenceSha256", "separate text rights")
        require(rights["decision"] in ("no-rights", "unknown", "licensed-excerpt", "original-summary"),
                "Invalid text rights decision")
        day(rights["assessedAt"])
        require(rights["assessedAt"] <= checked, "Text rights assessed after check")
        text(rights["basis"], "text rights basis")
        if rights["decision"] in ("licensed-excerpt", "original-summary"):
            receipt(rights["evidenceSha256"])
        else:
            require(rights["evidenceSha256"] is None or
                    re.fullmatch(r"[a-f0-9]{64}", rights["evidenceSha256"]), "Invalid rights receipt")
        require(isinstance(obs["accounts"], list), "Accounts must be an array")
        source_id = "home-care-review-" + sha((pid + "|" + canonical(obs["canonicalUrl"])).encode())[:24]
        source = {"id": source_id, "url": obs["canonicalUrl"], "title": obs["publisher"] + " office reviews",
                  "publisher": obs["publisher"], "kind": "review-platform", "checkedAt": checked,
                  "publishedAt": None, "access": "full-page"}
        aggregate = obs["aggregate"]
        aggregates = []
        if aggregate is not None:
            fields(aggregate, "kind rating scale count asOf", "published aggregate")
            require(aggregate["kind"] == "consumer-average", "Not a published consumer average")
            require(type(aggregate["scale"]) is int and aggregate["scale"] in (5, 10)
                    and type(aggregate["rating"]) in (int, float) and math.isfinite(aggregate["rating"])
                    and 0 <= aggregate["rating"] <= aggregate["scale"]
                    and type(aggregate["count"]) is int and aggregate["count"] > 0,
                    "Invalid published average/count")
            if aggregate["asOf"] is not None:
                day(aggregate["asOf"])
                require(aggregate["asOf"] <= checked and
                        (date.fromisoformat(batch["asOf"]) - date.fromisoformat(aggregate["asOf"])).days <= 365,
                        "Invalid or stale aggregate date")
            aggregates.append({k: aggregate[k] for k in ("rating", "scale", "count", "asOf")})
            aggregates[0].update(sourceId=source_id, sourceFamily=family, platform=obs["publisher"],
                                 scope="consumer", notes=NOTES)
        accounts, exclusions, account_ids = [], [], set()
        for account in obs["accounts"]:
            fields(account, "id url nativeReviewId date datePrecision authorObserved relationship "
                   "text textPresent privacyReviewed", "authored account")
            identifier(account["id"])
            require(account["id"] not in account_ids, "Duplicate account ID")
            account_ids.add(account["id"])
            url(account["url"])
            require(account["nativeReviewId"] is None or
                    re.fullmatch(r"[a-zA-Z0-9_-]{1,200}", account["nativeReviewId"]), "Invalid native review ID")
            known = primary_family(account["url"])
            require(known == family or canonical(account["url"]) == canonical(obs["canonicalUrl"]),
                    "Account URL must belong to the declared original family or checked listing")
            if known == "google":
                require(account_key(account["url"]).startswith("google:"),
                        "Google account needs an identity-bearing original review URL")
            else:
                require(canonical(account["url"]) == canonical(obs["canonicalUrl"])
                        and (account["nativeReviewId"] or url(account["url"]).fragment),
                        "Account needs a native identity on its checked office page")
            require(type(account["authorObserved"]) is bool and type(account["textPresent"]) is bool
                    and type(account["privacyReviewed"]) is bool, "Invalid account review flags")
            require(account["relationship"] in ("family", "resident", "staff", "visitor", "unknown"),
                    "Invalid account relationship")
            observed_date(account["date"], account["datePrecision"], checked)
            reasons = []
            if not account["authorObserved"]:
                reasons.append("missing-observed-author")
            if account["date"] is None:
                reasons.append("missing-observed-date")
            if account["relationship"] == "staff":
                reasons.append("staff-not-consumer")
            if account["text"] is not None:
                text(account["text"], "reviewed redacted text")
                require(account["textPresent"], "Text flag contradicts text")
            text_allowed = (rights["decision"] in ("licensed-excerpt", "original-summary")
                            and account["privacyReviewed"] and not reasons)
            if not text_allowed:
                account["text"] = None
            if account["textPresent"] and account["text"] is None:
                exclusions.append({"accountId": account["id"], "reasons":
                                   reasons + (["text-rights-not-established"] if rights["decision"] in
                                              ("no-rights", "unknown") else []) +
                                   ([] if account["privacyReviewed"] else ["text-privacy-not-reviewed"])})
            if reasons or rights["decision"] == "unknown":
                exclusions.append({"accountId": account["id"], "reasons":
                                   reasons + (["unknown-text-permission-account-withheld"]
                                              if rights["decision"] == "unknown" else [])})
                continue
            aid = "home-care-account-" + sha((pid + "|" + family + "|" + account_key(account["url"]) +
                                             "|" + (account["nativeReviewId"] or account["id"])).encode())[:24]
            accounts.append({"id": aid, "sourceId": source_id, "sourceFamily": family, "url": account["url"],
                             "date": account["date"], "datePrecision": account["datePrecision"],
                             "relationship": account["relationship"],
                             "excerpt": account["text"] if rights["decision"] == "licensed-excerpt" else None,
                             "summary": account["text"] if rights["decision"] == "original-summary" else None,
                             "representation": rights["decision"] if account["text"] else "link-only",
                             "provenance": "new-public-page",
                             **({"nativeReviewId": account["nativeReviewId"]} if account["nativeReviewId"] else {})})
        window = obs["window"]
        fields(window, "selection visibleCount observations pagesChecked coverage stopReason", "complete visible window")
        require(window["selection"] == "all-visible-before-highlighting", "Selected highlights are not a window")
        require(type(window["visibleCount"]) is int and window["visibleCount"] >= 0
                and isinstance(window["observations"], list)
                and window["visibleCount"] == len(window["observations"]), "Incomplete visible window")
        require(type(window["pagesChecked"]) is int and window["pagesChecked"] > 0
                and window["coverage"] in ("partial", "exhausted-visible-pages"), "Invalid window coverage")
        text(window["stopReason"], "window stop reason")
        visible = {}
        for item in window["observations"]:
            fields(item, "id date datePrecision sentiment", "visible window row")
            identifier(item["id"])
            require(item["id"] not in visible, "Duplicate visible account ID")
            observed_date(item["date"], item["datePrecision"], checked)
            require(item["sentiment"] in ("positive", "negative", "mixed", "neutral"), "Unknown visible sentiment")
            visible[item["id"]] = item
        require(account_ids <= visible.keys(), "Accounts absent from complete visible window")
        for account in obs["accounts"]:
            item = visible[account["id"]]
            require(item["date"] == account["date"] and item["datePrecision"] == account["datePrecision"],
                    "Account/window date precision mismatch")
        sample = {"sourceId": source_id, "sourceFamily": family, "selection": window["selection"],
                  "visibleCount": window["visibleCount"],
                  "observations": [{k: item[k] for k in ("id", "date", "sentiment")}
                                   for item in window["observations"]]}
        patch = providers.setdefault(pid, {"identity": identity_projection(provider), "sources": [],
                                            "reviewAggregates": [], "reviews": [], "reviewSamples": [],
                                            "notes": NOTES, "catalog": {"providerId": pid, "checkedAt": checked,
                                            "accounts": [], "sources": [], "notes": NOTES}})
        require(not any(s["id"] == source_id for s in patch["sources"]),
                "Duplicate canonical office page in batch")
        patch["sources"].append(source)
        patch["reviewAggregates"].extend(aggregates)
        patch["reviewSamples"].append(sample)
        patch["catalog"]["checkedAt"] = max(patch["catalog"]["checkedAt"], checked)
        patch["catalog"]["accounts"].extend(accounts)
        patch["catalog"]["sources"].append({
            "id": source_id, "publisher": obs["publisher"], "sourceFamily": family,
            "url": obs["canonicalUrl"], "reportedCount": aggregate["count"] if aggregate else None,
            "retainedCount": len(accounts), "previouslyUnseenCount": len(accounts),
            "pagesChecked": window["pagesChecked"], "coverage": window["coverage"],
            "stopReason": window["stopReason"],
        })
        decisions.append({"observationId": oid, "providerId": pid, "checkedUrl": obs["checkedUrl"],
                          "canonicalUrl": obs["canonicalUrl"], "originalUrl": obs["originalUrl"],
                          "effectiveUrl": obs["effectiveUrl"], "sourceFamily": family,
                          "sourceId": source_id, "aggregateRetained": bool(aggregates),
                          "accountsRetainedBeforeOverlapDedup": len(accounts), "exclusions": exclusions})
    return safe, providers, decisions


def managed_write(root, outputs, manifest_name, inputs, check):
    manifest_path = root / AREA / manifest_name
    manifest = {"schemaVersion": 1, "inputs": inputs,
                "outputs": {str(p): sha(data) for p, data in outputs.items()}}
    prior = parse(manifest_path.read_bytes()) if manifest_path.is_file() else None
    writes = {**outputs, AREA / manifest_name: encoded(manifest)}
    for rel, data in writes.items():
        path = root / rel
        require(not path.is_symlink() and path.resolve().is_relative_to(root), "Unsafe output path")
        if path.exists() and path.read_bytes() != data:
            require(not check, f"Byte drift: {rel}")
            require(prior is not None, f"Refusing to overwrite unknown work: {rel}")
            if path != manifest_path:
                require(prior.get("outputs", {}).get(str(rel)) == sha(path.read_bytes()),
                        f"Refusing to overwrite changed/user work: {rel}")
        elif check:
            require(path.is_file(), f"Missing output: {rel}")
    if not check:
        for rel, data in writes.items():
            path = root / rel
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("xb") as handle:
                    handle.write(data)
            elif path.read_bytes() != data:
                path.write_bytes(data)
    return manifest


def compile_release(root, input_path, check):
    inputs = Inputs(root)
    old = historical()
    offices = office_roster(inputs)
    if any(path.endswith("firms.xlsx") for path in inputs.hashes):
        inputs.hashes["scripts/regions/nj_collect.py"] = sha(Path(__file__).with_name("nj_collect.py").read_bytes())
    errors = []
    access_receipt, policy = old.source_access(root, errors)
    require(not errors and policy["valid"], "Missing or malformed historical source-access registry")
    inputs.hashes[access_receipt["path"]] = access_receipt["sha256"]
    inputs.hashes["scripts/regions/reviews.py"] = sha(Path(old.__file__).read_bytes())
    inputs.hashes["scripts/regions/home-care-reviews.py"] = sha(Path(__file__).read_bytes())
    prior_path = root / AREA / "manifest.json"
    prior = parse(prior_path.read_bytes()) if prior_path.is_file() else None
    if input_path is None:
        require(prior is not None, "Supply --input once; public replay then uses the immutable reviewed batch")
        retained = prior["inputs"].get("reviewedInput")
        require(isinstance(retained, dict) and
                re.fullmatch(r"research/north-jersey/home-care-reviews/batches/[a-f0-9]{64}\.json",
                             retained["path"]), "Invalid immutable replay path")
        input_path = root / retained["path"]
        require(sha(input_path.read_bytes()) == retained["sha256"], "Reviewed replay input hash drift")
    raw = input_path.read_bytes()
    batch = parse(raw)
    intake_outputs = {}
    if isinstance(batch, dict) and "publicationStatus" in batch:
        batch, intake_outputs = collector_intake(batch, raw)
        # Record a new unreviewed intake without replacing a previously published office release.
        if prior and (root / OUTPUT).is_file():
            published_bytes = (root / OUTPUT).read_bytes()
            published = parse(published_bytes)
            if published["providers"]:
                require(prior["outputs"][str(OUTPUT)] == sha(published_bytes),
                        "Published office review supplement has drifted")
                for rel, data in intake_outputs.items():
                    path = root / rel
                    require(not path.is_symlink() and path.resolve().is_relative_to(root),
                            "Unsafe intake output path")
                    if path.exists():
                        require(path.read_bytes() == data, "Immutable intake has drifted")
                    elif check:
                        raise ValueError(f"Missing intake: {rel}")
                    else:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        with path.open("xb") as handle:
                            handle.write(data)
                return published, prior
    if isinstance(batch, dict) and "intake" in batch:
        ref = batch["intake"]
        fields(ref, "path sha256", "redacted collector intake reference")
        receipt(ref["sha256"])
        require(isinstance(ref["path"], str) and re.fullmatch(
            r"research/north-jersey/home-care-reviews/intakes/[a-f0-9]{64}\.json", ref["path"]),
            "Invalid redacted collector intake path")
        intake_path = Path(ref["path"])
        if intake_path not in intake_outputs:
            data = inputs.data(ref["path"])
            require(sha(data) == ref["sha256"], "Redacted collector intake hash drift")
            intake_outputs[intake_path] = data
            # The immutable intake is an output on first import and on replay.
            del inputs.hashes[ref["path"]]
        validate_intake(parse(intake_outputs[intake_path]))
    safe, providers, decisions = validate_batch(batch, offices, policy, old)
    safe_bytes = encoded(safe)
    retained_path = AREA / "batches" / (sha(safe_bytes) + ".json")
    retained_file = root / retained_path
    if retained_file.exists():
        require(not retained_file.is_symlink() and retained_file.read_bytes() == safe_bytes,
                "Immutable reviewed input changed")
    else:
        require(not check, "Missing immutable reviewed input")
    release = {"schemaVersion": 1, "batchId": batch["batchId"], "asOf": batch["asOf"],
               "reviewedInputSha256": sha(safe_bytes), "providers": providers}
    original_hash = sha(raw)
    if prior and input_path.resolve() == (root / prior["inputs"]["reviewedInput"]["path"]).resolve():
        original_hash = prior["inputs"]["originalInputSha256"]
    replay_inputs = {"dependencies": inputs.hashes, "reviewedInput":
                     {"path": str(retained_path), "sha256": sha(safe_bytes)},
                     "originalInputSha256": original_hash}
    outputs = {**intake_outputs, retained_path: safe_bytes, OUTPUT: encoded(release),
               AREA / "decisions.json": encoded(decisions)}
    result = managed_write(root, outputs, "manifest.json", replay_inputs, check)
    return release, result


RUNTIME_AUDIT = r"""
const { markets } = require("./src/lib/markets");
const { getLocationResearch, getResearchSummary } = require("./src/lib/location-research");
const { getReviewCatalog } = require("./src/lib/review-catalog");
const { individualReviews, reviewAccountCounts } = require("./src/lib/individual-reviews");
const { searchProviders } = require("./src/lib/search");
const fs = require("node:fs");
const crosswalk = JSON.parse(fs.readFileSync("research/north-jersey/runtime/crosswalk.json", "utf8"));
const asOf = process.env.HOME_CARE_REVIEW_AS_OF;
const nj = markets.find(m => m.id === "north-jersey");
const rows = nj.providers.filter(p => p.id.startsWith("north-jersey-hp-") && p.category === "home-care").map(p => {
  const research = getLocationResearch(p.id, asOf);
  const catalog = getReviewCatalog(p.id);
  const accounts = individualReviews(research, catalog);
  const summary = getResearchSummary(p.id);
  const counts = reviewAccountCounts(accounts.accounts);
  if (JSON.stringify(counts) !== JSON.stringify(summary?.individualReviews ?? {total:0,withText:0})) throw Error("Summary/account mismatch");
  const counties = [...new Set(crosswalk.filter(r => r.providerId === p.id && r.status === "included").map(r => r.county))];
  if (counties.length !== 1) throw Error("Ambiguous runtime county");
  return { providerId:p.id, name:p.name, address:p.address, city:p.city, zip:p.zip, county:counties[0],
    experience:research.experience, individualReviews:counts,
    catalogSources:catalog?.sources ?? [], sources:research.sources,
    reviewAggregates:research.reviewAggregates, reviews:research.reviews, reviewSamples:research.reviewSamples ?? [] };
}).sort((a,b) => a.providerId.localeCompare(b.providerId));
const search = searchProviders({zip:nj.defaultZip, radius:50, category:"home-care", sort:"experience"});
for (const p of search.providers) {
 const row = rows.find(r => r.providerId === p.id);
 if (row && JSON.stringify(p.research?.individualReviews ?? {total:0,withText:0}) !== JSON.stringify(row.individualReviews)) throw Error("Search/account mismatch");
}
process.stdout.write(JSON.stringify({asOf, runtimeProviderCount:nj.providers.length, offices:rows, searchMatches:search.providers.length}));
"""


def audit(root, as_of, check):
    import os
    day(as_of)
    paths = ["src/data/home-care-reviews.json", "src/data/regional-markets.json",
             "src/data/review-catalog.json", "research/north-jersey/runtime/crosswalk.json",
             "src/lib/markets.ts", "src/lib/home-care-reviews.ts", "src/lib/review-catalog.ts",
             "src/lib/location-research.ts", "src/lib/individual-reviews.ts", "src/lib/experience-score.ts",
             "src/lib/providers.ts", "src/lib/search-scope.ts", "src/lib/search.ts",
             "scripts/regions/home-care-reviews.py"]
    dependencies = {p: sha((root / p).read_bytes()) for p in paths}
    result = subprocess.run([str(NODE), "--import", "tsx", "-e", RUNTIME_AUDIT], cwd=root,
                            env={**os.environ, "HOME_CARE_REVIEW_AS_OF": as_of},
                            capture_output=True, text=True, check=True)
    snapshot = parse(result.stdout)
    rows = snapshot["offices"]
    snapshot["totals"] = {
        "offices": len(rows), "scored": sum(r["experience"]["value"] is not None for r in rows),
        "officesWithEligibleAggregate": sum(bool(r["experience"]["includedSources"]) for r in rows),
        "reportedRatings": sum(r["experience"]["reviewCount"] for r in rows),
        "accounts": sum(r["individualReviews"]["total"] for r in rows),
        "accountsWithText": sum(r["individualReviews"]["withText"] for r in rows),
        "county": dict(sorted(Counter(r["county"] for r in rows).items())),
    }
    handle = io.StringIO(newline="")
    writer = csv.writer(handle, lineterminator="\r\n")
    writer.writerow(["providerId", "name", "address", "city", "zip", "county", "score",
                     "reportedRatings", "sourceFamilies", "accounts", "accountsWithText", "reason"])
    for row in rows:
        values = [row[k] for k in ("providerId", "name", "address", "city", "zip", "county")]
        values += [row["experience"]["value"], row["experience"]["reviewCount"],
                   row["experience"]["independentSourceCount"], row["individualReviews"]["total"],
                   row["individualReviews"]["withText"], row["experience"]["reason"]]
        writer.writerow(["'" + str(v) if str(v).lstrip().startswith(("=", "+", "-", "@"))
                         else v for v in values])
    require(dependencies == {p: sha((root / p).read_bytes()) for p in paths},
            "Runtime dependencies changed during audit; rerun against a stable checkout")
    managed_write(root, {AREA / "coverage.json": encoded(snapshot),
                         AREA / "coverage.csv": handle.getvalue().encode()},
                  "coverage-manifest.json", {"asOf": as_of, "dependencies": dependencies}, check)
    return snapshot["totals"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--audit", action="store_true")
    parser.add_argument("--as-of")
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        if args.audit:
            require(args.input is None and args.as_of is not None, "--audit requires --as-of and no --input")
            print(json.dumps(audit(root, args.as_of, args.check), sort_keys=True))
        else:
            require(args.as_of is None, "Batch owns asOf; --as-of belongs to --audit")
            release, _ = compile_release(root, args.input, args.check)
            print(json.dumps({"batchId": release["batchId"], "providers": len(release["providers"]),
                              "check": args.check}, sort_keys=True))
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"home-care-reviews: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stderr, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
