#!/usr/bin/env python3
"""Offline, read-only validation and an isolated public-link merge proof."""

import argparse
from copy import deepcopy
from datetime import date, datetime
import json
from pathlib import Path
import re
from urllib.parse import parse_qsl, unquote, urlsplit


BASE = Path(__file__).resolve().parent
COUNTIES = {"Bergen", "Essex", "Hudson", "Morris", "Passaic", "Union"}
RECORD_FIELDS = {
    "catalogAddress", "officialRegistrationId", "officeName", "county",
    "checkedAt", "identity", "reviewLinks",
}
IDENTITY_FIELDS = {
    "recordId", "recordsFile", "checkedAt", "registeredAddress", "observedAddress",
    "registeredCity", "registeredState", "registeredZip",
}
LINK_FIELDS = {"publisher", "url", "originalUrl", "discoveryReceipt", "identityBasis"}
RESTRICTED_HOSTS = {"caring.com", "care-one.com", "seniorcare.com", "yelp.com"}
CONTENT_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:/\s*5|out of\s*5|stars?\b|reviews?\b|ratings?\b)"
    r"|\b(?:rated|rating|score)\s*[:=]?\s*\d", re.I,
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, label):
    require(isinstance(value, str) and bool(value.strip()), f"{label} must be nonempty text")
    return value


def metadata(value, label):
    text(value, label)
    require(not CONTENT_PATTERN.search(value), f"{label} contains numeric review content")


def shape(value, required, optional, label):
    require(isinstance(value, dict), f"{label} must be an object")
    require(required <= value.keys(), f"{label} is missing required fields")
    require(value.keys() <= required | optional, f"{label} contains unsupported fields")


def checked_date(value, label):
    text(value, label)
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            result = date.fromisoformat(value)
        else:
            require("T" in value, f"{label} must be an ISO date")
            result = datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        raise ValueError(f"{label} must be an ISO date") from None
    require(result <= date.today(), f"{label} cannot be in the future")
    return result


def public_url(value):
    text(value, "URL")
    require(not any(c.isspace() or ord(c) < 32 for c in value), "URL contains whitespace")
    try:
        parsed = urlsplit(value)
        require(parsed.scheme in {"http", "https"} and bool(parsed.hostname),
                "URL must use HTTP(S) with a host")
        require(parsed.username is None and parsed.password is None,
                "URL must not contain credentials")
        parsed.port
    except ValueError:
        raise ValueError("URL must be a public HTTP(S) URL without credentials") from None
    for key, _ in parse_qsl(parsed.query, keep_blank_values=True):
        key = re.sub(r"[^a-z0-9]", "", unquote(key).lower())
        require(not any(part in key for part in (
            "key", "token", "secret", "password", "passwd", "credential",
            "authorization", "signature", "session", "email",
        )), "URL contains a secret query parameter")
    require(not re.search(r"(?:token|secret|password|api[_-]?key)=", parsed.fragment, re.I),
            "URL contains a secret fragment")
    return value


def canonical_url(original):
    """Return only a Google destination whose identifier is retained in the URL."""
    parsed = urlsplit(public_url(original))
    if parsed.scheme != "https" or parsed.fragment:
        return original
    pairs = parse_qsl(parsed.query, keep_blank_values=True)
    query = dict(pairs)
    if len(query) != len(pairs):
        return original
    if (parsed.netloc == "search.google.com" and parsed.path == "/local/writereview"
            and query.keys() == {"placeid"}
            and re.fullmatch(r"[A-Za-z0-9_-]+", query["placeid"])):
        return ("https://www.google.com/maps/search/?api=1&query=Home%20care"
                f"&query_place_id={query['placeid']}")
    if (parsed.netloc == "www.google.com"
            and parsed.path.startswith("/maps/reviews/data=") and not parsed.query):
        cids = re.findall(r"!1s0x0:0x([0-9a-fA-F]{1,16})(?=!|$)", unquote(parsed.path))
        if len(cids) == 1:
            return f"https://maps.google.com/?cid={int(cids[0], 16)}"
    if (parsed.netloc == "maps.google.com" and parsed.path == "/"
            and "cid" in query and query.keys() <= {"cid", "g_mp", "hl", "gl", "source"}
            and re.fullmatch(r"[0-9]+", query["cid"])):
        return f"https://maps.google.com/?cid={query['cid']}"
    return original


def read_json(path):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "JSON contains a duplicate key")
            result[key] = value
        return result
    return json.loads(Path(path).read_text(), object_pairs_hook=unique_pairs)


def relative_file(base, value, allowed):
    text(value, "file reference")
    relative = Path(value)
    require(not relative.is_absolute(), "file reference must be relative")
    path = (base / relative).resolve()
    if value.startswith("research/"):
        path = (base.parents[2] / relative).resolve()
    require(path.is_relative_to(allowed.resolve()) and path.suffix == ".json",
            "file reference escapes its evidence directory")
    require(path.is_file(), "referenced JSON file is missing")
    return path


def reviewed_identities(catalog, reviewed):
    require(isinstance(catalog, dict) and isinstance(reviewed, dict),
            "catalog and reviewed must be provider-keyed objects")
    seen = set()
    for provider_id, row in reviewed.items():
        text(provider_id, "provider ID")
        shape(row, RECORD_FIELDS, set(), "reviewed record")
        office = catalog.get(provider_id)
        require(isinstance(office, dict) and office.get("category") == "home-care",
                f"{provider_id}: exact home-care catalog record required")
        for field, catalog_field in (
            ("catalogAddress", "address"),
            ("officialRegistrationId", "officialRegistrationId"),
            ("county", "county"),
        ):
            text(row[field], field)
            require(row[field] == office.get(catalog_field),
                    f"{provider_id}: {field} differs from catalog")
        require(row["county"] in COUNTIES, f"{provider_id}: unsupported office county")
        text(row["officeName"], "officeName")
        checked_date(row["checkedAt"], "checkedAt")
        identity = row["identity"]
        shape(identity, IDENTITY_FIELDS, set(), "identity")
        for field in IDENTITY_FIELDS:
            text(identity[field], f"identity.{field}")
        require(" ".join(identity["registeredAddress"].split()) == row["catalogAddress"],
                f"{provider_id}: registered address differs from catalog")
        require(checked_date(identity["checkedAt"], "identity.checkedAt")
                <= checked_date(row["checkedAt"], "checkedAt"),
                "office identity cannot postdate link check")
        require(isinstance(row["reviewLinks"], list), "reviewLinks must be an array")
        for link in row["reviewLinks"]:
            shape(link, LINK_FIELDS, set(), "reviewLink")
            for field in ("publisher", "identityBasis", "discoveryReceipt"):
                metadata(link[field], field)
            urls = {public_url(link["originalUrl"]), public_url(link["url"])}
            require(link["url"] in {link["originalUrl"], canonical_url(link["originalUrl"])},
                    "review URL must equal originalUrl or its verified canonical destination")
            require(not seen.intersection(urls), "duplicate review URL")
            seen.update(urls)


def merge_links(records, catalog, reviewed):
    """Merge already receipt-validated links, without I/O or changing old decisions."""
    require(isinstance(records, dict), "records must be a location-research map")
    reviewed_identities(catalog, reviewed)
    result = deepcopy(records)
    for provider_id, row in reviewed.items():
        record = result.setdefault(provider_id, {
            "providerId": provider_id, "sources": [], "reviews": [], "reviewLinks": [],
        })
        require(isinstance(record, dict) and record.get("providerId") == provider_id,
                "existing research identity differs from map key")
        links = record.setdefault("reviewLinks", [])
        require(isinstance(links, list), "existing reviewLinks must be an array")
        seen = {link["url"] for link in links}
        for link in row["reviewLinks"]:
            if link["url"] not in seen:
                links.append({field: link[field] for field in ("publisher", "url")})
                seen.add(link["url"])
    return result


def restricted_hosts(base):
    hosts = set(RESTRICTED_HOSTS)
    policy = base.parent / "reviews/source-access.json"
    if policy.exists():
        for source in read_json(policy)["sources"]:
            if not source.get("access_decision", "").startswith(
                ("restricted", "excluded", "disabled", "authentication")
            ):
                continue
            for field in ("host", "url", "terms_url", "robots_url"):
                value = source.get(field, "")
                host = value if field == "host" else urlsplit(value).hostname
                if host:
                    hosts.add(host.lower().rstrip(".").removeprefix("www."))
    return hosts


def receipt_urls(receipt, denied):
    require(isinstance(receipt, dict), "discovery receipt must be an object")
    if "results" in receipt:
        shape(receipt, {"results"}, {"query", "checkedAt"}, "search receipt")
        entries, label = receipt["results"], "title"
        if "query" in receipt:
            metadata(receipt["query"], "query")
    else:
        shape(receipt, {"url", "checkedAt", "officeAddress", "links"},
              {"effectiveUrl", "identityReference", "addressEvidenceSource"}, "first-party receipt")
        for key in ("identityReference", "addressEvidenceSource"):
            if key in receipt:
                metadata(receipt[key], key)
        for key in ("url", "effectiveUrl"):
            if key in receipt:
                host = urlsplit(public_url(receipt[key])).hostname.lower().rstrip(".")
                require(not any(host == h or host.endswith("." + h) for h in denied),
                        "restricted publisher pages must remain link-only")
        text(receipt["officeAddress"], "officeAddress")
        entries, label = receipt["links"], "label"
    if "checkedAt" in receipt:
        checked_date(receipt["checkedAt"], "receipt.checkedAt")
    require(isinstance(entries, list), "receipt entries must be an array")
    urls = set()
    for entry in entries:
        shape(entry, {"url", label}, set(), "receipt entry")
        public_url(entry["url"])
        require(isinstance(entry[label], str), f"{label} must be text")
        if entry[label]:
            metadata(entry[label], label)
            require(not entry[label].strip().isdigit(), "receipt contains a review count")
        require(entry["url"] not in urls, "duplicate receipt URL")
        urls.add(entry["url"])
    return urls


def validate_coverage(coverage, catalog, reviewed):
    require(isinstance(coverage, list), "coverage must be an array")
    seen = set()
    for entry in coverage:
        shape(entry, {"providerId", "status", "queries", "acceptedUrls",
                      "withheldCandidates", "reason"}, {"county"}, "coverage entry")
        provider_id = entry["providerId"]
        text(provider_id, "coverage.providerId")
        require(provider_id not in seen, "duplicate coverage provider")
        seen.add(provider_id)
        office = catalog.get(provider_id)
        require(isinstance(office, dict) and office.get("category") == "home-care"
                and office.get("county") in COUNTIES,
                "coverage must reference a catalog home-care office")
        if "county" in entry:
            require(entry["county"] == office["county"], "coverage county differs from office")
        for field in ("status", "reason"):
            metadata(entry[field], field)
        for field in ("queries", "acceptedUrls", "withheldCandidates"):
            require(isinstance(entry[field], list), f"coverage.{field} must be an array")
        for query in entry["queries"]:
            metadata(query, "coverage query")
        accepted = entry["acceptedUrls"]
        for url in accepted:
            public_url(url)
        require(len(set(accepted)) == len(accepted), "duplicate accepted URL")
        expected = [link["url"] for link in reviewed.get(provider_id, {}).get("reviewLinks", [])]
        require(set(accepted) == set(expected), "coverage accepted URLs differ from reviewed links")
        for candidate in entry["withheldCandidates"]:
            shape(candidate, {"url", "reason"}, {"publisher", "originalUrl"}, "withheld candidate")
            public_url(candidate["url"])
            require(candidate["url"] not in accepted, "accepted URL is also withheld")
            metadata(candidate["reason"], "withheld reason")
            if "publisher" in candidate:
                metadata(candidate["publisher"], "withheld publisher")
            if "originalUrl" in candidate:
                public_url(candidate["originalUrl"])
    require(reviewed.keys() <= seen, "reviewed provider has no coverage entry")


def validate(base=BASE, catalog=None):
    """Return a JSON-safe report. Read local evidence only and write nothing."""
    base = Path(base).resolve()
    try:
        if catalog is None:
            providers = read_json(base.parent / "runtime/providers.json")
            crosswalk = read_json(base.parent / "runtime/crosswalk.json")
            identities = {}
            for row in crosswalk:
                if row.get("providerId") and row.get("status", "").startswith("included"):
                    pid = row["providerId"]
                    identity = (row["officialId"], row["county"])
                    require(pid not in identities or identities[pid] == identity,
                            "conflicting catalog crosswalk identity")
                    identities[pid] = identity
            catalog = {}
            for row in providers:
                pid = row["id"]
                require(pid not in catalog, "duplicate catalog provider")
                official_id, county = identities.get(pid, (None, None))
                catalog[pid] = {**row, "officialRegistrationId": official_id, "county": county}
        reviewed = read_json(base / "review-links.json")
        reviewed_identities(catalog, reviewed)
        denied = restricted_hosts(base)
        receipts = {}
        for path in sorted((base / "discovery").rglob("*.json")):
            require(path.resolve().is_relative_to((base / "discovery").resolve()),
                    "discovery receipt escapes its evidence directory")
            receipts[path.resolve()] = receipt_urls(read_json(path), denied)
        for provider_id, row in reviewed.items():
            identity = row["identity"]
            path = relative_file(base, identity["recordsFile"], base.parent / "home-care-first-party")
            require(path == (base.parent / "home-care-first-party/records.json").resolve(),
                    "identity must reference retained first-party records.json")
            first_party = read_json(path)
            require(isinstance(first_party, list), "first-party records must be an array")
            matches = [r for r in first_party if isinstance(r, dict)
                       and r.get("record_id") == identity["recordId"]]
            require(len(matches) == 1, "exact first-party record ID is missing or duplicated")
            record = matches[0]
            for actual, expected, label in (
                (record.get("provider_id"), provider_id, "provider_id"),
                (record.get("official_registration_id"), row["officialRegistrationId"], "registration"),
                (record.get("county"), row["county"], "county"),
                (record.get("registered_address"), identity["registeredAddress"], "registered address"),
                (record.get("registered_city"), identity["registeredCity"], "registered city"),
                (record.get("registered_state"), identity["registeredState"], "registered state"),
                (record.get("registered_zip"), identity["registeredZip"], "registered ZIP"),
                (record.get("observed_address"), identity["observedAddress"], "observed address"),
                (record.get("checked_at"), identity["checkedAt"], "identity date"),
            ):
                require(actual == expected, f"first-party {label} differs from reviewed identity")
            require(" ".join(record["registered_address"].split()) == row["catalogAddress"],
                    f"{provider_id}: first-party registered address differs from catalog")
            for link in row["reviewLinks"]:
                path = relative_file(base, link["discoveryReceipt"], base / "discovery")
                if path not in receipts:
                    receipts[path] = receipt_urls(read_json(path), denied)
                require(link["originalUrl"] in receipts[path],
                        "originalUrl must occur in the discovery receipt")
        validate_coverage(read_json(base / "coverage.json"), catalog, reviewed)
        merged = merge_links({}, catalog, reviewed)
        return {"valid": True, "errors": [], "providers": len(reviewed),
                "links": sum(len(r["reviewLinks"]) for r in reviewed.values()),
                "emptyMapProviders": len(merged), "discoveryReceipts": len(receipts)}
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError) as exc:
        message = str(exc) if isinstance(exc, ValueError) and not isinstance(
            exc, json.JSONDecodeError
        ) else f"unreadable or malformed input ({type(exc).__name__})"
        return {"valid": False, "errors": [message]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=BASE,
                        help="Directory containing review-links.json, coverage.json and discovery/")
    parser.add_argument("--write-portal", action="store_true", help="Rebuild the compact public profile-link projection")
    args = parser.parse_args()
    report = validate(args.directory)
    if report["valid"]:
        reviewed = read_json(args.directory / "review-links.json")
        links = [{"providerId": pid, "publisher": link["publisher"], "url": link["url"],
                  "checkedAt": row["checkedAt"], "catalogAddress": row["catalogAddress"]}
                 for pid, row in sorted(reviewed.items()) for link in row["reviewLinks"]]
        projection = {"schemaVersion": 1, "links": links}
        target = args.directory / "portal-links.json"
        if args.write_portal:
            target.write_text(json.dumps(projection, indent=2) + "\n")
        elif not target.exists() or read_json(target) != projection:
            report = {"valid": False, "errors": ["Rebuild portal-links.json with --write-portal"]}
    print(json.dumps(report, indent=2))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
