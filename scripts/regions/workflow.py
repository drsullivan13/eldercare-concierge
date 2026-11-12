#!/usr/bin/env python3
"""Run ordered regional workflow configs without owning their evidence schemas."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import time


MODES = ("verify", "refresh", "rebuild")
DEFAULT_ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = PurePosixPath("research/region-workflows")

# This guard is for trusted Python collectors, not a sandbox for hostile code.
GUARDED_RUNNER = r"""
import os, pathlib, runpy, sys, tempfile
if sys.platform == "darwin":
    import fcntl
scratch, mode, script, *arguments = sys.argv[1:]
scratch = pathlib.Path(scratch).resolve()
tempfile.tempdir = str(scratch)
def writable(path, dir_fd=None):
    if isinstance(path, int):
        raise PermissionError("workflow: descriptor mutation blocked")
    if dir_fd not in (None, -1):
        directory = (os.fsdecode(fcntl.fcntl(dir_fd, 50, b"\0" * 1024)).rstrip("\0")
                     if sys.platform == "darwin" else os.readlink("/proc/self/fd/" + str(dir_fd)))
        path = pathlib.Path(directory) / os.fsdecode(path)
    if not pathlib.Path(os.fsdecode(path)).resolve().is_relative_to(scratch):
        raise PermissionError("workflow: verify write outside scratch blocked")
def audit(event, args):
    if event.startswith(("socket.", "http.client.", "urllib.")):
        raise PermissionError("workflow: offline network access blocked")
    if event in ("subprocess.Popen", "os.system", "os.posix_spawn", "os.exec", "os.fork", "os.forkpty"):
        if not (mode == "rebuild" and event in ("subprocess.Popen", "os.posix_spawn")
                and pathlib.Path(args[0]).name == "pdftotext"):
            raise PermissionError("workflow: offline child process blocked")
    if mode != "verify":
        return
    if event == "open":
        path, access, flags = args
        if (access and any(c in access for c in "wax+")) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
            writable(path)
    elif event in ("os.remove", "os.rmdir", "os.mkdir", "os.chmod", "os.chown", "os.utime", "os.truncate"):
        writable(args[0], args[-1] if event in ("os.remove", "os.rmdir", "os.mkdir") else None)
    elif event in ("os.rename", "os.link"):
        writable(args[0], args[2] if len(args) > 2 else None)
        writable(args[1], args[3] if len(args) > 3 else None)
    elif event == "os.symlink":
        raise PermissionError("workflow: verify symlink creation blocked")
sys.addaudithook(audit)
sys.argv = [script, *arguments]
sys.path.insert(0, str(pathlib.Path(script).resolve().parent))
runpy.run_path(script, run_name="__main__")
"""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def relative_path(root, value, pattern=False):
    require(isinstance(value, str) and value and "\\" not in value, "path must be a relative POSIX path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and not any(p in ("", ".", "..") for p in value.split("/")),
            f"path must be canonical and repo-relative: {value}")
    require(pattern or not any(c in value for c in "*?[]"), f"glob not allowed: {value}")
    require((root / value).resolve().is_relative_to(root), f"path escapes repository: {value}")
    return root / value


def keys(value, allowed, required=()):
    require(isinstance(value, dict), "expected an object")
    require(not value.keys() - set(allowed), f"unknown fields: {sorted(value.keys() - set(allowed))}")
    require(set(required) <= value.keys(), f"missing fields: {sorted(set(required) - value.keys())}")


def strings(value, name):
    require(isinstance(value, list) and all(isinstance(v, str) and v.strip() for v in value),
            f"{name} must be a list of nonempty strings")
    require(len(value) == len(set(value)), f"duplicate {name}")


def pointer(value, path):
    require(isinstance(path, str) and (path == "" or path.startswith("/")), "invalid JSON pointer")
    for key in path.split("/")[1:] if path else []:
        key = key.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def select(value, path):
    require(isinstance(path, str) and (path == "" or path.startswith("/")), "invalid JSON pointer")

    def walk(current, parts):
        if not parts:
            return current
        head, rest = parts[0], parts[1:]
        if head == "*":
            if isinstance(current, dict):
                return {key: walk(item, rest) for key, item in current.items()}
            if isinstance(current, list):
                return [walk(item, rest) for item in current]
            raise KeyError("wildcard over a scalar")
        key = head.replace("~1", "/").replace("~0", "~")
        return walk(current[int(key)] if isinstance(current, list) else current[key], rest)

    return walk(value, path.split("/")[1:] if path else [])


def load_config(root, path):
    config = json.loads(relative_path(root, path).read_text())
    keys(config, ("schema_version", "market", "read_only", "known_gaps", "steps"),
         ("schema_version", "market", "read_only", "known_gaps", "steps"))
    require(type(config["schema_version"]) is int and config["schema_version"] == 1,
            "unsupported schema_version")
    keys(config["market"], ("id", "state", "label"), ("id", "state", "label"))
    require(all(isinstance(v, str) and v.strip() for v in config["market"].values()), "invalid market")
    require(type(config["read_only"]) is bool, "read_only must be boolean")
    strings(config["known_gaps"], "known_gaps")
    require(isinstance(config["steps"], list) and config["steps"], "steps must not be empty")
    seen = set()
    for step in config["steps"]:
        keys(step, ("id", "depends_on", "commands", "artifacts", "known_gaps", "local_acquisition"),
             ("id", "depends_on", "commands", "artifacts", "known_gaps"))
        require(type(step.get("local_acquisition", False)) is bool, "local_acquisition must be boolean")
        identifier = step["id"]
        require(isinstance(identifier, str) and re.fullmatch(r"[a-z][a-z0-9-]*", identifier),
                "invalid step id")
        require(identifier not in seen, "duplicate step id")
        strings(step["depends_on"], "depends_on")
        require(set(step["depends_on"]) <= seen, "dependencies must name earlier steps")
        seen.add(identifier)
        strings(step["known_gaps"], "known_gaps")
        keys(step["commands"], MODES)
        require(not config["read_only"] or not step["commands"].keys() - {"verify"},
                "read-only config cannot declare refresh or rebuild")
        for mode, command in step["commands"].items():
            keys(command, ("argv", "foreach", "timeout_seconds"), ("argv",))
            argv = command["argv"]
            require(isinstance(argv, list) and len(argv) >= 2 and
                    all(isinstance(v, str) and v and "\x00" not in v and "\n" not in v for v in argv),
                    "argv must be a nonempty string array")
            require(argv[0] == "python3", "commands must use python3 and a repo-relative script")
            relative_path(root, argv[1])
            require(argv[1].endswith(".py"), "command must name a Python script")
            if "foreach" in command:
                relative_path(root, command["foreach"], pattern=True)
            for arg in argv[2:]:
                value = arg.split("=", 1)[-1]
                require(not value.startswith(("/", "~")) and "\\" not in arg and
                        not any(token in arg for token in (";", "\n", "\r", "|", "`", "$(")),
                        "absolute paths and shell syntax are not allowed in argv")
                require(not any(part == ".." for part in value.split("/")), "argv path traversal")
                if "{" in arg or "}" in arg:
                    require(arg == "{match_dir}" and "foreach" in command, "unknown argv placeholder")
                if "/" in value and not value.startswith("https://") and arg != "{match_dir}":
                    relative_path(root, value)
            timeout = command.get("timeout_seconds", 120)
            require(type(timeout) is int and 1 <= timeout <= 3600, "invalid timeout_seconds")
        require(isinstance(step["artifacts"], list), "artifacts must be a list")
        for artifact in step["artifacts"]:
            keys(artifact, ("path", "role", "metadata", "sha256_from", "owner_check", "optional"),
                 ("path", "role"))
            relative_path(root, artifact["path"], pattern=True)
            require(artifact["role"] in ("source", "manifest", "output", "coverage"), "invalid artifact role")
            require(type(artifact.get("owner_check", True)) is bool, "owner_check must be boolean")
            require(type(artifact.get("optional", False)) is bool, "optional must be boolean")
            fields = artifact.get("metadata", [])
            require(isinstance(fields, list) and all(isinstance(field, str) for field in fields),
                    "metadata pointers must be a string list")
            require(len(fields) == len(set(fields)), "duplicate metadata pointer")
            for field in fields:
                require(field == "" or field.startswith("/"), "invalid metadata pointer")
                require(all(field.split("/")[1:]), "empty metadata pointer segment")
            if "sha256_from" in artifact:
                reference = artifact["sha256_from"]
                keys(reference, ("path", "pointer"), ("path", "pointer"))
                relative_path(root, reference["path"])
                require(isinstance(reference["pointer"], str) and reference["pointer"].startswith("/"),
                        "invalid hash pointer")
                require(not any(part == "*" for part in reference["pointer"].split("/")),
                        "expected hash pointers stay exact; wildcards are metadata-only")
    return config


def matches(root, pattern):
    result = sorted(root.glob(pattern))
    for path in result:
        require(path.resolve().is_relative_to(root), f"artifact symlink escapes repository: {pattern}")
    return result


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inventory(root, artifacts):
    result = []
    for spec in artifacts:
        paths = matches(root, spec["path"])
        if not paths:
            result.append({**spec, "status": "absent_optional" if spec.get("optional") else "missing"})
        for path in paths:
            item = {**spec, "path": path.relative_to(root).as_posix(), "status": "present_unverified"}
            try:
                require(path.is_file(), "artifact is not a file")
                item.update(sha256=sha256(path), bytes=path.stat().st_size)
                if spec.get("metadata"):
                    data = json.loads(path.read_text())
                    item["provenance"] = {}
                    for field in spec["metadata"]:
                        try:
                            item["provenance"][field] = {"value": select(data, field)}
                        except (KeyError, IndexError, ValueError, TypeError):
                            item["provenance"][field] = {"status": "not_recorded"}
                if "sha256_from" in spec:
                    ref = spec["sha256_from"]
                    expected = pointer(json.loads(relative_path(root, ref["path"]).read_text()), ref["pointer"])
                    require(isinstance(expected, str) and re.fullmatch("[0-9a-f]{64}", expected),
                            "invalid expected SHA-256")
                    item["expected_sha256"] = expected
                    item["reference_sha256"] = sha256(root / ref["path"])
                    item["status"] = "hash_verified" if expected == item["sha256"] else "stale"
            except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
                item.update(status="invalid", error=str(error))
            result.append(item)
    return result


def execute(root, command, mode):
    expanded = [None] if "foreach" not in command else matches(root, command["foreach"])
    if not expanded:
        return [{"argv": command["argv"], "status": "missing_command_input",
                 "foreach": command["foreach"], "exit_code": None}]
    outcomes = []
    for match in expanded:
        argv = [match.parent.relative_to(root).as_posix() if arg == "{match_dir}" else arg
                for arg in command["argv"]]
        tool = relative_path(root, argv[1])
        outcome = {"argv": argv, "cwd": ".", "status": "failed", "exit_code": None,
                   "network_allowed": mode == "refresh", "scratch_only_writes": mode == "verify",
                   "execution": "direct_python" if mode == "refresh" else "python_audit_guard"}
        if match is not None:
            outcome["match_dir"] = match.parent.relative_to(root).as_posix()
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="harbor-workflow-") as scratch:
            env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": scratch}
            try:
                outcome["tool_sha256"] = sha256(tool)
                actual = ([sys.executable, "-B", "-c", GUARDED_RUNNER, scratch, mode, *argv[1:]]
                          if mode != "refresh" else [sys.executable, "-B", *argv[1:]])
                result = subprocess.run(actual, cwd=root, env=env, text=True, errors="replace",
                                        capture_output=True, timeout=command.get("timeout_seconds", 120))
                outcome.update(exit_code=result.returncode,
                               status="succeeded" if result.returncode == 0 else "failed",
                               stdout=result.stdout, stderr=result.stderr)
                outcome["tool_sha256_after"] = sha256(tool)
                if outcome["tool_sha256_after"] != outcome["tool_sha256"]:
                    outcome["status"] = "tool_changed_during_run"
            except subprocess.TimeoutExpired as error:
                outcome.update(status="timed_out",
                               stdout=(error.stdout or b"").decode(errors="replace") if isinstance(error.stdout, bytes) else error.stdout or "",
                               stderr=(error.stderr or b"").decode(errors="replace") if isinstance(error.stderr, bytes) else error.stderr or "")
            except OSError as error:
                outcome["stderr"] = str(error)
            for stream in ("stdout", "stderr"):
                if stream in outcome:
                    outcome[stream] = outcome[stream].replace(str(root) + "/", "").replace(str(root), ".").replace(scratch, "<scratch>")
        outcome["elapsed_seconds"] = round(time.monotonic() - started, 6)
        outcomes.append(outcome)
    return outcomes


def run(root, config, config_path, action, mode, selection, scope="all"):
    started = time.monotonic()
    known = {step["id"] for step in config["steps"]}
    require(set(selection) <= known, f"unknown selected steps: {sorted(set(selection) - known)}")
    require(action == "plan" or mode == "verify" or not config["read_only"],
            "read-only baseline permits plan and verify only")
    local_steps = {s["id"] for s in config["steps"] if s.get("local_acquisition")}
    if scope == "shared":
        require(action in ("plan", "verify"), "shared checkout scope supports plan and verify")
        require(not set(selection) & local_steps, "local acquisition requires --scope all")
    selected = set(selection) if selection else known - (local_steps if scope == "shared" else set())
    report = {
        "schema_version": 1, "market": config["market"], "config_path": config_path,
        "config_sha256": sha256(root / config_path),
        "action": action, "mode": mode, "read_only": config["read_only"],
        "checkout_scope": scope, "local_acquisition_steps": sorted(local_steps),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "selected_steps": [s["id"] for s in config["steps"] if s["id"] in selected],
        "selection_scope": "all_configured_steps" if selected == known else "selected_steps_only",
        "known_gaps": config["known_gaps"],
        "verification_scope": "Declared owner checks and hash references only. File existence is not verification. No collection or publication completion is asserted.",
        "steps": [],
    }
    results = {}
    for step in config["steps"]:
        dependencies = {dep: results.get(dep, "not_selected") for dep in step["depends_on"]}
        item = {"id": step["id"], "depends_on": dependencies, "known_gaps": step["known_gaps"],
                "commands": step["commands"], "outcomes": []}
        if step["id"] not in selected:
            item["status"] = "not_selected"
            report["steps"].append(item)
            continue
        before = inventory(root, step["artifacts"])
        command = step["commands"].get(mode)
        if action == "plan":
            item.update(status="planned" if command else "inventory_only", artifacts=before)
        elif mode != "verify" and any(value not in ("succeeded", "not_selected", "inventory_only")
                                      for value in dependencies.values()):
            item.update(status="blocked_dependency", artifacts=before)
        else:
            item["outcomes"] = execute(root, command, mode) if command else []
            after = inventory(root, step["artifacts"])
            command_ok = bool(item["outcomes"]) and all(o["status"] == "succeeded" for o in item["outcomes"])
            previous = {a["path"]: a.get("sha256") for a in before}
            for artifact in after:
                owner_outcomes = [outcome for outcome in item["outcomes"]
                                  if "match_dir" not in outcome or
                                  PurePosixPath(artifact["path"]).is_relative_to(outcome["match_dir"])]
                owner_ok = bool(owner_outcomes) and all(o["status"] == "succeeded" for o in owner_outcomes)
                if mode == "verify" and artifact.get("sha256") != previous.get(artifact["path"]):
                    artifact["status"] = "changed_during_verify"
                elif (mode == "verify" and owner_ok and artifact.get("owner_check", True)
                      and artifact["status"] == "present_unverified"):
                    artifact["status"] = "verified"
            item["artifacts"] = after
            if mode == "verify":
                good = bool(after) and all(a["status"] in ("verified", "hash_verified", "absent_optional")
                                           for a in after)
                item["status"] = "verified" if good and (command is None or command_ok) else "verification_failed"
            else:
                item["status"] = "succeeded" if command_ok else "failed" if command else "inventory_only"
        results[step["id"]] = item["status"]
        report["steps"].append(item)
    failures = [value for value in results.values()
                if value in ("failed", "verification_failed", "blocked_dependency")]
    report["exit_code"] = 1 if failures else 0
    report["status"] = ("planned" if action == "plan" else "verification_failed" if failures and mode == "verify"
                        else "partial_failure" if failures else "checks_passed" if mode == "verify"
                        else "commands_finished")
    report["coverage_status"] = "not_assessed"
    report["artifact_status_counts"] = {}
    for step in report["steps"]:
        for artifact in step.get("artifacts", []):
            status = artifact["status"]
            report["artifact_status_counts"][status] = report["artifact_status_counts"].get(status, 0) + 1
    report["elapsed_seconds"] = round(time.monotonic() - started, 6)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", *MODES))
    parser.add_argument("--config", required=True, help="repo-relative workflow JSON")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="repository root, useful for isolated fixtures")
    parser.add_argument("--mode", choices=MODES, default="verify", help="mode to show with plan")
    parser.add_argument("--scope", choices=("all", "shared"), default="all", help="shared checks released artifacts without local acquisition archives")
    parser.add_argument("--step", action="append", default=[], help="select a step without implicitly running its dependencies")
    parser.add_argument("--report", help="repo-relative research/region-workflows/*.json; stdout when omitted")
    args = parser.parse_args()
    root = args.root.resolve()
    destination = None
    try:
        if args.report:
            destination = relative_path(root, args.report)
            require(PurePosixPath(args.report).parent == REPORT_DIR and destination.suffix == ".json",
                    "reports must be research/region-workflows/*.json")
            require(destination != relative_path(root, args.config), "report must not overwrite config")
            require(not destination.exists(), "report already exists; choose a new run path")
        config = load_config(root, args.config)
        report = run(root, config, args.config, args.action,
                     args.mode if args.action == "plan" else args.action, args.step, args.scope)
    except (OSError, ValueError, KeyError, TypeError) as error:
        report = {"status": "invalid_request", "error": str(error).replace(str(root) + "/", ""),
                  "config_path": args.config, "exit_code": 2}
    data = json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if destination is not None and report["status"] != "invalid_request":
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("x") as handle:
                handle.write(data)
        except OSError as error:
            print(json.dumps({"status": "report_write_failed",
                              "error": str(error).replace(str(root) + "/", ""), "exit_code": 2}))
            return 2
    print(data, end="")
    return report["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
