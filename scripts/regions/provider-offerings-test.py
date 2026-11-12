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

    def test_targeted_candidate_scope_and_price_periods(self):
        directory = offerings.DEFAULT / "offerings/hudson-passaic"
        coverage = json.loads((directory/"checks.json").read_text())["rows"]
        roster_ids = {pid for pid,row in self.coverage.items()
                      if (row["county"]=="Hudson" and row["category"] in {"assisted-living","life-plan","nursing-home"})
                      or (row["county"]=="Passaic" and row["category"]=="assisted-living")}
        self.assertEqual(roster_ids, {r["providerId"] for r in coverage})
        self.assertEqual(len(roster_ids),len(coverage))
        pages = json.loads((directory/"pages.json").read_text())
        self.assertEqual({r["providerId"] for r in pages},
                         {r["providerId"] for r in coverage if r["result"].startswith("operator-")})
        base_pages = json.loads((offerings.DEFAULT/"offerings/provider-page-checks.json").read_text())
        ids = {p["providerId"] for p in base_pages}
        candidate = self.release if all(p["providerId"] in ids for p in pages) else offerings.build(offerings.DEFAULT, directory/"pages.json")
        brookdale = candidate["locationResearch.json"]["north-jersey-doh-nj70a003"]
        self.assertEqual([5975,9365], [f["amount"]["min"] for f in brookdale["facts"] if f.get("amount")])
        clifton = candidate["locationResearch.json"]["north-jersey-doh-nj25240"]
        self.assertFalse(any(f.get("amount") for f in clifton["facts"]))
        self.assertTrue(any("4,275" in f["text"] for f in clifton["facts"]))

    def test_sources_and_rates_stay_with_the_named_care_setting(self):
        campus = self.records["north-jersey-campus-cedar-crest-village-07444"]
        costs = [fact for fact in campus["facts"] if fact.get("amount")]
        self.assertEqual(15, len(costs))
        self.assertTrue(all("independent living" in f["text"].lower() for f in costs))
        self.assertTrue(any(f["amount"]["min"] == 1486 and "from" not in f["text"] for f in costs))
        for pid in ("cms-315491", "north-jersey-doh-nj60a011", "cms-317092"):
            self.assertFalse(any(f.get("amount") for f in self.records[pid]["facts"]))
        rooms = [f for f in self.records["north-jersey-doh-nj90144"]["facts"] if f.get("amount")]
        self.assertEqual(6, len(rooms))
        self.assertTrue(any("Memory Care companion suite" in f["text"] and f["amount"]["min"] == 9600 for f in rooms))

    def test_directory_amenities_preserve_provenance_without_creating_costs_or_scores(self):
        record = self.records["cms-315307"]
        sources = {s["id"]:s for s in record["sources"]}
        directory = [f for f in record["facts"] if sources[f["sourceId"]]["kind"] == "review-platform"]
        self.assertTrue(any("Private Bathroom" in f["text"] for f in directory))
        self.assertTrue(all("Private Rooms" not in f["text"] for f in directory))
        self.assertFalse(any(f.get("amount") for f in record["facts"]))
        self.assertEqual([], record["reviewAggregates"])
        self.assertEqual("not-published", record["availability"]["status"])
        victoria = self.records["north-jersey-doh-nj60a004"]
        rooms = [f for f in victoria["facts"] if "six private suite layouts" in f["text"]]
        self.assertEqual(1, len(rooms))
        self.assertEqual("https://victoriamews.net/services/suites/", next(s["url"] for s in victoria["sources"] if s["id"] == rooms[0]["sourceId"]))

    def test_generated_hashes_match_actual_bytes(self):
        for name, info in self.release["manifest.json"]["outputs"].items():
            body=(offerings.DEFAULT/"offerings"/name).read_bytes()
            self.assertEqual(body,offerings.encode(self.release[name]))
            self.assertEqual(info["sha256"],hashlib.sha256(body).hexdigest())


if __name__=="__main__":
    unittest.main()
