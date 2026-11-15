import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
SPEC = importlib.util.spec_from_file_location("homecare_nppes", ROOT / "scripts/regions/homecare-nppes.py")
n = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(n)


def office(**changes):
    row = {
        "id": "office-a", "name": "Distinctive Care LLC DBA Garden Helpers",
        "address": "10 Main Street, Suite 200", "city": "Newark",
        "state": "NJ", "zip": "07102", "phone": "(201) 555-0100", "locationKind": "office",
    }
    row.update(changes)
    return {"identity": row, "identity_sha256": n.sha(n.encode(n.identity(row))),
            "conflicts": {}, "roster_warnings": [], "in_app": True, "in_supply": True}


def raw_record(number="1234567890", **changes):
    record = {
        "number": number, "enumeration_type": "NPI-2",
        "basic": {"organization_name": "DISTINCTIVE CARE, LLC", "status": "A"},
        "other_names": [{"organization_name": "GARDEN HELPERS", "type": "Doing Business As", "code": "3"}],
        "addresses": [
            {"address_purpose": "MAILING", "address_1": "90 Office Road", "city": "Trenton",
             "state": "NJ", "postal_code": "08608", "telephone_number": "6095550000"},
            {"address_purpose": "LOCATION", "address_1": "10 MAIN ST", "address_2": "STE 200",
             "city": "Newark", "state": "NJ", "postal_code": "071021234", "telephone_number": "2015550100"},
        ],
        "practiceLocations": [],
        "taxonomies": [{"code": "251E00000X", "desc": "Home Health", "primary": True}],
    }
    record.update(changes)
    return record


def entity(record=None):
    return n.candidate(record or raw_record(), ["receipts/test.json"])


def response(records):
    return n.encode({"result_count": len(records), "results": records})


class BranchIdentityTests(unittest.TestCase):
    def test_phone_normalizes_numeric_extension_only(self):
        for raw in ("908-722-7022 X218", "1 (908) 722-7022 ext. 218", "9087227022x218"):
            self.assertEqual(n.phone(raw), "9087227022")
        self.assertEqual(n.phone("908-722-7022 908-111-1234"), "")

    def test_legal_and_dba_identity(self):
        self.assertTrue(n.assess(office(), entity())["eligible"])
        self.assertTrue(n.assess(office(name="Garden Helpers Inc."), entity())["eligible"])
        self.assertFalse(n.assess(office(name="Distinctive"), entity())["eligible"])

    def test_combined_dba_name_is_parsed_without_fuzzy_matching(self):
        record = raw_record()
        record["basic"]["organization_name"] = "Distinctive Care LLC DBA Garden Helpers"
        record["other_names"] = []
        self.assertTrue(n.assess(office(name="Garden Helpers"), entity(record))["eligible"])

    def test_former_name_only_is_not_current_branch_identity(self):
        record = raw_record()
        record["basic"]["organization_name"] = "Different Current Company LLC"
        record["other_names"] = [{"organization_name": "Garden Helpers", "code": "1",
                                  "type": "Former Legal Business Name"}]
        result = n.assess(office(name="Garden Helpers"), entity(record))
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reason"], "former_name_only_identity")

    def test_wrong_branch_shared_brand_and_phone(self):
        record = raw_record()
        record["addresses"][1]["address_1"] = "50 OTHER ST"
        result = n.assess(office(), entity(record))
        self.assertEqual(result["reason"], "wrong_branch_or_older_address")
        self.assertFalse(result["eligible"])

    def test_mailing_is_never_practice_even_when_first(self):
        record = raw_record()
        record["addresses"][0] = dict(record["addresses"][1], address_purpose="MAILING")
        record["addresses"][1].update(address_1="615 PIIKOI ST", state="HI", postal_code="96814")
        self.assertEqual(n.assess(office(), entity(record))["reason"], "mailing_only_address_match")
        record["addresses"].reverse()
        self.assertEqual(n.assess(office(), entity(record))["reason"], "mailing_only_address_match")

    def test_secondary_practice_exact_identity(self):
        record = raw_record()
        secondary = record["addresses"].pop()
        secondary.pop("address_purpose")
        record["practiceLocations"] = [secondary]
        result = n.assess(office(), entity(record))
        self.assertTrue(result["eligible"])
        self.assertEqual(result["matching_practice_paths"], ["practiceLocations[0]"])

    def test_unknown_and_conflicting_purposes_do_not_become_practice(self):
        record = raw_record()
        record["addresses"][1]["address_purpose"] = "UNKNOWN"
        result = n.assess(office(), entity(record))
        self.assertFalse(result["eligible"])
        self.assertNotEqual(result["reason"], "mailing_only_address_match")
        record["practiceLocations"] = [dict(record["addresses"].pop(), address_purpose="MAILING")]
        result = n.assess(office(), entity(record))
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reason"], "conflicting_secondary_address_purpose")

    def test_suite_conflict(self):
        record = raw_record()
        record["addresses"][1]["address_2"] = "SUITE 201"
        self.assertEqual(n.assess(office(), entity(record))["reason"], "explicit_suite_or_floor_conflict")

    def test_range_does_not_collapse_to_single_unit(self):
        record = raw_record()
        record["addresses"][1]["address_2"] = "SUITE 12"
        result = n.assess(office(address="10 Main St, Suite 1-2"), entity(record))
        self.assertEqual(result["reason"], "explicit_suite_or_floor_conflict")

    def test_hash_unit_and_floor_descriptors(self):
        record = raw_record()
        record["addresses"][1]["address_2"] = "#200"
        self.assertTrue(n.assess(office(), entity(record))["eligible"])
        record["addresses"][1]["address_2"] = "#201"
        self.assertEqual(n.assess(office(), entity(record))["reason"], "explicit_suite_or_floor_conflict")
        record["addresses"][1]["address_2"] = "2nd Floor Front"
        self.assertEqual(n.assess(office(address="10 Main St, 2nd Floor Rear"), entity(record))["reason"],
                         "explicit_suite_or_floor_conflict")

    def test_street_names_are_not_unit_markers(self):
        self.assertEqual(n.address_key("10 Stevens Ave")["street"], "10 STEVENS AVE")
        self.assertEqual(n.address_key("10 Flanders Road")["street"], "10 FLANDERS RD")

    def test_floor_conflict_and_equivalent_ordinals(self):
        row = office(address="10 Main St, Second Floor")
        record = raw_record()
        record["addresses"][1]["address_2"] = "2ND FL"
        self.assertTrue(n.assess(row, entity(record))["eligible"])
        record["addresses"][1]["address_2"] = "3RD FLOOR"
        self.assertEqual(n.assess(row, entity(record))["reason"], "explicit_suite_or_floor_conflict")

    def test_missing_suite_is_unknown(self):
        record = raw_record()
        record["addresses"][1]["address_2"] = ""
        self.assertEqual(n.assess(office(), entity(record))["reason"], "suite_or_floor_evidence_missing")
        record["addresses"][1]["address_2"] = "STE 200"
        self.assertFalse(n.assess(office(address="10 Main St"), entity(record))["eligible"])

    def test_unrelated_same_address_and_phone(self):
        record = raw_record()
        record["basic"]["organization_name"] = "Generic Real Estate LLC"
        record["other_names"] = []
        self.assertEqual(n.assess(office(), entity(record))["reason"], "organization_identity_not_exact")

    def test_missing_phone_on_either_side(self):
        self.assertEqual(n.assess(office(phone=""), entity())["reason"], "practice_phone_missing")
        record = raw_record()
        record["addresses"][1].pop("telephone_number")
        self.assertEqual(n.assess(office(), entity(record))["reason"], "practice_phone_missing")

    def test_mailing_phone_cannot_fill_practice_phone(self):
        record = raw_record()
        record["addresses"][0]["telephone_number"] = "2015550100"
        record["addresses"][1]["telephone_number"] = ""
        self.assertEqual(n.assess(office(), entity(record))["reason"], "practice_phone_missing")

    def test_inactive_and_po_box_and_roster_conflict(self):
        record = raw_record()
        record["basic"]["status"] = "D"
        self.assertEqual(n.assess(office(), entity(record))["reason"], "inactive_or_deactivated_entity")
        self.assertEqual(n.assess(office(address="P.O. Box 200"), entity())["reason"],
                         "roster_mailing_only_po_box")
        row = office()
        row["conflicts"] = {"phone": ["2015550100", "2015550101"]}
        self.assertEqual(n.assess(row, entity())["reason"], "roster_source_identity_conflict")

    def test_same_address_different_zip_or_state_is_wrong_branch(self):
        self.assertFalse(n.assess(office(zip="07103"), entity())["eligible"])
        self.assertFalse(n.assess(office(state="NY"), entity())["eligible"])

    def test_city_conflict_and_missing_city_withheld(self):
        for city in ("East Newark", ""):
            result = n.assess(office(city=city), entity())
            self.assertFalse(result["eligible"])
            self.assertEqual(result["reason"], "practice_city_conflict_or_missing")

    def test_registration_status_warning_is_not_nppes_identity(self):
        row = office()
        row["roster_warnings"] = [
            "The registry lists this registration as Active with expiration 2026-09-30, "
            "before the 2026-11-15 capture. Both values are kept as published. "
            "Confirm the current registration with NJ Consumer Affairs."
        ]
        self.assertTrue(n.assess(row, entity())["eligible"])
        row["roster_warnings"] = [
            "The registry city and ZIP give conflicting counties. The physical office location is unverified."
        ]
        self.assertEqual(n.assess(row, entity())["reason"], "roster_location_warning")

    def test_multiple_npis_are_ambiguous(self):
        row = office()
        roster = {"offices": {"office-a": row}}
        plan = {"queries": {"query": {}}, "office_queries": {"office-a": ["query"]}}
        inventory = {number: {"versions": [entity(raw_record(number))], "version_conflict": False}
                     for number in ("1234567890", "1234567891")}
        index = {"queries": {"query": {"state": "complete"}}, "exact_queries": {}}
        coverage, facts, _ = n.decisions(roster, plan, index, inventory, {"query": set(inventory)})
        self.assertEqual(coverage["office-a"]["status"], "ambiguous")
        self.assertFalse(facts)

    def test_exact_lookup_required_and_saturation_withholds(self):
        row = office()
        roster = {"offices": {"office-a": row}}
        plan = {"queries": {"query": {}}, "office_queries": {"office-a": ["query"]}}
        inventory = {"1234567890": {"versions": [entity()], "version_conflict": False}}
        index = {"queries": {"query": {"state": "complete"}}, "exact_queries": {}}
        npis = {"query": {"1234567890"}}
        coverage, facts, _ = n.decisions(roster, plan, index, inventory, npis)
        self.assertEqual(coverage["office-a"]["status"], "incomplete")
        index["exact_queries"]["exact"] = {"number": "1234567890"}
        index["queries"]["exact"] = {"state": "complete"}
        npis["exact"] = {"1234567890"}
        coverage, facts, _ = n.decisions(roster, plan, index, inventory, npis)
        self.assertEqual(coverage["office-a"]["status"], "verified")
        self.assertEqual(set(facts), {"office-a"})
        self.assertEqual(facts["office-a"]["practice_locations"][0]["evidence_purpose"], "LOCATION")
        index["queries"]["query"]["state"] = "saturated"
        coverage, facts, _ = n.decisions(roster, plan, index, inventory, npis)
        self.assertEqual(coverage["office-a"]["status"], "incomplete")
        self.assertFalse(facts)

    def test_zero_error_and_unresolved_are_separate(self):
        roster = {"offices": {"office-a": office()}}
        plan = {"queries": {"query": {}}, "office_queries": {"office-a": ["query"]}}
        index = {"queries": {"query": {"state": "complete"}}, "exact_queries": {}}
        coverage, _, _ = n.decisions(roster, plan, index, {}, {"query": set()})
        self.assertEqual(coverage["office-a"]["status"], "attempted_zero")
        index["queries"]["query"]["state"] = "error"
        coverage, _, _ = n.decisions(roster, plan, index, {}, {"query": set()})
        self.assertEqual(coverage["office-a"]["status"], "incomplete")
        index["queries"]["query"]["state"] = "complete"
        record = raw_record()
        record["addresses"][1]["telephone_number"] = ""
        inventory = {"1234567890": {"versions": [entity(record)], "version_conflict": False}}
        coverage, _, _ = n.decisions(roster, plan, index, inventory, {"query": set(inventory)})
        self.assertEqual(coverage["office-a"]["status"], "unresolved")

    def test_conflicting_observed_versions_withheld(self):
        roster = {"offices": {"office-a": office()}}
        plan = {"queries": {"query": {}}, "office_queries": {"office-a": ["query"]}}
        index = {"queries": {"query": {"state": "complete"}}, "exact_queries": {}}
        inventory = {"1234567890": {"versions": [entity(), entity()], "version_conflict": True}}
        coverage, facts, _ = n.decisions(roster, plan, index, inventory, {"query": set(inventory)})
        self.assertFalse(facts)
        self.assertEqual(coverage["office-a"]["candidate_decisions"][0]["reason"],
                         "conflicting_observed_npi_records")

    def test_shared_branch_cannot_verify_multiple_roster_ids(self):
        a, b = office(), office(id="office-b")
        roster = {"offices": {"office-a": a, "office-b": b}}
        plan = {"queries": {"query": {}},
                "office_queries": {"office-a": ["query"], "office-b": ["query"]}}
        index = {"queries": {"query": {"state": "complete"}, "exact": {"state": "complete"}},
                 "exact_queries": {"exact": {"number": "1234567890"}}}
        inventory = {"1234567890": {"versions": [entity()], "version_conflict": False}}
        npis = {"query": {"1234567890"}, "exact": {"1234567890"}}
        coverage, facts, _ = n.decisions(roster, plan, index, inventory, npis)
        self.assertFalse(facts)
        self.assertTrue(all(x["status"] == "ambiguous" for x in coverage.values()))


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="test-cache-", dir=BASE)
        self.base = Path(self.temporary.name)
        self.query = {"enumeration_type": "NPI-2", "organization_name": "Distinctive*",
                      "state": "NJ"}

    def tearDown(self):
        self.temporary.cleanup()

    def test_cache_replay_does_not_network(self):
        calls = []
        def transport(url):
            calls.append(url)
            return 200, response([raw_record()])
        live = n.Acquisition(self.base, transport=transport).query(self.query)
        offline = n.Acquisition(self.base, offline=True,
                                transport=lambda url: self.fail("Offline network access")).query(self.query)
        self.assertEqual(live, offline)
        self.assertEqual(len(calls), 1)
        self.assertEqual(live["state"], "complete")
        self.assertEqual(live["count"], 1)

    def test_pagination_saturation_is_not_complete(self):
        skips = []
        def transport(url):
            skip = int(parse_qs(urlsplit(url).query)["skip"][0])
            skips.append(skip)
            return 200, response([raw_record(str(1000000000 + skip + i)) for i in range(200)])
        result = n.Acquisition(self.base, transport=transport).query(self.query)
        self.assertEqual(result["state"], "saturated")
        self.assertEqual(result["count"], 1200)
        self.assertEqual(skips, [0, 200, 400, 600, 800, 1000])
        self.assertEqual(n.Acquisition(self.base, offline=True).query(self.query), result)

    def test_exact_200_requires_next_page(self):
        def transport(url):
            skip = int(parse_qs(urlsplit(url).query)["skip"][0])
            return 200, response([raw_record(str(1000000000 + i)) for i in range(200)] if skip == 0 else [])
        result = n.Acquisition(self.base, transport=transport).query(self.query)
        self.assertEqual(result["state"], "complete")
        self.assertEqual(len(result["pages"]), 2)

    def test_repeated_page_is_incomplete(self):
        records = [raw_record(str(1000000000 + i)) for i in range(200)]
        result = n.Acquisition(self.base, transport=lambda url: (200, response(records))).query(self.query)
        self.assertEqual(result["state"], "pagination-conflict")

    def test_zero_and_api_error(self):
        result = n.Acquisition(self.base, transport=lambda url: (200, response([]))).query(self.query)
        self.assertEqual(result["state"], "complete")
        self.assertEqual(result["count"], 0)
        query = dict(self.query, organization_name="Error*")
        with patch.object(n.time, "sleep"):
            result = n.Acquisition(self.base, retries=1, transport=lambda url: (
                200, n.encode({"Errors": [{"description": "bad query"}]}))).query(query)
        self.assertEqual(result["state"], "error")
        receipt = n.read_json(self.base / result["pages"][0]["receipt"])
        self.assertEqual(len(receipt["attempts"]), 2)
        self.assertTrue(all(x["raw"] for x in receipt["attempts"]))

    def test_retry_and_raw_receipts(self):
        responses = iter([(503, b"unavailable"), (200, response([raw_record()]))])
        with patch.object(n.time, "sleep"):
            result = n.Acquisition(self.base, transport=lambda url: next(responses)).query(self.query)
        receipt = n.read_json(self.base / result["pages"][0]["receipt"])
        self.assertEqual(result["state"], "complete")
        self.assertEqual([x["http_status"] for x in receipt["attempts"]], [503, 200])
        self.assertTrue(all((self.base / x["raw"]).exists() for x in receipt["attempts"]))

    def test_resumed_error_retains_prior_receipt(self):
        first = n.Acquisition(self.base, retries=0,
                              transport=lambda url: (503, b"unavailable")).query(self.query)
        second = n.Acquisition(self.base,
                               transport=lambda url: (200, response([]))).query(self.query)
        self.assertEqual(first["state"], "error")
        self.assertEqual(second["state"], "complete")
        self.assertTrue((self.base / first["pages"][0]["receipt"]).exists())
        self.assertEqual(len(list((self.base / "receipts").glob("*.json"))), 2)

    def test_tampered_raw_rejected(self):
        result = n.Acquisition(self.base, transport=lambda url: (200, response([raw_record()]))).query(self.query)
        receipt = n.read_json(self.base / result["pages"][0]["receipt"])
        (self.base / receipt["attempts"][0]["raw"]).write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "Raw response tamper"):
            n.Acquisition(self.base, offline=True).query(self.query)

    def test_tampered_receipt_rejected(self):
        result = n.Acquisition(self.base, transport=lambda url: (200, response([]))).query(self.query)
        (self.base / result["pages"][0]["receipt"]).write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "Receipt tamper"):
            n.Acquisition(self.base, offline=True).query(self.query)

    def test_cached_query_drift_rejected(self):
        n.Acquisition(self.base, transport=lambda url: (200, response([]))).query(self.query)
        with self.assertRaisesRegex(ValueError, "Cached query drift"):
            n.Acquisition(self.base, offline=True).read_page(n.query_id(self.query), 0, dict(self.query, state="NY"))

    def test_offline_cache_miss_rejected(self):
        with self.assertRaisesRegex(ValueError, "Offline cache miss"):
            n.Acquisition(self.base, offline=True).query(self.query)

    def test_roster_drift_rejected(self):
        roster = {"offices": {"office-a": office()}}
        n.write_json(self.base / "roster.json", roster)
        with patch.object(n, "current_roster", return_value={"offices": {}}):
            with self.assertRaisesRegex(ValueError, "Roster drift"):
                n.initialize(ROOT, self.base)

    def test_plan_extension_is_explicit_and_additions_only(self):
        roster = {"offices": {"office-a": office()}}
        initial = n.make_plan(roster)
        qid = next(iter(initial["queries"]))
        previous = {**initial, "queries": {qid: initial["queries"][qid]},
                    "office_queries": {"office-a": [qid]}}
        n.write_json(self.base / "roster.json", roster)
        n.write_json(self.base / "query-plan.json", previous)
        with patch.object(n, "current_roster", return_value=roster):
            with self.assertRaisesRegex(ValueError, "Query plan drift"):
                n.initialize(ROOT, self.base)
            _, extended = n.initialize(ROOT, self.base, extend_plan=True)
            self.assertEqual(extended, initial)
            self.assertEqual(n.read_json(self.base / "plans" / f"{n.sha(n.encode(previous))}.json"),
                             previous)
            previous["queries"][qid] = {"number": "0000000000"}
            n.write_json(self.base / "query-plan.json", previous)
            with self.assertRaisesRegex(ValueError, "change or discard"):
                n.initialize(ROOT, self.base, extend_plan=True)

    def test_every_office_has_unfiltered_zip_and_statewide_names(self):
        plan = n.make_plan({"offices": {"office-a": office()}})
        queries = list(plan["queries"].values())
        self.assertIn({"enumeration_type": "NPI-2", "postal_code": "07102",
                       "address_purpose": "LOCATION"}, queries)
        self.assertTrue(any(q.get("organization_name") == "DISTINCTIVE CARE*"
                            and q.get("state") == "NJ" for q in queries))
        self.assertTrue(any(q.get("organization_name") == "GARDEN HELPERS*" for q in queries))

    def test_count_and_nonorganization_rejected(self):
        with self.assertRaisesRegex(ValueError, "count differs"):
            n.validate_payload({"result_count": 1, "results": []})
        with self.assertRaisesRegex(ValueError, "Non-organization"):
            n.validate_payload({"result_count": 1, "results": [raw_record(enumeration_type="NPI-1")]})

    def test_malformed_address_is_visible_and_null_state_stays_unknown(self):
        record = raw_record()
        record["addresses"][1]["state"] = None
        n.validate_payload({"result_count": 1, "results": [record]})
        self.assertFalse(n.assess(office(), entity(record))["eligible"])
        record["addresses"][1]["state"] = []
        with self.assertRaisesRegex(ValueError, "Invalid address field"):
            n.validate_payload({"result_count": 1, "results": [record]})

    def test_offline_cli_rebuild_and_manifest_tamper(self):
        fixture_root = self.base / "fixture"
        output = fixture_root / "retained"
        provider = dict(office()["identity"], category="home-care", warnings=[])
        n.write_json(fixture_root / n.SOURCES[0],
                     [{"id": "north-jersey", "providers": [provider]}])
        n.write_json(fixture_root / n.SOURCES[1], [provider])
        with patch.object(n.Acquisition, "fetch", return_value=(200, response([raw_record()]))):
            with contextlib.redirect_stdout(io.StringIO()):
                n.collect(fixture_root, output, workers=1)
        script = str(ROOT / "scripts/regions/homecare-nppes.py")
        for command in ("build", "check"):
            result = subprocess.run([sys.executable, "-B", script, command, "--root",
                                     str(fixture_root), "--output", str(output)],
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
        facts = n.read_json(output / "verified-branch-facts.json")
        self.assertEqual(facts["office-a"]["npi"], "1234567890")
        (output / "verified-branch-facts.json").write_bytes(b"{}")
        result = subprocess.run([sys.executable, "-B", script, "check", "--root",
                                 str(fixture_root), "--output", str(output)],
                                capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Manifest tamper/drift", result.stderr)
        with contextlib.redirect_stdout(io.StringIO()):
            n.build(fixture_root, output)
        provider["phone"] = "2015559999"
        n.write_json(fixture_root / n.SOURCES[1], [provider])
        with self.assertRaisesRegex(ValueError, "Roster/source drift"):
            n.build(fixture_root, output, check=True)


if __name__ == "__main__":
    unittest.main()
