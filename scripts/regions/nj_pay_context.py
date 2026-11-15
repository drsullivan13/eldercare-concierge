"""Project exact-office entries from the Morris County home-care directory."""
import re


def add_county_home_care_context(inputs, providers, research):
    offices = {p["id"]: p for p in providers if p["category"] == "home-care"}
    for row in inputs.json("home-care-pay-services/observations.json"):
        pid = row["provider_id"]
        if pid not in offices:
            continue  # The county directory includes agencies beyond the launch footprint.
        office = offices[pid]
        registry = row["registry_record"]
        if (row["scope"] != "exact_office" or row["decision"] != "accepted"
                or pid != "north-jersey-hp-" + row["official_registration_id"].lower()
                or any(str(office[k]).strip().casefold() != str(registry[k]).strip().casefold()
                       for k in ("address", "city", "state", "zip"))):
            raise ValueError(f"Changed county home-care office identity: {pid}")
        facts = []
        if re.search(r"\bprivate pay\b", row["private_pay_text"] or "", re.I):
            facts.append(("payment", "cost", "Private pay listed in the 2025 county directory. Confirm current terms with the agency."))
        if row["nonmedical_services"]:
            services = ", ".join(row["nonmedical_services"])
            facts.append(("services", "care", f"Services listed in the 2025 county directory: {services}."))
        if not facts:
            continue
        source = row["county_source"]
        source_id = row["entry_id"] + "-directory"
        record = research.setdefault(pid, {
            "providerId": pid, "checkedAt": source["checked_at"], "providerDetailsReviewed": True,
            "facts": [], "sources": [], "notes": [], "reviewAggregates": [], "reviews": [],
            "availability": {"status": "not-published", "asOf": None, "sourceId": None,
                             "text": "Contact the agency for current availability."},
        })
        record["checkedAt"] = max(record["checkedAt"], source["checked_at"])
        record["providerDetailsReviewed"] = True
        directory_source = {
            "id": source_id, "kind": "public-directory", "access": "pdf", "publisher": "Morris County",
            "title": f"2025 Home Care Agencies, page {source['page']}", "url": source["page_url"],
            "checkedAt": source["checked_at"], "publishedAt": None,
        }
        if directory_source not in record["sources"]:
            record["sources"].append(directory_source)
        existing = {fact["id"] for fact in record["facts"]}
        record["facts"].extend({"id": row["entry_id"] + "-" + key, "sourceId": source_id,
                                "kind": kind, "text": text} for key, kind, text in facts
                               if row["entry_id"] + "-" + key not in existing)
