#!/usr/bin/env python3
"""Run Keel's native suites with complete, reviewed case accounting."""

import argparse
from collections import Counter
from contextlib import contextmanager
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
INVENTORY = ROOT / ".tugling/pilot-cases.json"
ARTIFACTS = ROOT / ".tugling/local/pilot"
PYTHON_SUITES = ("test_linux_test_run", "test_tugling_pilot")
BROWSER_LANES = ("stateful", "mocked")


@contextmanager
def native_lease(runner):
    # Suites have disjoint reports/runtime roots. Serialize the same suite,
    # while allowing the reviewed dependency scheduler to overlap other suites.
    path = ARTIFACTS / f".{runner}.lease"
    with os.fdopen(os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), "a") as lease:
        info = os.fstat(lease.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1:
            raise ValueError("native suite lease must be an owned regular file")
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = path.stat(follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("native suite lease changed during acquisition")
        yield


def prepare_report(path):
    if path.is_symlink():
        raise ValueError("native reports must not follow symlinks")
    path.unlink(missing_ok=True)
    os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))


def merge_browser_reports(reports):
    if not reports:
        raise ValueError("browser reports are required")
    return {
        "kind": "keel-browser-lanes",
        "lanes": [{"id": lane, "config": report.get("config"), "stats": report["stats"]}
                  for lane, report in zip(BROWSER_LANES, reports)],
        "suites": [suite for report in reports for suite in report["suites"]],
        "errors": [error for report in reports for error in report["errors"]],
        "stats": {
            "startTime": reports[0]["stats"]["startTime"],
            **{key: sum(report["stats"][key] for report in reports)
               for key in ("duration", "expected", "skipped", "unexpected", "flaky")},
        },
    }


def check_browser_lane(lane, report, files, inventory):
    expected_workers = 2 if lane == "mocked" else 1
    if report["config"]["workers"] != expected_workers:
        raise ValueError(f"{lane} browser lane used an unexpected worker count")
    prefixes = {f"e2e/{file}" for file in files}
    subset = [identity for identity in inventory["playwright"]
              if identity.split(" :: ", 1)[0] in prefixes]
    compare_cases("playwright", playwright_cases(report),
                  {"playwright": subset, "exclusions": [entry for entry in inventory["exclusions"]
                                                         if entry["id"] in subset]})


def run_browser_lanes(output):
    lanes = json.loads(subprocess.check_output([
        "node", "--import", "tsx", "--input-type=module", "--eval",
        "import { BROWSER_TEST_LANES } from './scripts/browser-test-lanes.ts';"
        "console.log(JSON.stringify(BROWSER_TEST_LANES));",
    ], cwd=ROOT, text=True))
    if set(lanes) != set(BROWSER_LANES):
        raise ValueError("browser lane manifest differs from the required execution plan")
    inventory = json.loads(INVENTORY.read_text())
    # Remove diagnostics from an earlier attempt even if this attempt fails
    # before reaching the second lane. The caller holds the browser-suite lease.
    results = ARTIFACTS / "browser-results"
    if results.is_symlink():
        raise ValueError("browser results must not follow symlinks")
    if results.exists():
        shutil.rmtree(results)
    for lane in BROWSER_LANES:
        prepare_report(ARTIFACTS / f"playwright-{lane}.json")
    subprocess.run(["make", "db-verify-e2e"], cwd=ROOT, check=True)
    reports = []
    returncode = 0
    for lane in BROWSER_LANES:
        lane_output = ARTIFACTS / f"playwright-{lane}.json"
        env = {**os.environ, "KEEL_E2E_ISOLATED": "1",
               "KEEL_LOCAL_PERSIST_TO": str(ROOT / ".keel-local/e2e"),
               "KEEL_BROWSER_LANE": lane, "PLAYWRIGHT_JSON_OUTPUT_FILE": str(lane_output)}
        command = ["node", "node_modules/@playwright/test/cli.js", "test", "--config=playwright.config.ts",
                   "--forbid-only", "--update-snapshots=none", "--reporter=list,json",
                   f"--output={ARTIFACTS / 'browser-results' / lane}"]
        result = subprocess.run(command, cwd=ROOT, env=env, check=False)
        reports.append(json.loads(lane_output.read_text()))
        output.write_text(json.dumps(merge_browser_reports(reports)))
        check_browser_lane(lane, reports[-1], lanes[lane], inventory)
        if result.returncode or reports[-1]["errors"]:
            returncode = result.returncode or 1
            break
    return returncode


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
    # Protect evidence itself without changing native fixture/runtime umasks.
    prepare_report(output)
    if runner == "vitest":
        command = ["node", "node_modules/vitest/vitest.mjs", "run", "--config=vitest.config.ts",
                   "--allowOnly=false", "--passWithNoTests=false", "--reporter=default", "--reporter=json",
                   "--reporter=./scripts/pilot-vitest-reporter.ts",
                   f"--outputFile={output}"]
        returncode = subprocess.run(command, cwd=ROOT, check=False).returncode
    else:
        returncode = run_browser_lanes(output)
    report = json.loads(output.read_text())
    observed = vitest_cases(report) if runner == "vitest" else playwright_cases(report)
    compare_cases(runner, observed, inventory)
    if returncode or (runner == "vitest" and not report["success"]) or (runner == "playwright" and report["errors"]):
        raise ValueError(f"{runner} reported errors (exit {returncode})")


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
    with native_lease(args.runner):
        run_suite(args.runner)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Required native verification: {error}")
