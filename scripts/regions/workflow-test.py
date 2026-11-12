#!/usr/bin/env python3
"""Behavioral tests through the regional workflow CLI in disposable repositories."""

import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CLI = Path(__file__).with_name("workflow.py")
ROOT = CLI.resolve().parents[2]


class WorkflowCLI(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="workflow-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.write("scripts/check.py", "print('owner check passed')\n")
        self.write("research/input.json", json.dumps({
            "asOf": "2026-10-28", "source": {"url": "https://example.invalid/source",
            "retrievedAt": "2026-11-11"}, "gaps": ["not searched"],
        }))
        self.config = {
            "schema_version": 1,
            "market": {"id": "future-region", "state": "VT", "label": "Future geography"},
            "read_only": False, "known_gaps": ["Collection is partial."],
            "steps": [self.step("first")],
        }

    def write(self, path, body):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body)

    def step(self, identifier, script="scripts/check.py", dependencies=None):
        return {
            "id": identifier, "depends_on": dependencies or [], "known_gaps": [],
            "commands": {"verify": {"argv": ["python3", script]},
                         "rebuild": {"argv": ["python3", script]},
                         "refresh": {"argv": ["python3", script]}},
            "artifacts": [{"path": "research/input.json", "role": "source",
                           "metadata": ["/asOf", "/source", "/gaps"]}],
        }

    def call(self, action="verify", *args, config=None):
        self.write("research/region-workflows/fixture.json", json.dumps(config or self.config))
        result = subprocess.run(
            [sys.executable, "-B", str(CLI), action, "--root", str(self.root),
             "--config", "research/region-workflows/fixture.json", *args],
            cwd=self.root.parent, capture_output=True, text=True, timeout=30,
        )
        self.assertFalse(result.stderr, result.stderr)
        return result.returncode, json.loads(result.stdout)

    def test_owner_check_paths_dates_provenance_and_report(self):
        code, report = self.call("verify", "--report", "research/region-workflows/run.json")
        self.assertEqual(code, 0)
        self.assertEqual(report["status"], "checks_passed")
        self.assertEqual(report["coverage_status"], "not_assessed")
        self.assertEqual(report["market"]["state"], "VT")
        item = report["steps"][0]["artifacts"][0]
        self.assertEqual(item["path"], "research/input.json")
        self.assertEqual(item["status"], "verified")
        self.assertEqual(item["provenance"]["/asOf"]["value"], "2026-10-28")
        self.assertEqual(item["provenance"]["/source"]["value"]["retrievedAt"], "2026-11-11")
        self.assertEqual(item["provenance"]["/gaps"]["value"], ["not searched"])
        self.assertEqual(item["sha256"], hashlib.sha256((self.root / item["path"]).read_bytes()).hexdigest())
        self.assertEqual(report, json.loads((self.root / "research/region-workflows/run.json").read_text()))
        self.assertNotIn(str(self.root), json.dumps(report))
        outcome = report["steps"][0]["outcomes"][0]
        self.assertEqual(outcome["exit_code"], 0)
        self.assertEqual(outcome["argv"], ["python3", "scripts/check.py"])
        self.assertEqual(outcome["tool_sha256"], hashlib.sha256((self.root / "scripts/check.py").read_bytes()).hexdigest())

    def test_verify_blocks_network_without_refresh(self):
        self.write("scripts/check.py", "import socket\nsocket.create_connection(('127.0.0.1', 9), 0.1)\n")
        code, report = self.call()
        self.assertEqual(code, 1)
        outcome = report["steps"][0]["outcomes"][0]
        self.assertIn("offline network access blocked", outcome["stderr"])
        self.assertFalse(outcome["network_allowed"])

    def test_verify_blocks_writes_and_subprocesses(self):
        for body, message in (
            ("from pathlib import Path\nPath('research/input.json').write_text('changed')\n",
             "write outside scratch blocked"),
            ("import subprocess\nsubprocess.run(['python3', '-c', 'print(1)'])\n",
             "offline child process blocked"),
        ):
            with self.subTest(body=body):
                self.write("scripts/check.py", body)
                before = (self.root / "research/input.json").read_bytes()
                code, report = self.call()
                self.assertEqual(code, 1)
                self.assertIn(message, report["steps"][0]["outcomes"][0]["stderr"])
                self.assertEqual((self.root / "research/input.json").read_bytes(), before)
                self.assertFalse(list(self.root.rglob("__pycache__")))

    def test_verify_allows_temporary_check_work_and_cleanup(self):
        self.write("scripts/check.py",
                   "import tempfile\nfrom pathlib import Path\n"
                   "with tempfile.TemporaryDirectory() as d:\n"
                   "    p = Path(d) / 'child'\n"
                   "    p.mkdir()\n"
                   "    (p / 'check.json').write_text('{}')\n"
                   "print('temporary check removed')\n")
        code, report = self.call()
        self.assertEqual(code, 0, report)
        self.assertEqual(sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()),
                         ["research/input.json", "research/region-workflows/fixture.json", "scripts/check.py"])

    def test_independent_failure_continues_and_rebuild_dependencies_block(self):
        self.write("scripts/fail.py", "import sys\nprint('failure')\nsys.exit(7)\n")
        self.write("scripts/independent.py", "from pathlib import Path\nPath('research/independent.json').write_text('{}')\n")
        self.config["steps"] = [self.step("failed", "scripts/fail.py"),
                                self.step("dependent", dependencies=["failed"]),
                                self.step("independent", "scripts/independent.py")]
        code, report = self.call("rebuild")
        self.assertEqual(code, 1)
        self.assertEqual([s["status"] for s in report["steps"]],
                         ["failed", "blocked_dependency", "succeeded"])
        self.assertEqual(report["steps"][0]["outcomes"][0]["exit_code"], 7)
        self.assertTrue((self.root / "research/independent.json").exists())
        self.assertEqual(report["status"], "partial_failure")

    def test_verify_still_checks_independent_and_dependent_outputs(self):
        self.write("scripts/fail.py", "raise ValueError('stale output')\n")
        self.config["steps"] = [self.step("failed", "scripts/fail.py"),
                                self.step("dependent", dependencies=["failed"]),
                                self.step("independent")]
        code, report = self.call()
        self.assertEqual(code, 1)
        self.assertEqual([s["status"] for s in report["steps"]],
                         ["verification_failed", "verified", "verified"])
        self.assertEqual(report["steps"][1]["depends_on"], {"failed": "verification_failed"})

    def test_selection_does_not_refresh_or_run_omitted_dependencies(self):
        self.write("scripts/fail.py", "raise AssertionError('must not run')\n")
        self.config["steps"] = [self.step("first", "scripts/fail.py"),
                                self.step("independent", dependencies=["first"])]
        code, report = self.call("verify", "--step", "independent")
        self.assertEqual(code, 0)
        self.assertEqual(report["selection_scope"], "selected_steps_only")
        self.assertEqual(report["steps"][0]["outcomes"], [])
        self.assertEqual(report["steps"][1]["depends_on"], {"first": "not_selected"})
        self.assertEqual(self.call("verify", "--step", "unknown")[0], 2)

    def test_plan_is_inventory_only_and_shows_requested_mode(self):
        self.write("scripts/check.py", "raise AssertionError('plan executed a command')\n")
        code, report = self.call("plan", "--mode", "refresh")
        self.assertEqual(code, 0)
        self.assertEqual(report["mode"], "refresh")
        self.assertEqual(report["steps"][0]["outcomes"], [])
        self.assertEqual(report["steps"][0]["artifacts"][0]["status"], "present_unverified")

    def test_missing_stale_and_existence_are_distinct(self):
        self.config["steps"][0]["commands"] = {}
        self.config["steps"][0]["artifacts"] += [
            {"path": "research/missing.json", "role": "output"},
            {"path": "research/stale.json", "role": "output",
             "sha256_from": {"path": "research/hashes.json", "pointer": "/expected"}},
            {"path": "research/verified.json", "role": "output",
             "sha256_from": {"path": "research/hashes.json", "pointer": "/expected"}},
        ]
        self.write("research/hashes.json", json.dumps({"expected": hashlib.sha256(b"{}").hexdigest()}))
        self.write("research/stale.json", '{"changed":true}')
        self.write("research/verified.json", "{}")
        code, report = self.call()
        self.assertEqual(code, 1)
        self.assertEqual([a["status"] for a in report["steps"][0]["artifacts"]],
                         ["present_unverified", "missing", "stale", "hash_verified"])
        self.assertEqual(report["status"], "verification_failed")

    def test_successful_command_does_not_hide_missing_or_stale(self):
        self.config["steps"][0]["artifacts"] += [
            {"path": "research/missing.json", "role": "output"},
            {"path": "research/input.json", "role": "output",
             "sha256_from": {"path": "research/hashes.json", "pointer": "/expected"}},
        ]
        self.write("research/hashes.json", json.dumps({"expected": "0" * 64}))
        code, report = self.call()
        self.assertEqual(code, 1)
        self.assertEqual(report["steps"][0]["outcomes"][0]["exit_code"], 0)
        self.assertEqual([a["status"] for a in report["steps"][0]["artifacts"]],
                         ["verified", "missing", "stale"])

    def test_inventory_only_artifacts_are_not_promoted_by_owner_check(self):
        self.config["steps"][0]["artifacts"][0]["owner_check"] = False
        code, report = self.call()
        self.assertEqual(code, 1)
        self.assertEqual(report["steps"][0]["artifacts"][0]["status"], "present_unverified")

    def test_foreach_verifies_each_retained_run_and_continues_after_failure(self):
        self.write("research/runs/a/manifest.json", "{}")
        self.write("research/runs/b/manifest.json", "{}")
        self.write("scripts/check.py",
                   "import sys\nprint(sys.argv[1])\nsys.exit(3 if sys.argv[1].endswith('/a') else 0)\n")
        self.config["steps"][0]["commands"]["verify"] = {
            "argv": ["python3", "scripts/check.py", "{match_dir}"],
            "foreach": "research/runs/*/manifest.json",
        }
        self.config["steps"][0]["artifacts"] = [{"path": "research/runs/*/manifest.json", "role": "manifest"}]
        code, report = self.call()
        self.assertEqual(code, 1)
        outcomes = report["steps"][0]["outcomes"]
        self.assertEqual([o["exit_code"] for o in outcomes], [3, 0])
        self.assertEqual([o["argv"][-1] for o in outcomes], ["research/runs/a", "research/runs/b"])
        self.assertEqual([a["status"] for a in report["steps"][0]["artifacts"]],
                         ["present_unverified", "verified"])

    def test_timeout_keeps_output_and_continues_independent_step(self):
        self.write("scripts/slow.py", "import time\nprint('started', flush=True)\ntime.sleep(5)\n")
        slow = self.step("slow", "scripts/slow.py")
        slow["commands"]["verify"]["timeout_seconds"] = 1
        self.config["steps"] = [slow, self.step("independent")]
        code, report = self.call()
        self.assertEqual(code, 1)
        outcome = report["steps"][0]["outcomes"][0]
        self.assertEqual(outcome["status"], "timed_out")
        self.assertEqual(outcome["exit_code"], None)
        self.assertEqual(outcome["stdout"], "started\n")
        self.assertEqual(report["steps"][1]["status"], "verified")

    def test_tool_change_during_rebuild_is_not_a_success_claim(self):
        self.write("scripts/check.py",
                   "from pathlib import Path\nPath(__file__).write_text(\"print('new version')\\n\")\n")
        code, report = self.call("rebuild")
        self.assertEqual(code, 1)
        outcome = report["steps"][0]["outcomes"][0]
        self.assertEqual(outcome["exit_code"], 0)
        self.assertEqual(outcome["status"], "tool_changed_during_run")
        self.assertNotEqual(outcome["tool_sha256"], outcome["tool_sha256_after"])

    def test_read_only_ma_config_refuses_writes_and_keeps_files(self):
        config = json.loads((ROOT / "research/region-workflows/massachusetts.json").read_text())
        self.write("src/data/providers.json", '[{"state":"MA"}]')
        self.write("src/data/catalog-meta.json", '{"asOf":"2026-11-11"}')
        original = {p.relative_to(self.root).as_posix(): p.read_bytes()
                    for p in self.root.rglob("*") if p.is_file()}
        code, report = self.call("verify", config=config)
        self.assertEqual(code, 1)
        self.assertEqual(report["market"]["state"], "MA")
        self.assertEqual(report["steps"][0]["artifacts"][1]["status"], "present_unverified")
        for action in ("refresh", "rebuild"):
            code, refused = self.call(action, config=config)
            self.assertEqual(code, 2)
            self.assertIn("read-only", refused["error"])
        for path, body in original.items():
            self.assertEqual((self.root / path).read_bytes(), body)

    def test_read_only_cannot_smuggle_mutating_mode(self):
        self.config["read_only"] = True
        self.assertEqual(self.call()[0], 2)

    def test_rebuild_offline_refresh_explicit_and_neither_claims_verification(self):
        self.write("scripts/check.py", "import socket\nsocket.socket().close()\nprint('refresh socket opened')\n")
        code, report = self.call("rebuild")
        self.assertEqual(code, 1)
        self.assertIn("offline network access blocked", report["steps"][0]["outcomes"][0]["stderr"])
        code, report = self.call("refresh")
        self.assertEqual(code, 0)
        self.assertTrue(report["steps"][0]["outcomes"][0]["network_allowed"])
        self.assertEqual(report["steps"][0]["artifacts"][0]["status"], "present_unverified")
        self.assertEqual(report["status"], "commands_finished")
        self.assertEqual(report["coverage_status"], "not_assessed")

    def test_invalid_config_paths_arguments_modes_and_dependencies(self):
        cases = []
        for path in ("/tmp/out.json", "../out.json", "research/../out.json", "research//out.json"):
            config = copy.deepcopy(self.config)
            config["steps"][0]["artifacts"][0]["path"] = path
            cases.append(config)
        for argv in (
            "python3 scripts/check.py", ["sh", "scripts/check.py"],
            ["python3", "-c", "print('bad')"], ["python3", "/tmp/check.py"],
            ["python3", "scripts/check.py", "--output=/tmp/output"],
            ["python3", "scripts/check.py", "--root=.."],
            ["python3", "scripts/check.py", "../outside"],
            ["python3", "scripts/check.py", "{unknown}"],
            ["python3", "scripts/check.py", ";touch bad"],
        ):
            config = copy.deepcopy(self.config)
            config["steps"][0]["commands"]["verify"]["argv"] = argv
            cases.append(config)
        for field, value in (("depends_on", ["later"]), ("unknown_typo", True)):
            config = copy.deepcopy(self.config)
            config["steps"][0][field] = value
            cases.append(config)
        config = copy.deepcopy(self.config)
        config["steps"][0]["commands"]["verify"]["timeout_seconds"] = 0
        cases.append(config)
        config = copy.deepcopy(self.config)
        config["schema_version"] = True
        cases.append(config)
        for config in cases:
            with self.subTest(config=config):
                code, report = self.call(config=config)
                self.assertEqual(code, 2, report)
                self.assertEqual(report["status"], "invalid_request")

    def test_symlink_escape_and_report_confinement(self):
        (self.root / "research/outside").symlink_to(self.root.parent)
        self.config["steps"][0]["artifacts"][0]["path"] = "research/outside/input.json"
        self.assertEqual(self.call()[0], 2)
        self.config["steps"][0]["artifacts"][0]["path"] = "research/input.json"
        for report in ("research/not-owned.json", "src/data/output.json", "/tmp/result.json",
                       "research/region-workflows/nested/output.json"):
            with self.subTest(report=report):
                self.assertEqual(self.call("verify", "--report", report)[0], 2)
        self.write("research/region-workflows/existing.json", '{"user":"work"}')
        code, _ = self.call("verify", "--report", "research/region-workflows/existing.json")
        self.assertEqual(code, 2)
        self.assertEqual((self.root / "research/region-workflows/existing.json").read_text(), '{"user":"work"}')

    def test_wildcard_metadata_retains_nested_per_provider_provenance(self):
        self.write("research/locations.json", json.dumps({
            "provider-a": {"checkedAt": "2026-11-10", "sources": [
                {"checkedAt": "2026-11-10", "publishedAt": "2026-09-01"},
                {"checkedAt": "2026-11-09", "publishedAt": None}]},
            "provider-b": {"checkedAt": "2026-11-11", "sources": [
                {"checkedAt": "2026-11-11", "publishedAt": "2026-10-02"}]},
        }))
        self.config["steps"][0]["artifacts"] = [{
            "path": "research/locations.json", "role": "source",
            "metadata": ["/*/checkedAt", "/*/sources/*/checkedAt", "/*/sources/*/publishedAt"]}]
        code, report = self.call()
        self.assertEqual(code, 0)
        provenance = report["steps"][0]["artifacts"][0]["provenance"]
        self.assertEqual(provenance["/*/checkedAt"]["value"],
                         {"provider-a": "2026-11-10", "provider-b": "2026-11-11"})
        self.assertEqual(provenance["/*/sources/*/checkedAt"]["value"],
                         {"provider-a": ["2026-11-10", "2026-11-09"],
                          "provider-b": ["2026-11-11"]})
        self.assertEqual(provenance["/*/sources/*/publishedAt"]["value"],
                         {"provider-a": ["2026-09-01", None], "provider-b": ["2026-10-02"]})

    def test_expected_hash_pointers_stay_exact(self):
        self.write("research/hashes.json", json.dumps({"expected": {"a": "0" * 64}}))
        self.config["steps"][0]["artifacts"][0]["sha256_from"] = {
            "path": "research/hashes.json", "pointer": "/expected/*"}
        code, report = self.call()
        self.assertEqual(code, 2)
        self.assertIn("wildcards are metadata-only", report["error"])

    def test_optional_artifacts_are_captured_but_never_required_or_promoted(self):
        optional = {"path": "research/partial.json", "role": "manifest", "optional": True,
                    "owner_check": False, "metadata": ["/status"]}
        self.config["steps"][0]["artifacts"].append(optional)
        code, report = self.call()
        self.assertEqual(code, 0)
        self.assertEqual(report["steps"][0]["artifacts"][-1]["status"], "absent_optional")
        self.write("research/partial.json", json.dumps({"status": "collecting"}))
        code, report = self.call()
        self.assertEqual(code, 1)
        artifact = report["steps"][0]["artifacts"][-1]
        self.assertEqual(artifact["status"], "present_unverified")
        self.assertEqual(artifact["provenance"]["/status"]["value"], "collecting")

    def test_ma_config_metadata_pointers_match_actual_source_fields(self):
        spec = importlib.util.spec_from_file_location("region_workflow", CLI)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        config = json.loads((ROOT / "research/region-workflows/massachusetts.json").read_text())
        evidence = next(step for step in config["steps"] if step["id"] == "evidence")
        by_path = {artifact["path"]: artifact.get("metadata", [])
                   for artifact in evidence["artifacts"]}
        self.assertIn("/retrieved", by_path["src/data/inspection-history.json"])
        self.assertNotIn("/asOf", by_path["src/data/inspection-history.json"])
        self.assertIn("/retrieved", by_path["src/data/home-health-evidence.json"])
        self.assertIn("/releasedAt", by_path["src/data/home-health-evidence.json"])
        self.assertNotIn("/asOf", by_path["src/data/home-health-evidence.json"])
        self.assertIn("/checkedAt", by_path["src/data/facebook-research.json"])
        self.assertNotIn("/asOf", by_path["src/data/facebook-research.json"])
        location = by_path["src/data/location-research.json"]
        self.assertIn("/*/checkedAt", location)
        self.assertTrue(any(field.startswith("/*/sources/*/") for field in location))
        for artifact in evidence["artifacts"]:
            data = json.loads((ROOT / artifact["path"]).read_text())
            for field in artifact.get("metadata", []):
                module.select(data, field)

    def test_nj_cms_declares_exactly_the_registry_owned_metadata(self):
        tree = ast.parse((ROOT / "scripts/regions/cms_collect.py").read_text())
        registry = None
        for node in ast.walk(tree):
            if (isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == "REGISTRY"
                            for target in node.targets)):
                registry = ast.literal_eval(node.value)
        self.assertIsNotNone(registry)
        config = json.loads((ROOT / "research/region-workflows/north-jersey.json").read_text())
        cms = next(step for step in config["steps"] if step["id"] == "cms")
        owned = {artifact["path"] for artifact in cms["artifacts"]
                 if artifact.get("owner_check", True) and "/raw/" in artifact["path"]}
        expected = {f"research/north-jersey/cms/raw/{dataset_id}/{name}"
                    for dataset_id in registry
                    for name in ("metadata.json", "metadata-after.json")}
        self.assertEqual(owned, expected)
        optional = {artifact["path"]: artifact for artifact in cms["artifacts"]
                    if artifact.get("optional")}
        self.assertEqual(set(optional), {"research/north-jersey/cms/manifest.partial.json",
                                         "research/north-jersey/cms/pending-request.json"})
        self.assertTrue(all(not artifact.get("owner_check", True)
                            for artifact in optional.values()))

    def test_shared_scope_identifies_and_excludes_local_acquisition(self):
        self.config["steps"][0]["local_acquisition"] = True
        code, report = self.call("plan", "--scope", "shared")
        self.assertEqual(code, 0)
        self.assertEqual(report["local_acquisition_steps"], [self.config["steps"][0]["id"]])
        self.assertNotIn(self.config["steps"][0]["id"], report["selected_steps"])
        self.assertEqual(self.call("verify", "--scope", "shared", "--step", self.config["steps"][0]["id"])[0], 2)
        self.assertEqual(self.call("rebuild", "--scope", "shared")[0], 2)

    def test_real_configs_plan_from_fixture_without_geography_specific_runner_code(self):
        for name in ("north-jersey", "massachusetts"):
            config = json.loads((ROOT / f"research/region-workflows/{name}.json").read_text())
            code, report = self.call("plan", config=config)
            self.assertEqual(code, 0, report)
            self.assertTrue(any(a["status"] == "missing" for s in report["steps"]
                                for a in s.get("artifacts", [])))
            self.assertTrue(all(not s["outcomes"] for s in report["steps"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
