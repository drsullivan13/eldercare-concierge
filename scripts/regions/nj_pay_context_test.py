#!/usr/bin/env python3
"""Verify service, staffing and workforce-training office projections."""

import json
from pathlib import Path
import unittest

from nj_pay_context import add_county_home_care_context


ROOT = Path(__file__).resolve().parents[2]
SERVICES = "home-care-pay-services/verified-office-services.json"


class Inputs:
    def json(self, path):
        return json.loads((ROOT / "research/north-jersey" / path).read_text())


class OfficeContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = Inputs().json(SERVICES)
        cls.providers = [
            {"id": row["providerId"], "category": "home-care", "state": "NJ",
             "address": row["street"],
             **{key: row[key] for key in ("name", "city", "zip", "phone")}}
            for row in cls.rows
        ]
        cls.research = {}
        add_county_home_care_context(Inputs(), cls.providers, cls.research)

    def test_best_care_is_workforce_training_not_home_care_services(self):
        pid = "north-jersey-hp-hp0229600"
        row = next(row for row in self.rows if row["providerId"] == pid)
        self.assertTrue(row.get("workforceTraining"))
        record = self.research[pid]
        fact, = [fact for fact in record["facts"]
                 if fact["id"] == pid + "-office-training"]
        self.assertEqual(fact["kind"], "care")
        self.assertEqual(fact["text"], row["text"])
        source, = [source for source in record["sources"]
                   if source["id"] == fact["sourceId"]]
        self.assertEqual(source["id"], pid + "-office-training-source")
        self.assertEqual(source["url"], row["sourceUrl"])
        self.assertEqual(source["kind"], row["category"])
        self.assertFalse(any(fact["id"] == pid + "-office-services"
                             or fact["kind"] == "cost" or "amount" in fact
                             for fact in record["facts"]))
        self.assertEqual(record["reviews"], [])
        self.assertEqual(record["reviewAggregates"], [])
        self.assertEqual(record["availability"]["status"], "not-published")

    def test_other_service_and_staffing_facts_and_rates_are_preserved(self):
        for row in self.rows:
            if row["providerId"] == "north-jersey-hp-hp0229600":
                continue
            with self.subTest(provider=row["providerId"]):
                pid = row["providerId"]
                key = "office-staffing" if row.get("facilityStaffing") else "office-services"
                facts = self.research[pid]["facts"]
                fact, = [fact for fact in facts if fact["id"] == f"{pid}-{key}"]
                self.assertEqual(fact["text"], row["text"])
                self.assertEqual(fact["sourceId"], f"{pid}-{key}-source")
                for rate in row.get("rates", []):
                    self.assertIn({"id": f"{pid}-{rate['key']}", "kind": "cost",
                                   "sourceId": fact["sourceId"], "text": rate["text"],
                                   "amount": rate["amount"]}, facts)


if __name__ == "__main__":
    unittest.main()
