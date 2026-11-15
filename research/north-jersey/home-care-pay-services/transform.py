"""Offline county-office research. Review decisions are accepted/rejected/unresolved."""

import argparse
from collections import Counter
from datetime import date
import hashlib
import json
from pathlib import Path
import re


BASE = Path(__file__).resolve().parent
SOURCE_URL = (
    "https://www.morriscountynj.gov/files/sharedassets/public/v/1/departments/"
    "human-services/division-on-agingdisability/hh-agencies-2025.pdf"
)
CHECKED_AT = "2026-11-14"
ADDRESS = re.compile(r"^\s*\d+[A-Za-z]?\s+\S")
PHONE = re.compile(
    r"(?<!\d)(?:\(?1[-\s])?\(?(\d{3})\)?[\s.-]*(\d{3})[-.\s]*(\d{4})(?!\d)"
)
LABEL = re.compile(r"Services\s+Offered:|Accepts:", re.I)
FOOTER = re.compile(r"^\s*Updated 2025\s*\*\*JACC / State funded program\s*$")
CLINICAL = re.compile(
    r"nurs|therap|health aides?|\b(?:RN|LPN|PT|OT)\b|\b(?:P\.T\.|O\.T\.)(?=\W|$)", re.I
)
NONMEDICAL = re.compile(
    r"homemaker|companion|housekeep|house clean|meal preparation|cooking|"
    r"errands|shopping|transportation|shower assistance|assistance in hygiene|"
    r"medication reminder|personal care services", re.I
)


def phones(text):
    return sorted({"".join(match.groups()) for match in PHONE.finditer(text)})


def normalized(text):
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def parse_entries(text):
    entries = []
    for page, raw_page in enumerate(text.split("\f"), 1):
        lines = [line for line in raw_page.split("\n") if not FOOTER.fullmatch(line)]
        addresses = [i for i, line in enumerate(lines) if ADDRESS.match(line)]
        if not addresses:
            continue
        starts = []
        for address in addresses:
            start = address
            # An address with no preceding name inherits the preceding office's name.
            while start > 0:
                previous = lines[start - 1].strip()
                if (not previous or LABEL.search(previous) or PHONE.search(previous)
                        or "@" in previous or re.search(r"\.(com|org|net)\b", previous, re.I)):
                    break
                start -= 1
            starts.append(start)
        for index, address in enumerate(addresses):
            start = starts[index]
            end = starts[index + 1] if index + 1 < len(starts) else len(lines)
            block = "\n".join(lines[start:end]).strip("\n")
            name = " ".join(line.strip() for line in lines[start:address])
            if not name:
                if not entries or entries[-1]["page"] != page:
                    raise ValueError(f"Unnamed office on physical page {page}")
                name = entries[-1]["name"]
            body = "\n".join(lines[address:end]).strip("\n")
            phone_match = PHONE.search(body)
            if not phone_match:
                raise ValueError(f"Office without a phone on physical page {page}: {name}")
            address_end = re.search(r"\bNJ\s+\d{5}(?:-\d{4})?", body[:phone_match.start()])
            if not address_end:
                raise ValueError(f"Office without an NJ postal address: {name}")
            labels = list(LABEL.finditer(body))
            sections = {"services_text": None, "accepts_text": None}
            for offset, match in enumerate(labels):
                key = "accepts_text" if match.group().lower().startswith("accepts") else "services_text"
                if sections[key] is not None:
                    raise ValueError(f"Repeated {key} on physical page {page}")
                stop = labels[offset + 1].start() if offset + 1 < len(labels) else len(body)
                sections[key] = body[match.end():stop].strip() or None
            entries.append({
                "entry_id": f"morris-2025-{len(entries) + 1:03d}",
                "page": page,
                "name": name,
                "address_text": body[:address_end.end()].strip(),
                "phone_numbers": phones(body),
                **sections,
                "source_text": block,
            })
    if not entries:
        raise ValueError("No county offices found")
    return entries


def load_array(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError(f"Expected an array of objects: {path}")
    return value


def file_provenance(path):
    resolved = path.resolve()
    try:
        name = resolved.relative_to(BASE.parents[2]).as_posix()
    except ValueError:
        name = resolved.as_posix()
    return {"path": name, "sha256": hashlib.sha256(resolved.read_bytes()).hexdigest()}


def build_registry(inventory, state_rows):
    by_registration = {}
    for row in state_rows:
        by_registration.setdefault(row["official_registration_id"], []).append(row)
    registry = {}
    for row in inventory:
        if row.get("license_status", "").casefold() != "active":
            continue
        provider_id = row["provider_id"]
        if provider_id in registry:
            raise ValueError(f"Duplicate active provider_id: {provider_id}")
        raw_rows = [
            raw for raw in by_registration.get(row["official_registration_id"], [])
            if raw.get("license_status", "").casefold() == "active"
            and normalized(raw.get("address", "")) == normalized(row.get("registered_address") or row["address"])
            and normalized(raw.get("city", "")) == normalized(row["city"])
        ]
        registry[provider_id] = {
            "inventory": row,
            "raw_rows": raw_rows,
            "phones": sorted({
                phone for raw in raw_rows
                for phone in phones(str(raw.get("source_fields", {}).get("Business Phone", "")))
            }),
        }
    return registry


def strong_name(left, right):
    left, right = normalized(left), normalized(right)
    if not left or not right:
        return False
    stop = {
        "home", "care", "health", "healthcare", "services", "service", "inc",
        "llc", "corp", "of", "the", "and", "dba", "senior", "seniors", "nursing",
    }
    a, b = set(left.split()) - stop, set(right.split()) - stop
    return bool(a and b and a == b)


def candidate_matches(entries, registry):
    results = []
    for entry in entries:
        candidates = []
        for provider_id, record in sorted(registry.items()):
            row = record["inventory"]
            signals = []
            common = sorted(set(entry["phone_numbers"]) & set(record["phones"]))
            if common:
                signals.append({"kind": "phone", "values": common})
            house = re.match(r"\d+[A-Za-z]?", entry["address_text"])
            registered_house = re.match(r"\d+[A-Za-z]?", row.get("registered_address") or row["address"])
            city = normalized(row["city"])
            county_city = re.search(r"([^,;\n]+),\s*NJ\s+\d{5}", entry["address_text"], re.I)
            county_city_text = normalized(county_city.group(1)) if county_city else ""
            county_city_text = re.sub(
                r"^(?:(?:suite|ste)\s+)?\d+[a-z]?\s+", "", county_city_text
            )
            if (house and registered_house and house.group().lower() == registered_house.group().lower()
                    and city and city.replace(" ", "") == county_city_text.replace(" ", "")):
                signals.append({"kind": "house_number_city", "house_number": house.group(), "city": row["city"]})
            names = [row.get(key, "") for key in ("registered_name", "dba", "runtime_name")]
            matched_names = sorted({name for name in names if strong_name(entry["name"], name)})
            if matched_names:
                signals.append({"kind": "strong_name", "values": matched_names})
            if signals:
                candidates.append({
                    "provider_id": provider_id,
                    "official_registration_id": row["official_registration_id"],
                    "registered_name": row["registered_name"],
                    "dba": row.get("dba", ""),
                    "address": row.get("registered_address") or row["address"],
                    "city": row["city"],
                    "phones": record["phones"],
                    "match_signals": signals,
                    "registry_source": row.get("source"),
                    "registration_source_rows": row.get("registration_source_rows", []),
                    "phone_sources": [raw.get("source") for raw in record["raw_rows"]],
                })
        results.append({"entry_id": entry["entry_id"], "candidates": candidates})
    return results


def nonmedical_services(text):
    if not text:
        return []
    return [
        fragment.strip()
        for fragment in re.split(r";|,|(?<!\b[A-Za-z])\.(?=\s|$)", text)
        if NONMEDICAL.search(fragment) and not CLINICAL.search(fragment)
    ]


def registration_status_caveat(row):
    expires = row.get("license_expires")
    if not expires:
        return None
    try:
        elapsed = date.fromisoformat(expires) < date.fromisoformat(CHECKED_AT)
    except (TypeError, ValueError) as error:
        raise ValueError(
            f"Invalid license_expires for {row.get('provider_id')}: {expires}"
        ) from error
    if not elapsed:
        return None
    return {
        "portal_status": row["license_status"],
        "license_expires": expires,
        "checked_at": CHECKED_AT,
        "observation_scope": "historical",
        "current_eligibility_asserted": False,
        "reason": (
            "The portal reports Active, but the listed license expiration date "
            "elapsed before this check."
        ),
    }


def reviewed_observations(entries, registry, reviews, source_sha256, source_pdf_sha256):
    by_entry = {entry["entry_id"]: entry for entry in entries}
    seen = set()
    observations = []
    for review in reviews:
        entry_id = review.get("entry_id")
        if entry_id not in by_entry or entry_id in seen:
            raise ValueError(f"Unknown or duplicate reviewed entry_id: {entry_id}")
        seen.add(entry_id)
        if review.get("decision") not in {"accepted", "rejected", "unresolved"}:
            raise ValueError(f"Review decision must be accepted/rejected/unresolved: {entry_id}")
        for key in ("limitations", "identity_basis"):
            if not isinstance(review.get(key), list) or any(
                not isinstance(value, str) or not value.strip() for value in review[key]
            ):
                raise ValueError(f"Review {key} must be an array of nonempty strings: {entry_id}")
        if "provider_id" not in review:
            raise ValueError(f"Missing reviewed provider_id: {entry_id}")
        provider_id = review["provider_id"]
        if review["decision"] == "accepted" and provider_id is None:
            raise ValueError(f"Accepted review requires provider_id: {entry_id}")
        if review["decision"] != "accepted" and provider_id is not None:
            raise ValueError(f"Rejected/unresolved review requires null provider_id: {entry_id}")
        if provider_id is not None and (
            not isinstance(provider_id, str) or provider_id not in registry
        ):
            raise ValueError(f"Reviewed provider must be in the active inventory: {entry_id}")
        if review["decision"] != "accepted":
            continue
        if not review["identity_basis"]:
            raise ValueError(f"Accepted exact office requires identity_basis: {entry_id}")
        entry = by_entry[entry_id]
        record = registry[provider_id]
        observation = {
            "entry_id": entry_id,
            "provider_id": provider_id,
            "official_registration_id": record["inventory"]["official_registration_id"],
            "scope": "exact_office",
            "decision": "accepted",
            "identity_basis": review["identity_basis"],
            "limitations": review["limitations"],
            "registry_record": record["inventory"],
            "registry_rows": record["raw_rows"],
            "county_source": {
                "url": SOURCE_URL,
                "page_url": f"{SOURCE_URL}#page={entry['page']}",
                "year": 2025,
                "page": entry["page"],
                "checked_at": CHECKED_AT,
                "text_sha256": source_sha256,
                "pdf_sha256": source_pdf_sha256,
            },
            "county_office": entry,
            "private_pay_text": entry["accepts_text"] if re.search(
                r"\bprivate\s+pay\b", entry["accepts_text"] or "", re.I
            ) else None,
            "nonmedical_services": nonmedical_services(entry["services_text"]),
            "served_territories": [],
        }
        caveat = registration_status_caveat(record["inventory"])
        if caveat is not None:
            observation["registration_status_caveat"] = caveat
        observations.append(observation)
    return observations


def transform(
    text,
    inventory,
    state_rows,
    reviews,
    *,
    source_pdf_sha256=None,
    provenance=None,
):
    entries = parse_entries(text)
    registry = build_registry(inventory, state_rows)
    candidates = candidate_matches(entries, registry)
    observations = reviewed_observations(
        entries,
        registry,
        reviews,
        hashlib.sha256(text.encode("utf-8")).hexdigest(),
        source_pdf_sha256,
    )
    accepted = {row["entry_id"] for row in observations}
    review_map = {row["entry_id"]: row for row in reviews}
    candidate_map = {row["entry_id"]: row["candidates"] for row in candidates}
    unresolved = []
    for entry in entries:
        entry_id = entry["entry_id"]
        if entry_id not in accepted:
            review = review_map.get(entry_id)
            unresolved.append({
                "entry_id": entry_id,
                "page": entry["page"],
                "name": entry["name"],
                "reason": (
                    "not_reviewed" if review is None else
                    "no_provider_id" if review["provider_id"] is None else review["decision"]
                ),
                "candidate_provider_ids": [row["provider_id"] for row in candidate_map[entry_id]],
                "review": review,
            })
    coverage = {
        "checked_at": CHECKED_AT,
        "source_url": SOURCE_URL,
        "source_year": 2025,
        "provenance": provenance or {
            "county_text": {"sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()},
            "county_pdf": {"sha256": source_pdf_sha256},
            "inventory": [],
            "state": [],
        },
        "county_entry_count": len(entries),
        "entries_by_physical_page": dict(sorted(Counter(row["page"] for row in entries).items())),
        "active_inventory_count": len(registry),
        "entries_with_candidates": sum(bool(row["candidates"]) for row in candidates),
        "candidate_pair_count": sum(len(row["candidates"]) for row in candidates),
        "reviewed_entry_count": len(reviews),
        "accepted_entry_count": len(observations),
        "accepted_provider_count": len({row["provider_id"] for row in observations}),
        "unresolved_entry_count": len(unresolved),
        "missing_services_count": sum(row["services_text"] is None for row in entries),
        "missing_accepts_count": sum(row["accepts_text"] is None for row in entries),
        "unresolved_cases": unresolved,
        "limitations": [
            "County directory listing is not an endorsement or proof of current availability.",
            "Candidate signals do not establish exact-office identity and are never auto-promoted.",
            "County listing does not establish served territories.",
            "Health aide, nurse, therapy and live-in labels alone do not establish nonmedical services.",
            "Private pay is source wording, not a rate or confirmation of current payment terms.",
        ],
    }
    return {
        "county-entries.json": entries,
        "candidate-matches.json": candidates,
        "observations.json": observations,
        "coverage.json": coverage,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", type=Path, default=BASE / "sources/hh-agencies-2025.txt")
    parser.add_argument("--pdf", type=Path, default=BASE / "sources/hh-agencies-2025.pdf")
    parser.add_argument("--inventory", type=Path, default=BASE.parent / "home-care-first-party/inventory.json")
    parser.add_argument("--inventory-supplement", type=Path,
                        default=BASE / "inventory-supplement.json")
    parser.add_argument("--state-dir", type=Path, default=BASE.parent / "state")
    parser.add_argument("--state-supplement", type=Path,
                        default=BASE / "state-supplement.json")
    parser.add_argument("--reviewed-matches", type=Path, default=BASE / "reviewed-matches.json",
                        help="Optional review array. Only accepted decisions with a provider and identity basis emit facts.")
    parser.add_argument("--output-dir", type=Path, default=BASE,
                        help="Output directory, restricted to this research directory or its descendants.")
    args = parser.parse_args(argv)
    try:
        output_dir = args.output_dir.resolve()
        if not output_dir.is_relative_to(BASE):
            raise ValueError("Output directory must stay within the home-care-pay-services directory")
        state_files = sorted(args.state_dir.glob("*/home-care-firms.json"))
        if not state_files:
            raise ValueError("No state/*/home-care-firms.json inputs found")
        reviews = load_array(args.reviewed_matches) if args.reviewed_matches.exists() else []
        inventory_paths = [args.inventory]
        if args.inventory_supplement.exists():
            inventory_paths.append(args.inventory_supplement)
        state_paths = list(state_files)
        if args.state_supplement.exists():
            state_paths.append(args.state_supplement)
        text = args.text.read_text(encoding="utf-8")
        provenance = {
            "county_text": file_provenance(args.text),
            "county_pdf": file_provenance(args.pdf),
            "inventory": [file_provenance(path) for path in inventory_paths],
            "state": [file_provenance(path) for path in state_paths],
        }
        outputs = transform(
            text,
            [row for path in inventory_paths for row in load_array(path)],
            [row for path in state_paths for row in load_array(path)],
            reviews,
            source_pdf_sha256=provenance["county_pdf"]["sha256"],
            provenance=provenance,
        )
        for filename in outputs:
            if not (output_dir / filename).resolve().is_relative_to(BASE):
                raise ValueError(f"Output symlink escapes research directory: {filename}")
        output_dir.mkdir(parents=True, exist_ok=True)
        for filename, value in outputs.items():
            (output_dir / filename).write_text(
                json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    print(json.dumps({
        key: value for key, value in outputs["coverage.json"].items()
        if key.endswith("_count") or key == "entries_with_candidates"
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
