#!/usr/bin/env python3
"""Extract nonclinical amenity listings from retained, exact-location public pages."""
import argparse
import hashlib
import json
from pathlib import Path
import re

REGION = Path(__file__).resolve().parents[2] / "research/north-jersey"
OUTPUT = REGION / "offerings/directory-amenities.json"
SECTIONS = {
    "Room Amenities": ("room", {
        "Private Rooms", "Private Bathroom", "Cable or Satellite TV", "Wi-Fi / High-Speed Internet",
    }),
    "Meals & Dining": ("dining", {
        "Restaurant style Dining Room", "Professional Chef", "Guest Meals", "Room Service",
    }),
    "Community Amenities": ("amenity", {
        "Housekeeping", "Gathering / Activity Spaces", "Laundry Service", "Chapel / Religious Services",
        "Salon / Barber", "Outdoor Patio", "Pet Friendly", "Transportation Services",
    }),
    "Activities": ("amenity", {
        "Social Activities", "Birthday / Holiday Parties", "Games", "Arts and Crafts",
        "Grocery Shopping and Errands", "Live Performances",
    }),
}


def amenity_facts(markdown):
    section = ""
    facts = []
    inside = False
    for line in markdown.splitlines():
        line = line.strip()
        if line == "## Amenities":
            inside = True
            continue
        if not inside:
            continue
        if line.startswith("## "):
            break
        if line.startswith("### "):
            section = line[4:]
            continue
        if section in SECTIONS:
            kind, allowed = SECTIONS[section]
            label = line.removeprefix("- ").strip()
            if label in allowed:
                item = {"kind": kind, "text": label}
                if item not in facts:
                    facts.append(item)
    return facts


def collect():
    providers = {p["id"]: p for p in json.loads((REGION / "runtime/providers.json").read_text())}
    released = json.loads((REGION / "review-release/locationResearch.json").read_text())
    pages = REGION / "listing-index/discovery/pages"
    if not pages.is_dir():
        raise SystemExit("The local retained listing page archive is required for extraction.")
    rows = []
    for pid, record in sorted(released.items()):
        if providers[pid]["category"] not in {"nursing-home", "assisted-living", "life-plan"}:
            continue
        approved_ids = {a["sourceId"] for a in record["reviewAggregates"]}
        for source in record["sources"]:
            if source["id"] not in approved_ids or source["access"] != "full-page":
                continue
            url = source["url"].rstrip("/")
            match = re.fullmatch(r"https://www\.mylivingchoice\.com/property/([a-zA-Z0-9-]+)", url)
            if not match:
                continue
            path = pages / (match[1] + ".json")
            if not path.exists():
                continue
            body = path.read_bytes()
            page = json.loads(body)
            if page["metadata"]["statusCode"] != 200 or (page.get("effectiveUrl") or page.get("url") or page["metadata"].get("sourceURL", "")).rstrip("/") != url:
                continue
            facts = amenity_facts(page["markdown"])
            if facts:
                rows.append({"providerId": pid, "url": url, "title": "Listed rooms, dining and amenities",
                             "publisher": source["publisher"], "checkedAt": source["checkedAt"],
                             "captureSha256": hashlib.sha256(body).hexdigest(), "facts": facts})
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    rows = collect()
    body = json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
    if parser.parse_args().check:
        if body != OUTPUT.read_text():
            raise SystemExit("The directory amenity input differs from the retained captures.")
    else:
        OUTPUT.write_text(body)
    print(f"{len(rows)} reviewed listings, {sum(len(r['facts']) for r in rows)} listed amenities.")
