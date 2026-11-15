#!/usr/bin/env python3
"""Behavioral checks against original retained NJ source rows and release inputs."""

from collections import Counter
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from copy import deepcopy
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/regions/normalize-nj.py"
spec = importlib.util.spec_from_file_location("normalize_nj", SCRIPT)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
collector_spec = importlib.util.spec_from_file_location("nj_collector", SCRIPT.with_name("nj_collect.py"))
collector = importlib.util.module_from_spec(collector_spec)
collector_spec.loader.exec_module(collector)


class CmsNursingContextTests(unittest.TestCase):
    def setUp(self):
        self.provider = {"id": "cms-315001", "state": "NJ", "category": "nursing-home",
                         "cms": {"ccn": "315001"}, "address": "1 Shared Street"}
        self.row = {adapter.CCN: "315001", "state": "NJ", "processing_date": "2026-10-01",
                    "provider_type": "Medicare", "with_a_resident_and_family_council": "Resident"}
        self.metadata = {"retrieved_at": "2026-11-12T15:02:07+00:00", "released": "2026-10-28",
                         "landing_url": "https://data.cms.gov/provider-data/dataset/4pq5-n9py"}

    def project(self, row=None, providers=None, research=None):
        result = research if research is not None else {}
        adapter.add_cms_nursing_context([self.row if row is None else row], self.metadata,
                                       [self.provider] if providers is None else providers, result)
        return result

    def size_fact(self, **fields):
        record = self.project({**self.row, **fields})["cms-315001"]
        facts = [f for f in record["facts"] if f["id"].endswith("-cms-size-setting")]
        self.assertLessEqual(len(facts), 1)
        return facts[0] if facts else None

    def test_certified_beds_are_positive_integers_not_openings(self):
        for value in ("1", 1, "120", 120, "00120"):
            with self.subTest(value=value):
                fact = self.size_fact(number_of_certified_beds=value)
                self.assertEqual(fact, {
                    "id": "cms-315001-cms-size-setting", "kind": "care",
                    "text": f"Certified capacity is {int(value)} {'bed' if int(value) == 1 else 'beds'}. Ask admissions about current openings.",
                    "sourceId": "cms-315001-cms-provider-information", "asOf": "2026-10-01",
                })
        for value in (None, "", "0", 0, -1, "-1", "120.5", 120.5, "120.0", 120.0,
                      True, False, [], {}, "N/A", "120 beds", "1,200", "$120", "1e2",
                      " 120 ", "١٢٠", float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assertIsNone(self.size_fact(number_of_certified_beds=value))

    def test_positive_designations_survive_bad_beds_independently(self):
        labels = {
            "continuing_care_retirement_community": "The nursing home is part of a continuing care retirement community (CCRC)",
            "provider_resides_in_hospital": "The nursing home is located in a hospital",
        }
        for field, label in labels.items():
            with self.subTest(field=field):
                fact = self.size_fact(**{field: "Y", "number_of_certified_beds": "999 bad"})
                self.assertEqual(fact["text"], f"{label}. "
                                 "Ask admissions about openings and access to other care levels.")
                self.assertNotRegex(fact["text"], r"\d")
        fact = self.size_fact(number_of_certified_beds="120",
                              continuing_care_retirement_community="Y", provider_resides_in_hospital="Y")
        self.assertEqual(fact["text"], "Certified capacity is 120 beds. "
                         "The nursing home is part of a continuing care retirement community (CCRC). The nursing home is located in a hospital. "
                         "Ask admissions about openings and access to other care levels.")

    def test_negative_missing_and_malformed_designations_add_no_filler(self):
        fields = ("continuing_care_retirement_community", "provider_resides_in_hospital")
        for field in fields:
            other = next(f for f in fields if f != field)
            expected = self.size_fact(**{"number_of_certified_beds": "120", other: "Y"})
            for value in (None, "", "N", "Unknown", "N/A", "Yes", "y", " Y ", 1, 0, True, False, [], {}):
                with self.subTest(field=field, value=value):
                    self.assertEqual(self.size_fact(**{field: value, other: "Y",
                                                      "number_of_certified_beds": "120"}), expected)
                    self.assertIsNone(self.size_fact(**{field: value}))
        row = {adapter.CCN: "315001", "state": "NJ", "processing_date": "2026-10-01"}
        self.assertEqual(self.project(row), {})
        self.assertEqual(self.project({**row, "number_of_certified_beds": "bad",
                                      fields[0]: "N", fields[1]: None}), {})
        result = self.project({**row, fields[0]: "Y"})
        self.assertEqual(len(result["cms-315001"]["facts"]), 1)
        self.assertEqual(len(result["cms-315001"]["sources"]), 1)

    def test_resident_family_both_and_none_are_distinct(self):
        expected = {
            "Resident": "CMS lists a resident council only.",
            "Family": "CMS lists a family council only.",
            "Both": "CMS lists both a resident council and a family council.",
            "None": "CMS lists neither a resident nor a family council.",
        }
        for value, text in expected.items():
            with self.subTest(value=value):
                result = self.project({**self.row, "with_a_resident_and_family_council": value})
                self.assertEqual(result["cms-315001"]["facts"][1]["text"], text)

    def test_absent_and_malformed_fields_are_omitted_independently(self):
        for field in ("provider_type", "with_a_resident_and_family_council"):
            for value in (None, "", "Unknown", "resident", "N/A", [], {}, 0, True):
                with self.subTest(field=field, value=value):
                    result = self.project({**self.row, field: value})
                    facts = result["cms-315001"]["facts"]
                    self.assertEqual(len(facts), 1)
                    self.assertEqual(facts[0]["id"], "cms-315001-cms-" +
                                     ("councils" if field == "provider_type" else "program-participation"))
            row = {**self.row}
            del row[field]
            self.assertEqual(len(self.project(row)["cms-315001"]["facts"]), 1)
        row = {k: v for k, v in self.row.items()
               if k not in ("provider_type", "with_a_resident_and_family_council")}
        self.assertEqual(self.project(row), {})
        for value in (None, "", "2026-02-30", "2026-1-01", "unknown", [], {}):
            with self.subTest(date=value):
                self.assertEqual(self.project({**self.row, "number_of_certified_beds": "120",
                                               "processing_date": value}), {})
        for value in (None, "", "31501", "0315001", 315001, [], {}):
            with self.subTest(ccn=value):
                self.assertEqual(self.project({**self.row, "number_of_certified_beds": "120",
                                               adapter.CCN: value}), {})

    def test_colocated_units_and_other_states_do_not_inherit_facts(self):
        self.row.update(number_of_certified_beds="120", continuing_care_retirement_community="Y",
                        provider_resides_in_hospital="Y")
        siblings = [
            {**self.provider, "id": "north-jersey-doh-nj1234", "cms": {"ccn": "315001"}},
            {**self.provider, "id": "cms-315002", "cms": {"ccn": "315002"}},
        ]
        result = self.project(providers=[self.provider, *siblings])
        self.assertEqual(set(result), {"cms-315001"})
        for changes in ({"state": "MA"}, {"category": "assisted-living"},
                        {"category": "life-plan"}, {"cms": {"ccn": "315002"}}):
            with self.subTest(changes=changes):
                self.assertEqual(self.project(providers=[{**self.provider, **changes}]), {})
        self.assertEqual(self.project({**self.row, "state": "MA"}), {})
        self.assertEqual(self.project({**self.row, adapter.CCN: "315002"}), {})
        self.assertEqual(self.project(providers=[]), {})

    def test_existing_reviews_availability_and_clinical_fields_are_untouched(self):
        self.row.update(number_of_certified_beds="120", continuing_care_retirement_community="Y",
                        provider_resides_in_hospital="Y")
        research = {"cms-315001": {
            "checkedAt": "2026-11-15", "providerDetailsReviewed": False,
            "facts": [{"id": "existing"}], "sources": [{"id": "existing"}],
            "reviews": [{"id": "review"}], "reviewAggregates": [{"rating": 4}],
            "availability": {"status": "inquiry-only"}, "notes": ["Retained note"],
        }}
        before = deepcopy(research)
        provider = deepcopy(self.provider)
        self.project(research=research)
        self.assertEqual(self.provider, provider)
        record = research["cms-315001"]
        for field in ("reviews", "reviewAggregates", "availability", "notes", "checkedAt"):
            self.assertEqual(record[field], before["cms-315001"][field])
        self.assertEqual(record["facts"][0], {"id": "existing"})
        self.assertEqual(record["sources"][0], {"id": "existing"})


class ActualSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files, cls.manifest = adapter.normalize(adapter.RESEARCH, adapter.COUNTIES)
        cls.providers = json.loads(cls.files["providers.json"])
        cls.by_id = {provider["id"]: provider for provider in cls.providers}
        cls.crosswalk = json.loads(cls.files["crosswalk.json"])
        cls.ledger = json.loads(cls.files["unresolved-exclusions.json"])
        cls.original = collector.workbook_rows(adapter.RESEARCH / "state/raw/ltc.xlsx")
        cls.points = json.loads((adapter.RESEARCH / "address-points/providers-by-id.json").read_bytes())
        cls.original_by_id = {row["FacID"]: row for row in cls.original}

    def test_size_and_positive_settings_match_all_139_exact_retained_units(self):
        rows = json.loads((adapter.RESEARCH / "cms/datasets/4pq5-n9py.json").read_bytes())
        rows = [r for r in rows if r["countyparish"] in adapter.COUNTIES]
        research = json.loads(self.files["locationResearch.json"])
        facts = {pid: [f for f in record["facts"] if f["id"].endswith("-cms-size-setting")]
                 for pid, record in research.items()}
        facts = {pid: values for pid, values in facts.items() if values}
        self.assertEqual(set(facts), {"cms-" + r[adapter.CCN] for r in rows})
        self.assertEqual(len(facts), 139)
        ccrc = hospital = 0
        for row in rows:
            pid = "cms-" + row[adapter.CCN]
            fact, = facts[pid]
            self.assertIn(f'Certified capacity is {int(row["number_of_certified_beds"])} beds', fact["text"])
            self.assertIn("Certified capacity is", fact["text"])
            self.assertEqual("continuing care retirement community (CCRC)" in fact["text"],
                             row["continuing_care_retirement_community"] == "Y")
            self.assertEqual("The nursing home is located in a hospital" in fact["text"],
                             row["provider_resides_in_hospital"] == "Y")
            ccrc += "continuing care retirement community (CCRC)" in fact["text"]
            hospital += "The nursing home is located in a hospital" in fact["text"]
            self.assertEqual(fact["asOf"], row["processing_date"])
            self.assertEqual(fact["kind"], "care")
            self.assertNotIn("amount", fact)
            self.assertNotIn("numericValue", fact)
            self.assertEqual(fact["sourceId"], f"{pid}-cms-provider-information")
            self.assertEqual(sum(s["id"] == fact["sourceId"] for s in research[pid]["sources"]), 1)
        self.assertEqual((ccrc, hospital), (8, 6))

    def test_cms_participation_and_councils_match_exact_retained_units(self):
        inputs = adapter.Inputs(adapter.RESEARCH)
        manifest = inputs.json("cms/manifest.json")
        rows, metadata = adapter.cms_dataset(inputs, manifest, "4pq5-n9py")
        rows = [r for r in rows if r["countyparish"] in adapter.COUNTIES]
        research = json.loads(self.files["locationResearch.json"])
        published = {}
        for pid, record in research.items():
            facts = [f for f in record["facts"] if f["id"] in
                     (f"{pid}-cms-program-participation", f"{pid}-cms-councils")]
            if facts:
                published[pid] = facts
        self.assertEqual(set(published), {"cms-" + r[adapter.CCN] for r in rows})
        self.assertEqual(len(published), 139)
        self.assertEqual(Counter(r["provider_type"] for r in rows),
                         {"Medicare and Medicaid": 131, "Medicare": 8})
        self.assertEqual(Counter(r["with_a_resident_and_family_council"] for r in rows),
                         {"Resident": 122, "Both": 10, "None": 7})
        for row in rows:
            pid = "cms-" + row[adapter.CCN]
            facts = published[pid]
            self.assertEqual(len(facts), 2)
            self.assertTrue(all(f["kind"] == "care" and f["asOf"] == "2026-10-01" and
                                "amount" not in f for f in facts))
            source, = [s for s in research[pid]["sources"]
                       if s["id"] == facts[0]["sourceId"]]
            self.assertEqual(source["kind"], "regulator")
            self.assertEqual(source["checkedAt"], metadata["retrieved_at"][:10])
            self.assertEqual(source["publishedAt"], metadata["released"][:10])
            self.assertEqual(source["url"], metadata["landing_url"])
            self.assertIn(row[adapter.CCN], source["title"])
            self.assertIn(row["processing_date"], source["title"])
            if row["provider_type"] == "Medicare":
                self.assertIn("Medicaid participation is not reported.", facts[0]["text"])
            self.assertEqual(self.by_id[pid]["category"], "nursing-home")
            self.assertEqual(self.by_id[pid]["cms"]["ccn"], row[adapter.CCN])

    def test_federal_history_is_bound_to_the_registered_office_identity(self):
        inputs = adapter.Inputs(adapter.RESEARCH)
        pid = "north-jersey-hp-hp0015320"
        office = self.by_id[pid]
        research = {}
        adapter.add_federal_home_care_history(inputs, [office], research)
        facts = research[pid]["facts"]
        enrollment = next(f for f in facts if f["id"] == pid + "-hhs-nj-enrollment")
        self.assertIn("December 2018", enrollment["text"])
        self.assertEqual(research[pid]["reviewAggregates"], [])
        self.assertTrue(all(f["kind"] == "care" and "amount" not in f for f in facts))
        with self.assertRaisesRegex(ValueError, "no longer matches registered office"):
            adapter.add_federal_home_care_history(inputs, [{**office, "address": "Different office"}], {})

    def test_verified_services_reject_changed_offices_and_colocated_suites(self):
        from nj_pay_context import add_county_home_care_context
        pid = "north-jersey-hp-hp0366200"
        provider = self.by_id[pid]
        inputs = adapter.Inputs(adapter.RESEARCH)
        original_json = inputs.json
        row = next(r for r in inputs.json("home-care-pay-services/verified-office-services.json")
                   if r["providerId"] == pid)
        before = deepcopy(row)
        for field, value in (("street", "7 Glenwood Avenue, Suite 412"),
                             ("name", "Another registered firm"), ("city", "Newark"),
                             ("zip", "07102"), ("phone", "973-965-0366")):
            with self.subTest(field=field):
                changed = {**row, field: value}
                with patch.object(inputs, "json", side_effect=lambda path:
                                  [changed] if path.endswith("/verified-office-services.json")
                                  else original_json(path)):
                    with self.assertRaisesRegex(ValueError, "Changed office service identity"):
                        add_county_home_care_context(inputs, [provider], {})
        research = {}
        add_county_home_care_context(inputs, [provider], research)
        fact, = [f for f in research[pid]["facts"] if f["id"] == pid + "-office-services"]
        self.assertEqual(fact["text"], row["text"])
        self.assertEqual(row, before)
        self.assertEqual(provider["phone"], row["phone"])

    def test_every_original_doh_row_has_exactly_one_disposition(self):
        dispositions = [row for row in self.crosswalk + self.ledger if row["source"] == "NJ DOH All_LTC"]
        self.assertEqual(len(self.original), 894)
        self.assertEqual(Counter(row["officialId"] for row in dispositions),
                         Counter(row["FacID"] for row in self.original))
        for row in dispositions:
            original = self.original_by_id[row["officialId"]]
            self.assertEqual(row["sourceRow"], original["source_row"])
            self.assertEqual(row["license"], original["LIC#"])
            self.assertEqual(row["licensedName"], original["LICENSED_NAME"])
            self.assertEqual(row["licensedSetting"], original["FACILITY_TYPE"])
            if row["status"] != "included":
                continue
            provider = self.by_id[row["providerId"]]
            self.assertEqual(provider["zip"], original["ZIP"][:5])
            self.assertEqual(provider["city"], original["FAC_CITY"])
            self.assertEqual(provider["address"], " ".join(original["ADDRESS"].split()))
            self.assertEqual(row["sourceAsOf"], "2026-11-06")
            self.assertEqual(provider["sources"][0]["dataAsOf"], "2026-11-06")
            if float(original["LAT"]) and float(original["LNG"]):
                self.assertEqual(self.points[provider["id"]]["suppliedCoordinate"]["lat"], float(original["LAT"]))
                self.assertEqual(self.points[provider["id"]]["suppliedCoordinate"]["lng"], float(original["LNG"]))

    def test_all_six_counties_have_actual_licensed_units(self):
        included = [row for row in self.crosswalk if row["source"] == "NJ DOH All_LTC"]
        self.assertEqual(Counter(row["county"] for row in included),
                         {"Union": 34, "Morris": 54, "Essex": 55, "Bergen": 72, "Hudson": 18, "Passaic": 29})

    def test_morristown_union_and_separate_denville_units(self):
        doh = {row["officialId"]: self.by_id[row["providerId"]] for row in self.crosswalk
               if row["source"] == "NJ DOH All_LTC"}
        self.assertEqual(doh["NJ60921"]["name"], "CAREONE AT MADISON AVENUE")
        self.assertIn("151 MADISON AVENUE", doh["NJ60921"]["address"])
        self.assertEqual(doh["NJ60921"]["zip"], "07960")
        self.assertEqual(doh["NJ62004"]["zip"], "07083")
        self.assertIn("234 CHESTNUT STREET", doh["NJ62004"]["address"])
        self.assertNotEqual(doh["NJ60A002"]["id"], doh["NJ61424"]["id"])
        self.assertIn("19 POCONO ROAD", doh["NJ60A002"]["address"])
        self.assertIn("21 POCONO ROAD", doh["NJ61424"]["address"])
        self.assertNotIn("cms", doh["NJ60A002"])
        self.assertEqual(doh["NJ60A002"]["category"], "assisted-living")
        self.assertEqual(doh["NJ61424"]["category"], "nursing-home")

    def test_active_firms_are_source_registrations_not_certified_brands(self):
        old = {r["source_row"]: r for r in collector.workbook_rows(adapter.RESEARCH / "state/raw/firms.xlsx")}
        live_file = "home-care-supply/source/firms.xlsx"
        live = {r["source_row"]: r for r in collector.workbook_rows(adapter.RESEARCH / live_file)}
        firms = [r for r in self.crosswalk if r["source"] == "NJ HP registry"]
        self.assertEqual(len({r["providerId"] for r in firms}), 1074)
        for r in firms:
            raw = live if r.get("sourceFile") == live_file else old
            original = raw[r["sourceRow"]]
            self.assertEqual(original["License Status"], "Active")
            self.assertEqual(r["officialId"].upper(), original["License/Registration"].upper())
            provider = self.by_id[r["providerId"]]
            self.assertEqual(provider["name"], original["Business Name"])
            self.assertEqual(provider["address"], " ".join(original["Business Address"].split()))
            self.assertNotIn("cms", provider)
            self.assertNotIn("dataAsOf", provider["sources"][0])
            if provider.get("services") or provider.get("serviceArea"):
                self.assertTrue(any(s["kind"] == "provider" for s in provider["sources"]))
        original_dispositions = [r for r in self.crosswalk + self.ledger if r["source"] == "NJ HP registry" and r.get("sourceFile") != live_file]
        self.assertEqual(Counter(r["sourceRow"] for r in original_dispositions), Counter(old.keys()))
        self.assertEqual(len(live), 3628)

    def test_historical_campuses_have_no_invented_certification_or_date(self):
        campuses = [p for p in self.providers if p["category"] == "life-plan"]
        self.assertEqual(len(campuses), 7)
        for provider in campuses:
            self.assertNotIn("cms", provider)
            self.assertNotIn("capacity", provider)
            self.assertNotIn("dataAsOf", provider["sources"][0])
            self.assertIn("January 2018", provider["description"])
            self.assertTrue(provider["warnings"])

    def test_operator_testimonials_and_manual_profile_links(self):
        research = json.loads(self.files["locationResearch.json"])
        for pid in ("cms-315307", "cms-315101"):
            record = research[pid]
            sources = {s["id"]: s for s in record["sources"]}
            quotes = [r for r in record["reviews"] if sources[r["sourceId"]]["kind"] == "provider"]
            self.assertEqual({r["relationship"] for r in quotes}, {"family", "resident"})
            self.assertEqual(len(quotes), 2)
            self.assertLessEqual(sum(len(r["excerpt"].split()) for r in quotes), 25)
            for quote in quotes:
                self.assertEqual(quote["url"], sources[quote["sourceId"]]["url"])
                self.assertEqual(quote["aspects"], [])
                self.assertEqual((quote["rating"], quote["scale"], quote["date"]), (None, None, None))
        for pid in ("cms-315307", "north-jersey-doh-nj60a004"):
            record = research[pid]
            link, = record["reviewLinks"]
            self.assertEqual(set(link), {"publisher", "url"})
            self.assertEqual(link["publisher"], "Caring.com")
            self.assertNotIn(link["url"], [s["url"] for s in record["sources"]])

    def test_no_source_candidates_become_published_reviews(self):
        research = json.loads(self.files["locationResearch.json"])
        findings = json.loads((adapter.RESEARCH / "offerings/locationResearch.json").read_bytes())
        for pid, record in findings.items():
            self.assertTrue(all(f in research[pid]["facts"] for f in record["facts"]))
            if record["availability"]["sourceId"]:
                self.assertEqual(record["availability"], research[pid]["availability"])
        published = adapter.RESEARCH / "review-release/locationResearch.json"
        reviewed = json.loads(published.read_bytes()) if published.exists() else {}
        for pid, record in research.items():
            self.assertEqual(record["reviewAggregates"], reviewed.get(pid, {}).get("reviewAggregates", []))
        self.assertFalse(any(k.startswith("reviews/") for k in json.loads(self.files["source-inputs.json"])["files"]))
        facebook = json.loads(self.files["facebookResearch.json"])
        self.assertEqual(len(facebook["locations"]), 20)
        self.assertEqual(sum(len(row["findings"]) for row in facebook["locations"].values()), 2)
        self.assertEqual(sum(row["publishedObservationCount"] for row in facebook["locations"].values()), 8)
        self.assertTrue(all(finding["kind"] == "resident-family"
                            for row in facebook["locations"].values() for finding in row["findings"]))
        for provider in self.providers:
            self.assertNotIn("price", provider)
            self.assertNotIn("availability", provider)

    def test_address_accuracy_and_fallbacks_match_the_verified_release(self):
        points = json.loads((adapter.RESEARCH / "address-points/providers-by-id.json").read_bytes())
        for pid, row in points.items():
            provider = self.by_id[pid]
            if provider["lat"] is None:
                self.assertIsNone(provider["lng"])
                self.assertTrue(any("physical office location is unverified" in w for w in provider["warnings"]))
                continue
            self.assertEqual((provider["lat"], provider["lng"]), (row["lat"], row["lng"]))
            if row["status"] == "matched":
                self.assertIn(provider["locationKind"], ("facility", "office"))
                self.assertTrue(any(source["url"] == row["match"]["url"] for source in provider["sources"]))
                self.assertTrue(any("Entrance and suite are unverified." in note for note in provider["limitations"]))
            else:
                self.assertEqual(provider["locationKind"], row["suppliedCoordinate"]["locationKind"])
        self.assertEqual(sum(row["status"] == "matched" for row in points.values()), 853)

    def test_published_geography_and_evidence_denominators(self):
        stats = json.loads(self.files["validation.json"])["evidenceByCountyAndSetting"]
        actual = Counter()
        for county, settings in stats.items():
            self.assertIn(county, (*adapter.COUNTIES, *adapter.SUPPLY_COUNTIES))
            for count in settings.values():
                actual.update(count)
        self.assertEqual(actual["locations"], len(self.providers))
        self.assertEqual(actual["streetMatched"], 853 + 236)
        details = json.loads(self.files["locationResearch.json"])
        self.assertEqual(actual["locationsWithPublishedRate"],
                         sum(any(f.get("amount") for f in r["facts"]) for r in details.values()))
        self.assertEqual(actual["publishedWaitlists"],
                         sum(r["availability"]["status"] == "waitlist-published" for r in details.values()))

    def test_source_only_baseline_replays_retained_address_capture_inputs(self):
        files, _ = adapter.normalize(adapter.RESEARCH, adapter.COUNTIES, source_only=True)
        retained = adapter.RESEARCH / "address-points/inputs"
        for name in ("providers.json", "crosswalk.json", "zips.json", "meta.json"):
            self.assertEqual(files[name], (retained / name).read_bytes(), name)
        baseline = json.loads(files["meta.json"])
        published = json.loads(self.files["meta.json"])
        for county, totals in baseline["countyCounts"].items():
            current = published["countyCounts"][county]
            self.assertEqual({k:v for k,v in totals.items() if k != "home-care"}, {k:v for k,v in current.items() if k != "home-care"})
            self.assertGreaterEqual(current.get("home-care",0), totals.get("home-care",0))
        baseline_zips = json.loads(files["zips.json"])
        published_zips = json.loads(self.files["zips.json"])
        self.assertEqual({code: published_zips[code] for code in baseline_zips}, baseline_zips)
        baseline_ids = {p["id"] for p in json.loads(files["providers.json"])}
        self.assertLessEqual(baseline_ids, set(self.by_id))

    def test_real_runtime_validator_accepts_manifest(self):
        markets = adapter.validate_release(self.files, self.manifest)
        self.assertEqual(len(markets[0]["providers"]), len(self.providers))
        self.assertEqual(len(markets[0]["zips"]), 404)
        for provider in self.providers:
            if "cms" in provider:
                self.assertEqual(provider["id"], "cms-" + provider["cms"]["ccn"])
                self.assertEqual(provider["category"], "nursing-home")

    def test_cms_records_and_flags_match_actual_roster_rows(self):
        manifest = json.loads((adapter.RESEARCH / "cms/manifest.partial.json").read_text()) \
            if not (adapter.RESEARCH / "cms/manifest.json").exists() \
            else json.loads((adapter.RESEARCH / "cms/manifest.json").read_text())
        metadata = manifest.get("sources", {}).get("4pq5-n9py")
        if not metadata:
            self.skipTest("CMS roster has not completed collection")
        rows = [row for partition in metadata["partitions"] for page in partition["pages"]
                for row in json.loads((adapter.RESEARCH / "cms" / page["file"]).read_text())["results"]
                if row["countyparish"] in adapter.COUNTIES]
        self.assertEqual(len(rows), 139)
        self.assertEqual(Counter(row["countyparish"] for row in rows),
                         {"Union": 23, "Morris": 21, "Essex": 32, "Bergen": 29, "Hudson": 15, "Passaic": 19})
        for row in rows:
            provider = self.by_id["cms-" + row[adapter.CCN]]
            self.assertEqual(provider["cms"]["abuse"], row["abuse_icon"] == "Y")
            self.assertEqual(provider["cms"]["specialFocus"], row["special_focus_status"] or None)
            self.assertEqual(provider["cms"]["dataAsOf"], "2026-10-28")
            for key, column in [("overall", "overall_rating"), ("inspections", "health_inspection_rating"),
                                ("staffing", "staffing_rating"), ("quality", "qm_rating")]:
                expected = int(row[column]) if row[column].isdigit() else None
                self.assertEqual(provider["cms"][key], expected)

    def test_home_health_offices_use_actual_pos_counties_not_service_zips(self):
        release = json.loads(self.files["home-health-release-inputs.json"])
        if not (adapter.RESEARCH / "cms/pos/latest.json").exists():
            self.skipTest("POS supplement not yet verified")
        self.assertEqual(len(release["providers"]), 18)
        self.assertEqual(Counter(row["county"] for row in release["crosswalk"]),
                         {"Union": 1, "Morris": 3, "Essex": 4, "Bergen": 5, "Hudson": 3, "Passaic": 2})
        for row in release["crosswalk"]:
            payload = json.loads((adapter.RESEARCH / row["sourceFile"]).read_text())
            original = payload[row["sourceRowIndex"]]
            self.assertEqual(original["prvdr_num"], row["cmsCcn"])
            self.assertEqual(original["fips_state_cd"] + original["fips_cnty_cd"], row["officeCountyFips"])
            self.assertEqual(original["fed_crtfctn_stus_name"], "Certified")
        for provider in release["providers"]:
            self.assertNotIn("cms", provider)
            final = self.by_id[provider["id"]]
            for key in ("id", "name", "address", "category", "city", "state", "zip", "services"):
                self.assertEqual(final[key], provider[key])
            self.assertIn(provider["locationKind"], ("office", "zip"))
            self.assertNotIn("serviceArea", provider)
        self.assertEqual(release["status"], "included_verified_offices")
        self.assertTrue(all(row["status"] == "included" for row in release["crosswalk"]))
        self.assertFalse(any("requires_inapplicable_nursing_fields" in row["reason"] for row in self.ledger))

    def test_nursing_clinical_summaries_preserve_missing_and_footnoted_values(self):
        summaries = json.loads((adapter.RESEARCH / "clinical/nursing-cms-by-ccn.json").read_bytes())
        raw = {row[adapter.CCN]: row for row in json.loads(
            (adapter.RESEARCH / "cms/datasets/4pq5-n9py.json").read_bytes())}
        columns = {
            "overall": "overall_rating", "inspections": "health_inspection_rating",
            "staffing": "staffing_rating", "quality": "qm_rating",
            "totalNurseHours": "reported_total_nurse_staffing_hours_per_resident_per_day",
            "rnHours": "reported_rn_staffing_hours_per_resident_per_day",
            "turnover": "total_nursing_staff_turnover", "fines": "number_of_fines",
            "fineAmount": "total_amount_of_fines_in_dollars",
            "paymentDenials": "number_of_payment_denials",
            "healthDeficiencies": "rating_cycle_1_total_number_of_health_deficiencies",
        }
        missing = 0
        for ccn, summary in summaries.items():
            provider = self.by_id["cms-" + ccn]
            self.assertEqual(provider["cms"], summary)
            for field, column in columns.items():
                value = raw[ccn][column].strip()
                expected = None if value in ("", "-", "NA", "N/A", "Not Available",
                                             "Not Applicable") else float(value.replace(",", ""))
                self.assertEqual(summary[field], expected)
                missing += expected is None
            notes = [f"{key}={value}" for key, value in raw[ccn].items()
                     if key.endswith("_footnote") and value.strip()]
            for note in notes:
                self.assertTrue(any(note in limitation for limitation in provider["limitations"]))
        self.assertGreater(missing, 0)

    def test_clinical_fragments_keep_exact_ccns_and_source_values(self):
        hh = json.loads(self.files["homeHealthEvidence.json"])
        clinical = json.loads((adapter.RESEARCH / "clinical/home-health-evidence.json").read_bytes())
        self.assertEqual(hh, clinical)
        self.assertEqual(json.loads(self.files["inspectionHistory.json"]),
                         json.loads((adapter.RESEARCH / "clinical/inspection-history.json").read_bytes()))
        office_ids = {p["id"] for p in self.providers if p["category"] == "home-health"}
        self.assertEqual(office_ids, {a["organizationId"] for a in hh["agencies"]})
        self.assertEqual(len(office_ids), 18)
        service_only = json.loads((adapter.RESEARCH / "clinical/home-health-service-only.json").read_bytes())
        self.assertTrue(office_ids.isdisjoint("cms-" + ccn for ccn in service_only["agencyCcns"]))
        self.assertEqual(hh["patientExperienceComparators"]["state"]["code"], "NJ")
        self.assertEqual(set(hh["patientExperienceComparators"]), {"state", "national"})
        by_ccn = {}
        for dataset in ("6jpm-sxkc", "ccn4-8vby"):
            by_ccn[dataset] = {
                row[adapter.CCN]: row for row in json.loads(
                    (adapter.RESEARCH / f"cms/datasets/{dataset}.json").read_bytes())
            }

        def metrics(value):
            if isinstance(value, dict):
                if "sourceColumn" in value:
                    yield value
                else:
                    for item in value.values():
                        yield from metrics(item)
            elif isinstance(value, list):
                for item in value:
                    yield from metrics(item)

        checked = 0
        for agency in hh["agencies"]:
            self.assertNotIn("cms", self.by_id[agency["organizationId"]])
            for section in ("qualityOfPatientCare", "patientExperience"):
                raw = by_ccn[agency[section]["datasetId"]][agency["ccn"]]
                for metric in metrics(agency[section]):
                    column = metric["sourceColumn"]
                    if column == "not published in source":
                        self.assertIsNone(metric["value"])
                        self.assertIsNone(metric["rawValue"])
                    else:
                        self.assertEqual(metric["rawValue"], raw[column])
                        value = raw[column].strip()
                        expected = None if value in ("", "-", "NA", "N/A", "Not Available",
                                                     "Not Applicable") else float(value.replace(",", ""))
                        self.assertEqual(metric["value"], expected)
                    self.assertEqual(metric["status"],
                                     "not published" if metric["value"] is None else "published")
                    checked += 1
        self.assertEqual(checked, 1260)
        small_survey = next(a["patientExperience"] for a in hh["agencies"] if a["ccn"] == "317050")
        self.assertEqual(small_survey["generalFootnoteCodes"], ["11"])
        self.assertEqual(small_survey["completedSurveys"]["value"], 55)
        self.assertIn("11", hh["footnoteDefinitions"])

    def test_clinical_receipts_fail_closed_for_stale_sources_and_outputs(self):
        for target, message in (
            ("cms/manifest.json", "Clinical consumed source mismatch"),
            ("clinical/home-health-evidence.json", "Clinical output hash mismatch"),
        ):
            inputs = adapter.Inputs(adapter.RESEARCH)
            original_read = inputs.read

            def altered(relative):
                body = original_read(relative)
                return body + b" " if relative == target else body

            with self.subTest(target=target), patch.object(inputs, "read", side_effect=altered):
                with self.assertRaisesRegex(ValueError, message):
                    adapter.clinical_inputs(inputs, self.providers, [])

    def test_built_runtime_search_and_evidence_for_morristown_and_union(self):
        markets = adapter.validate_release(self.files, self.manifest)
        script = """
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createMarketRegistry} = require('./src/lib/markets.ts');
const {searchProviders} = require('./src/lib/search.ts');
const {getHomeHealthEvidence} = require('./src/lib/home-health.ts');
const {getInspectionEvidence} = require('./src/lib/inspections.ts');
const {getLocationResearch} = require('./src/lib/location-research.ts');
const registry = createMarketRegistry(JSON.parse(readFileSync(0, 'utf8')));
const locationRows = registry[0].locationResearch;
const ratingRows = Object.values(locationRows).filter(r => r.reviewAggregates.length);
if (ratingRows.length) {
  const {computeExperienceScore} = require('./src/lib/experience-score.ts');
  const verified = JSON.parse(readFileSync('research/north-jersey/review-release/experience-verification.json', 'utf8'));
  assert.equal(ratingRows.length, Object.keys(verified.releasedOutput).length);
  for (const row of ratingRows) {
    const score = computeExperienceScore({...row, asOfDate: verified.assessmentDate});
    const operatorIds = new Set(row.sources.filter(s => s.kind === "provider").map(s => s.id));
    const noOperatorQuotes = row.reviews.filter(r => !operatorIds.has(r.sourceId));
    if (noOperatorQuotes.length < row.reviews.length) {
      const before = computeExperienceScore({...row, reviews: noOperatorQuotes, asOfDate: verified.assessmentDate});
      for (const key of ["value", "reviewCount", "independentSourceCount", "confidence"])
        assert.equal(score[key], before[key], key);
    }
    assert.equal(score.value, verified.releasedOutput[row.providerId].value);
    assert.equal(score.reviewCount, verified.releasedOutput[row.providerId].reviewCount);
  }
}
for (const [zip, expected] of [['07960', 'cms-317002'], ['07083', 'cms-317020']]) {
  const result = searchProviders({zip, radius: 10, category: 'home-health'}, undefined, registry);
  assert.equal(result.market.id, 'north-jersey');
  assert(result.providers.some(p => p.id === expected));
  assert(result.providers.every(p => p.category === 'home-health' && p.cms === undefined));
  const evidence = getHomeHealthEvidence(expected, registry);
  assert.equal(evidence.agencies.length, 1);
  assert.equal(evidence.agencies[0].ccn, expected.slice(4));
  assert.equal(evidence.patientExperienceComparators.state.code, 'NJ');
  assert.equal(getLocationResearch(expected, undefined, registry).experience.value, null);
}
for (const provider of registry[0].providers.filter(p => p.zip === '07960' || p.zip === '07083')) {
  if (provider.category === 'nursing-home' && provider.cms) {
    const evidence = getInspectionEvidence(provider.cms.ccn, 25, registry);
    assert.equal(evidence.providerId, provider.id);
    assert(evidence.healthCitations.records.length <= 25);
  }
}
console.log('Morristown and Union search and exact-CCN evidence passed');
"""
        result = subprocess.run(["node", "--import", "tsx", "-e", script], cwd=ROOT,
                                input=json.dumps(markets), capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_union_morris_checkpoint_uses_same_real_unit_ids(self):
        files, manifest = adapter.normalize(adapter.RESEARCH, ("Union", "Morris"))
        rows = json.loads(files["crosswalk.json"])
        official_ids = {row["officialId"] for row in rows if row["source"] == "NJ DOH All_LTC"}
        expected = {row["officialId"] for row in self.crosswalk if row["source"] == "NJ DOH All_LTC"
                    and row["county"] in ("Union", "Morris")}
        self.assertEqual(official_ids, expected)
        self.assertEqual(len(official_ids), 88)
        hh = json.loads(files["homeHealthEvidence.json"])
        self.assertEqual(len(hh["agencies"]), 4)
        published = {p["id"] for p in json.loads(files["providers.json"]) if p["category"] == "home-health"}
        self.assertEqual(published, {a["organizationId"] for a in hh["agencies"]})
        inspection = json.loads(files["inspectionHistory.json"])
        self.assertEqual(len(inspection["facilities"]), 44)
        adapter.validate_release(files, manifest)

    def test_actual_inspection_totals_and_worst_case_bound(self):
        if "inspectionHistory.json" not in self.files:
            self.skipTest("Inspection sources not yet collected")
        history = json.loads(self.files["inspectionHistory.json"])
        source_health = json.loads((adapter.RESEARCH / "cms/datasets/r5ix-sfxw.json").read_text())
        source_penalties = json.loads((adapter.RESEARCH / "cms/datasets/g6vv-u9sr.json").read_text())
        health_counts = Counter(row[adapter.CCN] for row in source_health)
        penalty_counts = Counter(row[adapter.CCN] for row in source_penalties)
        self.assertEqual(len(history["facilities"]), 139)
        self.assertEqual(sum(f["healthCitations"]["total"] for f in history["facilities"].values()), 3256)
        self.assertEqual(sum(f["penalties"]["total"] for f in history["facilities"].values()), 107)
        self.assertEqual(max(len(f["healthCitations"]["records"]) for f in history["facilities"].values()), 25)
        for ccn, facility in history["facilities"].items():
            self.assertEqual(facility["healthCitations"]["total"], health_counts[ccn])
            self.assertEqual(facility["penalties"]["total"], penalty_counts[ccn])
            for collection in facility.values():
                self.assertEqual(len(collection["records"]), min(collection["total"], 25))
        raw_by_tag_date = {(r[adapter.CCN], r["deficiency_prefix"] + r["deficiency_tag_number"],
                            r["survey_date"], r["deficiency_description"]) for r in source_health}
        for ccn, facility in history["facilities"].items():
            for record in facility["healthCitations"]["records"]:
                self.assertIn((ccn, record["tag"], record["surveyDate"], record["description"]), raw_by_tag_date)

    def test_repeated_normalization_is_byte_identical(self):
        sources = json.loads(self.files["source-inputs.json"])["files"]
        with tempfile.TemporaryDirectory(prefix="harbor-nj-deterministic-") as temporary:
            root = Path(temporary)
            for relative, expected in sources.items():
                body = (adapter.RESEARCH / relative).read_bytes()
                self.assertEqual(adapter.digest(body), expected, f"Source changed during test: {relative}")
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
            first, manifest = adapter.normalize(root, adapter.COUNTIES)
            again, again_manifest = adapter.normalize(root, adapter.COUNTIES)
            self.assertEqual(first, again)
            self.assertEqual(manifest, again_manifest)
            self.assertEqual(self.files, first)
            self.assertEqual(self.manifest, manifest)

    def test_tampered_source_receipt_and_midrun_change_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="harbor-nj-source-test-") as temporary:
            root = Path(temporary)
            original = (adapter.RESEARCH / "state/raw/ltc.xlsx").read_bytes()
            (root / "snapshot.xlsx").write_bytes(original)
            (root / "snapshot.xlsx.json").write_text(json.dumps({"sha256": adapter.digest(original)}))
            inputs = adapter.Inputs(root)
            inputs.receipt("snapshot.xlsx")
            (root / "snapshot.xlsx").write_bytes(original + b"changed")
            with self.assertRaisesRegex(ValueError, "changed during normalization"):
                inputs.verify()
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                adapter.Inputs(root).receipt("snapshot.xlsx")


class AcquisitionMergeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.pid = "cms-315488"
        self.roster = {self.pid: {"county": "Morris"}}
        self.offerings = {
            "providerId": self.pid, "checkedAt": "2026-11-12",
            "providerDetailsReviewed": True,
            "sources": [{"id": "provider-official", "url": "https://example.org/unit"}],
            "facts": [{"sourceId": "provider-official", "text": "Retained fact"}],
            "reviewAggregates": [], "reviews": [], "notes": ["Retained offering note"],
        }
        self.reviews = {
            "providerId": self.pid, "checkedAt": "2026-11-13",
            "providerDetailsReviewed": False,
            "sources": [{"id": "review-release-legacy"}, {"id": "review-release-new-acquisition"}],
            "facts": [], "reviews": [], "notes": ["Retained review note"],
            "reviewAggregates": [
                {"sourceId": "review-release-legacy", "rating": 4.4, "scale": 5, "count": 40},
                {"sourceId": "review-release-new-acquisition", "rating": 4.2, "scale": 5, "count": 30},
            ],
            "reviewSamples": [{"sourceId": "review-release-legacy", "visibleReviewCount": 2}],
        }
        self.write("review-excerpts/reviewed.json", {})
        self.release("offerings", self.offerings)
        self.release("review-release", self.reviews)

    def write(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(adapter.encode(value))

    def release(self, origin, record):
        data = {self.pid: record}
        self.write(f"{origin}/locationResearch.json", data)
        receipt = adapter.digest(adapter.encode(data))
        self.write(f"{origin}/manifest.json", {
            "outputs": {"locationResearch.json": {"sha256": receipt} if origin == "offerings" else receipt},
        })

    def test_acquisition_normalizer_preserves_old_and_new_sources_original_aggregates_and_samples(self):
        result = adapter.released_research(adapter.Inputs(self.root), self.roster, ("Morris",))
        record = result[self.pid]
        self.assertEqual(record["sources"], self.offerings["sources"] + self.reviews["sources"])
        self.assertEqual(record["reviewAggregates"], self.reviews["reviewAggregates"])
        self.assertEqual(record["reviewSamples"], self.reviews["reviewSamples"])
        self.assertEqual(record["facts"], self.offerings["facts"])
        self.assertEqual(record["checkedAt"], "2026-11-13")
        self.assertTrue(record["providerDetailsReviewed"])
        self.assertEqual(record["reviews"], [])
        self.assertEqual(result, adapter.released_research(adapter.Inputs(self.root), self.roster, ("Morris",)))

    def test_acquisition_normalizer_refuses_hash_drift(self):
        self.reviews["reviewAggregates"][1]["count"] = 99
        self.write("review-release/locationResearch.json", {self.pid: self.reviews})
        with self.assertRaisesRegex(ValueError, "review-release release hash mismatch"):
            adapter.released_research(adapter.Inputs(self.root), self.roster, ("Morris",))

    def test_acquisition_normalizer_keeps_duplicate_sample_producer_guard(self):
        self.offerings["reviewSamples"] = self.reviews["reviewSamples"]
        self.release("offerings", self.offerings)
        with self.assertRaisesRegex(ValueError, "Duplicate review sample producer"):
            adapter.released_research(adapter.Inputs(self.root), self.roster, ("Morris",))

    def test_acquisition_normalizer_never_reads_unreleased_acquisition_files(self):
        before = adapter.released_research(adapter.Inputs(self.root), self.roster, ("Morris",))
        self.write("experience-acquisition/integration/approved-batches.json", {"unreviewed": True})
        self.assertEqual(before, adapter.released_research(adapter.Inputs(self.root), self.roster, ("Morris",)))


if __name__ == "__main__":
    unittest.main()
