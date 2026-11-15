#!/usr/bin/env python3
"""Checks for the retained UHC source, strict branch release, and real CLI."""

import collections
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("uhc_replay", ROOT / "uhc-replay.py")
REPLAY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPLAY)
EXPECTED_IDS = {
    "0022500", "0022801", "0023300", "0024800", "0035003", "0035004",
    "0051801", "0054400", "0056900", "0057100", "0061600", "0067900",
    "0074502", "0080600", "0081200", "0083500", "0105200", "0108700",
    "0115500", "0116100", "0116700", "0121600", "0126900", "0131700",
    "0131702", "0138300", "0143900", "0147200", "0150300", "0197100",
    "0198500", "0204600", "0227900", "0227902", "0231605", "0246500",
    "0259811", "0261400", "0265700", "0267700", "0273100", "0273600",
    "0282300", "0284400", "0287900", "0309500", "0423700",
}
GENTLE = "north-jersey-hp-hp0081200"
GENTLE_NAME = "Gentle Heart Care LLC"


class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = REPLAY.load()
        cls.outputs = REPLAY.build()

    def changed_release(self, change):
        inputs = copy.deepcopy(self.inputs)
        change(*inputs)
        with patch.object(REPLAY, "load", return_value=inputs):
            return REPLAY.build()

    def assert_gentle_excluded(self, outputs):
        self.assertNotIn(GENTLE, outputs["uhc-verified.json"])
        listing_ids = {
            x["listingId"] for x in self.outputs["uhc-verified.json"][GENTLE]["listings"]
        }
        self.assertTrue(all(
            outputs["uhc-row-dispositions.json"][key]["status"] == "excluded"
            for key in listing_ids
        ))

    def test_expected_release_and_county_reconciliation(self):
        self.assertEqual(
            set(self.outputs["uhc-verified.json"]),
            {"north-jersey-hp-hp" + value for value in EXPECTED_IDS},
        )
        counts = self.outputs["uhc-counts.json"]
        self.assertEqual(counts["acceptedSourceRows"], 255)
        self.assertEqual(counts["providerKeyedListings"], 255)
        self.assertEqual(
            {k: v["acceptedBranches"] for k, v in counts["byServicingCounty"].items()},
            {"Bergen": 32, "Essex": 40, "Hudson": 30, "Middlesex": 24,
             "Monmouth": 18, "Morris": 22, "Passaic": 31, "Somerset": 21, "Union": 37},
        )
        self.assertEqual(sum(counts["rowDispositionReasons"].values()), 886)
        self.assertEqual(sum(counts["rosterDispositionReasons"].values()), 1074)
        self.assertEqual(counts["distinctAcceptedOfficeIdentities"], 47)

    def test_all_886_rows_independent_literal_source_audit(self):
        source_rows = self.inputs[0]
        listings = self.outputs["uhc-directory-listings.json"]
        decisions = self.outputs["uhc-row-dispositions.json"]
        self.assertEqual(len(decisions), 886)
        for index, (raw, listing) in enumerate(zip(source_rows, listings), 1):
            with self.subTest(row=index):
                self.assertEqual(listing["sourceRow"], index)
                self.assertEqual(listing["physicalPage"], raw["page"])
                self.assertEqual(listing["sourceLine"], raw["line"])
                self.assertIsNone(listing["printedPage"])
                self.assertEqual(listing["sourceEvidence"], raw)
                county, text = raw["body"].split(" Personal Care Assistant ", 1)
                self.assertEqual(listing["servicingCounty"], county)
                self.assertEqual(listing["specialty"], "Personal Care Assistant")
                decision = decisions[listing["listingId"]]
                self.assertTrue(decision["rationale"])
                if not listing["parseExclusion"]:
                    self.assertEqual(
                        text, f"{listing['listingName']} {listing['phone']} {listing['address']}",
                    )
                    self.assertEqual(
                        raw["continuation"],
                        f"{listing['city']}, {listing['state']} {listing['zip']}",
                    )
                else:
                    self.assertEqual(decision["status"], "excluded")
                    self.assertFalse(decision["providerIds"])

    def test_all_accepted_rows_have_page_and_registered_identity_proof(self):
        source_rows, roster, bridge, identities, manifest = self.inputs
        pages = collections.defaultdict(list)
        for index, row in enumerate(source_rows, 1):
            pages[str(row["page"])].append({"sourceRow": index, **row})
        checked = 0
        for provider_id, record in self.outputs["uhc-verified.json"].items():
            office = roster[provider_id]
            self.assertFalse(bridge[provider_id]["locationHold"])
            for listing in record["listings"]:
                checked += 1
                with self.subTest(provider=provider_id, listing=listing["listingId"]):
                    raw = source_rows[listing["sourceRow"] - 1]
                    self.assertIn(listing["listingName"], raw["body"])
                    self.assertIn(listing["phone"], raw["body"])
                    self.assertTrue(raw["body"].endswith(listing["address"]))
                    self.assertEqual(listing["sourceEvidence"], raw)
                    self.assertEqual(listing["physicalPage"], raw["page"])
                    page_bytes = (json.dumps(
                        pages[str(raw["page"])], ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                    ) + "\n").encode()
                    self.assertEqual(
                        hashlib.sha256(page_bytes).hexdigest(), listing["sourcePageExtractSha256"],
                    )
                    self.assertEqual(listing["sourceExtractSha256"], manifest["files"]["uhc-source-rows.json"]["sha256"])
                    proof = listing["organizationBasis"]
                    registration = identities["providers"][provider_id]
                    self.assertEqual(proof["registrationValue"], registration[proof["registrationField"]])
                    self.assertEqual(proof["registration"], registration["registration"])
                    self.assertEqual(proof["sourceRows"], registration["sourceRows"])
                    self.assertIn(proof["bridgeSourceRow"], registration["sourceRows"])
                    self.assertEqual(proof["source"], identities["source"])
                    self.assertEqual(listing["sourceDate"], "2026-06")
                    self.assertIsNone(listing["sourcePdfSha256"])
                    self.assertEqual(listing["sourceUrl"], REPLAY.SOURCE_URL)
                    self.assertEqual(office["zip"], listing["zip"])
                    self.assertNotRegex(listing["listingName"].lower(), "pediatr|children|kids")
                    self.assertIn("Not evidence of current participation", record["caveat"])
        self.assertEqual(checked, 255)

    def test_full_roster_not_fidelis_subset(self):
        rows, roster, bridge, identities, _ = self.inputs
        self.assertEqual(len(roster), 1074)
        self.assertEqual(set(roster), set(bridge))
        self.assertEqual(set(roster), set(identities["providers"]))
        self.assertEqual(set(roster), set(self.outputs["uhc-roster-dispositions.json"]))
        self.assertEqual(len(rows), 886)
        for disposition in self.outputs["uhc-roster-dispositions.json"].values():
            self.assertEqual(disposition["scannedSourceRows"], 886)
            self.assertEqual(set(disposition["scannedServicingCounties"]), set(REPLAY.COUNTIES))
            self.assertTrue(disposition["rationale"])
        fidelis = json.loads((ROOT / "verified.json").read_bytes())
        self.assertTrue(set(self.outputs["uhc-verified.json"]) - set(fidelis))

    def test_every_branch_rejects_incomplete_or_different_identity(self):
        roster, bridge, identities = self.inputs[1:4]
        for provider_id, record in self.outputs["uhc-verified.json"].items():
            office = roster[provider_id]
            names = REPLAY.identity_names(bridge[provider_id], identities["providers"][provider_id])
            for original in record["listings"]:
                for field, value in (
                    ("address", original["address"] + " Ste 999"),
                    ("city", "Wrong City"), ("zip", "99999"),
                    ("listingName", original["listingName"] + " Services"),
                    ("phone", "(999) 999-9999"), ("state", "NY"),
                ):
                    with self.subTest(provider=provider_id, listing=original["listingId"], field=field):
                        listing = original | {field: value}
                        checks, _ = REPLAY.compare(office, listing, names)
                        self.assertFalse(all(checks.values()))

    def test_suite_city_zip_phone_and_moved_office_fail_full_replay(self):
        for field, value in (
            ("address", "333 Sylvan Ave Ste 999"),
            ("address", "333 Sylvan Ave"),
            ("address", "777 New Office Road Ste 205"),
            ("city", "Englewood"),
            ("zip", "07631"),
            ("phone", "(999) 999-9999"),
        ):
            def change(rows, roster, bridge, identities, manifest):
                roster[GENTLE][field] = value
                bridge[GENTLE][field] = value
            with self.subTest(field=field, value=value):
                self.assert_gentle_excluded(self.changed_release(change))

    def test_no_generic_organization_word_deletion(self):
        names = ("Gentle Heart LLC", "Gentle Heart Health Care LLC",
                 "Gentle Heart Care Services LLC", "Gentle Heart Care Inc",
                 "Gentle Heart Home Care LLC")
        for value in names:
            def change(rows, roster, bridge, identities, manifest):
                roster[GENTLE]["name"] = value
                bridge[GENTLE]["legalName"] = value
                identities["providers"][GENTLE]["businessName"] = value
            with self.subTest(name=value):
                self.assert_gentle_excluded(self.changed_release(change))

    def test_full_suite_lists_and_house_hyphens_do_not_disappear(self):
        for left, right in (
            ("30 Park Rd Ste 1A 1B AND 4B", "30 Park Rd Ste 1A"),
            ("17-17 Broadway", "1717 Broadway"),
            ("12-18 River Rd", "1218 River Rd"),
            ("134 Evergreen Pl Ste 303-14", "134 Evergreen Pl Ste 30314"),
            ("50 Union Ave #503", "50 Union Ave Ste 503"),
        ):
            self.assertNotEqual(REPLAY.street(left), REPLAY.street(right))
        self.assertEqual(REPLAY.street("225 Ocean Avenue, 2nd Floor"), REPLAY.street("225 Ocean Ave Fl 2"))

    def test_registered_dba_is_independently_tied(self):
        provider_id = "north-jersey-hp-hp0126900"
        record = self.outputs["uhc-verified.json"][provider_id]
        self.assertTrue(all(
            listing["organizationBasis"]["field"] == "stateRegisteredTradeNames"
            and listing["organizationBasis"]["value"] == "CROSSLINKS CARE LLC"
            for listing in record["listings"]
        ))
        def change(rows, roster, bridge, identities, manifest):
            identities["providers"][provider_id]["dbas"] = "UNRELATED LLC"
        self.assertNotIn(provider_id, self.changed_release(change)["uhc-verified.json"])

    def test_foreign_bridge_address_or_source_row_does_not_authorize_dba(self):
        for field, value in (("address", "999 Unrelated Ave"), ("sourceRow", "999999")):
            def change(rows, roster, bridge, identities, manifest):
                bridge[GENTLE][field] = value
            with self.subTest(field=field):
                outputs = self.changed_release(change)
                self.assert_gentle_excluded(outputs)
                self.assertEqual(outputs["uhc-roster-dispositions.json"][GENTLE]["reason"], "bridge_identity_conflict")

    def test_distinct_colocated_roster_organization_blocks_release(self):
        def change(rows, roster, bridge, identities, manifest):
            other = "north-jersey-hp-hp0000216"
            for key in ("address", "city", "state", "zip"):
                roster[other][key] = roster[GENTLE][key]
                if key != "state":
                    bridge[other][key] = roster[GENTLE][key]
        outputs = self.changed_release(change)
        self.assert_gentle_excluded(outputs)
        ids = self.outputs["uhc-roster-dispositions.json"][GENTLE]["acceptedListingIds"]
        self.assertTrue(all(outputs["uhc-row-dispositions.json"][i]["reason"] == "ambiguous_colocation" for i in ids))

    def test_distinct_colocated_source_entity_does_not_inherit_identity(self):
        def change(rows, roster, bridge, identities, manifest):
            rows[0]["body"] = "Bergen Personal Care Assistant Unrelated Health LLC (999) 999-9999 333 Sylvan Ave Ste 205"
            rows[0]["continuation"] = "Englewood Cliffs, NJ 07632"
        outputs = self.changed_release(change)
        self.assert_gentle_excluded(outputs)
        self.assertEqual(next(iter(outputs["uhc-row-dispositions.json"].values()))["status"], "excluded")

    def test_real_colocated_acadia_and_citadel_are_not_released(self):
        listings = self.outputs["uhc-directory-listings.json"]
        checked = 0
        for listing in listings:
            if listing.get("address") == "7 Glenwood Ave Ste 412":
                checked += 1
                self.assertFalse(self.outputs["uhc-row-dispositions.json"][listing["listingId"]]["providerIds"])
        self.assertGreater(checked, 1)

    def test_exact_pediatric_identity_stays_excluded(self):
        def change(rows, roster, bridge, identities, manifest):
            name = "Gentle Heart Pediatric Care LLC"
            roster[GENTLE]["name"] = name
            bridge[GENTLE]["legalName"] = name
            identities["providers"][GENTLE]["businessName"] = name
            for row in rows:
                row["body"] = row["body"].replace(GENTLE_NAME, name)
        outputs = self.changed_release(change)
        self.assert_gentle_excluded(outputs)
        self.assertEqual(outputs["uhc-roster-dispositions.json"][GENTLE]["reason"], "wrong_population")
        pediatric = [x for x in self.outputs["uhc-directory-listings.json"] if "Towne Pediatric" in x["listingName"]]
        self.assertEqual(len(pediatric), 9)
        self.assertTrue(all(self.outputs["uhc-row-dispositions.json"][x["listingId"]]["reason"] == "wrong_population" for x in pediatric))

    def test_headquarters_service_area_and_moved_identity_stay_excluded(self):
        for description in ("Headquarters only.", "HQ-only office.", "Service-area-only location.", "This office moved."):
            def change(rows, roster, bridge, identities, manifest):
                roster[GENTLE]["description"] = description
            with self.subTest(description=description):
                outputs = self.changed_release(change)
                self.assert_gentle_excluded(outputs)
                self.assertEqual(outputs["uhc-roster-dispositions.json"][GENTLE]["reason"], "not_branch_office")

    def test_explicit_location_hold_blocks_otherwise_exact_branch(self):
        def change(rows, roster, bridge, identities, manifest):
            bridge[GENTLE]["locationHold"] = "unresolved_move"
        outputs = self.changed_release(change)
        self.assert_gentle_excluded(outputs)
        self.assertEqual(outputs["uhc-roster-dispositions.json"][GENTLE]["reason"], "roster_location_hold")

    def test_all_wrapped_and_question_mark_source_rows_fail_closed(self):
        reasons = collections.Counter(x["parseExclusion"] for x in self.outputs["uhc-directory-listings.json"])
        self.assertEqual(reasons["unresolved_source_wrap"], 12)
        self.assertEqual(reasons["uncertain_source_text"], 5)
        row = self.inputs[0][72]
        self.assertIn("Main StToms River", row["continuation"])
        self.assertEqual(REPLAY.parse_row(row, 73)["parseExclusion"], "unresolved_source_wrap")

    def test_input_hash_drift_is_rejected_without_writes(self):
        path = ROOT / "uhc-source-rows.json"
        real_read = Path.read_bytes
        def read_bytes(file):
            data = real_read(file)
            return data + b" " if file == path else data
        with patch.object(Path, "read_bytes", read_bytes):
            with self.assertRaisesRegex(AssertionError, "Input drift"):
                REPLAY.load()

    def test_page_tampering_fails_even_if_input_hash_is_recomputed(self):
        raw = copy.deepcopy(self.inputs[0])
        raw[0]["page"] = 24
        payload = json.dumps(raw).encode()
        manifest = copy.deepcopy(self.inputs[-1])
        manifest["files"]["uhc-source-rows.json"] = {
            "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload),
        }
        replacements = {
            ROOT / "uhc-source-rows.json": payload,
            ROOT / "uhc-manifest.json": json.dumps(manifest).encode(),
        }
        real_read = Path.read_bytes
        def read_bytes(file):
            return replacements[file] if file in replacements else real_read(file)
        with patch.object(Path, "read_bytes", read_bytes):
            with self.assertRaises(AssertionError):
                REPLAY.load()

    def test_output_page_date_specialty_and_line_tampering_fail_validation(self):
        for field, value in (
            ("physicalPage", 1), ("printedPage", "1"), ("sourceLine", 1),
            ("sourceDate", "2026-06-01"), ("specialty", "Home Health Care"),
            ("sourceUrl", REPLAY.LANDING_URL),
        ):
            with self.subTest(field=field):
                outputs = copy.deepcopy(self.outputs)
                outputs["uhc-verified.json"][GENTLE]["listings"][0][field] = value
                with self.assertRaises(AssertionError):
                    REPLAY.validate(outputs, self.inputs[0], self.inputs[1])

    def test_no_invented_month_day_or_printed_page(self):
        manifest = self.inputs[-1]
        self.assertEqual(manifest["sourceDate"], "2026-06")
        self.assertEqual(manifest["sourceDatePrecision"], "month")
        self.assertEqual(manifest["pdfPageCount"], 373)
        self.assertIsNone(manifest["pdfSha256"])
        self.assertEqual(manifest["pdfRetrieval"]["httpStatus"], 403)
        self.assertTrue(all(
            x["printedPage"] is None and x["sourceDate"] == "2026-06"
            for x in self.outputs["uhc-directory-listings.json"]
        ))

    def test_replay_reads_only_retained_inputs_without_network(self):
        real_read = Path.read_bytes
        def read_bytes(file):
            self.assertEqual(file.parent, ROOT)
            self.assertIn(file.name, set(self.inputs[-1]["files"]) | {"uhc-manifest.json"})
            return real_read(file)
        with patch.object(Path, "read_bytes", read_bytes), patch(
            "socket.socket", side_effect=AssertionError("Replay must not use the network"),
        ):
            self.assertEqual(REPLAY.build(), self.outputs)

    def test_check_mode_rejects_output_drift_without_writing(self):
        real_read = Path.read_bytes
        def read_bytes(file):
            data = real_read(file)
            return data + b" " if file.name == "uhc-verified.json" else data
        with patch.object(Path, "read_bytes", read_bytes), patch.object(
            Path, "write_bytes", side_effect=AssertionError("--check must not write"),
        ), patch.object(sys, "argv", ["uhc-replay.py", "--check"]), patch(
            "sys.stdout", new_callable=io.StringIO,
        ):
            with self.assertRaisesRegex(AssertionError, "Stale output: uhc-verified.json"):
                REPLAY.main()

    def test_real_cli_offline_check_and_default_regeneration_are_deterministic(self):
        before = {name: (ROOT / name).read_bytes() for name in self.outputs}
        for args in (["--check"], [], ["--check"]):
            process = subprocess.run(
                [sys.executable, "-B", str(ROOT / "uhc-replay.py"), *args],
                cwd="/tmp", capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(process.returncode, 0, process.stderr)
            report = json.loads(process.stdout)
            self.assertEqual(report["sourceRows"], 886)
            self.assertEqual(report["rosterProviders"], 1074)
            self.assertEqual(report["verifiedProviders"], 47)
        for name, data in before.items():
            self.assertEqual((ROOT / name).read_bytes(), data)
            self.assertEqual(REPLAY.encoded(self.outputs[name]), data)


if __name__ == "__main__":
    unittest.main(verbosity=2)
