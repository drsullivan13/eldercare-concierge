"""Office identity and dated accreditation regressions. Run with python3 -B."""
import unittest

import replay


class MatchTest(unittest.TestCase):
    def setUp(self):
        self.office = dict(providerId="p1", registeredName="Care One LLC",
                           dbas="Family First", street="4 Main St Suite 3",
                           city="Newark", zip="07102", phone="9735550011", hold=False)
        self.row = dict(name="Family First", displayAddress="4 Main Street #3 Newark NJ 07102",
                        phone="(973) 555-0011", id="organization-office")
        self.index = {replay.key_for(self.office): [self.office]}

    def result(self, **changes):
        return replay.match("chap", self.row | changes, self.index)[0]

    def test_exact_dba_address_and_optional_phone(self):
        self.assertEqual(self.result()[0]["providerId"], "p1")
        self.assertIsNotNone(self.result(phone=""))

    def test_conflicts(self):
        for changes in (dict(name="Care Two"), dict(phone="9735559999"),
                        dict(displayAddress="4 Main St Suite 2 Newark NJ 07102"),
                        dict(displayAddress="4 Main St Suite 3 Newark NJ 07101")):
            with self.subTest(changes=changes):
                self.assertIsNone(self.result(**changes))

    def test_held_address_and_ambiguous_identity(self):
        self.office["hold"] = True
        self.assertIsNone(self.result())
        self.office["hold"] = False
        self.index[replay.key_for(self.office)].append(self.office | {"providerId":"p2"})
        self.assertIsNone(self.result())

    def render(self, facts, issue=None, office=None):
        return replay.render("chap", self.row, office or self.office, "2026-11-15", facts, issue)

    def test_date_boundaries_and_program(self):
        fact = dict(program="Home Care", services=["Personal care"], **{"from":"2026-11-15", "to":"2026-11-15"})
        self.assertEqual(self.render([fact])[1], "current_location_scope")
        for edits in ({"from":"2025-01-01", "to":"2026-11-14"},
                      {"from":"2026-11-16", "to":"2027-01-01"}, {"program":"Home Health"}):
            self.assertIsNone(self.render([fact | edits])[0])
        with self.assertRaises(ValueError):
            self.render([fact], "organization_identifier_repeats_across_offices")

    def test_shared_organization(self):
        a, disposition = self.render([], "organization_identifier_repeats_across_offices")
        b, _ = self.render([], "organization_identifier_repeats_across_offices",
                           self.office | {"providerId": "p2"})
        self.assertEqual(disposition, "directory_only")
        self.assertIn("Check the scope", a["accreditations"][0])
        self.assertNotEqual(a["source"]["id"], b["source"]["id"])

    def test_nihca_links_are_office_specific_and_undated(self):
        row = self.row | {"id":"138", "url":"https://members.nihcaccreditation.com/af_directory.asp?memberid=138", "category":"NIHCA Accredited"}
        record, level = replay.render("nihca", row, self.office, "2026-11-15", [], None)
        self.assertEqual(level, "directory_only")
        self.assertEqual(record["source"]["url"], row["url"])
        self.assertIn("does not give a service scope or expiration date", record["accreditations"][0])
        for change in ({"category":"NIHCA Accredited PDN"}, {"url":"https://example.org/memberid=138"}):
            with self.assertRaises(ValueError):
                replay.render("nihca", row | change, self.office, "2026-11-15", [], None)

    def test_captured_dataset(self):
        release = replay.replay()
        summary = release["summary.json"]
        self.assertEqual(len(release["decisions.json"]), 390)
        self.assertEqual(summary["distinctOffices"], 88)
        self.assertEqual(summary["additionalToCahc"], 88)
        self.assertEqual(summary["sources"]["chap"]["dispositions"]["directory_only"], 2)
        self.assertEqual(summary["sources"]["chap"]["dispositions"]["no_dated_home_care_scope_current_at_check"], 4)
        for record in release["offices.json"]["offices"]:
            self.assertTrue(record["accreditations"])
            self.assertFalse(record["services"] or record["awards"] or record["paymentOptions"])
            self.assertNotIn("score", record)


if __name__ == "__main__":
    unittest.main()
