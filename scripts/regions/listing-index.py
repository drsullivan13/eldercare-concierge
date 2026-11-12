#!/usr/bin/env python3
"""Offline county-roster consumer-listing crosswalk, Python standard library only.

Usage (run from the checkout, or pass an absolute --root):
  python3 scripts/regions/listing-index.py build --as-of 2026-11-12
  python3 scripts/regions/listing-index.py build --as-of 2026-11-12 --dry-run
  python3 scripts/regions/listing-index.py verify --run /absolute/path/to/run
  python3 scripts/regions/listing-index.py refresh --allow-source MyLivingChoice \
      --policy /absolute/policy.json --requests /absolute/requests.json

All writes go under research/north-jersey/listing-index. Build never fetches.
County-roster excludes included_cms_only rows, retaining their IDs in exclusions;
--denominator runtime includes those additions. The default count derives from
the retained roster. --expected-count asserts an explicit hard count. Outputs
retain input counts/hashes and the difference from the historical 942 baseline.
Dry-run prints the complete result without writing. Dates are UTC.

Normalized discovery input, retained in listing-index/discovery/*.json:
{"schemaVersion": 1, "observations": [{
  "providerId": "stable runtime ID", "source": "MyLivingChoice",
  "status": "exact", "url": "https://www.mylivingchoice.com/property/example",
  "observedAt": "2026-11-12", "inspection": "full-page",
  "sourceType": "review-platform", "access": {"decision": "permitted"},
  "identity": {"name": "Actual published name", "address": "Complete address",
    "city": "Town", "state": "NJ", "zip": "07960",
    "careSetting": "nursing-home", "careUnitText": "Published care-unit label",
    "scopeConfirmed": true, "evidence": "How this specific unit was confirmed"},
  "aggregate": {"value": 4, "count": 185, "scale": 5, "family": "google",
    "asOf": null, "scope": "consumer", "kind": "consumer-average"}
}]}

Statuses are exact/candidate/no_hit/access_restricted/unattempted. An exact
request is downgraded without independently matching name, street/city/state and
explicit unit/scope evidence. A reviewed alias requires identity.nameConfirmed
and identity.nameBasis as well as actual observed name/address. No fuzzy match
is promoted. no_hit requires method and a valid observedAt. Unknowns stay null.
An actual 0 rating or 0 review count stays 0, but a zero count is not scoreable.
Directory/sitemap FetchUrl envelopes (markdown, effectiveUrl, retrievedAt) are
also accepted as candidate discovery only. They never prove no_hit or exact.
Existing reviews observations and run candidates plus pilot/home-care checks are
read automatically, linked by stable IDs or official IDs, never refetched.

Refresh request file is {"requests":[{"source":"MyLivingChoice","url":"..."}]}.
Policy is {"sources":[{"source":"MyLivingChoice","family":"google",
  "hosts":["www.mylivingchoice.com"], "allowedPaths":["/property/"],
  "termsAllowed":true, "robotsAllowed":true, "checkedAt":"2026-11-12",
  "termsUrl":"https://www.mylivingchoice.com/terms-of-service",
  "robotsUrl":"https://www.mylivingchoice.com/robots.txt",
  "robotsText":"User-agent: *\\nAllow: /property/",
  "basis":"Retained terms and robots assessment", "minIntervalSeconds":10}]}.
Policy checks must be at most 30 days old. User allowlist, retained source-access
policy, terms, robots, allowed hosts and paths must ALL permit each request.
Unknown permissions fail closed. Redirects are not followed. HTTP restrictions,
429 and challenge pages persistently stop that source AND host. No retries or
bypass. Cache reuse does not fetch. --revalidate explicitly requests a new public
check without clearing source stops. Every fetched observation has immutable
metadata under cache/history and content-addressed raw bytes. Refresh raw pages remain discovery candidates
until normalized observations supply identity and published-aggregate evidence.
Do not use refresh to fetch prohibited sources through a mirror or new alias.

Refresh also saves visible HTML as FetchUrl-shaped JSON under discovery/pages.
Scripts, styles and hidden elements are omitted. Headings, links and block
newlines survive. No internal API is used. Existing retained public pages and
successful direct observations are cache inputs, including the direct pilot.
Repeated URLs in one batch are requested at most once, even with --revalidate.
To materialize older raw caches offline, run:
  python3 scripts/regions/listing-index.py materialize
From the checkout, use the runtime denominator to include every published provider:
  python3 scripts/regions/listing-index-discover.py plan --denominator runtime
  python3 scripts/regions/listing-index.py refresh --allow-source MyLivingChoice \
      --policy research/north-jersey/listing-index/refresh-policy.json \
      --requests research/north-jersey/listing-index/fetch-plan.json
  python3 scripts/regions/listing-index-discover.py ingest --denominator runtime
  python3 scripts/regions/listing-index.py build --denominator runtime --as-of YYYY-MM-DD
Use the actual assessment date. Refresh the source terms and robots assessment before
a new collection if the dated access policy is stale. Requests run serially with
a minimum ten-second interval. Successful pages are reused. On macOS framework
Python, set SSL_CERT_FILE=/etc/ssl/cert.pem if its default CA bundle is missing;
after verifying the connection, --retry-transport retries local connection errors.
The listing-release guide describes the following editorial and scoring steps.
"""

import argparse
import hashlib
import ipaddress
import json
import math
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parents[2]
REGION = Path("research/north-jersey")
OUTPUT = REGION / "listing-index"
COUNTIES = ["Union", "Morris", "Bergen", "Essex", "Hudson", "Passaic"]
STATUSES = {"exact", "candidate", "no_hit", "access_restricted", "unattempted"}
DEFAULT_SOURCES = ["MyLivingChoice", "Google", "Caring.com", "A Place for Mom",
                   "SeniorAdvisor.com", "Yelp", "Facebook"]
PROHIBITED = {"yelp", "caring", "careone", "careonemobilelegacysite"}
USER_AGENT = "HarborListingIndex/1.0"
MAX_BYTES = 8 * 1024 * 1024


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def token(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def family(value):
    key = token(value)
    if key in {"apfm", "aplaceformom", "senioradvisor", "senioradvisorcom"}:
        return "aplaceformom"
    return {"caringcom": "caring", "yelpcom": "yelp"}.get(key, key)


def day(value):
    try:
        return date.fromisoformat(value) if isinstance(value, str) and re.fullmatch(
            r"\d{4}-\d{2}-\d{2}", value) else None
    except ValueError:
        return None


def observed_day(value):
    return day(value[:10]) if isinstance(value, str) else None


def public_url(value):
    if not isinstance(value, str):
        return None
    try:
        parts = urlsplit(value)
        if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
            return None
        return parts
    except ValueError:
        return None


def page_key(value):
    parts = public_url(value)
    return (parts.hostname.lower().removeprefix("www.") + parts.path.rstrip("/")) if parts else None


def confined(root, path):
    base = root.resolve() / OUTPUT
    if base.resolve() != base:
        raise ValueError("symlinked listing-index namespace refused")
    resolved = path.resolve()
    if not resolved.is_relative_to(base):
        raise ValueError(f"write outside listing-index refused: {path}")
    return resolved


def write(root, path, data, immutable=True):
    target = confined(root, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if immutable and target.exists():
        if target.read_bytes() != data:
            raise ValueError(f"immutable output already exists with different contents: {target}")
    else:
        target.write_bytes(data)


def read_json(path):
    return json.loads(path.read_bytes())


def address_key(value):
    words = {"avenue": "ave", "street": "st", "road": "rd", "drive": "dr",
             "boulevard": "blvd", "lane": "ln", "court": "ct", "place": "pl",
             "north": "n", "south": "s", "east": "e", "west": "w", "suite": "ste",
             "newjersey": "nj", "route": "rt", "rte": "rt", "highway": "hwy"}
    value = re.sub(r"\bnew jersey\b", "nj", str(value or "").lower())
    return tuple(words.get(w, w) for w in re.findall(r"[a-z0-9]+", value))


def name_key(value):
    value = str(value or "")
    return token(value.replace("&", " and "))


def identity_check(provider, identity):
    name = identity.get("name")
    basis = identity.get("nameBasis")
    name_matches = bool(name and (name_key(name) == name_key(provider["name"]) or (
        identity.get("nameConfirmed") is True and isinstance(basis, str) and basis.strip())))
    address = identity.get("address")
    address_matches = bool(address and address_key(address) == address_key(provider["address"]))
    if identity.get("street"):
        expected_street = address_key(provider["address"])
        tail = re.search(r"(?i)\b(New Jersey|NJ)\s+(\d{5}(?:-\d{4})?)\s*$", provider["address"])
        state = provider.get("state") or ("NJ" if tail else None)
        postal = provider.get("zip") or (tail[2] if tail else None)
        if tail:
            expected_street = address_key(provider["address"][:tail.start()])
            suffix = address_key(provider.get("city"))
        else:
            suffix = address_key(" ".join(str(v or "") for v in (provider.get("city"), state, postal)))
        if suffix and expected_street[-len(suffix):] == suffix:
            expected_street = expected_street[:-len(suffix)]
        published_zip = identity.get("zip")
        address_matches = bool(
            expected_street and address_key(identity["street"]) == expected_street and
            address_key(identity.get("city")) and
            address_key(identity.get("city")) == address_key(provider.get("city")) and
            state and address_key(identity.get("state")) == address_key(state) and
            (published_zip is None or (isinstance(published_zip, str) and postal and
             (published_zip == postal or (len(published_zip) == 5 and published_zip == postal[:5])))))
    if identity.get("zip") is not None and not identity.get("street"):
        address_matches = address_matches and identity["zip"] == provider.get("zip")
    scope_matches = bool(identity.get("scopeConfirmed") is True and
                         identity.get("careSetting") == provider["category"] and
                         identity.get("careUnitText") and identity.get("evidence"))
    return {"name": name_matches, "address": address_matches, "scope": scope_matches}


def policy_restricted(source, policies):
    return family(source) in PROHIBITED or any(
        family(p.get("source")) == family(source) and
        p.get("access_decision") != "permitted_low_volume" for p in policies)


def host_restricted(url, policies):
    parts = public_url(url)
    if not parts:
        return False
    host = parts.hostname.lower()
    prohibited_hosts = {"yelp.com", "caring.com", "care-one.com"}
    for assessment in policies:
        if policy_restricted(assessment.get("source"), policies):
            if assessment.get("host"):
                prohibited_hosts.add(assessment["host"].lower().removeprefix("www."))
            for field in ("url", "terms_url", "robots_url"):
                parsed = public_url(assessment.get(field))
                if parsed:
                    prohibited_hosts.add(parsed.hostname.lower().removeprefix("www."))
    return any(host == domain or host.endswith("." + domain) for domain in prohibited_hosts)


def normalized(raw):
    """Adapt retained reviews collector input, not its claimed acceptance status."""
    if not isinstance(raw, dict):
        raise ValueError("each observation must be an object")
    obs = dict(raw)
    if "input" in obs and isinstance(obs["input"], dict):
        obs = dict(obs["input"])
    obs["source"] = obs.get("source") or obs.get("platform")
    if obs["source"] is not None and not isinstance(obs["source"], str):
        raise ValueError("observation source must be a string")
    obs["observedAt"] = obs.get("observedAt") or obs.get("checkedAt")
    obs["url"] = obs.get("canonicalUrl") or obs.get("url")
    obs["status"] = obs.get("status") if obs.get("status") in STATUSES else {
        "observed": "exact", "not-listed": "no_hit", "access-gap": "access_restricted"
    }.get(obs.get("outcome"), "candidate")
    if "rating" in obs and isinstance(obs["rating"], dict):
        rating = obs["rating"]
        obs["aggregate"] = {
            "value": rating.get("value"), "count": rating.get("count"),
            "scale": rating.get("scale"), "asOf": rating.get("asOf"),
            "family": obs.get("sourceFamily"), "scope": obs.get("population"),
            "kind": rating.get("kind"),
        }
    return obs


def retained_observation(raw):
    if str(raw.get("kind") or "").startswith("discovery_search"):
        lead = raw.get("exact_property_lead")
        if isinstance(lead, dict):
            lead = lead.get("url")
        if not isinstance(lead, str):
            lead = None
        return {"official_id": raw.get("official_id"), "source": "MyLivingChoice",
                "status": "candidate" if lead else "unattempted" if raw.get("error") else "no_hit",
                "url": lead, "observedAt": raw.get("checked_at"),
                "method": raw.get("query"), "inspection": "search-snippet"}
    if raw.get("kind") != "property_page_check":
        return raw
    identity, agg = raw.get("identity", {}), raw.get("aggregate") or {}
    setting = {"ASSISTED LIVING RESIDENCE": "assisted-living",
               "LONG TERM CARE FACILITY SNF/NF": "nursing-home"}.get(
                   raw.get("official_type") or raw.get("official_care_unit"))
    confirmed = identity.get("match_result") == "exact_location_single_license"
    families = agg.get("underlying_source_families", [])
    family_name = families[0].get("family") if len(families) == 1 else None
    ambiguity = agg.get("ambiguity")
    scope = "consumer" if ambiguity in {"none_for_unit_identity", "none_observed",
                                        "none_observed_in_displayed_reviews"} else "ambiguous"
    return {"official_id": raw.get("official_id"), "source": raw.get("source", "MyLivingChoice"),
            "status": "exact" if confirmed else "candidate",
            "url": raw.get("canonical_url") or raw.get("requested_url"),
            "observedAt": raw.get("checkedAt") or raw.get("checked_at"),
            "inspection": "full-page" if raw.get("http_status") == 200 else None,
            "sourceType": "review-platform",
            "access": {"decision": raw.get("access_decision") or raw.get("access_basis", {}).get("access_decision")},
            "identity": {"name": identity.get("observed_name"), "street": identity.get("observed_street"),
                         "city": identity.get("observed_city"), "state": identity.get("observed_state"),
                         "zip": identity.get("observed_zip"), "careSetting": setting,
                         "careUnitText": identity.get("observed_care_unit"),
                         "scopeConfirmed": confirmed and identity.get("care_unit_match") is True,
                         "evidence": identity.get("match_reasoning"),
                         "nameConfirmed": confirmed and identity.get("name_match") in (True, "brand_variant"),
                         "nameBasis": identity.get("match_reasoning")},
            "aggregate": {"value": agg.get("rating"), "scale": agg.get("scale"),
                          "count": agg.get("review_count"), "asOf": agg.get("published_as_of"),
                          "family": family_name, "scope": scope, "kind": "consumer-average",
                          "ambiguity": ambiguity}}


def assess(provider, raw, policies, as_of):
    obs = normalized(raw)
    source = obs["source"]
    identity = obs.get("identity") or {}
    checks = identity_check(provider, identity)
    checked = observed_day(obs.get("observedAt"))
    dated = checked is not None and checked <= as_of
    parts = public_url(obs.get("url"))
    listing_url = parts is not None and not (
        parts.path.rstrip("/") in {"/search", "/websearch"} or
        parts.hostname.lower() in {"www.bing.com", "bing.com", "duckduckgo.com"})
    status = obs["status"]
    reasons = []
    if status == "exact" and not (all(checks.values()) and dated and
                                 listing_url and
                                 obs.get("inspection") in {"full-page", "pdf"}):
        status = "candidate"
        reasons.append("Exact requires observed name, complete address, unit/scope, date and direct public page.")
    if status == "no_hit" and not (dated and obs.get("method")):
        status = "unattempted"
        reasons.append("No-hit requires a dated retained search method.")
    restricted = policy_restricted(source, policies) or host_restricted(obs.get("url"), policies) or (
        isinstance(obs.get("access"), dict) and obs["access"].get("decision") in
        {"restricted", "authentication_required", "denied"})
    if restricted:
        status = "access_restricted"
    agg = obs.get("aggregate")
    aggregate = None
    if isinstance(agg, dict):
        declared_family = family(agg.get("family") or agg.get("sourceFamily"))
        platform_family = family(source)
        if platform_family in {"aplaceformom", "caring"}:
            declared_family = platform_family
        aggregate = {"value": agg.get("value", agg.get("rating")), "count": agg.get("count"),
                     "scale": agg.get("scale"), "family": declared_family or None,
                     "asOf": agg.get("asOf"), "scope": agg.get("scope"),
                     "kind": agg.get("kind"), "observedAt": obs.get("observedAt"),
                     "url": obs.get("url")}
    if not restricted and isinstance(obs.get("access"), dict):
        permitted = obs["access"].get("decision") in {"permitted", "permitted_low_volume"}
    else:
        permitted = False
    eligibility_reasons = []
    if status != "exact":
        eligibility_reasons.append("not_exact")
    if not permitted:
        eligibility_reasons.append("access_not_permitted")
    if obs.get("sourceType") not in {"review-platform", "public-discussion"}:
        eligibility_reasons.append("not_consumer_review_source")
    if not aggregate or aggregate["scope"] != "consumer" or aggregate["kind"] != "consumer-average":
        eligibility_reasons.append("not_published_consumer_average")
    if not checked or checked > as_of or (as_of - checked).days > 180:
        eligibility_reasons.append("check_missing_future_or_stale")
    if aggregate:
        snapshot = checked if aggregate["asOf"] is None else day(aggregate["asOf"])
        if not snapshot or not checked or snapshot > checked or (as_of - snapshot).days > 365:
            eligibility_reasons.append("snapshot_invalid_future_or_stale")
        value, scale, count = (aggregate[k] for k in ("value", "scale", "count"))
        if (type(value) not in (int, float) or not math.isfinite(value) or
                type(scale) not in (int, float) or scale not in (5, 10) or not 0 <= value <= scale or
                type(count) is not int or not 1 <= count <= 9007199254740991):
            eligibility_reasons.append("rating_scale_or_count_invalid_or_unknown")
        if not aggregate["family"] or not public_url(aggregate["url"]):
            eligibility_reasons.append("family_or_url_missing")
        if policy_restricted(aggregate["family"], policies):
            eligibility_reasons.append("underlying_family_restricted")
        if aggregate["family"] in {"unknown", "mixed", "mixedfamily", "multiple", "combined"}:
            aggregate["family"] = None
            eligibility_reasons.append("family_or_url_missing")
    return {"source": source, "status": status, "url": obs.get("url"),
            "observedAt": obs.get("observedAt"), "identity": identity,
            "identityChecks": checks, "aggregate": aggregate,
            "matchReasons": reasons, "provenance": obs.get("_provenance"),
            "harborEligibility": {"eligibleAggregate": not eligibility_reasons,
                                  "reasons": eligibility_reasons}}


def eligibility(listings):
    candidates = [x for x in listings if x["harborEligibility"]["eligibleAggregate"]]
    groups = []
    for item in candidates:
        hits = [g for g in groups if any(
            x["aggregate"]["family"] == item["aggregate"]["family"] or
            page_key(x["url"]) == page_key(item["url"]) for x in g)]
        combined = [item]
        for group in hits:
            combined.extend(group)
            groups.remove(group)
        groups.append(combined)
    selected = []
    excluded = []
    for group in groups:
        group.sort(key=lambda x: (
            -(day(x["aggregate"]["asOf"]) or observed_day(x["observedAt"])).toordinal(),
            -observed_day(x["observedAt"]).toordinal(), -x["aggregate"]["count"],
            x["source"], x["aggregate"]["value"], x["url"]))
        selected.append(group[0])
        excluded.extend({"source": x["source"], "url": x["url"], "reason": "shared_family_or_page"}
                        for x in group[1:])
    count = sum(x["aggregate"]["count"] for x in selected)
    rated = count >= 10 and bool(selected)
    weights = [math.sqrt(min(x["aggregate"]["count"], 100)) for x in selected]
    score = None
    if rated:
        value = sum(x["aggregate"]["value"] / x["aggregate"]["scale"] * 10 * w
                    for x, w in zip(selected, weights)) / sum(weights)
        score = math.floor(value * 10 + 0.5) / 10
    return {"methodVersion": "1.0", "eligible": rated, "value": score,
            "reviewCount": count, "independentSourceCount": len(selected),
            "confidence": "unrated" if not rated else "moderate" if len(selected) >= 2 and count >= 30 else "limited",
            "includedSources": [{"source": x["source"], "url": x["url"],
                                 "family": x["aggregate"]["family"]} for x in selected],
            "excludedSources": excluded,
            "reason": None if rated else "At least 10 reported reviews from eligible aggregates are required.",
            "publicationStatus": "private_crosswalk_not_editorial_approval"}


def collect_inputs(root):
    fixed = [REGION / "runtime/providers.json", REGION / "runtime/crosswalk.json",
             REGION / "reviews/source-access.json"]
    paths = [root / p for p in fixed]
    for pattern in ("reviews/**/observations.json", "reviews/runs/*/candidates.json",
                    "reviews/runs/*/roster.json", "reviews/pilot-direct-check.json",
                    "reviews/home-care-direct-checks.json",
                    "listing-index/discovery/**/*.json", "listing-index/cache/*.json",
                    "listing-index/refresh-state.json"):
        paths.extend((root / REGION).glob(pattern))
    return sorted(set(paths))


def pilot_observation(data, crosswalk):
    loc = data["location"]
    ids = {x["providerId"] for x in crosswalk if x.get("officialId") == loc.get("official_id")}
    if len(ids) != 1:
        return None
    direct = data["direct_observation"]
    identity = direct.get("identity", {})
    agg = direct.get("aggregate", {})
    return {
        "providerId": next(iter(ids)), "source": direct["source"], "status": "exact",
        "url": direct.get("canonical_url"), "observedAt": data.get("checked_at"),
        "inspection": direct.get("inspection"), "sourceType": direct.get("source_type"),
        "access": {"decision": direct.get("access_decision")},
        "identity": {"name": identity.get("observed_name"), "street": identity.get("observed_address"),
                     "city": identity.get("observed_city"), "state": "NJ" if identity.get("observed_state") == "New Jersey" else identity.get("observed_state"),
                     "zip": loc.get("postal_code"), "careSetting": "nursing-home",
                     "scopeConfirmed": identity.get("care_unit_match"),
                     "careUnitText": identity.get("observed_care_unit"), "evidence": identity.get("evidence")},
        "aggregate": {"value": agg.get("rating"), "count": agg.get("review_count"),
                      "scale": agg.get("scale"), "family": agg.get("source_family"),
                      "asOf": agg.get("published_as_of"), "scope": agg.get("scope"),
                      "kind": "consumer-average"},
    }


def construct(inputs, as_of, denominator="county-roster", expected_count=None):
    providers = inputs[(REGION / "runtime/providers.json").as_posix()]
    crosswalk = inputs[(REGION / "runtime/crosswalk.json").as_posix()]
    policies = list(inputs[(REGION / "reviews/source-access.json").as_posix()]["sources"])
    stopped = inputs.get((OUTPUT / "refresh-state.json").as_posix(), {}).get("stopped", {})
    policies.extend({"source": source, "access_decision": "refresh_stopped", "internal": True,
                     "host": source if "." in source and " " not in source else None}
                    for source in sorted(stopped))
    ids = [p["id"] for p in providers]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate runtime provider IDs")
    county_rows = {}
    exclusions = []
    for p in providers:
        rows = [r for r in crosswalk if r.get("providerId") == p["id"] and
                r.get("status", "").startswith("included")]
        if not rows:
            raise ValueError(f"provider has no included crosswalk row: {p['id']}")
        roster_rows = [r for r in rows if r["status"] != "included_cms_only"]
        if denominator == "county-roster" and not roster_rows:
            exclusions.append({"providerId": p["id"], "reason": "included_cms_only_not_county_roster"})
            continue
        counties = {r["county"] for r in roster_rows or rows}
        if len(counties) != 1 or not counties.issubset(COUNTIES):
            raise ValueError(f"ambiguous or out-of-region county: {p['id']}")
        county_rows[p["id"]] = (p, next(iter(counties)), rows)
    if expected_count is not None and len(county_rows) != expected_count:
        raise ValueError(f"denominator drift: expected {expected_count}, found {len(county_rows)}")
    observations, discovery, unlinked = [], [], []
    roster_keys = {}
    for path, data in inputs.items():
        if path.endswith("/roster.json") and isinstance(data, dict):
            for row in data.get("locations", data.get("rows", [])):
                if isinstance(row, dict) and row.get("rosterKey"):
                    roster_keys[row["rosterKey"]] = row
    for path, data in sorted(inputs.items()):
        entries = []
        if path.endswith("pilot-direct-check.json"):
            obs = pilot_observation(data, crosswalk)
            entries = [obs] if obs else []
        elif path.endswith("home-care-direct-checks.json"):
            for location in data.get("locations", []):
                entries.append({"official_id": location.get("official_id"), "source": "MyLivingChoice",
                                "observedAt": data.get("checked_at"),
                                "status": "no_hit" if location.get("review_outcome") == "no_exact_MyLivingChoice_listing_discovered" else "unattempted",
                                "method": "; ".join(location.get("queries", []))})
                for url in location.get("discovered_urls", []):
                    if public_url(url) and public_url(url).hostname.endswith("aplaceformom.com"):
                        entries.append({"official_id": location.get("official_id"), "source": "A Place for Mom",
                                        "observedAt": data.get("checked_at"), "status": "candidate", "url": url})
        elif "/discovery/" in path or path.endswith("/observations.json"):
            entries = data if isinstance(data, list) else data.get("observations", [])
            if isinstance(data, dict) and "markdown" in data:
                discovery.append((path, data))
        elif "/cache/" in path and isinstance(data, dict):
            if data.get("source") and data.get("url"):
                discovery.append((path, data))
        elif path.endswith("/candidates.json"):
            for candidate in data:
                source = candidate.get("source", {})
                aggregate = candidate.get("aggregate", {})
                entries.append({
                    "providerId": candidate.get("providerId"), "rosterKey": candidate.get("rosterKey"),
                    "source": aggregate.get("platform"), "url": source.get("url"),
                    "observedAt": source.get("checkedAt"), "status": "candidate",
                    "inspection": source.get("access"), "sourceType": source.get("kind"),
                    "aggregate": {**aggregate, "value": aggregate.get("rating"),
                                  "family": aggregate.get("sourceFamily"), "kind": "consumer-average"},
                })
        for entry in entries:
            obs = normalized(retained_observation(entry))
            obs["_provenance"] = path
            pid = obs.get("providerId")
            if not pid and obs.get("official_id"):
                matching = {r["providerId"] for r in crosswalk if r.get("officialId") == obs["official_id"]}
                pid = next(iter(matching)) if len(matching) == 1 else None
            key = obs.get("rosterKey") or ""
            if not pid and key.startswith("cms-ccn:"):
                matching = {r["providerId"] for r in crosswalk if r.get("cmsCcn") == key.split(":", 1)[1]}
                pid = next(iter(matching)) if len(matching) == 1 else None
            if not pid and key:
                row = roster_keys.get(key, {})
                official = key.split(":", 1)[-1]
                matching = {r["providerId"] for r in crosswalk if r.get("officialId") == official}
                pid = row.get("providerId") or (next(iter(matching)) if len(matching) == 1 else None)
            if pid not in county_rows or not obs.get("source"):
                unlinked.append({"path": path, "observation": entry,
                                 "reason": "missing_or_out_of_denominator_provider_or_source"})
            else:
                obs["providerId"] = pid
                observations.append(obs)
    sources = sorted(set(DEFAULT_SOURCES + [p["source"] for p in policies if not p.get("internal")] +
                         [o["source"] for o in observations] +
                         [d.get("source", "MyLivingChoice") for _, d in discovery]))
    discoveries = []
    for path, data in discovery:
        urls = set(re.findall(r"https://www\.mylivingchoice\.com/property/[a-z0-9-]+?(?=\d{4}-\d{2}-\d{2}T|[^a-z0-9-]|$)", data.get("markdown", "")))
        if data.get("url"):
            urls.add(data["url"])
        discoveries.extend((path, data, url, token(urlsplit(url).path.rsplit("/", 1)[-1]))
                           for url in sorted(urls))
    records = []
    for pid, (provider, county, rows) in sorted(county_rows.items(), key=lambda item: (
            COUNTIES.index(item[1][1]), name_key(item[1][0]["name"]), item[0])):
        own = [assess(provider, o, policies, as_of) for o in observations if o["providerId"] == pid]
        key = name_key(provider["name"])
        for path, data, url, slug in discoveries:
            if len(key) >= 8 and (slug == key or key in slug):
                own.append(assess(provider, {
                    "source": data.get("source", "MyLivingChoice"),
                    "status": "access_restricted" if data.get("status") == "access_restricted" else "candidate",
                    "url": url, "observedAt": data.get("retrievedAt", data.get("observedAt")),
                    "_provenance": path,
                }, policies, as_of))
        source_rows = []
        for source in sources:
            listings = [o for o in own if o["source"] == source]
            restricted = policy_restricted(source, policies)
            status = "access_restricted" if restricted else next(
                (s for s in ("exact", "candidate", "access_restricted", "no_hit")
                 if any(o["status"] == s for o in listings)), "unattempted")
            source_rows.append({"source": source, "status": status, "listings": listings})
        records.append({"providerId": pid, "name": provider["name"], "address": provider["address"],
                        "county": county, "category": provider["category"],
                        "locationKind": provider.get("locationKind"), "rosterEvidence": rows,
                        "sources": source_rows, "harborEligibility": eligibility(own)})
    county_roster_ids = {r["providerId"] for r in crosswalk
                         if r.get("status", "").startswith("included") and r["status"] != "included_cms_only"}
    roster_count = len(county_roster_ids.intersection(ids))
    roster_summary = {
        "historicalCountyRosterBaseline": 942, "actualCountyRosterCount": roster_count,
        "differenceFromBaseline": roster_count - 942, "assertedExpectedCount": expected_count,
        "sources": [{"path": path, "count": len(inputs[path]),
                     "canonicalJsonSha256": digest(encoded(inputs[path]))}
                    for path in ((REGION / "runtime/providers.json").as_posix(),
                                 (REGION / "runtime/crosswalk.json").as_posix())]}
    return {"schemaVersion": 1, "asOf": as_of.isoformat(), "denominator": denominator,
            "rosterSummary": roster_summary,
            "providerCount": len(records), "countyOrder": COUNTIES, "sources": sources,
            "countyCounts": dict(Counter(r["county"] for r in records)),
            "excludedRuntimeProviders": exclusions, "unlinkedEvidence": unlinked,
            "providers": records}


def build(root, as_of, denominator, expected_count, dry_run=False):
    paths = collect_inputs(root)
    inputs, retained, raw_inputs, raw_observations = {}, [], {}, []
    for path in paths:
        relative = path.relative_to(root).as_posix()
        raw = path.read_bytes()
        inputs[relative] = json.loads(raw)
        raw_inputs[relative] = raw
        retained.append({"path": relative, "sha256": digest(raw), "bytes": len(raw)})
        if "/cache/" in relative:
            cached = inputs[relative]
            body = (root / OUTPUT / "raw" / cached["sha256"]).read_bytes()
            if digest(body) != cached["sha256"] or len(body) != cached["bytes"]:
                raise ValueError(f"cached raw hash mismatch: {relative}")
            raw_observations.append({"sha256": cached["sha256"], "bytes": cached["bytes"]})
    result = construct(inputs, as_of, denominator, expected_count)
    if dry_run:
        return result
    tool_hash = digest(Path(__file__).read_bytes())
    manifest = {"schemaVersion": 1, "asOf": as_of.isoformat(), "denominator": denominator,
                "expectedCount": expected_count, "inputs": retained, "toolSha256": tool_hash,
                "rosterSummary": result["rosterSummary"],
                "rawObservations": raw_observations, "crosswalkSha256": digest(encoded(result))}
    run_id = f"{as_of.isoformat()}-{digest(encoded(manifest))[:12]}"
    run = root / OUTPUT / "runs" / run_id
    for item in retained:
        write(root, root / OUTPUT / "raw" / item["sha256"], raw_inputs[item["path"]])
    write(root, run / "crosswalk.json", encoded(result))
    write(root, run / "manifest.json", encoded(manifest))
    return {"runDir": run.relative_to(root).as_posix(), "providerCount": result["providerCount"],
            "countyCounts": result["countyCounts"], "crosswalkSha256": manifest["crosswalkSha256"]}


def verify(root, run):
    run = confined(root, run)
    manifest = read_json(run / "manifest.json")
    if digest(Path(__file__).read_bytes()) != manifest["toolSha256"]:
        raise ValueError("tool hash changed; rebuild with current script")
    inputs = {}
    for item in manifest.get("rawObservations", []):
        raw = (root / OUTPUT / "raw" / item["sha256"]).read_bytes()
        if digest(raw) != item["sha256"] or len(raw) != item["bytes"]:
            raise ValueError("cached raw observation hash mismatch")
    for item in manifest["inputs"]:
        raw = (root / OUTPUT / "raw" / item["sha256"]).read_bytes()
        if digest(raw) != item["sha256"] or len(raw) != item["bytes"]:
            raise ValueError(f"retained input hash mismatch: {item['path']}")
        inputs[item["path"]] = json.loads(raw)
    rebuilt = construct(inputs, day(manifest["asOf"]), manifest["denominator"], manifest["expectedCount"])
    actual = (run / "crosswalk.json").read_bytes()
    if actual != encoded(rebuilt) or digest(actual) != manifest["crosswalkSha256"]:
        raise ValueError("crosswalk does not reproduce from retained inputs")
    return {"verified": True, "providerCount": rebuilt["providerCount"],
            "crosswalkSha256": digest(actual)}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class VisibleHTML(HTMLParser):
    blocks = {"address", "article", "aside", "blockquote", "br", "div", "dl", "dt",
              "dd", "footer", "header", "hr", "li", "main", "nav", "ol", "p",
              "section", "table", "tr", "td", "th", "ul"}
    voids = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
             "meta", "param", "source", "track", "wbr"}

    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.parts, self.hidden, self.links = url, [], [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        hidden = (tag in {"script", "style", "head", "template", "noscript"} or
                  "hidden" in attrs or attrs.get("aria-hidden") == "true" or
                  bool(re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", attrs.get("style", ""), re.I)))
        if self.hidden or hidden:
            if tag not in self.voids:
                self.hidden.append(tag)
            return
        if re.fullmatch(r"h[1-6]", tag):
            self.parts.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag in self.blocks:
            self.parts.append("\n")
        elif tag == "a":
            href = urljoin(self.url, attrs.get("href") or "")
            self.links.append(href if public_url(href) else None)
            self.parts.append("[")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.voids:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.hidden:
            if tag in self.hidden:
                del self.hidden[len(self.hidden) - 1 - self.hidden[::-1].index(tag):]
            return
        if tag == "a" and self.links:
            href = self.links.pop()
            self.parts.append(f"]({href})" if href else "]")
        elif tag in self.blocks or re.fullmatch(r"h[1-6]", tag):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(re.sub(r"\s+", " ", data))

    def markdown(self):
        text = "".join(self.parts)
        text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
        return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"


def materialize_page(root, item, raw):
    """Retain only visible public content, with the raw observation's provenance."""
    root = root.resolve()
    if item.get("httpStatus") != 200 or item.get("status") == "access_restricted":
        return None
    url = item["url"]
    parts = public_url(url)
    if not parts:
        raise ValueError("invalid cached page URL")
    parser = VisibleHTML(url)
    parser.feed(raw.decode("utf-8", errors="replace"))
    parser.close()
    slug = parts.path.rstrip("/").rsplit("/", 1)[-1]
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        slug = digest(url.encode())
    target = confined(root, root / OUTPUT / "discovery/pages" / f"{slug}.json")
    if target.exists():
        existing = read_json(target)
        if page_key(existing.get("effectiveUrl") or existing.get("url")) != page_key(url):
            target = target.with_name(f"{slug}-{digest(url.encode())[:12]}.json")
        elif not existing.get("materializedFrom"):
            return target.relative_to(root).as_posix()
    page = {"url": url, "effectiveUrl": url, "retrievedAt": item["observedAt"],
            "source": item["source"], "markdown": parser.markdown(),
            "metadata": {"statusCode": 200},
            "materializedFrom": {"rawSha256": item["sha256"], "bytes": item["bytes"]}}
    write(root, target, encoded(page), immutable=False)
    return target.relative_to(root).as_posix()


def cached_raw(root, item):
    if not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))):
        raise ValueError("cache identity or hash metadata mismatch")
    raw = (root / OUTPUT / "raw" / item["sha256"]).read_bytes()
    if digest(raw) != item["sha256"] or len(raw) != item.get("bytes"):
        raise ValueError("cached raw hash mismatch")
    return raw


def materialize(root):
    pages = []
    for path in sorted((root / OUTPUT / "cache").glob("*.json")):
        item = read_json(path)
        page = materialize_page(root, item, cached_raw(root, item))
        if page:
            pages.append(page)
    return {"pages": pages}


def retained_public_checks(root, today):
    checks = {}
    paths = sorted((root / OUTPUT / "discovery").glob("**/*.json"))
    paths += sorted((root / REGION / "reviews").glob("**/observations.json"))
    pilot = root / REGION / "reviews/pilot-direct-check.json"
    if pilot.exists():
        paths.append(pilot)
    for path in paths:
        data = read_json(path)
        entries = data if isinstance(data, list) else data.get("observations", [])
        if isinstance(data, dict) and "markdown" in data:
            status = data.get("metadata", {}).get("statusCode", data.get("statusCode"))
            if status in (None, 200) and data.get("markdown", "").strip() and not re.search(
                    r"captcha|verify you are human|access denied|sign.in required",
                    data["markdown"][:2000], re.I):
                entries = [data]
        elif isinstance(data, dict) and "direct_observation" in data:
            entries = [{**data["direct_observation"], "observedAt": data.get("checked_at")}]
        for entry in entries:
            url = (entry.get("effectiveUrl") or entry.get("canonical_url") or
                   entry.get("canonicalUrl") or entry.get("url"))
            checked = entry.get("retrievedAt") or entry.get("observedAt") or entry.get("checked_at")
            observed = observed_day(checked)
            source = entry.get("source") or ("MyLivingChoice" if public_url(url) and
                     public_url(url).hostname == "www.mylivingchoice.com" else None)
            full = ("markdown" in entry or entry.get("http_status") == 200 or
                    entry.get("inspection") == "full-page")
            access = entry.get("access", {})
            decision = access.get("decision") if isinstance(access, dict) else None
            decision = decision or entry.get("access_decision")
            if (page_key(url) and source and observed and observed <= today and full and
                    entry.get("status") != "access_restricted" and
                    not entry.get("pageAccess", {}).get("restricted") and
                    entry.get("pageAccess", {}).get("samePage") is not False and
                    decision not in {"restricted", "authentication_required", "denied"}):
                checks[(source, page_key(url))] = {
                    "source": source, "url": url, "observedAt": checked,
                    "status": "candidate", "retainedPage": path.relative_to(root).as_posix(),
                    "retainedSha256": digest(path.read_bytes()), "cacheReused": True}
    return checks


def fetch_permission(source, url, policy, retained, allowlist, today):
    if source not in allowlist:
        return "source_not_allowlisted"
    if policy_restricted(source, retained) or policy_restricted(policy.get("family"), retained):
        return "prohibited_source_or_family"
    if not isinstance(policy.get("family"), str) or not policy["family"].strip():
        return "source_family_missing"
    checked = day(policy.get("checkedAt"))
    if not checked or not 0 <= (today - checked).days <= 30:
        return "policy_missing_future_or_stale"
    if not (policy.get("termsAllowed") is True and policy.get("robotsAllowed") is True and
            policy.get("basis") and public_url(policy.get("termsUrl")) and public_url(policy.get("robotsUrl"))):
        return "terms_or_robots_permission_missing"
    parts = public_url(url)
    if not parts or parts.scheme != "https" or parts.port not in (None, 443):
        return "public_https_required"
    host = parts.hostname.lower()
    if host not in policy.get("hosts", []) or host == "localhost" or host.endswith(".local"):
        return "host_not_permitted"
    try:
        if not ipaddress.ip_address(host).is_global:
            return "non_public_address"
    except ValueError:
        pass
    if host_restricted(url, retained):
        return "prohibited_host"
    if any(part in {".", ".."} for part in unquote(parts.path).split("/")):
        return "path_traversal_not_permitted"
    if not any(parts.path.startswith(prefix) for prefix in policy.get("allowedPaths", []) if prefix.startswith("/")):
        return "path_not_permitted"
    robots = RobotFileParser()
    if not isinstance(policy.get("robotsText"), str) or not policy["robotsText"].strip():
        return "robots_evidence_missing"
    robots.parse(policy["robotsText"].splitlines())
    if not all(robots.can_fetch(agent, url) for agent in (USER_AGENT, "GPTBot", "ChatGPT-User", "OAI-SearchBot")):
        return "robots_disallow"
    return None


def refresh(root, requests, policies, allowlist, interval=10, opener=None, clock=time.time, sleep=time.sleep,
            revalidate=False, retry_transport=False):
    if not math.isfinite(interval) or interval < 10:
        raise ValueError("minimum interval is 10 seconds")
    retained = read_json(root / REGION / "reviews/source-access.json")["sources"]
    opener = opener or build_opener(NoRedirect())
    today = datetime.fromtimestamp(clock(), timezone.utc).date()
    state_path = confined(root, root / OUTPUT / "refresh-state.json")
    state = read_json(state_path) if state_path.exists() else {"stopped": {}, "lastRequest": {}}
    if retry_transport:
        selected = {policy["source"] for policy in policies if policy["source"] in allowlist}
        hosts = {host for policy in policies if policy["source"] in selected for host in policy["hosts"]}
        state["stopped"] = {key: reason for key, reason in state["stopped"].items()
                            if key not in selected | hosts or not reason.startswith("transport_error:")}
    results = []
    public_checks = retained_public_checks(root, today) if not revalidate else {}
    seen = {}
    for request in requests:
        source, url = request["source"], request["url"]
        policy = next((p for p in policies if p.get("source") == source), {})
        reason = fetch_permission(source, url, policy, retained, allowlist, today)
        parts = public_url(url)
        host = parts.hostname if parts else ""
        if reason:
            results.append({"source": source, "url": url, "status": "access_restricted", "reason": reason})
            continue
        if source in state["stopped"] or host in state["stopped"]:
            results.append({"source": source, "url": url, "status": "access_restricted", "reason": "source_or_host_stopped"})
            continue
        key = (source, page_key(url))
        if key in seen:
            results.append({**seen[key], "cacheReused": True})
            continue
        cache = root / OUTPUT / "cache" / (digest(url.encode()) + ".json")
        cached = read_json(cache) if cache.exists() and not revalidate else None
        if cached and not (retry_transport and (cached.get("reason") or "").startswith("transport_error:")):
            item = cached
            if (item.get("source") != source or item.get("url") != url or
                    not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", "")))):
                raise ValueError("cache identity or hash metadata mismatch")
            raw = cached_raw(root, item)
            page = materialize_page(root, item, raw)
            seen[key] = {**item, "cacheReused": True, "retainedPage": page}
            results.append(seen[key])
            continue
        if key in public_checks:
            seen[key] = public_checks[key]
            results.append(seen[key])
            continue
        robots = RobotFileParser()
        robots.parse(policy["robotsText"].splitlines())
        crawl_delay = robots.crawl_delay(USER_AGENT) or 0
        request_rate = robots.request_rate(USER_AGENT)
        rate_delay = request_rate.seconds / request_rate.requests if request_rate else 0
        delay = policy.get("minIntervalSeconds", 10)
        if type(delay) not in (int, float) or not math.isfinite(delay) or delay < 0:
            raise ValueError("invalid policy minimum interval")
        gap = max(interval, delay, crawl_delay, rate_delay)
        last = max(state["lastRequest"].get(source, 0), state["lastRequest"].get(host, 0))
        remaining = gap - (clock() - last)
        if remaining > 0:
            sleep(remaining)
        state["lastRequest"][source] = state["lastRequest"][host] = clock()
        status, raw = 0, b""
        try:
            with opener.open(Request(url, headers={"User-Agent": USER_AGENT}), timeout=30) as response:
                status = response.status
                raw = response.read(MAX_BYTES + 1)
        except HTTPError as exc:
            status = exc.code
            try:
                raw = exc.read(MAX_BYTES + 1)
            except (URLError, TimeoutError, OSError):
                raw = b""
        except (URLError, TimeoutError, OSError) as exc:
            reason = f"transport_error: {type(exc).__name__}"
        challenge = bool(re.search(rb"captcha|verify you are human|cf-chl-|access denied|sign.in required|just a moment|checking your browser|sign in to continue", raw.lower()))
        stop = reason is not None or status != 200 or challenge or len(raw) > MAX_BYTES
        if stop:
            reason = reason or ("challenge_or_oversize" if challenge or len(raw) > MAX_BYTES else f"http_{status}")
            state["stopped"][source] = state["stopped"][host] = reason
        observed_at = datetime.fromtimestamp(clock(), timezone.utc).isoformat()
        item = {"source": source, "url": url, "observedAt": observed_at,
                "httpStatus": status, "sha256": digest(raw), "bytes": len(raw),
                "status": "access_restricted" if stop else "candidate",
                "reason": reason, "policySha256": digest(encoded(policy))}
        write(root, root / OUTPUT / "raw" / item["sha256"], raw)
        write(root, root / OUTPUT / "cache/history" / (digest(encoded(item)) + ".json"), encoded(item))
        write(root, cache, encoded(item), immutable=False)
        write(root, state_path, encoded(state), immutable=False)
        item["retainedPage"] = materialize_page(root, item, raw)
        seen[key] = item
        results.append(item)
    return {"results": results, "stopped": state["stopped"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("build", "verify", "refresh", "materialize"):
        command = sub.add_parser(name)
        command.add_argument("--root", type=Path, default=ROOT)
        if name == "build":
            command.add_argument("--as-of", required=True)
            command.add_argument("--denominator", choices=["county-roster", "runtime"], default="county-roster")
            command.add_argument("--expected-count", type=int)
            command.add_argument("--dry-run", action="store_true")
        elif name == "verify":
            command.add_argument("--run", type=Path, required=True)
        elif name == "refresh":
            command.add_argument("--retry-transport", action="store_true",
                                 help="Retry after a repaired local connection; preserve server or access-policy stops")
            command.add_argument("--requests", type=Path, required=True)
            command.add_argument("--policy", type=Path, required=True)
            command.add_argument("--allow-source", action="append", required=True)
            command.add_argument("--min-interval", type=float, default=10)
            command.add_argument("--revalidate", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        if args.command == "build":
            as_of = day(args.as_of)
            if not as_of:
                raise ValueError("--as-of must be YYYY-MM-DD")
            result = build(root, as_of, args.denominator, args.expected_count, args.dry_run)
        elif args.command == "verify":
            result = verify(root, args.run.resolve())
        elif args.command == "materialize":
            result = materialize(root)
        else:
            result = refresh(root, read_json(args.requests)["requests"],
                             read_json(args.policy)["sources"], args.allow_source, args.min_interval,
                             revalidate=args.revalidate, retry_transport=args.retry_transport)
        print(encoded(result).decode(), end="")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f"listing-index: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
