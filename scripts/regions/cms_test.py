#!/usr/bin/env python3
"""Offline regression tests and checks against the retained CMS collection."""

import copy
from contextlib import contextmanager
import io
import json
import os
from pathlib import Path
import ssl
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import cms_collect as cms


class TransportTests(unittest.TestCase):
    def response(self, url, body=b'{"source":"CMS"}'):
        response = io.BytesIO(body)
        response.url = url
        response.headers = {"Content-Type": "application/json"}
        return response

    def test_default_user_agent_and_verified_system_ca(self):
        url = cms.CATALOG + "/4pq5-n9py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(os.environ, {}, clear=True), patch(
                "cms_collect.urlopen", return_value=self.response(url)
            ) as open_url:
                body, receipt = cms.fetch(url, root / "payload.json", root)
            args, kwargs = open_url.call_args
            self.assertEqual(args, (url,))
            self.assertEqual(kwargs["context"].verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(kwargs["context"].check_hostname)
            self.assertGreater(len(kwargs["context"].get_ca_certs()), 0)
            self.assertEqual(cms.verify_receipt(root, receipt), body)

    def test_explicit_ca_is_honored_and_invalid_ca_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(os.environ, {"SSL_CERT_FILE": str(root / "missing.pem")}), patch(
                "cms_collect.urlopen"
            ) as open_url:
                with self.assertRaises(FileNotFoundError):
                    cms.fetch(cms.CATALOG, root / "payload.json", root)
                open_url.assert_not_called()

    def test_completed_receipt_reused_but_fresh_request_replaces_it(self):
        url = cms.CATALOG + "/4pq5-n9py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "payload.json"
            with patch("cms_collect.urlopen", return_value=self.response(url)) as open_url:
                original, _ = cms.fetch(url, path, root)
                self.assertEqual(cms.fetch(url, path, root)[0], original)
                self.assertEqual(open_url.call_count, 1)
            with patch("cms_collect.urlopen", return_value=self.response(url, b"new")):
                self.assertEqual(cms.fetch(url, path, root, refresh=True)[0], b"new")

    def test_manual_bridge_payload_is_replaced_with_direct_bytes(self):
        url = cms.CATALOG + "/4pq5-n9py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "payload.json"
            with patch("cms_collect.urlopen", return_value=self.response(url)):
                _, receipt = cms.fetch(url, path, root)
            receipt["transport"] = "FetchUrl_full_JSON_payload_text_not_HTTP_wire_bytes"
            cms.write_json(root / "payload.json.receipt.json", receipt)
            cms.write_json(root / "payload.json.transport.json", receipt)
            with patch("cms_collect.urlopen", return_value=self.response(url, b"direct")):
                body, direct = cms.fetch(url, path, root)
            self.assertEqual(body, b"direct")
            self.assertNotIn("transport", direct)
            self.assertFalse((root / "payload.json.transport.json").exists())

    def test_pull_rechecks_counts_even_when_resuming_cached_pages(self):
        row = {cms.CCN: "315001", "state": "NJ"}
        conditions = [cms.condition("state", "=", "NJ")]
        requests = []

        def fetch(url, path, root, refresh=False):
            requests.append((path.name, refresh))
            is_page = path.name.startswith("page-")
            page = {
                "count": 1, "results": [row],
                "schema": {"source": {"fields": {cms.CCN: {}, "state": {}}}},
                "query": {"conditions": conditions, "offset": 0, "limit": 2 if is_page else 1},
            }
            if is_page:
                page["query"]["sorts"] = [
                    {"property": field, "order": "asc"} for field in (cms.CCN, "state")]
            return json.dumps(page).encode(), {}

        with tempfile.TemporaryDirectory() as directory, patch("cms_collect.fetch", side_effect=fetch):
            rows, partition = cms.pull(Path(directory), "4pq5-n9py", "primary", conditions, 2)
        self.assertEqual(rows, [row])
        self.assertTrue(partition["complete"])
        self.assertEqual(requests, [
            ("probe.json", True), ("page-0000000.json", False), ("count-after.json", True)])


class PageTests(unittest.TestCase):
    def setUp(self):
        self.conditions = [cms.condition("state", "=", "NJ")]
        self.page = {
            "count": 2,
            "results": [{"state": "NJ", cms.CCN: "017001"},
                        {"state": "NJ", cms.CCN: "317002"}],
            "query": {"conditions": self.conditions, "offset": 0, "limit": 2},
        }

    def test_preserves_leading_zero_ccn_and_suppression(self):
        self.page["results"][0].update({"rating": "-", "footnote": "2", "abuse_icon": "Y"})
        before = copy.deepcopy(self.page)
        self.assertEqual(cms.validate_page(self.page, self.conditions, 2, 0), 2)
        self.assertEqual(self.page, before)

    def test_rejects_truncated_page(self):
        self.page["results"].pop()
        with self.assertRaisesRegex(ValueError, "Truncated"):
            cms.validate_page(self.page, self.conditions, 2, 0)

    def test_rejects_count_drift(self):
        with self.assertRaisesRegex(ValueError, "count changed"):
            cms.validate_page(self.page, self.conditions, 2, 0, 3)

    def test_rejects_ignored_filter_even_when_query_echoes_it(self):
        self.page["results"][0]["state"] = "NY"
        with self.assertRaisesRegex(ValueError, "outside"):
            cms.validate_page(self.page, self.conditions, 2, 0)

    def test_rejects_missing_filter_echo(self):
        self.page["query"]["conditions"] = []
        with self.assertRaisesRegex(ValueError, "filters"):
            cms.validate_page(self.page, self.conditions, 2, 0)

    def test_rejects_numeric_or_shortened_ccn(self):
        for value in (17001, "17001"):
            self.page["results"][0][cms.CCN] = value
            with self.assertRaisesRegex(ValueError, "six-character"):
                cms.validate_page(self.page, self.conditions, 2, 0)

    def test_rejects_ignored_ordering(self):
        with self.assertRaisesRegex(ValueError, "ordering"):
            cms.validate_page(self.page, self.conditions, 2, 0, sorts=[cms.CCN])

    def test_empty_result_is_valid_only_with_zero_count(self):
        page = {"count": 0, "results": [],
                "query": {"conditions": [], "offset": 0, "limit": 2}}
        self.assertEqual(cms.validate_page(page, [], 2, 0), 0)
        page["count"] = 1
        with self.assertRaisesRegex(ValueError, "Truncated"):
            cms.validate_page(page, [], 2, 0)


class GeographyTests(unittest.TestCase):
    def test_ambiguous_zip_never_becomes_exact_county(self):
        crosswalk = [{"zip": "07001", "county": "34039"},
                     {"zip": "07001", "county": "34023"},
                     {"zip": "07002", "county": "34017"}]
        rows = [{"state": "NY", cms.CCN: "337001", "zip_code": "07001"},
                {"state": "PA", cms.CCN: "397001", "zip_code": "07002"}]
        edges = cms.service_edges(rows, crosswalk)
        self.assertIsNone(edges[0]["county"])
        self.assertEqual(edges[0]["target_county_candidates"], ["Union"])
        self.assertEqual(edges[0]["crosswalk_county_fips"], ["34023", "34039"])
        self.assertEqual(edges[1]["county"], "Hudson")
        self.assertEqual(edges[1]["office_state"], "PA")

    def test_office_location_does_not_create_service_edges(self):
        rows = [{"state": "NJ", cms.CCN: "317001", "zip_code": "99999"}]
        self.assertEqual(cms.service_edges(rows, [{"zip": "07001", "county": "34039"}]), [])

    def test_crosswalk_reads_numeric_leading_zeros_and_multiple_counties(self):
        body = io.BytesIO()
        xml = (
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row>'
            '<c r="A1" t="inlineStr"><is><t>COUNTY</t></is></c>'
            '<c r="B1" t="inlineStr"><is><t>ZIP</t></is></c></row>'
            '<row><c r="A2"><v>34039</v></c><c r="B2"><v>7001</v></c></row>'
            '<row><c r="A3"><v>34023</v></c><c r="B3"><v>7001</v></c></row>'
            '</sheetData></worksheet>'
        )
        with zipfile.ZipFile(body, "w") as archive:
            archive.writestr("xl/worksheets/sheet1.xml", xml)
        self.assertEqual(cms.crosswalk_rows(body.getvalue()), [
            {"county": "34039", "zip": "07001"}, {"county": "34023", "zip": "07001"}])


class IntegrityTests(unittest.TestCase):
    def test_completed_collection_requires_new_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cms.write_json(root / "manifest.json", {"status": "complete"})
            with patch("cms_collect.fetch") as fetch:
                with self.assertRaisesRegex(ValueError, "new --output"):
                    cms.collect(root, 1000)
                fetch.assert_not_called()
            self.assertEqual(json.loads((root / "manifest.json").read_text()), {"status": "complete"})

    def test_changed_release_cannot_resume_old_pages(self):
        source = "4pq5-n9py"
        current = {"identifier": source, "title": "CMS", "released": "2026-10-28"}
        old = {**current, "released": "2026-09-28"}
        requested = []

        def fetch(url, path, root, refresh=False):
            requested.append((url, refresh))
            return (json.dumps([current]).encode() if url == cms.CATALOG else b"reference"), {}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata_path = root / "raw" / source / "metadata.json"
            cms.write_json(metadata_path, old)
            with patch("cms_collect.fetch", side_effect=fetch), patch(
                "cms_collect.crosswalk_rows", return_value=[{"zip": "07001", "county": "34039"}]
            ):
                with self.assertRaisesRegex(ValueError, "Cached source release changed"):
                    cms.collect(root, 1000)
            self.assertEqual(json.loads(metadata_path.read_text()), old)
            self.assertEqual(requested[0], (cms.CATALOG, True))
            self.assertFalse(any("/datastore/query/" in url for url, _ in requested))

    def test_tampered_raw_bytes_fail_hash_check(self):
        cms.OUTPUT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".cms-test-", dir=cms.OUTPUT) as directory:
            root = Path(directory)
            (root / "page.json").write_bytes(b'{"results":[]}')
            receipt = {"file": "page.json", "sha256": cms.digest(b"original"), "bytes": 14}
            with self.assertRaisesRegex(ValueError, "SHA256"):
                cms.verify_receipt(root, receipt)

    def test_rejects_nonofficial_or_credentialed_sources(self):
        for url in ("https://example.com/data", "http://data.cms.gov/data",
                    "https://raw.githubusercontent.com/other/repository/file"):
            self.assertFalse(cms.official_url(url))

    def test_different_family_releases_are_valid_but_mixed_family_is_not(self):
        metadata = {key: {"modified": "2026-09-01",
                          "released": "2026-10-28" if spec["family"] == "nursing" else "2026-10-21"}
                    for key, spec in cms.REGISTRY.items()}
        self.assertEqual(cms.release_check(metadata)["home_health"], ["2026-10-21"])
        metadata["r5ix-sfxw"]["released"] = "2026-09-28"
        with self.assertRaisesRegex(ValueError, "Inconsistent"):
            cms.release_check(metadata)


class PartitionCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((cms.OUTPUT / "manifest.json").read_text())
        cls.crosswalk = json.loads((cms.OUTPUT / "crosswalk.json").read_text())["rows"]

    @contextmanager
    def archive(self, mutate):
        manifest = copy.deepcopy(self.manifest)
        mutate(manifest)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("raw", "crosswalk.json", "catalog-discovery.json"):
                (root / name).symlink_to(cms.OUTPUT / name)
            datasets = {}
            changed = set()
            (root / "datasets").mkdir()
            for dataset_id, source in manifest["sources"].items():
                original = self.manifest["sources"][dataset_id]["partitions"]
                pages = [page["file"] for part in source["partitions"] for page in part["pages"]]
                original_pages = [page["file"] for part in original for page in part["pages"]]
                name = f"datasets/{dataset_id}.json"
                if pages != original_pages:
                    rows = [
                        row for filename in pages
                        for row in json.loads((cms.OUTPUT / filename).read_text())["results"]
                    ]
                    if dataset_id == "m5eg-upu5":
                        rows = cms.unique_rows(rows)
                    datasets[dataset_id] = rows
                    changed.add(name)
                    cms.write_json(root / name, rows)
                    source["retained_rows"] = len(rows)
                else:
                    (root / name).symlink_to(cms.OUTPUT / name)
            if all(not source["partitions"] for source in manifest["sources"].values()):
                for name, value in cms.derive(datasets, self.crosswalk).items():
                    changed.add(f"{name}.json")
                    cms.write_json(root / f"{name}.json", value)
            else:
                for name in ("nursing_roster", "home_health_roster",
                             "home_health_service_zip_edges", "nursing_evidence", "coverage"):
                    (root / f"{name}.json").symlink_to(cms.OUTPUT / f"{name}.json")
            for receipt in manifest["artifacts"]:
                if receipt["file"] in changed:
                    body = (root / receipt["file"]).read_bytes()
                    receipt.update(sha256=cms.digest(body), bytes=len(body))
            cms.write_json(root / "manifest.json", manifest)
            yield root

    def reject(self, mutate, message):
        with self.archive(mutate) as root:
            with self.assertRaisesRegex(ValueError, message):
                cms.verify(root)

    def test_rejects_all_sources_without_partitions_and_empty_datasets(self):
        def mutate(manifest):
            for source in manifest["sources"].values():
                source["partitions"] = []
        self.reject(mutate, "partition coverage")

    def test_rejects_missing_primary_for_every_registry_source(self):
        for dataset_id in cms.REGISTRY:
            with self.subTest(dataset_id=dataset_id):
                self.reject(
                    lambda manifest: manifest["sources"][dataset_id]["partitions"].pop(0),
                    "partition coverage",
                )

    def test_rejects_missing_nj_office_service_query(self):
        self.reject(
            lambda manifest: manifest["sources"]["m5eg-upu5"]["partitions"].pop(1),
            "partition coverage",
        )

    def test_rejects_each_missing_foreign_clinical_or_survey_query(self):
        manifest = json.loads((cms.OUTPUT / "manifest.json").read_text())
        for dataset_id in ("6jpm-sxkc", "ccn4-8vby"):
            for index in range(1, len(manifest["sources"][dataset_id]["partitions"])):
                with self.subTest(dataset_id=dataset_id, index=index):
                    self.reject(
                        lambda value: value["sources"][dataset_id]["partitions"].pop(index),
                        "partition coverage",
                    )

    def test_rejects_substituted_filters_for_each_partition(self):
        manifest = json.loads((cms.OUTPUT / "manifest.json").read_text())
        for dataset_id, source in manifest["sources"].items():
            for index in range(len(source["partitions"])):
                with self.subTest(dataset_id=dataset_id, index=index):
                    def mutate(value):
                        value["sources"][dataset_id]["partitions"][index]["conditions"] = [
                            cms.condition("state", "=", "NY")]
                    self.reject(mutate, "filters|request URL")

    def test_rejects_duplicate_partition(self):
        def mutate(manifest):
            partitions = manifest["sources"]["4pq5-n9py"]["partitions"]
            partitions.append(copy.deepcopy(partitions[0]))
        self.reject(mutate, "Duplicate partition")

    def test_rejects_unexpected_partition_name(self):
        self.reject(
            lambda manifest: manifest["sources"]["4pq5-n9py"]["partitions"][0].update(
                name="substituted-primary"),
            "partition coverage",
        )

    def test_rejects_changed_registry_role_family_or_scope(self):
        for field in ("role", "family", "scope"):
            with self.subTest(field=field):
                self.reject(
                    lambda manifest: manifest["sources"]["4pq5-n9py"].update({field: "other"}),
                    "Source registry",
                )

    def test_rejects_invalid_page_sizes(self):
        for size in (0, -1, True, 1.5, "1000", 5001):
            with self.subTest(size=size):
                self.reject(
                    lambda manifest: manifest["sources"]["4pq5-n9py"]["partitions"][0].update(
                        page_size=size),
                    "Page size",
                )

    def test_rejects_wrong_official_request_url_for_each_receipt_kind(self):
        for kind in ("probe", "count_after", "pages"):
            with self.subTest(kind=kind):
                def mutate(manifest):
                    partition = manifest["sources"]["4pq5-n9py"]["partitions"][0]
                    receipt = partition["pages"][0] if kind == "pages" else partition[kind]
                    receipt["url"] = cms.query_url(
                        "4pq5-n9py", [cms.condition("state", "=", "NY")], 1, 0)
                self.reject(mutate, "request URL")


class RetainedArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = cms.verify(cms.OUTPUT)
        cls.datasets = {
            key: json.loads((cms.OUTPUT / "datasets" / f"{key}.json").read_text())
            for key in cms.REGISTRY
        }

    def test_actual_artifacts_and_source_release_dates(self):
        self.assertEqual(self.report["status"], "passed")
        self.assertEqual(self.report["datasets_checked"], 17)
        self.assertEqual(self.report["release_consistency"],
                         {"nursing": ["2026-10-28"], "home_health": ["2026-10-21"]})
        self.assertEqual(len(self.datasets["4pq5-n9py"]), 348)
        self.assertEqual(sum(row[cms.CCN].startswith("31")
                             for row in self.datasets["ccn4-8vby"]), 38)

    def test_independently_verified_source_specific_target_counts(self):
        expected = {
            "4pq5-n9py": 139, "r5ix-sfxw": 3256, "ifjz-ge4w": 2293,
            "g6vv-u9sr": 107, "djen-97ju": 2363, "ijh5-nb2v": 556,
            "tbry-pc2d": 415, "svdt-c123": 1161, "fykj-qjee": 7923,
        }
        self.assertEqual(
            {key: self.report["evidence"][key]["target_nursing_rows"] for key in expected},
            expected,
        )
        self.assertEqual(self.report["nursing_counties"], {
            "Union": 23, "Morris": 21, "Essex": 32, "Bergen": 29, "Hudson": 15, "Passaic": 19,
        })

    def test_manifest_does_not_claim_concurrently_owned_artifacts(self):
        manifest = json.loads((cms.OUTPUT / "manifest.json").read_text())
        artifacts = {item["file"] for item in manifest["artifacts"]}
        self.assertFalse(any(path.startswith("pos/") for path in artifacts))
        self.assertFalse({"independent-verification.md", "transport-verification.md"} & artifacts)
        self.assertFalse(any("transport" in path or "pending" in path for path in artifacts))
        receipts = [manifest["catalog"], *manifest["references"]]
        for source in manifest["sources"].values():
            receipts.extend([source["metadata"], source["metadata_after"]])
            for partition in source["partitions"]:
                receipts.extend([partition["probe"], partition["count_after"], *partition["pages"]])
        self.assertTrue(all("transport" not in receipt for receipt in receipts))

    def test_original_dictionary_pdfs_and_fresh_metadata_after_are_retained(self):
        manifest = json.loads((cms.OUTPUT / "manifest.json").read_text())
        dictionaries = [receipt for receipt in manifest["references"]
                        if receipt["role"] == "data_dictionary_and_footnotes"]
        self.assertEqual(len(dictionaries), 2)
        for receipt in dictionaries:
            self.assertTrue(cms.verify_receipt(cms.OUTPUT, receipt).startswith(b"%PDF-"))
            self.assertEqual(receipt["content_type"].split(";")[0], "application/pdf")
        for source in manifest["sources"].values():
            self.assertGreaterEqual(source["metadata"]["retrieved_at"], manifest["started_at"])
            self.assertGreaterEqual(source["metadata_after"]["retrieved_at"],
                                    source["metadata"]["retrieved_at"])

    def test_all_target_counties_have_actual_roster_and_clinical_inspection_evidence(self):
        target = json.loads((cms.OUTPUT / "nursing_roster.json").read_text())
        for county in cms.COUNTIES:
            ccns = {row[cms.CCN] for row in target if row["countyparish"] == county}
            self.assertTrue(ccns, county)
            for source in ("r5ix-sfxw", "ifjz-ge4w", "djen-97ju", "ijh5-nb2v", "tbry-pc2d"):
                self.assertTrue(any(row[cms.CCN] in ccns for row in self.datasets[source]),
                                (county, source))

    def test_all_nj_home_health_offices_remain_county_unknown(self):
        offices = json.loads((cms.OUTPUT / "home_health_roster.json").read_text())
        self.assertTrue(offices)
        self.assertTrue(all(row["office_county"] is None for row in offices))
        raw_nj = {row[cms.CCN] for row in self.datasets["6jpm-sxkc"] if row["state"] == "NJ"}
        self.assertEqual(raw_nj, {row["ccn"] for row in offices if row["office_state"] == "NJ"})

    def test_actual_staffing_and_material_warnings_are_retained(self):
        roster = self.datasets["4pq5-n9py"]
        required = {"abuse_icon", "special_focus_status", "overall_rating_footnote",
                    "reported_rn_staffing_hours_per_resident_per_day",
                    "total_nursing_staff_turnover", "total_nursing_staff_turnover_footnote"}
        self.assertTrue(all(required <= row.keys() for row in roster))
        self.assertTrue(any(row["abuse_icon"] == "Y" for row in roster))
        self.assertTrue(any(row["staffing_rating"] == "" and row["staffing_rating_footnote"]
                            for row in roster))

    def test_actual_service_zips_do_not_discard_non_nj_offices(self):
        rows = self.datasets["m5eg-upu5"]
        self.assertTrue(any(row["state"] != "NJ" for row in rows))
        offices = {row[cms.CCN] for row in self.datasets["6jpm-sxkc"]}
        self.assertTrue({row[cms.CCN] for row in rows} <= offices)


if __name__ == "__main__":
    unittest.main(verbosity=2)
