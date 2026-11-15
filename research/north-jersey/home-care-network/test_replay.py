import collections
import copy
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

import replay


ROOT = Path(__file__).resolve().parent
HOME_HEADINGS = {
    "Home Health Care", "Licensed Home Care Service Agency", "Personal Care Services",
    "Respite Care Services", "Chore/Housekeeping Services", "Private Duty Nursing",
    "Adult Family Home Care", "Attendant Care",
}
OTHER_HEADINGS = set(
    "Adult Day Care|Adult Medical Day Care|Ambulatory Surgery Center|Assisted Living Services|"
    "Audiology|Behavioral Health Facility|Case Management Services|Child Development Center|"
    "Clinic|Community Mental Health Center|Community Service Board|Convenient Care Clinic|"
    "Diagnostic Center|Diagnostic Imaging|Dialysis|Distinct Part Unit Psych|Distinct Part Unit Rehab|"
    "Durable Medical Equipment|Federally Qualified Health Center|Hearing Aid Supplier|"
    "Home Delivered Meals|Hospice|Infusion Therapy|Laboratory Pathology Testing|"
    "Magnetic Resonance Imaging|Mammography|Mobile Diagnostic|Occupational Therapy|Optometry|"
    "Orthotics & Prosthetics|Pediatric Dentistry|Personal Emergency Response|System|"
    "Physical Therapy|Psych Hospital|Rehabilitation Facility|Skilled Nursing Facility|"
    "Social Day Care|Speech Therapy|Urgent Care Center".split("|")
)


class ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.outputs = replay.build()
        cls.listings = cls.outputs["directory-listings.json"]
        cls.verified = cls.outputs["verified.json"]
        cls.ledger = cls.outputs["dispositions.json"]
        with (ROOT / "sources/roster.csv").open(newline="") as handle:
            cls.rows = {row["providerId"]: row for row in csv.DictReader(handle)}
        cls.pages = {
            path.name.split(".")[0].removeprefix("region-"): json.loads(path.read_text())
            for path in (ROOT / "sources").glob("*.pages.json")
        }

    def test_generated_outputs_are_exact_replay(self):
        for name, value in self.outputs.items():
            self.assertEqual((ROOT / name).read_bytes(), replay.encoded(value), name)

    def test_ancillary_all_pages_are_bound_to_original_sources(self):
        manifest = json.loads((ROOT / "sources/manifest.json").read_text())
        payload = (ROOT / "sources/ancillary-all-pages.json").read_bytes()
        self.assertEqual(replay.digest(payload),
                         "12c20fb8f35c73f89e5b273a43e01b2e8699ffffb8eac52c02e9d3a70f607b21")
        pages = json.loads(payload)
        expected = {
            "1_1": (204, "189"), "1_2": (125, "110"), "2_1": (162, "147"),
            "2_2": (98, "83"), "3_1": (180, "165"), "3_2": (170, "155"),
            "4_2": (158, "143"),
        }
        self.assertEqual(set(pages), set(expected))
        for region, page in pages.items():
            source = manifest["sources"][region]
            self.assertEqual((page["physicalPage"], page["printedPage"]), expected[region])
            self.assertEqual(page["sourceUrl"], source["url"])
            self.assertEqual(page["sourcePdfSha256"], source["pdfSha256"])
            self.assertEqual(page["sourceDate"], source["sourceDate"])
            self.assertEqual(page["checkedDate"], manifest["checkedDate"])
            self.assertNotIn(page["physicalPage"], source["retainedPages"])
            for field in ("raw", "layout"):
                self.assertEqual(replay.digest(page[field].encode()), page[field + "Sha256"])

    def test_ancillary_all_pages_contain_only_laboratory_and_transport_contacts(self):
        pages = json.loads((ROOT / "sources/ancillary-all-pages.json").read_bytes())
        body = [
            "Ancillary Providers", "All", "Laboratory Pathology Testing",
            "Labcorp", "For Providers And Locations", "Please Call:", "(888) 522-2677",
            "Quest Diagnostics", "For Providers And Locations", "Please Call:", "(888) 277-8772",
            "Medically Necessary Transportation", "WellCare Customer Service",
            "For Providers And Locations", "Please Call:", "(888) 453-2534",
        ]
        date = "This directory is updated as of 10/06/2026."
        for region, page in pages.items():
            footer = "www.fideliscarenj.com " + page["printedPage"]
            self.assertEqual(page["raw"].splitlines(), body + [footer, date], region)
            self.assertEqual([" ".join(line.split()) for line in page["layout"].splitlines() if line.strip()],
                             body + [date, footer], region)
            for field in ("raw", "layout"):
                self.assertNotRegex(page[field], r"(?i)Provider\s+ID\s*:")
                self.assertTrue(HOME_HEADINGS.isdisjoint(line.strip() for line in page[field].splitlines()))

    def test_tampered_ancillary_provenance_pages_and_content_fail(self):
        path = ROOT / "sources/ancillary-all-pages.json"
        pages = json.loads(path.read_bytes())
        manifest = json.loads((ROOT / "sources/manifest.json").read_text())
        original = Path.read_bytes
        for field, value in (
            ("sourceUrl", "https://example.com/other.pdf"),
            ("sourcePdfSha256", "0" * 64), ("sourceDate", "2026-11-14"),
            ("checkedDate", "2026-11-15"), ("physicalPage", 205), ("printedPage", "190"),
            ("raw", pages["1_1"]["raw"].replace("Labcorp", "Other contact")),
            ("layout", pages["1_1"]["layout"].replace("Labcorp", "Other contact")),
            ("rawSha256", "0" * 64), ("layoutSha256", "0" * 64),
        ):
            altered = copy.deepcopy(pages)
            altered["1_1"][field] = value

            def changed(candidate, *args, **kwargs):
                return replay.encoded(altered) if candidate == path else original(candidate, *args, **kwargs)

            with self.subTest(field=field), patch.object(Path, "read_bytes", changed):
                with self.assertRaises(AssertionError):
                    replay.validate_ancillary(manifest)

    def test_every_roster_provider_has_one_disposition(self):
        self.assertEqual(set(self.rows), set(self.ledger))
        self.assertEqual(len(self.ledger), 1074)
        self.assertEqual(len(self.verified), 31)
        self.assertEqual(collections.Counter(item["status"] for item in self.ledger.values()),
                         {"hold": 1043, "verified": 31})
        self.assertEqual(collections.Counter(item["reason"] for item in self.ledger.values()), {
            "exact_office_identity": 31, "identity_discrepancy": 182,
            "not_found_in_full_directory_phone_audit": 857, "roster_location_hold": 4,
        })
        for item in self.ledger.values():
            self.assertEqual(item["scannedRegions"], ["1_1", "1_2", "2_1", "2_2", "3_1", "3_2", "4_2"])
            self.assertEqual(item["scannedListingCount"], 298)

    def test_independent_raw_source_scan_matches_every_listing_occurrence(self):
        expected = collections.Counter()
        for region, pages in self.pages.items():
            active = None
            for page in pages[3:]:
                for line in page["raw"].splitlines():
                    heading = re.sub(r"\s*- cont\.$", "", line.strip())
                    if heading in HOME_HEADINGS:
                        active = heading
                    elif heading.rstrip(" -") in OTHER_HEADINGS:
                        active = None
                    elif line.startswith("Provider ID:") and active:
                        expected[(region, page["physicalPage"], line.split(":", 1)[1].strip(), active)] += 1
        observed = collections.Counter(
            (item["region"], item["physicalPage"], item["directoryProviderId"], item["directorySection"])
            for item in self.listings
        )
        self.assertEqual(expected, observed)
        self.assertEqual(sum(expected.values()), 298)
        self.assertEqual(collections.Counter(item["region"] for item in self.listings), {
            "1_1": 49, "1_2": 29, "2_1": 49, "2_2": 29, "3_1": 68, "3_2": 52, "4_2": 22,
        })

    def test_listing_ids_and_identity_fields_are_valid(self):
        self.assertEqual(len({item["listingId"] for item in self.listings}), 298)
        for item in self.listings:
            self.assertRegex(item["phone"], r"^\(\d{3}\) \d{3}-\d{4}$")
            self.assertRegex(item["zip"], r"^\d{5}(?:-\d{4})?$")
            self.assertTrue(item["address"])
            self.assertEqual(item["listingName"], " ".join(item["listingNameLines"]))
            self.assertEqual(item["address"], " ".join(item["addressLines"]))
            self.assertIn(item["directorySection"], HOME_HEADINGS)

    def test_every_parsed_listing_is_a_contiguous_original_raw_source_block(self):
        for item in self.listings:
            page = next(page for page in self.pages[item["region"]]
                        if page["physicalPage"] == item["physicalPage"])
            block = " ".join(" ".join(item["rawListingLines"]).split())
            self.assertIn(block, " ".join(page["raw"].split()), item["listingId"])

    def test_every_published_listing_passes_all_identity_fields(self):
        by_id = {item["listingId"]: item for item in self.listings + self.outputs["broader-directory-listings.json"]}
        for provider_id, fact in self.verified.items():
            self.assertEqual(fact["checkedDate"], "2026-11-14")
            self.assertIn("Not found is not nonparticipation.", fact["caveat"])
            for listing in fact["listings"]:
                self.assertTrue(all(replay.identity(self.rows[provider_id], by_id[listing["listingId"]])[0].values()))
                self.assertEqual(listing["sourceDate"], "2026-10-06")
                self.assertRegex(listing["sourceUrl"], r"^https://www\.fideliscarenj\.com/content/dam/centene/wellcare/nj/pdfs/directories/NJ_Caid_Provider_Directory_Region_[1-4]_[12]_Eng_Spa_R\.PDF$")

    def test_source_based_exact_office_example(self):
        item = self.verified["north-jersey-hp-hp0208800"]["listings"][0]
        self.assertEqual(
            {field: item[field] for field in ("listingName", "address", "city", "zip", "phone", "specialty", "physicalPage", "printedPage")},
            {"listingName": "Elite Homecare LLC", "address": "1215 Livingston Ave, Ste 5",
             "city": "North Brunswick", "zip": "08902-3840", "phone": "(732) 964-0062",
             "specialty": "Private Duty Nursing, Respite Care", "physicalPage": 187, "printedPage": "172"},
        )
        source = next(page["raw"] for page in self.pages["3_1"] if page["physicalPage"] == 187)
        self.assertIn("Elite Homecare LLC\nProvider ID: 2013785\nSubspecialty: Private Duty\nNursing, Respite Care\n1215 Livingston Ave, Ste 5\nNorth Brunswick, NJ 08902-3840\n(732) 964-0062", source)
        self.assertIsNone(next(item for item in self.listings
                               if item["listingName"] == "Elite Homecare LLC")["practiceName"])

    def test_valley_hospice_is_a_directory_fact_not_a_home_care_claim(self):
        fact = self.verified["north-jersey-hp-hp0174100"]
        self.assertEqual(len(fact["listings"]), 1)
        listing = fact["listings"][0]
        self.assertEqual(
            {key: listing[key] for key in (
                "directoryProviderId", "listingName", "practiceName", "address", "city",
                "zip", "phone", "directorySection", "physicalPage", "printedPage",
            )},
            {"directoryProviderId": "3452476", "listingName": "Valley Home Care Inc",
             "practiceName": "Valley Hospice", "address": "15 Essex Rd, Ste 301",
             "city": "Paramus", "zip": "07652-1457", "phone": "(201) 291-6000",
             "directorySection": "Hospice", "physicalPage": 212, "printedPage": "197"},
        )
        self.assertIn("NOT a PCA/home-care payer claim", listing["serviceEvidenceLimitation"])
        self.assertIn("hospice eligibility", listing["serviceEvidenceLimitation"])

    def test_original_thirty_records_and_forty_one_occurrences_are_unchanged(self):
        original = {key: value for key, value in self.verified.items()
                    if key != "north-jersey-hp-hp0174100"}
        self.assertEqual(len(original), 30)
        self.assertEqual(sum(len(fact["listings"]) for fact in original.values()), 41)
        self.assertEqual(hashlib.sha256(json.dumps(original, sort_keys=True).encode()).hexdigest(),
                         "dcdb563cb2183f1a96fda2348afb771f13f07775f898d01b5569ece9f29ce858")

    def test_independent_full_pdf_phone_scan_has_no_unreviewed_hits(self):
        regions = json.loads(gzip.decompress((ROOT / "sources/full-raw-pages.json.gz").read_bytes()))
        phones = {re.sub(r"\D", "", row["phone"])[:10] for row in self.rows.values()}
        expected = []
        for region, evidence in regions.items():
            for number, raw in enumerate(evidence["pages"], 1):
                for match in re.finditer(r"\(\d{3}\)\s+\d{3}-\d{4}", raw):
                    phone = re.sub(r"\D", "", match.group())
                    if phone in phones:
                        expected.append((region, number, raw.count("\n", 0, match.start()) + 1, phone))
        hits = self.outputs["phone-audit.json"]
        self.assertEqual(expected, [(hit["region"], hit["physicalPage"], hit["line"], hit["phone"]) for hit in hits])
        self.assertEqual(len(hits), 184)
        self.assertEqual(collections.Counter(hit["scope"] for hit in hits),
                         {"home_care": 160, "broader_directory": 24})
        self.assertEqual(sum(len(item["pages"]) for item in regions.values()), 2012)
        self.assertEqual(len(phones), 1047)

    def test_full_raw_pages_agree_with_every_previously_retained_page(self):
        regions = json.loads(gzip.decompress((ROOT / "sources/full-raw-pages.json.gz").read_bytes()))
        for region, pages in self.pages.items():
            for page in pages:
                self.assertEqual(page["raw"], regions[region]["pages"][page["physicalPage"] - 1])

    def test_broader_blocks_are_literal_source_with_exact_printed_services(self):
        regions = json.loads(gzip.decompress((ROOT / "sources/full-raw-pages.json.gz").read_bytes()))
        broader = self.outputs["broader-directory-listings.json"]
        self.assertEqual(len(broader), 24)
        self.assertEqual(collections.Counter(item["directorySection"] for item in broader), {
            "Hospice": 5, "Psychology": 1, "Skilled Nursing Facility": 4,
            "Retail": 3, "Internal Medicine": 1, "Substance Abuse": 1,
            "Child Development Center": 1, "Licensed Clinical Social Worker": 7,
            "Assisted Living Services": 1,
        })
        for listing in broader:
            lines = regions[listing["region"]]["pages"][listing["physicalPage"] - 1].splitlines()
            start, end = listing["sourceLineRange"]
            self.assertEqual(listing["rawListingLines"], lines[start - 1:end])
            self.assertEqual(listing["phone"], lines[end - 1])
            start, end = listing["sourceHeadingLines"]
            self.assertEqual(re.sub(r"\s*- cont\.$", "", " ".join(lines[start - 1:end])),
                             listing["directorySection"])

    def test_phone_hits_already_in_home_care_are_also_audited_outside_it(self):
        home_phones = {replay.phone_digits(item["phone"]) for item in self.listings}
        broader = self.outputs["broader-directory-listings.json"]
        repeated = [item for item in broader if replay.phone_digits(item["phone"]) in home_phones]
        self.assertEqual(len(repeated), 5)
        self.assertEqual(collections.Counter(item["listingName"] for item in repeated), {
            "Caliberhealth Plus FC": 3, "Faith Hospice Care LLC": 1,
            "Owen Home Health Agency Inc": 1,
        })
        for item in repeated:
            self.assertFalse(any(all(replay.identity(row, item)[0].values()) for row in self.rows.values()))

    def test_clinician_practice_cannot_verify_an_organization_even_with_exact_alias(self):
        clinicians = [item for item in self.outputs["broader-directory-listings.json"]
                      if item["providerKind"] == "practitioner"]
        self.assertEqual(len(clinicians), 9)
        for listing in clinicians:
            row = {**self.rows["north-jersey-hp-hp0252100"],
                   **{key: listing[key] for key in ("address", "city", "zip", "phone")},
                   "legalName": listing["practiceName"], "stateRegisteredTradeNames": ""}
            self.assertFalse(replay.identity(row, listing)[0]["organization"])
            row["legalName"] = listing["listingName"]
            checks, _ = replay.identity(row, listing)
            self.assertTrue(checks["organization"])
            self.assertFalse(checks["organizationProvider"])

    def test_broader_mismatches_stay_in_main_dispositions(self):
        broader_ids = {item["listingId"] for item in self.outputs["broader-directory-listings.json"]}
        self.assertEqual(broader_ids, {
            candidate["listingId"] for item in self.ledger.values() for candidate in item["candidates"]
            if candidate["listingId"] in broader_ids
        })
        for provider_id in (
            "north-jersey-hp-hp0218000", "north-jersey-hp-hp0021207",
            "north-jersey-hp-hp0324700", "north-jersey-hp-hp0241200",
            "north-jersey-hp-hp0049900", "north-jersey-hp-hp0252100",
            "north-jersey-hp-hp0350300", "north-jersey-hp-hp0065600",
        ):
            self.assertEqual(self.ledger[provider_id]["status"], "hold")
            self.assertTrue(any(candidate["listingId"] in broader_ids
                                for candidate in self.ledger[provider_id]["candidates"]))

    def test_roster_extension_is_scanned_but_not_silently_dropped_for_verification(self):
        item = self.ledger["north-jersey-hp-hp0284100"]
        self.assertEqual(item["fullDirectoryPhoneAudit"]["basePhoneScanned"], "9087227022")
        self.assertEqual(item["fullDirectoryPhoneAudit"]["hitIds"], ["4_2:p175:l19:c0"])
        self.assertEqual(item["status"], "hold")
        candidate = next(candidate for candidate in item["candidates"]
                         if candidate["listingId"] == "4_2:p175:raw15")
        self.assertFalse(candidate["checks"]["phone"])
        self.assertFalse(candidate["checks"]["organization"])

    def test_missing_review_or_phone_audit_evidence_fails_closed(self):
        original = Path.read_bytes
        path = ROOT / "sources/broader-review.json"
        reviews = json.loads(path.read_bytes())
        for changed in (reviews[:-1], reviews + [reviews[0]]):
            def read(candidate, *args, **kwargs):
                return replay.encoded(changed) if candidate == path else original(candidate, *args, **kwargs)
            with self.subTest(length=len(changed)), patch.object(Path, "read_bytes", read):
                with self.assertRaises(AssertionError):
                    replay.build()

    def test_tampered_full_raw_provenance_page_or_hash_fails(self):
        original = Path.read_bytes
        raw_path = ROOT / "sources/full-raw-pages.json.gz"
        manifest_path = ROOT / "sources/full-raw-manifest.json"
        regions = json.loads(gzip.decompress(raw_path.read_bytes()))
        for field, value in (
            ("sourceUrl", "https://example.com/other.pdf"), ("sourcePdfSha256", "0" * 64),
            ("sourceDate", "2026-11-14"), ("checkedDate", "2026-11-15"),
            ("pages", regions["1_1"]["pages"][:-1]),
        ):
            altered = copy.deepcopy(regions)
            altered["1_1"][field] = value
            payload = replay.encoded(altered)
            metadata = json.loads(manifest_path.read_bytes())
            metadata["uncompressedSha256"] = replay.digest(payload)
            def read(candidate, *args, **kwargs):
                if candidate == raw_path:
                    return gzip.compress(payload, mtime=0)
                if candidate == manifest_path:
                    return replay.encoded(metadata)
                return original(candidate, *args, **kwargs)
            with self.subTest(field=field), patch.object(Path, "read_bytes", read):
                with self.assertRaises(AssertionError):
                    replay.build()

    def test_counts_separate_home_occurrences_broader_candidates_and_phone_coverage(self):
        counts = self.outputs["counts.json"]
        self.assertEqual(counts["homeCareListingOccurrences"], 298)
        self.assertEqual(counts["broaderDirectoryListingOccurrences"], 24)
        self.assertEqual(counts["totalAuditedDirectoryListingOccurrences"], 322)
        self.assertEqual(counts["verifiedListingOccurrences"], 42)
        self.assertEqual(counts["comparisonCount"], 345828)
        self.assertEqual(counts["homeCareComparisonCount"], 320052)
        audit = counts["phoneAudit"]
        self.assertEqual(audit["pagesScanned"], 2012)
        self.assertEqual(audit["rosterRowsScanned"], 1074)
        self.assertEqual(audit["rosterRowsWithExtensions"], 4)
        self.assertEqual(audit["unexaminedPhoneHits"], 0)
        self.assertEqual(audit["unexaminedSourcePages"], 0)

    def test_no_specialty_is_inferred_from_home_care_section(self):
        item = self.verified["north-jersey-hp-hp0038100"]["listings"][0]
        self.assertEqual(item["directorySection"], "Licensed Home Care Service Agency")
        self.assertIsNone(item["specialty"])
        self.assertEqual(sum(item["specialty"] is not None for item in self.listings), 3)

    def test_registered_dba_is_explicit_and_office_specific(self):
        fact = self.verified["north-jersey-hp-hp0120800"]["listings"][0]
        self.assertEqual(fact["organizationBasis"], {
            "field": "stateRegisteredTradeNames", "value": "AVEANNA HEALTHCARE",
        })
        self.assertEqual(fact["address"], "77 Brant Ave, Ste 320")

    def test_registered_name_at_an_alternate_office_stays_on_hold(self):
        item = self.ledger["north-jersey-hp-hp0153402"]
        self.assertEqual(item["reason"], "identity_discrepancy")
        self.assertTrue(any(candidate["checks"]["organization"] for candidate in item["candidates"]))
        self.assertTrue(all(not candidate["checks"]["streetAndUnit"] for candidate in item["candidates"]))

    def test_phone_mismatch_is_a_hold_even_for_registered_dba(self):
        item = self.ledger["north-jersey-hp-hp0000216"]
        self.assertEqual(item["status"], "hold")
        candidates = [candidate for candidate in item["candidates"]
                      if candidate["checks"]["organization"] and candidate["checks"]["streetAndUnit"]]
        self.assertTrue(candidates)
        self.assertTrue(all(not candidate["checks"]["phone"] for candidate in candidates))

    def test_exact_address_and_phone_do_not_override_organization(self):
        item = self.ledger["north-jersey-hp-hp0022500"]
        self.assertEqual(item["status"], "hold")
        self.assertTrue(any(candidate["discrepancies"] == ["organization"] for candidate in item["candidates"]))

    def test_other_offices_suites_and_phones_cannot_verify(self):
        original = self.rows["north-jersey-hp-hp0208800"]
        listing = next(item for item in self.listings if item["listingName"] == "Elite Homecare LLC")
        for field, value in (
            ("address", "1215 Livingston Avenue, Suite 6"),
            ("address", "1215 Livingston Avenue"),
            ("address", "1217 Livingston Avenue, Suite 5"),
            ("city", "New Brunswick"), ("zip", "08901"), ("phone", "(732) 964-0063"),
            ("legalName", "Elite Homecare Inc"),
        ):
            row = {**original, field: value}
            self.assertFalse(all(replay.identity(row, listing)[0].values()), (field, value))

    def test_documented_formatting_does_not_drop_suite_or_floor(self):
        self.assertEqual(replay.street("286 UNION STREET, 2ND FLOOR"), replay.street("286 Union St, Fl2"))
        self.assertEqual(replay.street("1215 Livingston Avenue, Suite #5"), replay.street("1215 Livingston Ave, Ste 5"))
        self.assertNotEqual(replay.street("1215 Livingston Ave"), replay.street("1215 Livingston Ave, Ste 5"))
        self.assertNotEqual(replay.street("1215 Livingston Ave, Ste 1A, 1B & 4B"), replay.street("1215 Livingston Ave, Ste 1A"))
        self.assertNotEqual(replay.organization("Elite Homecare LLC"), replay.organization("Elite Homecare"))

    def test_location_holds_are_never_released(self):
        held = [key for key, row in self.rows.items() if row["locationHold"]]
        self.assertEqual(len(held), 4)
        self.assertTrue(all(self.ledger[key]["reason"] == "roster_location_hold" for key in held))

    def test_tampered_source_provenance_fails(self):
        manifest = json.loads((ROOT / "sources/manifest.json").read_text())
        original = Path.read_text
        for field, value in (
            ("url", "https://example.com/other.pdf"), ("sourceDate", "2026-11-15"),
            ("evidenceSha256", "0" * 64), ("pdfSha256", "not-a-hash"),
        ):
            altered = copy.deepcopy(manifest)
            altered["sources"]["1_1"][field] = value

            def changed(path, *args, **kwargs):
                if path == ROOT / "sources/manifest.json":
                    return json.dumps(altered)
                return original(path, *args, **kwargs)

            with self.subTest(field=field), patch.object(Path, "read_text", changed):
                with self.assertRaises(AssertionError):
                    replay.build()

    def test_invalid_physical_and_printed_pages_fail_even_with_updated_evidence_hash(self):
        original_text, original_bytes = Path.read_text, Path.read_bytes
        for field, value in (("physicalPage", 0), ("printedPage", "9999")):
            pages = copy.deepcopy(self.pages["1_1"])
            pages[3][field] = value
            payload = replay.encoded(pages)
            manifest = json.loads((ROOT / "sources/manifest.json").read_text())
            manifest["sources"]["1_1"]["evidenceSha256"] = replay.digest(payload)

            def changed_text(path, *args, **kwargs):
                if path == ROOT / "sources/manifest.json":
                    return json.dumps(manifest)
                return original_text(path, *args, **kwargs)

            def changed_bytes(path, *args, **kwargs):
                if path == ROOT / "sources/region-1_1.pages.json":
                    return payload
                return original_bytes(path, *args, **kwargs)

            with self.subTest(field=field), patch.object(Path, "read_text", changed_text), patch.object(Path, "read_bytes", changed_bytes):
                with self.assertRaises(AssertionError):
                    replay.build()


if __name__ == "__main__":
    unittest.main()
