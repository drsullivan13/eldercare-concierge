#!/usr/bin/env python3
"""Check audited description inputs without acquiring or opening original sources."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

RESEARCH = Path("research/north-jersey/descriptions")
INPUTS = (
    "official/baseline.json",
    "official/coverage.json",
    "official/capture.json",
    "provider-residential.json",
    "provider-offices.json",
)
IDENTITY_FIELDS = ("id", "name", "address", "city", "zip", "category", "locationKind")


def digest(value):
    body = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def check(root, baseline_output=None):
    spec = importlib.util.spec_from_file_location(
        "descriptions", root / "scripts/prepare-location-descriptions.py"
    )
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    load, require = builder.load, builder.require
    manifest = load(root / RESEARCH / "public-validation.json")
    require(manifest["schemaVersion"] == 1, "Unsupported public audit schema")
    require(manifest["marketId"] == "north-jersey", "Wrong public audit market")
    providers = builder.active_providers(root / "src/data/regional-markets.json")
    identities = {
        pid: {field: provider[field] for field in IDENTITY_FIELDS}
        for pid, provider in providers.items()
    }
    require(digest(identities) == manifest["inventoryIdentitySha256"],
            "Active provider identity differs from the audited inventory")
    require(set(manifest["inputs"]) == set(INPUTS), "Public audit input set differs")
    inputs = {name: load(root / RESEARCH / name) for name in INPUTS}
    baseline = inputs["official/baseline.json"]
    supplement = manifest["cmsSupplement"]
    require(digest(supplement) == manifest["cmsSupplementSha256"],
            "CMS normalized supplement differs from the audited release")
    require(not set(baseline) & set(supplement), "CMS supplement overlaps the official baseline")
    merged = {**baseline, **supplement}
    result = builder.build(
        providers, merged, inputs["provider-residential.json"], inputs["provider-offices.json"]
    )
    for name, value in inputs.items():
        require(digest(value) == manifest["inputs"][name],
                f"{name}: normalized input differs from the audited release")
    coverage = inputs["official/coverage.json"]
    rows = coverage["locations"]
    ids = [row["providerId"] for row in rows]
    require(len(ids) == len(set(ids)) and set(ids) == set(providers),
            "Official coverage must contain every active ID exactly once")
    require(all(row["status"] in {"described", "fetch-failed", "identity-conflict"} for row in rows),
            "Unknown official collection disposition")
    require({row["providerId"] for row in rows if row["status"] == "described"} == set(baseline)
            and coverage["describedCount"] == len(baseline),
            "Official coverage differs from normalized baseline")
    require(set(manifest["cmsProvenance"]) == set(supplement), "CMS provenance IDs differ")
    for pid, entry in supplement.items():
        provenance = manifest["cmsProvenance"][pid]
        require(len(entry["sources"]) == 1 and entry["sources"][0] == provenance["source"],
                f"{pid}: CMS source differs from audited provenance")
        require(len(provenance["markdownSha256"]) == 64
                and all(c in "0123456789abcdef" for c in provenance["markdownSha256"]),
                f"{pid}: invalid CMS source fingerprint")
    require(builder.render(result) == (root / "src/data/location-descriptions.json").read_text(),
            "Public descriptions differ from the audited normalized build")
    if baseline_output is not None:
        baseline_output.write_text(builder.render(merged))
    return {
        "active": len(providers), "described": len(result["locations"]),
        "cmsSupplement": len(supplement), "checkedAt": result["checkedAt"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--baseline-output", type=Path,
                        help="Write the validated merged official input for the normal builder")
    args = parser.parse_args()
    print(json.dumps(check(args.root, args.baseline_output), sort_keys=True))
