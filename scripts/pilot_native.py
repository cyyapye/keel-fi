#!/usr/bin/env python3
"""Run Keel's native suites with complete, reviewed case accounting."""

import argparse
from collections import Counter
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
INVENTORY = ROOT / ".tugling/pilot-cases.json"
ARTIFACTS = ROOT / ".tugling/local/pilot"
PYTHON_SUITES = ("test_linux_test_run", "test_tugling_pilot")


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compare_cases(runner, observed, inventory, platform=sys.platform):
    expected = inventory[runner]
    counts = Counter(identity for identity, _ in observed)
    missing = sorted(set(expected) - counts.keys())
    extra = sorted(counts.keys() - set(expected))
    repeated = sorted(identity for identity, count in counts.items() if count != 1)
    exclusions = {
        entry["id"] for entry in inventory["exclusions"]
        if entry["runner"] == runner and platform in entry["platforms"]
    }
    bad = [(identity, status) for identity, status in observed
           if status != ("skipped" if identity in exclusions else "passed")]
    if not expected or len(expected) != len(set(expected)) or missing or extra or repeated or bad:
        raise ValueError(json.dumps({"runner": runner, "missing": missing, "extra": extra,
                                     "duplicates": repeated, "unexpected_outcomes": bad}, indent=2))
    print(f"{runner}: all {len(expected)} reviewed cases accounted for; {len(exclusions)} explicit exclusions")


def vitest_cases(report):
    return [
        (f"{Path(suite['name']).relative_to(ROOT).as_posix()} :: " +
         " > ".join([*case["ancestorTitles"], case["title"]]),
         "invalid" if case.get("failureMessages") else
         "skipped" if case["status"] == "pending" else case["status"])
        for suite in report["testResults"] for case in suite["assertionResults"]
    ]


def playwright_cases(report):
    observed = []
    def visit(suite, ancestors):
        for spec in suite.get("specs", []):
            for case in spec["tests"]:
                identity = f"e2e/{spec['file']} :: {case['projectName']} :: " + " > ".join([*ancestors, spec["title"]])
                results = case["results"]
                # Expected failures, interruptions and flaky successes cannot
                # satisfy a required case. Keep the native retry configuration.
                status = "invalid"
                if results and case["status"] == "expected" and case["expectedStatus"] == "passed" and all(r["status"] == "passed" for r in results):
                    status = "passed"
                elif results and all(r["status"] == "skipped" for r in results):
                    status = "skipped"
                observed.append((identity, status))
        for child in suite.get("suites", []):
            visit(child, [*ancestors, child["title"]])
    for suite in report["suites"]:
        visit(suite, [])
    return observed


class AccountedResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.observed = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.observed.append((test.id(), "passed"))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.observed.append((test.id(), "skipped"))


def run_suite(runner):
    inventory = json.loads(INVENTORY.read_text())
    if runner == "python":
        suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromModule(load_module(name)) for name in PYTHON_SUITES)
        result = unittest.TextTestRunner(verbosity=2, resultclass=AccountedResult).run(suite)
        compare_cases(runner, result.observed, inventory)
        if not result.wasSuccessful():
            raise ValueError("native Python tests failed")
        return
    output = ARTIFACTS / f"{runner}.json"
    output.unlink(missing_ok=True)
    # Protect evidence itself without changing native fixture/runtime umasks.
    os.close(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))
    if runner == "vitest":
        command = ["node", "node_modules/vitest/vitest.mjs", "run", "--config=vitest.config.ts",
                   "--allowOnly=false", "--passWithNoTests=false", "--reporter=default", "--reporter=json",
                   "--reporter=./scripts/pilot-vitest-reporter.ts",
                   f"--outputFile={output}"]
    else:
        subprocess.run(["make", "db-verify-e2e"], cwd=ROOT, check=True)
        os.environ.update(KEEL_E2E_ISOLATED="1", KEEL_LOCAL_PERSIST_TO=str(ROOT / ".keel-local/e2e"),
                          PLAYWRIGHT_JSON_OUTPUT_FILE=str(output))
        command = ["node", "node_modules/@playwright/test/cli.js", "test", "--config=playwright.config.ts",
                   "--forbid-only", "--update-snapshots=none", "--reporter=list,json",
                   f"--output={ARTIFACTS / 'browser-results'}"]
    result = subprocess.run(command, cwd=ROOT, check=False)
    report = json.loads(output.read_text())
    observed = vitest_cases(report) if runner == "vitest" else playwright_cases(report)
    compare_cases(runner, observed, inventory)
    if result.returncode or (runner == "vitest" and not report["success"]) or (runner == "playwright" and report["errors"]):
        raise ValueError(f"{runner} reported errors (exit {result.returncode})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runner", choices=("vitest", "playwright", "python"))
    args = parser.parse_args()
    load_module("tugling-pilot").require_unfiltered_environment()
    ARTIFACTS.mkdir(parents=True, exist_ok=True, mode=0o700)
    if ARTIFACTS.resolve() != ARTIFACTS or any((ARTIFACTS / name).is_symlink() for name in (".lease", "browser-results", "vitest.json", "playwright.json")):
        raise ValueError("native artifact ownership must not follow symlinks")
    # One report slot per runner, scoped to this checkout; never replace a
    # report still owned by another active verification process.
    with os.fdopen(os.open(ARTIFACTS / ".lease", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), "a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run_suite(args.runner)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Required native verification: {error}")
