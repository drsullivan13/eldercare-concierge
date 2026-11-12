#!/usr/bin/env python3
"""Relink a local approval ledger to shareable aggregate-only source observations.

Run only to prepare a new review snapshot, with the original local collection
and an approval ledger whose observation field points at that collection.
"""
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("review_release", Path(__file__).with_name("release-reviews.py"))
release = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = release
spec.loader.exec_module(release)


def freeze():
    inputs = release.Inputs(release.ROOT)
    ledger_path = release.RELEASE / "approvals.json"
    ledger = inputs.json(str(ledger_path))
    rows = []
    for approval in ledger["approvals"]:
        original = approval["observation"]
        file = inputs.bound(original, pointer=True)
        if original["path"].endswith("source-observations.json"):
            raise ValueError("Supply original collection references for a new snapshot")
        value = json.loads(file)
        context = dict(value.get("location", {})) if isinstance(value,dict) else {}
        for key in original["pointer"].split("/")[1:]:
            value = value[int(key)] if isinstance(value,list) else value[key]
        row = release.Observation(original["path"], original["pointer"], value, context)
        if isinstance(value.get("markdown"),str):
            obs = release.raw_listing_observation(approval,row,inputs)
        else:
            obs = row.normalized(inputs)
        if (obs["aggregate"] != approval["aggregate"] or obs["identity"] != approval["identity"]
                or release.canonical_url(obs["url"]) != release.canonical_url(approval["url"])):
            raise ValueError("Source and approval disagree for " + approval["id"])
        rows.append({"url":obs["url"],"platform":obs["platform"],"sourceType":obs["kind"],
                     "checkedAt":obs["checkedAt"] or approval["checkedAt"],"inspection":obs["inspection"],
                     "identity":obs["identity"],"aggregate":obs["aggregate"],"access_decision":"permitted_low_volume",
                     "originalReceipt":original})
    path = release.RELEASE / "source-observations.json"
    source = release.encoded({"schemaVersion":1,"observations":rows})
    for index,a in enumerate(ledger["approvals"]):
        a["observation"] = {"path":str(path),"sha256":release.digest(source),"pointer":f"/observations/{index}"}
    (release.ROOT/path).write_bytes(source)
    (release.ROOT/ledger_path).write_bytes(release.encoded(ledger))


if __name__ == "__main__":
    freeze()
