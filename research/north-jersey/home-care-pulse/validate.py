#!/usr/bin/env python3
"""Validate a source-only Activated Insights branch evidence release."""

import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys


HERE = Path(__file__).resolve().parent
REGISTRY = HERE.parent / "home-care-supply" / "providers.json"
PUBLISHED = HERE.parents[2] / "src" / "data" / "regional-markets.json"
FIELDS = {
    "providerId", "title", "address", "sourceUrl", "checkedAt",
    "services", "paymentOptions", "awards", "accounts",
}
FACT_FIELDS = ("services", "paymentOptions", "awards", "accounts")
SOURCE_URL = re.compile(
    r"https://awards\.activatedinsights\.com(?::443)?/agency/([A-Za-z0-9._~-]+)/?"
)
CONTENT_PATTERN = re.compile(
    r"(?<![\w./-])\d+(?:\.\d+)?\s*(?:-?\s*(?:stars?|ratings?|scores?)\b|[★☆]"
    r"|/\s*(?:5|10)(?![\w/]|[.]\d)"
    r"|out\s+of\s+(?:5|10)(?![\w/]|[.]\d))"
    r"|\b(?:rated|ratings?|scores?)\b\s*(?:(?:of|is|was)\b\s*)?[:=(]?\s*\d",
    re.I,
)
STREET_SUFFIXES = {
    "AVE": "AVENUE", "BLVD": "BOULEVARD", "RD": "ROAD", "ST": "STREET",
    "DR": "DRIVE", "LN": "LANE", "CT": "COURT", "PL": "PLACE",
    "PKWY": "PARKWAY", "HWY": "HIGHWAY", "TER": "TERRACE", "CIR": "CIRCLE",
}


def address_matches(value, provider):
    def tokens(value):
        return re.findall(r"[A-Z0-9]+", value.upper())

    def street(parts):
        parts = list(parts)
        suite = next((i for i, part in enumerate(parts)
                      if part in {"STE", "SUITE", "UNIT", "APT", "APARTMENT"}), len(parts))
        if suite < len(parts) and parts[suite] == "STE":
            parts[suite] = "SUITE"
        if suite:
            parts[suite - 1] = STREET_SUFFIXES.get(parts[suite - 1], parts[suite - 1])
        return parts

    supplied = tokens(value)
    locality = tokens(f"{provider['city']} {provider['state']} {provider['zip']}")
    if supplied[-len(locality):] == locality:
        supplied = supplied[:-len(locality)]
    supplied = street(supplied)
    expected = street(tokens(provider["address"]))
    if supplied == expected:
        return True
    has_suite = any(part in {"SUITE", "UNIT", "APT", "APARTMENT"} for part in expected)
    return (not has_suite and supplied[:len(expected)] == expected
            and len(supplied) == len(expected) + 2
            and supplied[len(expected)] == "SUITE")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        raise ValueError(f"{path}: cannot read valid JSON: {error}") from None


def fields(value, expected, context):
    require(isinstance(value, dict), f"{context}: expected an object")
    missing = expected - value.keys()
    unknown = value.keys() - expected
    require(not missing and not unknown,
            f"{context}: missing keys {sorted(missing)}; unknown keys {sorted(unknown)}")


def provider_index(records, context):
    require(isinstance(records, list), f"{context}: expected a provider array")
    index = {}
    for number, record in enumerate(records):
        require(isinstance(record, dict) and text(record.get("id")),
                f"{context}[{number}]: expected a provider with a nonblank id")
        pid = record["id"]
        require(pid not in index, f"{context}: ambiguous duplicate provider id {pid!r}")
        index[pid] = record
    return index


def validate(branches, registry, published):
    require(isinstance(branches, list), "branches: expected an array")
    seen = set()
    for number, branch in enumerate(branches):
        context = f"branches[{number}]"
        fields(branch, FIELDS, context)
        for key in ("providerId", "title", "address", "sourceUrl", "checkedAt"):
            require(text(branch[key]), f"{context}.{key}: expected a nonblank string")
        require(not CONTENT_PATTERN.search(branch["title"]),
                f"{context}.title: numeric rating or score content is not allowed")
        pid = branch["providerId"]
        context += f" ({pid})"
        require(pid not in seen, f"{context}: duplicate providerId")
        seen.add(pid)
        provider = registry.get(pid)
        require(provider is not None and provider.get("category") == "home-care",
                f"{context}.providerId: must resolve to one sibling-registry home-care record")
        live = published.get(pid)
        require(live is not None and live.get("category") == "home-care",
                f"{context}.providerId: not a published home-care provider")
        for key in ("address", "city", "state", "zip"):
            require(text(provider.get(key)), f"{context}: registry lacks office {key}")
            require(live.get(key) == provider[key],
                    f"{context}: published office {key} differs from sibling registry")
        expected_address = (
            f"{provider['address']}, {provider['city']}, "
            f"{provider['state']} {provider['zip']}"
        )
        require(address_matches(branch["address"], provider),
                f"{context}.address: must match registry street address "
                f"{provider['address']!r} or full office address {expected_address!r}, "
                "preserving the house number, registry suite and any supplied city/state/ZIP")
        match = SOURCE_URL.fullmatch(branch["sourceUrl"])
        require(match is not None and match[1] not in (".", ".."),
                f"{context}.sourceUrl: expected HTTPS awards.activatedinsights.com"
                "/agency/<slug> with an unencoded ASCII slug, optional trailing slash"
                " and port 443 only; no credentials, query or fragment")
        checked = branch["checkedAt"]
        require(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", checked) is not None,
                f"{context}.checkedAt: expected YYYY-MM-DD")
        try:
            date.fromisoformat(checked)
        except ValueError:
            raise ValueError(f"{context}.checkedAt: invalid calendar date {checked!r}") from None
        for key in FACT_FIELDS:
            require(isinstance(branch[key], list), f"{context}.{key}: expected an array")
        for key in ("services", "paymentOptions", "accounts"):
            for item_number, item in enumerate(branch[key]):
                require(text(item),
                        f"{context}.{key}[{item_number}]: expected a nonblank string")
                require(not CONTENT_PATTERN.search(item),
                        f"{context}.{key}[{item_number}]: numeric rating or score content is not allowed")
        for award_number, award in enumerate(branch["awards"]):
            award_context = f"{context}.awards[{award_number}]"
            fields(award, {"name", "years"}, award_context)
            require(text(award["name"]), f"{award_context}.name: expected a nonblank string")
            require(not CONTENT_PATTERN.search(award["name"]),
                    f"{award_context}.name: numeric rating or score content is not allowed")
            years = award["years"]
            require(isinstance(years, list) and bool(years),
                    f"{award_context}.years: expected a nonempty array")
            require(all(type(year) is int and 1 <= year <= 9999 for year in years),
                    f"{award_context}.years: expected integer calendar years 1..9999, not bool")
            require(len(years) == len(set(years)), f"{award_context}.years: duplicate year")
        require(any(branch[key] for key in FACT_FIELDS),
                f"{context}: at least one substantive service, payment option, award or account required")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog=(
            "Each address must match the sibling registry street or full office address. "
            "Case, punctuation and explicit street-suffix abbreviations are normalized. "
            "Registry suites must match; a source may add a suite where none is registered. "
            "Any supplied city/state/ZIP must match in full. "
            "Public text must not contain numeric ratings or scores. "
            "Published means present as home-care in src/data/regional-markets.json, "
            "as loaded by src/lib/markets.ts. The title is the source page title, not "
            "the registry legal name. Accounts must be editorially authored original "
            "paraphrases; this validator cannot certify authorship, source accuracy "
            "or that a source page identifies the claimed office. Human review is "
            "required. This command reads local files only and does not publish evidence."
        ),
    )
    parser.add_argument(
        "input", nargs="?", type=Path, default=HERE / "branches.json",
        help="branch JSON input (default: branches.json beside this script)",
    )
    args = parser.parse_args()
    try:
        branches = read_json(args.input)
        registry = provider_index(read_json(REGISTRY), str(REGISTRY))
        markets = read_json(PUBLISHED)
        require(isinstance(markets, list), f"{PUBLISHED}: expected a market array")
        records = []
        for number, market in enumerate(markets):
            require(isinstance(market, dict) and isinstance(market.get("providers"), list),
                    f"{PUBLISHED}[{number}]: expected a market with a provider array")
            records.extend(market["providers"])
        published = provider_index(records, str(PUBLISHED))
        validate(branches, registry, published)
    except (ValueError, RecursionError) as error:
        print(f"Validation failed: {error}", file=sys.stderr)
        return 1
    print(f"Validated {len(branches)} branch(es). Source-only checks passed; "
          "account authorship and source-to-office accuracy still require editorial review.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
