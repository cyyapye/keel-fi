#!/usr/bin/env python3
"""Run partial checks for one trusted draft plan on its verified merge checkout."""

import argparse
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile


def unique_fields(pairs):
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise ValueError("duplicate draft plan field")
    return fields


def checked_plan(stream, selector):
    raw = stream.read(4097)
    if len(raw) > 4096:
        raise ValueError("draft plan exceeds its size limit")
    supplied = json.loads(raw, object_pairs_hook=unique_fields)
    if not isinstance(supplied, dict) or supplied.get("profile") not in ("docs", "test-files"):
        raise ValueError("only a selective draft plan can run partial checks")
    expected = selector(supplied.get("base"), supplied.get("head"))
    if json.dumps(supplied, sort_keys=True) != json.dumps(expected, sort_keys=True):
        raise ValueError("draft plan differs from the verified Git diff")
    return expected


def run_selected_tests(files, root, native):
    registry = json.loads((root / ".tugling/pilot-cases.json").read_bytes())
    identities = [case for case in registry["vitest"] if case.partition(" :: ")[0] in files]
    if not files or {case.partition(" :: ")[0] for case in identities} != set(files):
        raise ValueError("selected test file has no registered native cases")
    inventory = {"vitest": identities, "exclusions": [
        entry for entry in registry["exclusions"] if entry["runner"] == "vitest" and entry["id"] in identities
    ]}
    with tempfile.TemporaryDirectory(prefix="keel-draft-checks-") as temp:
        report = Path(temp) / "draft-cases.json"
        native["prepare_report"](report)
        subprocess.run([
            "node", "node_modules/vitest/vitest.mjs", "run", "--config=vitest.config.ts", "--maxWorkers=1",
            "--allowOnly=false", "--passWithNoTests=false", "--reporter=default", "--reporter=json",
            "--reporter=./scripts/pilot-vitest-reporter.ts", f"--outputFile={report}", *files,
        ], check=True, cwd=root)
        phase = json.loads(native["read_vitest_artifact"](report))
        native["validate_vitest_phase_report"](phase, inventory)
    return identities


def checked_merge(plan):
    commit, *parents = subprocess.check_output([
        "git", "--no-replace-objects", "rev-list", "--parents", "-n1", "HEAD",
    ], text=True).split()
    if parents != [plan["base"], plan["head"]]:
        raise ValueError("draft checks require the verified base/head merge checkout")
    subprocess.run(["git", "--no-replace-objects", "diff", "--quiet", "--no-ext-diff", "HEAD", "--"], check=True)
    return commit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan-stdin", action="store_true", required=True)
    parser.parse_args()
    root = Path.cwd()
    selector = runpy.run_path(str(Path(__file__).with_name("ci-draft-plan.py")))
    plan = checked_plan(sys.stdin.buffer, selector["plan"])
    revision = checked_merge(plan)
    targets = ["data-scan", "format-check"]
    if plan["test_files"]:
        targets.append("lint-typecheck")
    subprocess.run(["make", "-j2", *targets], cwd=root, check=True)
    cases = []
    if plan["test_files"]:
        native = runpy.run_path(str(root / "scripts/pilot_native.py"))
        cases = run_selected_tests(plan["test_files"], root, native)
    if checked_merge(plan) != revision:
        raise ValueError("draft checkout changed during verification")
    print("Keel draft partial checks " + json.dumps({
        "profile": plan["profile"], "base": plan["base"], "head": plan["head"], "merge": revision,
        "checks": targets, "test_files": plan["test_files"], "cases": len(cases),
        "case_ids_sha256": hashlib.sha256(json.dumps(sorted(cases), separators=(",", ":")).encode()).hexdigest(),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
