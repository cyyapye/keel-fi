#!/usr/bin/env python3
"""Run Keel's native suites with complete, reviewed case accounting."""

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import stat
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
INVENTORY = ROOT / ".tugling/pilot-cases.json"
ARTIFACTS = ROOT / ".tugling/local/pilot"
PYTHON_SUITES = ("test_linux_test_run", "test_tugling_pilot")
BROWSER_LANES = ("mocked", "mocked-development", "stateful-development", "stateful-a", "stateful-b")
BROWSER_MAX_ACTIVE_WORKERS = 4
BROWSER_RUNTIME = ROOT / ".keel-local/e2e-lanes"


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
    if set(reports) != set(BROWSER_LANES):
        raise ValueError("browser reports must contain every required lane exactly once")
    ordered = [reports[lane] for lane in BROWSER_LANES]
    starts = [datetime.fromisoformat(report["stats"]["startTime"].replace("Z", "+00:00"))
              for report in ordered]
    start = min(starts)
    duration = max(
        (started - start).total_seconds() * 1_000 + report["stats"]["duration"]
        for started, report in zip(starts, ordered)
    )
    return {
        "kind": "keel-browser-lanes",
        "lanes": [{"id": lane, "config": reports[lane].get("config"), "stats": reports[lane]["stats"]}
                  for lane in BROWSER_LANES],
        "suites": [suite for report in ordered for suite in report["suites"]],
        "errors": [error for report in ordered for error in report["errors"]],
        "stats": {
            "startTime": min(report["stats"]["startTime"] for report in ordered),
            "duration": duration,
            **{key: sum(report["stats"][key] for report in ordered)
               for key in ("expected", "skipped", "unexpected", "flaky")},
        },
        "totalWorkDuration": sum(report["stats"]["duration"] for report in ordered),
    }


def check_browser_lane(lane, report, files, inventory, execution):
    expected_workers = execution[lane]["workers"]
    if report["config"]["workers"] != expected_workers:
        raise ValueError(f"{lane} browser lane used an unexpected worker count")
    prefixes = {f"e2e/{file}" for file in files}
    subset = [identity for identity in inventory["playwright"]
              if identity.split(" :: ", 1)[0] in prefixes]
    compare_cases("playwright", playwright_cases(report),
                  {"playwright": subset, "exclusions": [entry for entry in inventory["exclusions"]
                                                         if entry["id"] in subset]})


def validate_browser_execution(lanes, execution, schedule):
    if (set(lanes) != set(BROWSER_LANES) or set(execution) != set(BROWSER_LANES)
            or set(schedule) != set(BROWSER_LANES)):
        raise ValueError("browser lane manifest differs from the required execution plan")
    for lane, dependencies in schedule.items():
        if not isinstance(dependencies, list):
            raise ValueError(f"{lane} browser dependencies must be a list")
        if lane in dependencies:
            raise ValueError(f"{lane} browser lane cannot depend on itself")
        if any(dependency not in schedule for dependency in dependencies):
            raise ValueError(f"{lane} browser lane has an unknown dependency")

    visiting = set()
    visited = set()
    def visit(lane):
        if lane in visiting:
            raise ValueError("browser lane schedule must be acyclic")
        if lane in visited:
            return
        visiting.add(lane)
        for dependency in schedule[lane]:
            visit(dependency)
        visiting.remove(lane)
        visited.add(lane)
    for lane in BROWSER_LANES:
        visit(lane)

    expected_schedule = {
        "mocked": [],
        "mocked-development": ["stateful-development"],
        "stateful-development": [],
        "stateful-a": [],
        "stateful-b": [],
    }
    if schedule != expected_schedule:
        raise ValueError("browser lane dependencies differ from the reviewed four-slot schedule")
    ports = []
    expected = {
        "mocked": ("mocked", "production"),
        "mocked-development": ("mocked", "development"),
        "stateful-development": ("stateful", "development"),
        "stateful-a": ("stateful", "production"),
        "stateful-b": ("stateful", "production"),
    }
    for lane in BROWSER_LANES:
        config = execution[lane]
        expected_server, expected_frontend = expected[lane]
        if (config["server"], config["frontend"], config["workers"]) != (
                expected_server, expected_frontend, 1):
            raise ValueError(f"{lane} browser lane exceeds its reviewed resource budget")
        lane_ports = [config["webPort"]]
        if expected_server == "stateful":
            lane_ports.append(config["apiPort"])
        elif config["apiPort"] is not None:
            raise ValueError("mocked browser lane must not allocate an API server")
        if any(not isinstance(port, int) or port < 31_000 or port >= 32_768 for port in lane_ports):
            raise ValueError(f"{lane} browser lane uses an unsafe port")
        ports.extend(lane_ports)
    if len(ports) != len(set(ports)):
        raise ValueError("browser lanes must use distinct runtime ports")
    initial_workers = sum(execution[lane]["workers"] for lane in BROWSER_LANES
                          if not schedule[lane])
    if initial_workers > BROWSER_MAX_ACTIVE_WORKERS:
        raise ValueError("browser lane schedule exceeds four active workers")
    return ports


def ready_browser_lanes(started, completed, schedule):
    return [lane for lane in BROWSER_LANES
            if lane not in started and set(schedule[lane]).issubset(completed)]


def active_browser_workers(processes, execution):
    return sum(execution[lane]["workers"] for lane, process in processes.items()
               if process.poll() is None)


def assert_browser_ports_available(ports):
    sockets = []
    try:
        for port in ports:
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sockets.append(listener)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", port))
            listener.listen(1)
    except OSError as error:
        raise ValueError(f"browser runtime port {port} is unavailable") from error
    finally:
        for listener in sockets:
            listener.close()


def validate_owned_browser_path(path, label, *, recursive=False, allow_missing=False):
    if path.resolve() != path:
        raise ValueError(f"{label} must not follow symlinks")
    if not path.exists():
        if allow_missing:
            return
        raise ValueError(f"{label} must exist")
    candidates = [path, *path.rglob("*")] if recursive else [path]
    for candidate in candidates:
        info = candidate.lstat()
        regular = stat.S_ISREG(info.st_mode) and info.st_nlink == 1
        if info.st_uid != os.geteuid() or not (stat.S_ISDIR(info.st_mode) or regular):
            raise ValueError(f"{label} must contain only owned directories and single-link regular files")


def remove_browser_profiles():
    local = ROOT / ".keel-local"
    validate_owned_browser_path(local, "browser profile parent", allow_missing=True)
    validate_owned_browser_path(BROWSER_RUNTIME, "browser runtime profiles",
                                recursive=True, allow_missing=True)
    if BROWSER_RUNTIME.exists():
        shutil.rmtree(BROWSER_RUNTIME)


def prepare_browser_profiles(execution):
    local = ROOT / ".keel-local"
    base = local / "e2e"
    validate_owned_browser_path(local, "browser profile parent", allow_missing=True)
    validate_owned_browser_path(base, "verified browser seed", recursive=True, allow_missing=True)
    remove_browser_profiles()
    subprocess.run(["make", "db-verify-e2e"], cwd=ROOT, check=True)
    validate_owned_browser_path(local, "browser profile parent")
    validate_owned_browser_path(base, "verified browser seed", recursive=True)
    BROWSER_RUNTIME.mkdir(mode=0o700)
    for lane in BROWSER_LANES:
        if execution[lane]["server"] == "stateful":
            shutil.copytree(base, BROWSER_RUNTIME / lane)
        else:
            (BROWSER_RUNTIME / lane).mkdir(mode=0o700)


def browser_process_group_alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def cleanup_browser_processes(processes):
    processes = tuple(processes)
    for process in processes:
        try:
            # Playwright handles SIGINT by running task teardown, which owns its
            # detached webServer process group. SIGTERM skips that teardown.
            os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
    # Complete before Tugling's outer three-second process-group deadline.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        # Reap exited leaders so Darwin does not retain a zombie process group
        # that reports EPERM even after Playwright finished its owned teardown.
        for process in processes:
            process.poll()
        if not any(browser_process_group_alive(process.pid) for process in processes):
            break
        time.sleep(0.05)
    for process in processes:
        process.poll()
        if browser_process_group_alive(process.pid):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass


def wait_for_browser_lane_teardown(lane, process, execution, timeout_seconds=5):
    process.wait(timeout=1)
    ports = [execution[lane]["webPort"]]
    if execution[lane]["apiPort"] is not None:
        ports.append(execution[lane]["apiPort"])
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if not browser_process_group_alive(process.pid):
            try:
                assert_browser_ports_available(ports)
                return
            except ValueError:
                pass
        time.sleep(0.05)
    raise ValueError(f"{lane} browser lane did not release its owned runtime")


def run_browser_lanes(output):
    manifest = json.loads(subprocess.check_output([
        "node", "--import", "tsx", "--input-type=module", "--eval",
        "import { BROWSER_TEST_EXECUTION, BROWSER_TEST_LANES, BROWSER_TEST_SCHEDULE } from './scripts/browser-test-lanes.ts';"
        "console.log(JSON.stringify({execution:BROWSER_TEST_EXECUTION,lanes:BROWSER_TEST_LANES,schedule:BROWSER_TEST_SCHEDULE}));",
    ], cwd=ROOT, text=True))
    lanes, execution, schedule = manifest["lanes"], manifest["execution"], manifest["schedule"]
    ports = validate_browser_execution(lanes, execution, schedule)
    assert_browser_ports_available(ports)
    inventory = json.loads(INVENTORY.read_text())
    results = ARTIFACTS / "browser-results"
    if results.is_symlink():
        raise ValueError("browser results must not follow symlinks")
    if results.exists():
        shutil.rmtree(results)
    for lane in BROWSER_LANES:
        prepare_report(ARTIFACTS / f"playwright-{lane}.json")
    processes = {}
    reports = {}
    handled_signals = {signal.SIGINT, signal.SIGTERM}
    previous_handlers = {name: signal.getsignal(name) for name in handled_signals}
    signal_state = {"registering": False, "pending": None}

    def interrupt(signum, _frame):
        if signal_state["registering"]:
            signal_state["pending"] = signum
            return
        raise SystemExit(128 + signum)

    for name in handled_signals:
        signal.signal(name, interrupt)
    try:
        prepare_browser_profiles(execution)
        started = set()
        completed = set()

        def start_lane(lane):
            if active_browser_workers(processes, execution) + execution[lane]["workers"] > BROWSER_MAX_ACTIVE_WORKERS:
                raise ValueError("browser lane scheduler exceeded four active workers")
            lane_output = ARTIFACTS / f"playwright-{lane}.json"
            env = {**os.environ, "KEEL_E2E_ISOLATED": "1", "KEEL_BROWSER_LANE": lane,
                   "PLAYWRIGHT_JSON_OUTPUT_FILE": str(lane_output)}
            if execution[lane]["server"] == "stateful":
                env["KEEL_LOCAL_PERSIST_TO"] = str(BROWSER_RUNTIME / lane)
            command = ["node", "node_modules/@playwright/test/cli.js", "test", "--config=playwright.config.ts",
                       "--forbid-only", "--update-snapshots=none", "--reporter=list,json",
                       f"--output={results / lane}"]
            signal_state["registering"] = True
            try:
                process = subprocess.Popen(command, cwd=ROOT, env=env, start_new_session=True)
                processes[lane] = process
            finally:
                signal_state["registering"] = False
            if signal_state["pending"] is not None:
                raise SystemExit(128 + signal_state["pending"])
            started.add(lane)

        for lane in ready_browser_lanes(started, completed, schedule):
            start_lane(lane)
        while len(completed) < len(BROWSER_LANES):
            finished = []
            for lane in BROWSER_LANES:
                if lane not in started or lane in completed:
                    continue
                returncode = processes[lane].poll()
                if returncode is None:
                    continue
                finished.append((lane, returncode))
            for lane, returncode in finished:
                try:
                    report = json.loads((ARTIFACTS / f"playwright-{lane}.json").read_text())
                    check_browser_lane(lane, report, lanes[lane], inventory, execution)
                except (ValueError, OSError, json.JSONDecodeError) as error:
                    raise ValueError(f"{lane} browser lane produced invalid evidence: {error}") from error
                if returncode or report["errors"]:
                    raise ValueError(f"{lane} browser lane reported errors (exit {returncode})")
                wait_for_browser_lane_teardown(lane, processes[lane], execution)
                reports[lane] = report
                completed.add(lane)
            for lane in ready_browser_lanes(started, completed, schedule):
                start_lane(lane)
            if not finished and active_browser_workers(processes, execution) == 0:
                raise ValueError("browser lane schedule cannot make progress")
            if len(completed) < len(BROWSER_LANES):
                time.sleep(0.1)
        output.write_text(json.dumps(merge_browser_reports(reports)))
        return 0
    finally:
        cleanup_browser_processes(processes.values())
        remove_browser_profiles()
        for name, handler in previous_handlers.items():
            signal.signal(name, handler)


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
