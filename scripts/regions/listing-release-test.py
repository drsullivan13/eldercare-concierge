import copy
from collections import defaultdict
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release_listing", Path(__file__).with_name("listing-release.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ListingReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = module.ROOT / module.OUT
        cls.providers = {r["id"]: r for r in module.read(module.REGION / "runtime/providers.json")}
        cls.crosswalk = module.read(module.REGION / "runtime/crosswalk.json")
        cls.by_address = defaultdict(list)
        for p in cls.providers.values():
            cls.by_address[(module.review.provider_street(p), module.review.token(p["city"]))].append(p)
        cls.official = defaultdict(list)
        for row in cls.crosswalk:
            if row.get("status") == "included" and row.get("officialId"):
                cls.official[row["providerId"]].append(row["officialId"])
        receipt = json.loads((cls.directory / "history/c0fc5f2160fdf4a6/receipts/additional-broadway-house-for-continuing-care.json").read_bytes())
        # Reconstruct a minimal test page solely from independently retained public sections.
        cls.capture = {"url": receipt["url"], "effectiveUrl": receipt["url"],
                       "retrievedAt": receipt["retrievedAt"], "metadata": {"statusCode": 200},
                       "markdown": "\n\n".join([
                           receipt["addressHeader"], "## Types of Care", receipt["careUnit"],
                           "## Reviews of Broadway House For Continuing Care", receipt["ratingPanel"],
                           " ".join(receipt["scopeChecks"]["googlePlaceIds"]), "## Frequently Asked Questions",
                           "Broadway House For Continuing Care carries a " + receipt["ratingAttribution"] + ".",
                       ])}

    def check(self, data):
        return module.assess(data, self.capture["url"], self.providers, self.crosswalk,
                             self.by_address, self.official, "2026-11-12")

    def test_exact_licensed_nursing_unit(self):
        pid, _, identity, material, aggregate = self.check(self.capture)
        self.assertEqual(pid, "cms-315343")
        self.assertEqual(identity["address"], "298 Broadway")
        self.assertEqual((aggregate["rating"], aggregate["count"]), (3.6, 35))
        self.assertEqual(material["scopeQa"]["googlePlaceIdCount"], 1)

    def test_rejects_competing_underlying_google_places(self):
        d = copy.deepcopy(self.capture)
        d["markdown"] = d["markdown"].replace("3.6★ on Google (35)", "3.6★ on Google (35)\n\n!1s0xaabb:0xdeed")
        with self.assertRaisesRegex(module.Ineligible, "multiple_underlying"):
            self.check(d)

    def test_rejects_employee_and_attribution_drift(self):
        d = copy.deepcopy(self.capture)
        d["markdown"] = d["markdown"].replace("3.6★ on Google (35)", "3.6★ on Google (35)\n\nAs a former employee")
        with self.assertRaisesRegex(module.Ineligible, "employee"):
            self.check(d)
        d = copy.deepcopy(self.capture)
        d["markdown"] = d["markdown"].replace("3.6★ on Google (35)", "3.6★ on Google (900)")
        with self.assertRaisesRegex(module.Ineligible, "mixed_or_empty"):
            self.check(d)

    def test_rejects_parent_brand_and_other_street(self):
        for a,b in [("# Broadway House For Continuing Care", "# Broadway National"),
                    ("298 Broadway,", "399 Broadway,")]:
            d = copy.deepcopy(self.capture)
            d["markdown"] = d["markdown"].replace(a,b)
            with self.assertRaises(module.Ineligible):
                self.check(d)

    def test_historical_first_wave_is_independent_of_cache(self):
        wave = self.directory / "history/c0fc5f2160fdf4a6"
        module.verify_history(wave)
        with tempfile.TemporaryDirectory() as temp:
            forged = Path(temp) / ("0"*16)
            forged.mkdir()
            (forged / "manifest.json").write_bytes((wave / "manifest.json").read_bytes())
            with self.assertRaisesRegex(module.Ineligible, "wave_digest"):
                module.verify_history(forged)


if __name__ == "__main__":
    unittest.main()
