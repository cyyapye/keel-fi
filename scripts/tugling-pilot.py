#!/usr/bin/env python3
"""Project-owned entry point for the isolated, reviewed Tugling candidate."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ".tugling/pilot.json"
HELPER = "plugins/tugling/scripts/project_contract.py"


def git_environment():
    # Neither identity checks nor the helper may inherit another Git worktree,
    # replacement objects, config injection, or an executable fsmonitor hook.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_NO_REPLACE_OBJECTS="1", GIT_CONFIG_COUNT="1",
               GIT_CONFIG_KEY_0="core.fsmonitor", GIT_CONFIG_VALUE_0="false")
    return env


def git(root, *args):
    return subprocess.check_output(
        ["git", "--no-replace-objects", "-c", "core.fsmonitor=false", "-C", str(root), *args],
        env=git_environment(), stderr=subprocess.PIPE,
    )


def validate_source(source, revision):
    source = source.resolve(strict=True)
    if Path(os.fsdecode(git(source, "rev-parse", "--show-toplevel")).strip()).resolve() != source:
        raise ValueError("candidate source must be its actual Git root")
    if git(source, "rev-parse", "HEAD").decode().strip() != revision:
        raise ValueError("candidate source does not match the reviewed revision")
    if git(source, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none").strip():
        raise ValueError("candidate source must be clean")
    flags = git(source, "ls-files", "-v", "-z").decode().split("\0")
    if any(flag and (flag[0].islower() or flag[0] == "S") for flag in flags):
        raise ValueError("candidate index cannot hide tracked changes")
    helper = source / HELPER
    if helper.resolve() != helper or not helper.is_file():
        raise ValueError("candidate helper must be a regular file without symlinks")
    if helper.read_bytes() != git(source, "cat-file", "blob", f"{revision}:{HELPER}"):
        raise ValueError("candidate helper differs from the reviewed Git blob")
    return helper


def require_unfiltered_environment():
    blocked = {
        "TEST_ARGS", "E2E_ARGS", "PNPM", "COMPOSE", "SCENARIO", "NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV",
        "MAKEOVERRIDES", "MFLAGS", "MAKEFILES", "MAKEFLAGS",
        "npm_config_argv", "npm_config_node_options", "KEEL_LOCAL_SCENARIO",
        "KEEL_E2E_ISOLATED", "KEEL_LOCAL_PERSIST_TO", "E2E_PERSIST_TO",
        "KEEL_BROWSER_LANE",
    }
    for key, value in os.environ.items():
        runner_override = key.startswith(("VITEST_", "VITE_", "PW_TEST_", "PLAYWRIGHT_"))
        # A provisioned browser cache changes location, not selection or results.
        if key == "PLAYWRIGHT_BROWSERS_PATH":
            runner_override = False
        if value and (key in blocked or runner_override):
            raise ValueError(f"required verification rejects override {key}; use focused native commands")


def helper_command(helper, source, mode, receipt=None):
    command = [sys.executable, "-I", str(helper), "--repo", str(ROOT),
               "--config", CONFIG, "--source-root", str(source), "--source-mode", "pinned", "--json"]
    if mode == "required":
        command.append("--run-required")
    elif mode == "evidence":
        if receipt is None:
            raise ValueError("evidence requires a receipt path")
        command.extend(["--check-required-evidence", receipt])
    elif mode == "cleanup":
        command.append("--cleanup-evidence")
    return command


def run_partial_native(contract, source, mode):
    revision = contract.clean_revision(ROOT)
    report = contract.validate_project(root=ROOT, config_path=Path(CONFIG),
                                       source_root=source, source_mode="pinned")
    mapping = report["verification"]
    selected = contract.required_flow_ids(mapping)
    if mode == "layout-draft":
        label = "Layout draft native checks"
        pdf = next((flow for flow in mapping["flows"] if flow["id"] == "pdf-isolation"), None)
        if pdf is None or "pdf-isolation" not in selected or pdf["argv"] != ["make", "pdf-sandbox-verify"]:
            raise ValueError("review the layout draft command against the PDF verification map")
        pdf["argv"] = ["node", "--import", "tsx", "scripts/pdf-sandbox-verify.ts", "--layout-draft"]
    elif mode == "unit-diagnostic":
        label = "Isolated unit diagnostic (partial; no required receipt)"
        expected = {
            "gate-and-artifact-integrity": {
                "argv": ["python3", "-I", "scripts/pilot_native.py", "preflight"],
                "depends_on": [], "timeout_seconds": 120,
            },
            "native-unit-and-cost": {
                "argv": ["python3", "-I", "scripts/pilot_native.py", "vitest-main"],
                "depends_on": ["gate-and-artifact-integrity"], "timeout_seconds": 1500,
            },
        }
        selected = list(expected)
        if not set(selected).issubset(contract.required_flow_ids(mapping)):
            raise ValueError("isolated unit diagnostic requires both native unit flows")
        by_id = {flow["id"]: flow for flow in mapping["flows"]}
        if any({key: by_id[flow_id].get(key) for key in shape} != shape
               for flow_id, shape in expected.items()):
            raise ValueError("review the isolated unit commands, deadlines and dependencies")
    else:
        raise ValueError("unknown partial native mode")
    budget = report["verification_budget_seconds"]
    if budget is None:
        raise ValueError("partial native verification requires the native time budget")
    if mode == "unit-diagnostic" and budget != 900:
        raise ValueError("isolated unit diagnostic requires the unchanged 900-second budget")
    contract.flow_execution_ancestry(ROOT)
    # The pinned scheduler owns each process group and cleans up on KeyboardInterrupt.
    def interrupt(signum, frame):
        raise KeyboardInterrupt
    previous = signal.signal(signal.SIGTERM, interrupt)
    try:
        rows = contract.execute_flow_plan(ROOT, mapping, selected, active_budget=budget)
    finally:
        signal.signal(signal.SIGTERM, previous)
    performance = contract.performance_summary(rows, budget)
    limits = {flow["id"]: flow["timeout_seconds"] for flow in mapping["flows"]}
    print(label + " " + json.dumps({"revision": revision, "context": contract.execution_context(),
                                    "selected_flows": selected, "results": rows,
                                    "performance": performance, "required_receipt": False}, sort_keys=True))
    if (not performance["within_budget"] or contract.clean_revision(ROOT) != revision
            or len(rows) != len(selected) or {row["id"] for row in rows} != set(selected)
            or any(row["duration_seconds"] > limits[row["id"]] for row in rows)
            or any(row["failure"] or row["exit_code"] != 0 or row["forced_cleanup"] for row in rows)):
        raise ValueError("partial native verification failed")
    contract.validate_execution_timing(rows, contract.execution_plan(mapping, selected))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("validate", "required", "evidence", "cleanup", "layout-draft", "unit-diagnostic"))
    parser.add_argument("receipt", nargs="?")
    args = parser.parse_args()
    if args.mode != "evidence" and args.receipt is not None:
        parser.error("runner arguments and selections are not accepted")
    require_unfiltered_environment()
    source_value = os.environ.get("TUGLING_PILOT_SOURCE")
    if not source_value:
        raise ValueError("set TUGLING_PILOT_SOURCE to the reviewed sibling checkout")
    source = Path(source_value).resolve(strict=True)
    if source == ROOT or ROOT in source.parents or source in ROOT.parents:
        raise ValueError("candidate source and project must be separate sibling checkouts")
    config = json.loads((ROOT / CONFIG).read_text())
    helper = validate_source(source, config["tugling"]["revision"])
    if args.mode in ("required", "layout-draft", "unit-diagnostic"):
        local = ROOT / ".tugling/local"
        local.mkdir(parents=True, exist_ok=True, mode=0o700)
        if local.resolve() != local or (local / "pilot-required.lease").is_symlink():
            raise ValueError("pilot evidence ownership must not follow symlinks")
        lease = os.fdopen(os.open(local / "pilot-required.lease", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), "a")
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.mode in ("layout-draft", "unit-diagnostic"):
        environment = git_environment()
        os.environ.clear()
        os.environ.update(environment)
        contract = SimpleNamespace(**runpy.run_path(str(helper)))
        run_partial_native(contract, source, args.mode)
        return
    if args.mode == "required":
        os.set_inheritable(lease.fileno(), True)
    os.execve(sys.executable, helper_command(helper, source, args.mode, args.receipt), git_environment())


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Tugling pilot: {error}")
