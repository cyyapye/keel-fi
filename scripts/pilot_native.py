#!/usr/bin/env python3
"""Run Keel's native suites with complete, reviewed case accounting."""

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import importlib.util
import json
import math
import os
import re
from pathlib import Path
import signal
import shutil
import socket
import stat
import subprocess
import sys
import time
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
INVENTORY = ROOT / ".tugling/pilot-cases.json"
ARTIFACTS = ROOT / ".tugling/local/pilot"
PYTHON_SUITES = ("test_linux_test_run", "test_tugling_pilot", "test_pdf_sandbox_owner", "test_ci_diagnostics", "test_ci_verification")
BROWSER_LANES = ("mocked", "mocked-development", "stateful-development", "stateful-a", "stateful-b")
BROWSER_MAX_ACTIVE_WORKERS = 4
BROWSER_RUNTIME = ROOT / ".keel-local/e2e-lanes"
BROWSER_SEED = ROOT / ".keel-local/pilot-browser-seed"
BROWSER_SEED_SEAL = ROOT / ".keel-local/pilot-browser-seed.json"
STRICT_VITEST_FILES = (
    "packages/database/src/d1-capacity.test.ts",
    "scripts/runtime-work-inventory.test.ts",
    "packages/database/src/cash-accounts.test.ts",
    "apps/api/src/position-purchases.test.ts",
    "scripts/provider-agent-usage.test.ts",
    "packages/database/src/exposures.test.ts",
    "packages/database/src/manual-holdings-migration.test.ts",
    "scripts/seed-entity-review.test.ts",
    "packages/database/src/price-proxies.test.ts",
    "scripts/public-company-worker-runtime.test.ts",
)


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


def native_lease_name(runner):
    if runner in ("migration-seed", "browser-fixture", "playwright", "playwright-prepared"):
        return "playwright"
    if runner in ("preflight", "vitest-main"):
        return "vitest"
    return runner


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
        "mocked-development": [
            "mocked", "stateful-development", "stateful-a", "stateful-b"
        ],
        "stateful-development": [],
        "stateful-a": [],
        "stateful-b": [],
    }
    if schedule != expected_schedule:
        raise ValueError("browser lane dependencies differ from the reviewed four-slot schedule")
    ports = []
    expected = {
        "mocked": ("mocked", "production"),
        "mocked-development": ("mocked", "production"),
        "stateful-development": ("stateful", "development"),
        "stateful-a": ("stateful", "production"),
        "stateful-b": ("stateful", "production"),
    }
    for lane in BROWSER_LANES:
        config = execution[lane]
        expected_server, expected_frontend = expected[lane]
        expected_workers = 4 if lane == "mocked-development" else 1
        if (config["server"], config["frontend"], config["workers"]) != (
                expected_server, expected_frontend, expected_workers):
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


def browser_seed_input_digest():
    files = [
        ROOT / "Makefile",
        ROOT / "package.json",
        ROOT / "pnpm-lock.yaml",
        ROOT / "apps/api/wrangler.jsonc",
        ROOT / "scripts/reset-e2e-state.mjs",
        ROOT / "scripts/local-seed-scenarios.ts",
        ROOT / "packages/database/seed/synthetic.sql",
        ROOT / "packages/database/seed/scenarios/default.sql",
        *sorted((ROOT / "packages/database/migrations").glob("*.sql")),
    ]
    digest = hashlib.sha256()
    for path in files:
        if path.resolve() != path or not path.is_file() or path.is_symlink():
            raise ValueError("browser seed inputs must be regular repository files")
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def browser_seed_tree_digest(path):
    digest = hashlib.sha256()
    files = sorted(candidate for candidate in path.rglob("*") if candidate.is_file())
    for candidate in files:
        digest.update(candidate.relative_to(path).as_posix().encode())
        digest.update(b"\0")
        digest.update(candidate.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest(), len(files)


def remove_browser_seed():
    local = ROOT / ".keel-local"
    validate_owned_browser_path(local, "browser seed parent", allow_missing=True)
    validate_owned_browser_path(BROWSER_SEED, "prepared browser seed",
                                recursive=True, allow_missing=True)
    validate_owned_browser_path(BROWSER_SEED_SEAL, "browser seed seal",
                                allow_missing=True)
    if BROWSER_SEED.exists():
        shutil.rmtree(BROWSER_SEED)
    BROWSER_SEED_SEAL.unlink(missing_ok=True)


def write_browser_seed_seal():
    seed_digest, file_count = browser_seed_tree_digest(BROWSER_SEED)
    seal = {
        "schemaVersion": 1,
        "seedPath": BROWSER_SEED.relative_to(ROOT).as_posix(),
        "inputSha256": browser_seed_input_digest(),
        "seedSha256": seed_digest,
        "fileCount": file_count,
    }
    if BROWSER_SEED_SEAL.resolve() != BROWSER_SEED_SEAL or BROWSER_SEED_SEAL.is_symlink():
        raise ValueError("browser seed seal must not follow symlinks")
    BROWSER_SEED_SEAL.unlink(missing_ok=True)
    descriptor = os.open(
        BROWSER_SEED_SEAL,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
    )
    with os.fdopen(descriptor, "w") as output:
        json.dump(seal, output, sort_keys=True)
        output.write("\n")


def validate_browser_seed_seal():
    validate_owned_browser_path(BROWSER_SEED, "prepared browser seed", recursive=True)
    validate_owned_browser_path(BROWSER_SEED_SEAL, "browser seed seal")
    try:
        seal = json.loads(BROWSER_SEED_SEAL.read_text())
    except json.JSONDecodeError as error:
        raise ValueError("browser seed seal is invalid") from error
    seed_digest, file_count = browser_seed_tree_digest(BROWSER_SEED)
    expected = {
        "schemaVersion": 1,
        "seedPath": BROWSER_SEED.relative_to(ROOT).as_posix(),
        "inputSha256": browser_seed_input_digest(),
        "seedSha256": seed_digest,
        "fileCount": file_count,
    }
    if seal != expected:
        raise ValueError("browser seed seal does not match the verified fixture")


def prepare_browser_seed():
    local = ROOT / ".keel-local"
    base = local / "e2e"
    validate_owned_browser_path(local, "browser profile parent", allow_missing=True)
    validate_owned_browser_path(base, "verified browser seed", recursive=True, allow_missing=True)
    remove_browser_seed()
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True, mode=0o700)
    # Replay every migration and the canonical synthetic readback once. Wrangler
    # has exited before copying; browser lanes receive independent mutable state.
    subprocess.run(["node", "--import", "tsx", "scripts/local-seed-scenarios.ts", "verify-ci", "default"], cwd=ROOT, check=True)
    validate_owned_browser_path(local, "browser profile parent")
    validate_owned_browser_path(base / "v3" / "d1", "verified base D1 state", recursive=True)
    # Keep the independent browser binding/readback check, without replaying the
    # same migrations a second time. Explicit persistence cannot inherit an override.
    subprocess.run(["make", "db-check-e2e", "E2E_PERSIST_TO=.keel-local/e2e"], cwd=ROOT, check=True)
    validate_owned_browser_path(base, "verified browser seed", recursive=True)
    base.rename(BROWSER_SEED)
    write_browser_seed_seal()
    validate_browser_seed_seal()


def copy_browser_profiles(execution, base):
    validate_owned_browser_path(base, "verified browser seed", recursive=True)
    remove_browser_profiles()
    BROWSER_RUNTIME.mkdir(mode=0o700)
    for lane in BROWSER_LANES:
        if execution[lane]["server"] == "stateful":
            shutil.copytree(base, BROWSER_RUNTIME / lane)
        else:
            (BROWSER_RUNTIME / lane).mkdir(mode=0o700)


def prepare_browser_profiles(execution, *, prepared=False):
    if prepared:
        validate_browser_seed_seal()
        copy_browser_profiles(execution, BROWSER_SEED)
        remove_browser_seed()
        return
    local = ROOT / ".keel-local"
    base = local / "e2e"
    validate_owned_browser_path(local, "browser profile parent", allow_missing=True)
    validate_owned_browser_path(base, "verified browser seed",
                                recursive=True, allow_missing=True)
    remove_browser_profiles()
    subprocess.run(["make", "db-verify-e2e"], cwd=ROOT, check=True)
    validate_owned_browser_path(local, "browser profile parent")
    validate_owned_browser_path(base, "verified browser seed", recursive=True)
    copy_browser_profiles(execution, base)


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
    permission_errors = []
    for process in processes:
        try:
            # Playwright handles SIGINT by running task teardown, which owns its
            # detached webServer process group. SIGTERM skips that teardown.
            os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        except PermissionError as error:
            permission_errors.append(error)
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
            except PermissionError as error:
                permission_errors.append(error)
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        process.poll()
    remaining = sorted({
        process.pid for process in processes
        if browser_process_group_alive(process.pid)
    })
    if remaining or permission_errors:
        message = (
            "browser process cleanup could not prove every owned group stopped"
            + (f": {remaining}" if remaining else "")
        )
        if permission_errors:
            raise ValueError(message) from permission_errors[0]
        raise ValueError(message)


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


def release_browser_lane(lane, processes, execution, timeout_seconds=5):
    wait_for_browser_lane_teardown(
        lane, processes[lane], execution, timeout_seconds=timeout_seconds
    )
    # The process group and ports are proven gone. Remove the stale numeric PGID
    # before a later lane gives the operating system time to recycle it.
    del processes[lane]


def cleanup_browser_runtime(processes, original_failure):
    try:
        cleanup_browser_processes(processes)
        remove_browser_profiles()
    except BaseException as cleanup_error:
        if original_failure is None:
            raise
        print(
            f"Browser cleanup also failed after {type(original_failure).__name__}: "
            f"{cleanup_error}",
            file=sys.stderr,
        )


def run_browser_lanes(output, *, prepared=False):
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
    original_failure = None
    try:
        prepare_browser_profiles(execution, prepared=prepared)
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
                release_browser_lane(lane, processes, execution)
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
    except BaseException as error:
        original_failure = error
        raise
    finally:
        try:
            cleanup_browser_runtime(processes.values(), original_failure)
        finally:
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


def vitest_observations(report):
    return (
        (f"{Path(suite['name']).relative_to(ROOT).as_posix()} :: " +
         " > ".join([*case["ancestorTitles"], case["title"]]),
         "invalid" if case.get("failureMessages") else
         "skipped" if case["status"] == "pending" else case["status"], case.get("duration"))
        for suite in report["testResults"] for case in suite["assertionResults"]
    )


def vitest_cases(report):
    return [(identity, status) for identity, status, _ in vitest_observations(report)]


def playwright_observations(report):
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
                duration = results[0].get("duration") if len(results) == 1 else None
                observed.append((identity, status, duration))
        for child in suite.get("suites", []):
            visit(child, [*ancestors, child["title"]])
    for suite in report["suites"]:
        visit(suite, [])
    return observed


def playwright_cases(report):
    return [(identity, status) for identity, status, _ in playwright_observations(report)]


TIMING_PREFIX = "KEEL_CASE_TIMINGS_V1 "
TIMING_LINE_LIMIT = 16 * 1024


def timing_registry_hash(inventory):
    data = json.dumps(inventory, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()


def timing_line(runner, observations, inventory, revision, run, attempt, platform):
    # Units are microseconds rounded up. Null belongs exclusively to reviewed skips.
    if (runner not in ("python", "vitest", "playwright") or not re.fullmatch(r"[0-9a-f]{40}", revision)
            or not all(re.fullmatch(r"[1-9][0-9]{0,19}", value) for value in (run, attempt))):
        raise ValueError("incomplete timing source")
    names = inventory[runner]
    excluded = {entry["id"] for entry in inventory["exclusions"]
                if entry["runner"] == runner and platform in entry["platforms"]}
    durations = {}
    for identity, state, milliseconds in observations:
        if identity in durations:
            raise ValueError("duplicate case timing")
        if state == "skipped" and identity in excluded:
            durations[identity] = None
        elif (state == "passed" and identity not in excluded and type(milliseconds) in (int, float)
              and 0 <= milliseconds <= 86_400_000):
            durations[identity] = math.ceil(milliseconds * 1000)
        else:
            raise ValueError("missing duration or unexpected outcome")
    if not names or len(names) != len(set(names)) or durations.keys() != set(names):
        raise ValueError("incomplete case timings")
    content = json.dumps({"suite": runner, "revision": revision, "run": run, "attempt": attempt,
                          "platform": platform, "registry": timing_registry_hash(inventory),
                          "us": [durations[name] for name in names]}, separators=(",", ":"))
    line = TIMING_PREFIX + hashlib.sha256(content.encode()).hexdigest() + " " + content
    if len(line) + 1 > TIMING_LINE_LIMIT:
        raise ValueError("case timing line exceeds log budget")
    return line


def log_timings(runner, observations, inventory):
    # Timings are optional diagnostics emitted after native accounting succeeds.
    try:
        line = timing_line(runner, observations, inventory, os.environ["GITHUB_SHA"],
                           os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"], sys.platform)
    except (KeyError, TypeError, ValueError, OverflowError):
        line = f"Case timing diagnostics unavailable for {runner}."
    print(line, file=sys.stderr, flush=True)


class AccountedResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.observed = []
        self.durations_ms = {}

    def startTest(self, test):
        super().startTest(test)
        self.started_ns = time.monotonic_ns()

    def stopTest(self, test):
        self.durations_ms[test.id()] = (time.monotonic_ns() - self.started_ns) / 1_000_000
        super().stopTest(test)

    def addSuccess(self, test):
        super().addSuccess(test)
        self.observed.append((test.id(), "passed"))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.observed.append((test.id(), "skipped"))


@contextmanager
def cost_seed_directory():
    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)
    previous = {name: signal.signal(name, interrupted) for name in (signal.SIGINT, signal.SIGTERM)}
    try:
        with tempfile.TemporaryDirectory(prefix="d1-seed-", dir=ARTIFACTS) as seed:
            yield seed
    finally:
        for name, handler in previous.items():
            signal.signal(name, handler)



def vitest_partition(inventory, strict):
    selected = [identity for identity in inventory["vitest"]
                if (identity.split(" :: ", 1)[0] in STRICT_VITEST_FILES) is strict]
    if not selected or (strict and {identity.split(" :: ", 1)[0] for identity in selected}
                        != set(STRICT_VITEST_FILES)):
        raise ValueError("Vitest partition is empty or omits a strict workload file")
    return {"vitest": selected, "exclusions": [entry for entry in inventory["exclusions"]
                                               if entry["id"] in selected]}


def validate_preflight_dependencies(mapping):
    flows = mapping.get("flows") if isinstance(mapping, dict) else None
    if not isinstance(flows, list) or not flows:
        raise ValueError("Native dependencies need a nonempty flow list")
    by_id = {}
    for flow in flows:
        if (not isinstance(flow, dict) or not isinstance(flow.get("id"), str) or not flow["id"]
                or not isinstance(flow.get("depends_on"), list)
                or any(not isinstance(parent, str) or not parent for parent in flow["depends_on"])):
            raise ValueError("Native dependencies need named flows and parent lists")
        if flow["id"] in by_id or len(flow["depends_on"]) != len(set(flow["depends_on"])):
            raise ValueError("Native dependencies contain duplicate flows or parents")
        by_id[flow["id"]] = flow["depends_on"]
    if any(parent not in by_id for parents in by_id.values() for parent in parents):
        raise ValueError("Native dependencies contain an unknown parent")
    ancestors, visiting = {}, set()
    def upstream(name):
        if name in visiting:
            raise ValueError("Native preflight dependencies contain a cycle")
        if name not in ancestors:
            visiting.add(name)
            parents = set()
            for parent in by_id[name]:
                parents.add(parent)
                parents.update(upstream(parent))
            visiting.remove(name)
            ancestors[name] = parents
        return ancestors[name]
    for name in by_id:
        upstream(name)
    gate = "gate-and-artifact-integrity"
    if (by_id.get(gate) != []
            or any(gate not in ancestors[name] for name in by_id if name != gate)):
        raise ValueError("Every native flow must follow the isolated preflight")
    for name in ("native-unit-and-cost", "browser-workflows", "pdf-isolation", "source-quality"):
        if name not in by_id:
            raise ValueError(f"Missing required native flow {name}")
    if "source-quality" not in ancestors["pdf-isolation"]:
        raise ValueError("PDF isolation must follow source-quality")


def vitest_context():
    pilot = load_module("tugling-pilot")
    source = hashlib.sha256()
    for raw in filter(None, pilot.git(ROOT, "ls-files", "--stage", "-z").split(b"\0")):
        metadata, name = raw.split(b"\t", 1)
        mode, _blob, stage = metadata.split()
        if stage != b"0":
            raise ValueError("Vitest evidence cannot bind an unmerged source")
        path = ROOT / os.fsdecode(name)
        content = os.fsencode(os.readlink(path)) if mode == b"120000" else path.read_bytes()
        source.update(metadata + b"\0" + name + b"\0" + hashlib.sha256(content).digest())
    github = {key: os.environ.get(key) for key in (
        "GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA",
    )}
    if github["GITHUB_ACTIONS"] == "true" and not all(github.values()):
        raise ValueError("Vitest evidence needs the complete GitHub attempt identity")
    coordinator = os.getppid()
    started = subprocess.check_output(["ps", "-p", str(coordinator), "-o", "lstart="],
                                      text=True, timeout=5).strip()
    if not started:
        raise ValueError("Vitest evidence needs a live coordinator identity")
    return {"revision": pilot.git(ROOT, "rev-parse", "HEAD").decode().strip(),
            "source_sha256": source.hexdigest(), "github": github,
            "coordinator": {"pid": coordinator, "started": started},
            "root": str(ROOT)}


def read_vitest_artifact(path):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1
            or info.st_size > 4 * 1024 * 1024):
        raise ValueError("Vitest evidence must be a bounded owned regular file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        current = os.fstat(stream.fileno())
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("Vitest evidence changed during acquisition")
        data = stream.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise ValueError("Vitest evidence exceeds its byte bound")
        return data



def write_vitest_artifact(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "w") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1:
            raise ValueError("Vitest evidence writes require an owned regular file")
        os.ftruncate(stream.fileno(), 0)
        json.dump(value, stream, allow_nan=False)
        stream.write("\n")


def validate_vitest_phase_report(report, inventory):
    if not isinstance(report, dict):
        raise ValueError("Vitest phase report must be an object")
    try:
        observed = vitest_cases(report)
    except (KeyError, TypeError) as error:
        raise ValueError("Vitest phase report has malformed case records") from error
    compare_cases("vitest", observed, inventory)
    counters = ("numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites",
                "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests")
    snapshot = report.get("snapshot")
    snapshot_counters = ("added", "filesAdded", "filesRemoved", "filesUnmatched", "filesUpdated",
                         "matched", "total", "unchecked", "unmatched", "updated")
    if (report.get("success") is not True
            or any(type(report.get(key)) is not int or report[key] < 0 for key in counters)
            or report["numTotalTests"] != len(observed)
            or report["numPassedTests"] != sum(status == "passed" for _, status in observed)
            or report["numPendingTests"] != sum(status == "skipped" for _, status in observed)
            or report["numTotalTestSuites"] != sum(report[key] for key in (
                "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites"))
            or any(report[key] for key in ("numFailedTestSuites", "numFailedTests", "numTodoTests"))
            or not isinstance(snapshot, dict)
            or set(snapshot) != {*snapshot_counters, "failure", "didUpdate", "filesRemovedList", "uncheckedKeysByFile"}
            or snapshot["failure"] is not False or type(snapshot["didUpdate"]) is not bool
            or any(type(snapshot[key]) is not int or snapshot[key] < 0 for key in snapshot_counters)
            or not isinstance(snapshot["filesRemovedList"], list)
            or any(type(value) is not str for value in snapshot["filesRemovedList"])
            or not isinstance(snapshot["uncheckedKeysByFile"], list)
            or any(not isinstance(value, dict) or set(value) != {"filePath", "keys"}
                   or type(value["filePath"]) is not str or not isinstance(value["keys"], list)
                   or any(type(key) is not str for key in value["keys"])
                   for value in snapshot["uncheckedKeysByFile"])):
        raise ValueError("Vitest phase reported errors or inconsistent counters")


def read_strict_vitest_evidence(inventory, context, *, used):
    proof_path = ARTIFACTS / ("vitest-preflight-used.json" if used else "vitest-preflight-proof.json")
    proof_bytes = read_vitest_artifact(proof_path)
    proof = json.loads(proof_bytes)
    budget = json.loads((ROOT / ".tugling/pilot.json").read_text())["project"]["verification_budget_seconds"]
    if (not isinstance(proof, dict) or set(proof) != {"context", "started_at", "completed_at", "report_sha256"}
            or proof["context"] != context
            or type(proof["started_at"]) is not int or type(proof["completed_at"]) is not int
            or not proof["started_at"] <= proof["completed_at"]
            or not 0 <= time.time() * 1000 - proof["completed_at"] <= budget * 1000):
        raise ValueError("Vitest preflight evidence is stale or from another source or attempt")
    raw = read_vitest_artifact(ARTIFACTS / "vitest-preflight.json")
    if hashlib.sha256(raw).hexdigest() != proof["report_sha256"]:
        raise ValueError("Vitest preflight report differs from its completed proof")
    report = json.loads(raw)
    if (type(report.get("startTime")) is not int
            or not proof["started_at"] <= report["startTime"] <= proof["completed_at"]):
        raise ValueError("Vitest report predates its preflight execution")
    validate_vitest_phase_report(report, vitest_partition(inventory, True))
    return report, hashlib.sha256(proof_bytes).hexdigest()


def strict_vitest_report(inventory, context):
    evidence = read_strict_vitest_evidence(inventory, context, used=False)
    proof = ARTIFACTS / "vitest-preflight-proof.json"
    claimed = ARTIFACTS / "vitest-preflight-used.json"
    os.link(proof, claimed, follow_symlinks=False)
    proof.unlink()
    if read_strict_vitest_evidence(inventory, context, used=True) != evidence:
        raise ValueError("Vitest preflight evidence changed during its claim")
    return evidence


def remove_vitest_artifact(path):
    try:
        read_vitest_artifact(path)
    except FileNotFoundError:
        return
    path.unlink()


def merge_vitest_reports(strict, main):
    merged = {**main, "success": strict["success"] and main["success"],
              "startTime": min(strict["startTime"], main["startTime"]),
              "testResults": [*strict["testResults"], *main["testResults"]]}
    for key in ("numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites",
                "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"):
        merged[key] = strict[key] + main[key]
    merged["snapshot"] = {
        key: (strict["snapshot"][key] or value) if type(value) is bool
        else [*strict["snapshot"][key], *value] if isinstance(value, list)
        else strict["snapshot"][key] + value
        for key, value in main["snapshot"].items()
    }
    return merged


def run_vitest(runner, inventory):
    partitioned = runner in ("preflight", "vitest-main")
    strict = runner == "preflight"
    subset = vitest_partition(inventory, strict) if partitioned else inventory
    context = vitest_context() if partitioned else None
    earlier = strict_vitest_report(inventory, context) if runner == "vitest-main" else None
    output = ARTIFACTS / ("vitest-preflight.json" if strict else "vitest-main.json"
                          if partitioned else "vitest.json")
    if strict:
        for name in ("vitest-preflight-used.json", "vitest-main.json"):
            remove_vitest_artifact(ARTIFACTS / name)
    prepare_report(output)
    if partitioned:
        prepare_report(ARTIFACTS / "vitest.json")
    proof = ARTIFACTS / "vitest-preflight-proof.json"
    if strict:
        prepare_report(proof)
    command = ["node", "node_modules/vitest/vitest.mjs", "run", "--config=vitest.config.ts",
               "--allowOnly=false", "--passWithNoTests=false", "--reporter=default", "--reporter=json",
               "--reporter=./scripts/pilot-vitest-reporter.ts", f"--outputFile={output}"]
    started_at = int(time.time() * 1000)
    if strict:
        command.extend(["--maxWorkers=1", *STRICT_VITEST_FILES])
        returncode = subprocess.run(command, cwd=ROOT, check=False).returncode
    else:
        if partitioned:
            command.extend(f"--exclude={file}" for file in STRICT_VITEST_FILES)
        with cost_seed_directory() as seed:
            subprocess.run(["node", "--import", "tsx", "scripts/prepare-d1-cost-seed.ts", seed],
                           cwd=ROOT, check=True)
            unavailable_pdf = Path(seed) / "pdf-runtime-unavailable.json"
            if unavailable_pdf.exists() or unavailable_pdf.is_symlink():
                raise ValueError("Unit PDF boundary must remain unprovisioned")
            returncode = subprocess.run(command, cwd=ROOT, check=False,
                                        env={**os.environ, "KEEL_TEST_D1_SEED": seed,
                                             "KEEL_PDF_SANDBOX_CONFIG": str(unavailable_pdf)}).returncode
    completed_at = int(time.time() * 1000)
    raw = read_vitest_artifact(output) if partitioned else output.read_bytes()
    report = json.loads(raw)
    if partitioned:
        if (not isinstance(report, dict) or type(report.get("startTime")) is not int
                or not started_at <= report["startTime"] <= completed_at):
            raise ValueError("Vitest report predates its phase execution")
        validate_vitest_phase_report(report, subset)
    else:
        compare_cases("vitest", vitest_cases(report), subset)
    if returncode or report["success"] is not True:
        raise ValueError(f"vitest reported errors (exit {returncode})")
    if partitioned and context != vitest_context():
        raise ValueError("Vitest source changed during its partition execution")
    if strict:
        write_vitest_artifact(proof, {"context": context, "started_at": started_at,
                                     "completed_at": completed_at,
                                     "report_sha256": hashlib.sha256(raw).hexdigest()})
    elif partitioned:
        if read_strict_vitest_evidence(inventory, context, used=True) != earlier:
            raise ValueError("Vitest preflight evidence changed during the remaining unit phase")
        merged = merge_vitest_reports(earlier[0], report)
        validate_vitest_phase_report(merged, inventory)
        write_vitest_artifact(ARTIFACTS / "vitest.json", merged)
        return merged
    elif not strict:
        return report


def run_suite(runner, *, record_timings=False):
    if runner == "migration-seed":
        prepare_browser_seed()
        return
    if runner == "browser-fixture":
        validate_browser_seed_seal()
        return
    inventory = json.loads(INVENTORY.read_text())
    if runner == "python":
        suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromModule(load_module(name)) for name in PYTHON_SUITES)
        result = unittest.TextTestRunner(verbosity=2, resultclass=AccountedResult).run(suite)
        compare_cases(runner, result.observed, inventory)
        if not result.wasSuccessful():
            raise ValueError("native Python tests failed")
        if record_timings:
            log_timings("python", ((name, state, result.durations_ms.get(name))
                                   for name, state in result.observed), inventory)
        return
    if runner in ("vitest", "vitest-main", "preflight"):
        if runner == "preflight":
            validate_preflight_dependencies(json.loads((ROOT / ".tugling/pilot-verification.json").read_text()))
        report = run_vitest(runner, inventory)
        if record_timings and report is not None:
            log_timings("vitest", vitest_observations(report), inventory)
        if runner == "preflight":
            with native_lease("python"):
                run_suite("python", record_timings=record_timings)
        return
    output = ARTIFACTS / "playwright.json"
    prepare_report(output)
    returncode = run_browser_lanes(output, prepared=runner == "playwright-prepared")
    report = json.loads(output.read_text())
    compare_cases("playwright", playwright_cases(report), inventory)
    if returncode or report["errors"]:
        raise ValueError(f"playwright reported errors (exit {returncode})")
    if record_timings:
        log_timings("playwright", playwright_observations(report), inventory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "runner",
        choices=("migration-seed", "browser-fixture", "vitest", "vitest-main", "preflight", "playwright", "playwright-prepared", "python"),
    )
    args = parser.parse_args()
    load_module("tugling-pilot").require_unfiltered_environment()
    ARTIFACTS.mkdir(parents=True, exist_ok=True, mode=0o700)
    if ARTIFACTS.resolve() != ARTIFACTS or any((ARTIFACTS / name).is_symlink() for name in (".lease", "browser-results", "vitest.json", "vitest-main.json", "vitest-preflight.json",
                                                                                   "vitest-preflight-proof.json", "vitest-preflight-used.json", "playwright.json")):
        raise ValueError("native artifact ownership must not follow symlinks")
    # One report slot per runner, scoped to this checkout; never replace a
    # report still owned by another active verification process.
    with native_lease(native_lease_name(args.runner)):
        run_suite(args.runner, record_timings=os.environ.get("GITHUB_ACTIONS") == "true" and sys.platform == "linux")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Required native verification: {error}")
