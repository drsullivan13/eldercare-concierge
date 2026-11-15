"""Join reviewed branch evidence and published Census office locations to NJ providers."""
import hashlib
import json
import re

from homecare_service_zips import Geography, SourceArea, resolve_service_zips

AREA = "home-care-supply/"
OPERATOR = AREA + "operator-evidence/"
# Reviewed lines in each branch's approved service-area facts. Partial territories
# such as "Northwestern Bergen County" intentionally have no whole-ZIP mapping.
AREAS = {
    "HP0065000": {64: ("county", ["Union County", "Essex County"])},
    "HP0154800": {257: ("municipality", ["Hoboken", "Secaucus", "Kearny", "North Arlington"])},
    "HP0167700": {425: ("county", ["Passaic County", "Bergen County"])},
    "HP0216800": {233: ("municipality", ["Fort Lee", "Cliffside Park", "Leonia"])},
    "HP0221500": {183: ("municipality", ["Jersey City", "Bayonne"])},
    "HP0320800": {365: ("municipality", ["Scotch Plains"])},
    "HP0397500": {272: ("county", ["Morris County"])},
    "HP0058900": {61: ("county", ["Essex County"])},
    "HP0289000": {107: ("municipality", ["Bridgewater"]), 108: ("municipality", ["East Brunswick"]), 112: ("municipality", ["Hillsborough"])},
    "HP0374000": {40: ("county", ["Somerset County", "Middlesex County"]), 30: ("municipality", ["Edison"])},
    "HP0443400": {53: ("municipality", ["Carteret", "Clark", "Cranford", "Garwood", "Kenilworth", "Linden", "Perth Amboy", "Rahway", "Roselle", "Roselle Park", "Woodbridge"])},
    "HP0052100": {69: ("municipality", ["East Brunswick"]), 71: ("municipality", ["Edison"]), 81: ("municipality", ["New Brunswick"])},
    "HP0223700": {59: ("municipality", ["Manalapan", "Marlboro", "Holmdel", "Middletown", "East Brunswick", "Old Bridge", "Red Bank"])},
    "HP0172800": {286: ("municipality", ["Red Bank", "Manalapan", "Matawan", "Wall Township"])},
}


def enrich(inputs, providers, zips, county_by_id):
    by_id = {p["id"]: p for p in providers if p["category"] == "home-care"}
    release = inputs.json(OPERATOR + "release.json")["byProviderID"]
    records = inputs.json(OPERATOR + "reconciliation.json")["records"]
    audits = {r["providerID"]: r for r in records if r.get("status") == "verified"}
    geography = Geography.load()
    for pid, patch in release.items():
        if pid not in by_id:
            continue
        p = by_id[pid]
        audit = audits[pid]
        for field in ("phone", "website", "serviceArea"):
            if field in patch:
                p[field] = patch[field]
        p["services"] = list(dict.fromkeys(p["services"] + patch.get("services", [])))
        p["sources"].extend(s for s in patch["sources"] if s not in p["sources"])
        if pid == "north-jersey-hp-hp0436900":
            raise ValueError("East Brunswick Visiting Angels lacks a corroborated first-party branch address")
        lines = AREAS.get(audit["registrationID"], {})
        claims = []
        for fact in audit.get("publishedFields", {}).get("serviceArea", []):
            receipt_path = fact["receipt"].removeprefix("research/north-jersey/")
            body = inputs.read(receipt_path)
            if hashlib.sha256(body).hexdigest() != fact["sha256"]:
                raise ValueError(f"Branch evidence drift: {receipt_path}")
            for row in json.loads(body)["excerpts"]:
                index = row["line"]
                if index not in lines or index not in fact["lines"]:
                    continue
                kind, labels = lines[index]
                for label in labels:
                    # The reviewed text sometimes contracts two county names
                    # into "Somerset and Middlesex Counties".
                    first = label.removesuffix(" County").removesuffix(" Township")
                    if re.search(r"\b" + re.escape(first) + r"\b", row["text"], re.I):
                        claims.append(SourceArea(label, kind, "full", fact["url"], row["text"]))
        if claims:
            covered = resolve_service_zips(claims, geography)["serviceAreaZips"]
            inside = sorted(set(covered).intersection(zips))
            if inside:
                p["serviceAreaZips"] = inside
