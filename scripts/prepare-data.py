#!/usr/bin/env python3
"""Rebuild Provider[] from retained real source records; no network/geocoding.
Run from any directory: python scripts/prepare-data.py
Research refresh first replaces src/data/inputs/* after reviewing original sources.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src/data"
INPUTS = DATA / "inputs"
CHECKED = "2026-11-11"


def load(p):
    return json.loads(p.read_text())


def number(v):
    if v is None or v == "":
        return None
    return (
        float(v)
        if isinstance(v, str) and "." in v
        else int(v) if isinstance(v, str) else v
    )


def source(title, publisher, url, kind, supports, asof=None):
    s = {
        "title": title,
        "publisher": publisher,
        "url": url,
        "kind": kind,
        "checkedAt": CHECKED,
        "supports": supports,
    }
    if asof:
        s["dataAsOf"] = asof
    return s


def adapt(r):
    nh = r["type"] == "nursing_home"
    s = r["source"]
    state = r.get("stateCertification")
    warnings = []
    p = {
        "id": r["id"],
        "name": " ".join(r["name"].split()),
        "category": "nursing-home" if nh else "assisted-living",
        "address": r["address"],
        "city": r["city"],
        "state": r["state"],
        "zip": r["zip"],
        "lat": r.get("latitude"),
        "lng": r.get("longitude"),
        "locationKind": "facility",
        "phone": r.get("phone", ""),
        "officialRecord": True,
        "services": [],
        "sources": [],
        "warnings": warnings,
        "limitations": [
            "No current openings, prices, clinical suitability or independent vetting are established by this listing.",
            "Distance is straight-line from a ZIP representative point, not driving distance.",
        ],
    }
    if nh:
        stars = r.get("cmsStars") or {}
        staff = r.get("staffing") or {}
        inspection = r.get("inspections") or {}
        penalty = r.get("penalties") or {}
        p["description"] = (
            "CMS-listed Medicare/Medicaid nursing facility. Published CMS ratings describe this care setting only; confirm current eligibility, services and availability."
        )
        p["services"] = ["Nursing facility"]
        p["ownership"] = r.get("ownershipType", "")
        if r.get("certifiedBeds") is not None:
            p["capacity"] = r["certifiedBeds"]
        p["cms"] = {
            "ccn": r["cmsCertificationNumber"],
            "overall": number(stars.get("overall")),
            "inspections": number(stars.get("healthInspection")),
            "staffing": number(stars.get("staffing")),
            "quality": number(stars.get("qualityMeasures")),
            "totalNurseHours": number(
                staff.get("reported_total_nurse_staffing_hours_per_resident_per_day")
            ),
            "rnHours": number(
                staff.get("reported_rn_staffing_hours_per_resident_per_day")
            ),
            "turnover": number(staff.get("total_nursing_staff_turnover")),
            "fines": number(penalty.get("fineCount")),
            "fineAmount": number(penalty.get("totalFineDollars")),
            "paymentDenials": number(penalty.get("paymentDenialCount")),
            "healthDeficiencies": number(
                inspection.get("latestCycleHealthDeficiencies")
            ),
            "abuse": r.get("abuseIcon") is True,
            "specialFocus": r.get("specialFocusStatus"),
            "dataAsOf": s.get("processingDate") or s.get("datasetModified") or CHECKED,
        }
        if inspection.get("mostRecentHealthInspectionDate"):
            p["cms"]["lastInspection"] = inspection["mostRecentHealthInspectionDate"]
        p["sources"] = [
            source(
                "CMS Nursing Home Provider Information",
                "Centers for Medicare & Medicaid Services",
                s["datasetUrl"],
                "regulatory",
                "Official listing, CMS stars, staffing, most recent standard health-inspection cycle and published penalty totals.",
                s.get("processingDate"),
            ),
            source(
                "Medicare Care Compare facility record",
                "Centers for Medicare & Medicaid Services",
                s["careCompareUrl"],
                "inspection",
                "Facility-specific public CMS information; does not establish live availability.",
                s.get("processingDate"),
            ),
        ]
        if p["cms"]["abuse"]:
            warnings.append("CMS abuse icon is present in this source release.")
        if p["cms"]["specialFocus"]:
            warnings.append(
                "CMS special-focus status: " + p["cms"]["specialFocus"] + "."
            )
        if r.get("ownershipChangedInLast12Months"):
            warnings.append(
                "CMS reports an ownership change within the last 12 months."
            )
        if inspection.get("inspectionMoreThanTwoYearsOld"):
            warnings.append(
                "CMS reports the latest health inspection is over two years old."
            )
        if r.get("footnotes"):
            warnings.append(
                "CMS suppression/footnotes apply: "
                + json.dumps(r["footnotes"], sort_keys=True)
            )
        p["limitations"].append(
            "Penalty totals and latest-cycle deficiency counts refer to published CMS windows, not a complete lifetime record. A null is unavailable, not zero."
        )
    else:
        p["description"] = (
            "Massachusetts official assisted-living directory listing. State records are distinct from nursing-home CMS ratings; verify current certification, care scope and terms directly."
        )
        p["services"] = ["Assisted living"]
        p["sources"] = [
            source(
                "Massachusetts assisted-living residence listing",
                s["publisher"],
                s["facilityUrl"],
                "directory",
                "Official directory name, address, phone and published map location.",
            )
        ]
        if state:
            p["sources"].append(
                source(
                    "Massachusetts certified assisted-living list",
                    s["publisher"],
                    s["stateListUrl"],
                    "regulatory",
                    "Matched state certification status and listed unit/occupancy counts.",
                    s["stateListAsOf"],
                )
            )
            if state.get("maximumOccupancy") is not None:
                p["capacity"] = state["maximumOccupancy"]
            if state.get("specialCareUnits", 0) > 0:
                p["services"].append("State-listed special care units")
            status = state.get("certificationStatus")
            if status and status != "Certified":
                warnings.append(
                    "State list certification status: "
                    + str(status)
                    + ". Verify current status."
                )
            if state.get("sourceAnomaly"):
                warnings.append("State source anomaly: " + str(state["sourceAnomaly"]))
        else:
            warnings.append(
                "Directory entry did not match the June 2026 certification list. Current certification is unverified."
            )
        p["limitations"].append(
            "No CMS nursing-home stars apply to assisted living. State-list matching is not an independent quality assessment."
        )
    return p


def adapt_home(r):
    office = r["office_address"]
    loc = r.get("location")
    area = r["service_area"]
    proof = r["regulatory_or_third_party_proof"]
    sources = []
    for e in r["evidence"]:
        kind = "provider" if e["source_type"] == "provider_official" else "directory"
        sources.append(
            source(
                e["publisher"] + " public record",
                e["publisher"],
                e["url"],
                kind,
                e["supports"],
            )
        )
    if proof.get("cms_source_url"):
        sources.append(
            source(
                "CMS Home Health Provider Information",
                "Centers for Medicare & Medicaid Services",
                proof["cms_source_url"],
                "regulatory",
                "Identifies certified entity CCN(s) "
                + ", ".join(proof["cms_ccns"])
                + ". "
                + proof["interpretation"],
                proof.get("cms_release_date"),
            )
        )
    if loc:
        sources.append(
            source(
                "Census office-address geocode",
                "U.S. Census Bureau",
                loc["source_url"],
                "directory",
                loc["accuracy"],
            )
        )
    historical = r.get("historical_service_zips", {})
    if historical.get("source_url"):
        sources.append(
            source(
                "CMS historical home-health service ZIPs",
                "Centers for Medicare & Medicaid Services",
                historical["source_url"],
                "regulatory",
                historical["meaning"],
                historical.get("release_date"),
            )
        )
    warnings = [
        "Map distance is to an office, not proof that the agency serves your address. Confirm individual service acceptance and staffing."
    ]
    if not loc:
        warnings.append(
            "No safe office coordinate was verified. This record is excluded from radius search and the map."
        )
    limitations = (
        list(r["not_verified"]) + [proof["interpretation"]] + area.get("notes", [])
    )
    limitations += [
        "This agency keeps one primary category; researched supplemental services can also match another search category. No cross-category quality score is assigned."
    ]
    for o in r.get("offices", []):
        address = ", ".join(
            filter(
                None,
                [
                    o.get("street"),
                    o.get("city"),
                    (o.get("state", "") + " " + o.get("zip", "")).strip(),
                ],
            )
        )
        limitations += [
            "Office " + address + ": " + note for note in o.get("notes", [])
        ]
    p = {
        "id": r["id"],
        "name": r["name"],
        "category": r["category"],
        "address": office["street"],
        "city": office["city"],
        "state": office["state"],
        "zip": office["zip"],
        "lat": loc["lat"] if loc else None,
        "lng": loc["lng"] if loc else None,
        "locationKind": "office",
        "phone": r.get("phone", ""),
        "website": r["website"],
        "description": r["summary"],
        "services": r["service_types"],
        "serviceArea": "; ".join(area["regions"])
        + ". "
        + ("Town examples: " + ", ".join(area["towns"]) + ". " if area["towns"] else "")
        + "Not exhaustive; confirm the individual address.",
        "officialRecord": bool(proof.get("cms_ccns")),
        "sources": sources,
        "warnings": warnings,
        "limitations": limitations,
    }
    if r["id"] in {"all-care", "croi-health", "abc-home-healthcare", "privatus-boston"}:
        if "home-care" not in r.get("categories", []):
            raise ValueError(
                "Missing researched supplemental home-care support: " + r["id"]
            )
        p["searchCategories"] = ["home-care"]
    return p


def adapt_lifeplan(r):
    if r["category"] != "life-plan":
        raise ValueError("Unexpected life-plan category")
    keys = [
        "id",
        "name",
        "category",
        "address",
        "city",
        "state",
        "zip",
        "lat",
        "lng",
        "locationKind",
        "phone",
        "website",
        "description",
        "services",
        "officialRecord",
        "sources",
        "warnings",
        "limitations",
    ]
    p = {k: r[k] for k in keys if k in r}
    p["warnings"] = list(r.get("warnings", []))
    p["limitations"] = list(r.get("limitations", []))
    p["sources"] = [dict(x) for x in r["sources"]]
    p["limitations"].append(r["officialRecordScope"])
    p["limitations"].append(
        "Campus identity is separate from each licensed care unit. No nursing-unit CMS stars, CCN quality measures or historical promotional ratings apply to this campus record."
    )
    for unit in r.get("relatedUnits", []):
        p["limitations"].append(
            "Separate "
            + unit["category"]
            + " unit: "
            + unit["name"]
            + "; "
            + unit["address"]
            + "; record "
            + unit["providerId"]
            + (". CCN " + unit["ccn"] if unit.get("ccn") else "")
            + ". "
            + unit["relationship"]
        )
    if r["lat"] is None or r["lng"] is None:
        points = load(DATA / "ma-zips.json")
        provenance = load(DATA / "ma-zips-provenance.json")
        code = r["zip"]
        if (
            code not in points
            or provenance[code]["coordinateSource"]
            != "census_2026_zcta_representative_point"
        ):
            raise ValueError("Campus ZIP estimate lacks Census provenance: " + r["id"])
        p["lat"] = points[code]["lat"]
        p["lng"] = points[code]["lng"]
        p["locationKind"] = "zip"
        message = (
            "Exact campus point not confirmed; distance and map use ZIP area estimate."
        )
        p["description"] = p["description"] + " " + message
        p["limitations"].append(message)
        p["warnings"] = [
            (
                "Original campus-location evidence: " + warning
                if "Campus coordinates are unavailable." in warning
                else warning
            )
            for warning in p["warnings"]
        ]
        p["warnings"].append(
            "Location shown is a published ZIP-area representative point, not the campus entrance or a different-address care-unit location."
        )
        p["sources"].append(
            source(
                "Census 2026 ZIP-area representative point " + code,
                "U.S. Census Bureau",
                "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_zcta_national.zip",
                "directory",
                "Published ZCTA INTPTLAT/INTPTLONG used only as a ZIP-area estimate; exact campus coordinates are unconfirmed.",
                "2026",
            )
        )
    else:
        p["locationKind"] = "facility"
        p["limitations"].append(r["locationEvidence"]["precision"])
    # Explicit whitelist above intentionally never copies a cms block or ratings.
    return p


def main():
    rows = load(INPUTS / "boston-region-providers.json")
    out = [adapt(r) for r in rows]
    home = INPUTS / "homecare.json"
    if home.exists():
        extra = load(home)
        if not isinstance(extra, dict) or not isinstance(extra.get("providers"), list):
            raise ValueError("Unexpected home-care research schema")
        out += [adapt_home(r) for r in extra["providers"]]
    lifeplan = INPUTS / "lifeplan.json"
    if lifeplan.exists():
        out += [adapt_lifeplan(r) for r in load(lifeplan)["providers"]]
    corrections = INPUTS / "provider-corrections.json"
    if corrections.exists():
        by_id = {p["id"]: p for p in out}
        for correction in load(corrections):
            p = by_id[correction["providerId"]]
            if (
                p["zip"] != correction["originalZip"]
                or p["address"] != correction["originalAddress"]
            ):
                raise ValueError("Address correction needs re-review: " + p["id"])
            p["zip"] = correction["zip"]
            p["address"] = correction["address"]
            p["sources"].append(correction["source"])
            p["limitations"].append(correction["note"])
    ids = [p["id"] for p in out]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate provider IDs")
    for p in out:
        if not p["sources"] or not all(
            s["url"].startswith("https://") for s in p["sources"]
        ):
            raise ValueError("Missing provenance: " + p["id"])
        if not isinstance(p["zip"], str) or len(p["zip"]) != 5:
            raise ValueError("ZIP must retain leading zero: " + p["id"])
    out.sort(key=lambda p: p["id"])
    (DATA / "providers.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n"
    )
    summary = {
        "asOf": CHECKED,
        "catalogTotal": len(out),
        "categories": {
            c: sum(p["category"] == c for p in out)
            for c in [
                "nursing-home",
                "assisted-living",
                "home-care",
                "home-health",
                "staffing",
                "life-plan",
            ]
        },
        "geography": {
            "center": {"lat": 42.3601, "lng": -71.0589},
            "radiusMiles": 55,
            "method": "Straight-line from Boston. Office location is not an agency service-area claim.",
        },
        "officialDatasetSummary": load(INPUTS / "dataset-summary.json"),
    }
    (DATA / "catalog-meta.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
