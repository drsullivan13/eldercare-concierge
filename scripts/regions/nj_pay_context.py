"""Project county program and service evidence onto exact New Jersey home-care offices."""
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
        record = office_record(research, pid, source["checked_at"])
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

    respite = inputs.json("home-care-pay-services/county-respite-programs.json")
    add_respite_context(respite, offices, research)
    union = inputs.json("home-care-pay-services/union-caregiver-directory.json")
    add_union_context(union, offices, research)
    for row in inputs.json("home-care-pay-services/verified-office-services.json"):
        pid = row["providerId"]
        if pid not in offices:
            continue
        office = offices[pid]
        if (any(office[k].casefold() != row[j].casefold() for k, j in
                (("address", "street"), ("city", "city"), ("name", "name"), ("zip", "zip")))
                or re.sub(r"\D", "", office["phone"]) != re.sub(r"\D", "", row["phone"])):
            raise ValueError(f"Changed office service identity: {pid}")
        key = "office-staffing" if row.get("facilityStaffing") else "office-services"
        add_fact(research, pid, key, row["title"], row["text"], row,
                 "full-page", row["checkedAt"], kind=row["category"])
        for rate in row.get("rates", []):
            research[pid]["facts"].append({"id": f"{pid}-{rate['key']}", "kind": "cost",
                                          "sourceId": f"{pid}-{key}-source",
                                          "text": rate["text"], "amount": rate["amount"]})



def office_record(research, pid, checked_at):
    record = research.setdefault(pid, {
        "providerId": pid, "checkedAt": checked_at, "providerDetailsReviewed": True,
        "facts": [], "sources": [], "notes": [], "reviewAggregates": [], "reviews": [],
        "availability": {"status": "not-published", "asOf": None, "sourceId": None,
                         "text": "Contact the agency for current availability."},
    })
    record["checkedAt"] = max(record["checkedAt"], checked_at)
    record["providerDetailsReviewed"] = True
    return record


def add_respite_context(data, offices, research):
    checked = data["checkedUTC"]
    for row in data["agencyDetails"]:
        pid = row["providerId"]
        if pid not in offices:
            continue
        office = offices[pid]
        location = row["sourceOffice"]
        registry = row.get("registryOffice", location)
        if (re.sub(r"\D", "", office["phone"]) != re.sub(r"\D", "", location["phone"])
                or office["city"].strip().casefold() != registry["city"].strip().casefold()
                or office["address"].strip().rstrip(".").casefold() != registry["street"].strip().rstrip(".").casefold()
                or ("name" in registry and office["name"] != registry["name"])):
            raise ValueError(f"Changed Essex respite office identity: {pid}")

        if row["field"] == "historical_respite_program_listing":
            key = "essex-respite-2025"
            title = f"Essex County 2025 respite program schedule, page {row['sourcePhysicalPage']}"
            text = "Named in Essex County’s 2025 respite program schedule. Contact the county for the current provider list."
            access = "pdf"
        elif row["field"] == "in_home_respite_intake":
            key = "nj211-respite-services"
            title = "NJ 211 · In-home respite care"
            text = f"NJ 211 lists in-home respite care for Essex County residents. Call {row['phone']} for intake."
            access = "full-page"
        else:
            raise ValueError(f"Unknown respite evidence: {row['field']}")
        add_fact(research, pid, key, title, text, row, access, checked)


def add_union_context(rows, offices, research):
    for row in rows:
        pid = row["providerId"]
        if pid not in offices:
            continue
        office = offices[pid]
        registry = row["registryOffice"]
        if (any(office[k].strip().casefold() != registry[k].strip().casefold()
                for k in ("address", "city", "zip")) or office["name"] != registry["legalName"]
                or re.sub(r"\D", "", office["phone"]) != re.sub(r"\D", "", registry["phone"])):
            raise ValueError(f"Changed Union County directory office identity: {pid}")
        text = f"Union County’s May 2026 guide lists this office for home care and caregiver services. Call {row['sourceOffice']['phone']}."
        title = f"Union County resource directory for older adults, page {row['physicalPage']}"
        add_fact(research, pid, "union-caregiver-directory", title, text, row,
                 "pdf", row["checkedAt"], row["sourceDate"])


def add_fact(research, pid, key, title, text, row, access, checked, published=None, kind="public-directory"):
    record = office_record(research, pid, checked)
    source_id = f"{pid}-{key}-source"
    record["sources"].append({"id": source_id, "kind": kind, "access": access,
                              "publisher": row["publisher"], "title": title, "url": row["sourceUrl"],
                              "checkedAt": checked, "publishedAt": published})
    record["facts"].append({"id": f"{pid}-{key}", "kind": "care", "sourceId": source_id, "text": text})
