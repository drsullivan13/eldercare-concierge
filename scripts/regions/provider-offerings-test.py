import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("offerings", Path(__file__).with_name("provider-offerings.py"))
offerings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(offerings)


class OfferingEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = offerings.build(offerings.DEFAULT)
        cls.records = cls.release["locationResearch.json"]
        cls.coverage = {x["providerId"]: x for x in cls.release["coverage.json"]}

    def test_full_retained_roster_has_unique_coverage(self):
        roster = json.loads((offerings.DEFAULT/"runtime/providers.json").read_text())
        self.assertEqual({p["id"] for p in roster}, set(self.coverage))
        self.assertEqual(len(roster), len(self.release["coverage.json"]))
        self.assertEqual(len({r["county"] for r in self.coverage.values()}), 6)

    def test_all_released_facts_reference_inspected_sources(self):
        for pid, rec in self.records.items():
            self.assertEqual(rec["providerId"], pid)
            sources = {s["id"] for s in rec["sources"]}
            self.assertEqual(len(sources), len(rec["sources"]))
            for fact in rec["facts"]:
                self.assertIn(fact["sourceId"], sources)
            if rec["availability"]["sourceId"]:
                self.assertIn(rec["availability"]["sourceId"], sources)

    def test_published_source_rates_and_fee_roles(self):
        rec = self.records["north-jersey-doh-nj60a000"]
        amounts = [f["amount"] for f in rec["facts"] if f.get("amount")]
        self.assertEqual([7450, 10135], [a["min"] for a in amounts])
        self.assertEqual({"2026-11-05"}, {a["asOf"] for a in amounts})
        self.assertEqual("inquiry-only",rec["availability"]["status"])
        rec = self.records["north-jersey-campus-lantern-hill-07974"]
        fees = [f["amount"] for f in rec["facts"] if f.get("amount")]
        self.assertEqual((416000, 686000, "one-time", "entrance-fee"),
                         tuple(fees[0][k] for k in ("min","max","period","type")))
        self.assertEqual("waitlist-published",rec["availability"]["status"])
        self.assertNotIn(1000,{a["min"] for a in fees})

    def test_capacity_inquiry_and_unknown_do_not_establish_opening(self):
        self.assertFalse(any(r["availability"]["status"]=="opening-published" for r in self.records.values()))
        self.assertFalse(any(f["kind"]=="availability" for r in self.records.values() for f in r["facts"]))
        self.assertTrue(all(c["availability"]=="unverified" for c in self.coverage.values()
                            if c["providerPageStatus"]!="checked"))

    def test_address_mismatch_is_withheld(self):
        rec = self.coverage["north-jersey-doh-nj5a007"]
        self.assertEqual("source_address_disagrees",rec["providerPageStatus"])
        self.assertEqual(0,rec["publishedPriceFacts"])
        self.assertEqual("unverified",rec["availability"])

    def test_undefined_period_is_never_given_monthly_amount(self):
        rec = self.records["north-jersey-doh-nj20a013"]
        prices = [f for f in rec["facts"] if f["kind"]=="cost"]
        self.assertEqual(3,len(prices))
        self.assertTrue(all(f["amount"] is None for f in prices))

    def test_office_services_and_registration_scope(self):
        vna = self.records["cms-317002"]
        self.assertTrue(any("Physical therapy".lower() in f["text"] for f in vna["facts"]))
        self.assertIsNone(vna["availability"]["sourceId"])
        self.assertFalse(self.coverage["north-jersey-hp-hp0254700"]["regulatedFacts"])

    def test_generated_hashes_match_actual_bytes(self):
        for name, info in self.release["manifest.json"]["outputs"].items():
            body=(offerings.DEFAULT/"offerings"/name).read_bytes()
            self.assertEqual(body,offerings.encode(self.release[name]))
            self.assertEqual(info["sha256"],hashlib.sha256(body).hexdigest())


if __name__=="__main__":
    unittest.main()
