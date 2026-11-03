"""Synthetic native-runner and pre-execution source boundary holdouts."""

import importlib.util
import json
import os
from pathlib import Path
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from contextlib import contextmanager


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pilot = load("pilot", "tugling-pilot.py")
native = load("native", "pilot_native.py")


class SourceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=pilot.ROOT / ".tugling/local")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.helper = self.root / pilot.HELPER
        self.helper.parent.mkdir(parents=True)
        self.helper.write_text("import json\nprint(json.dumps({'isolated': True}))\n")
        (self.root / ".gitignore").write_text("ignored/\njson.py\n__pycache__/\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "synthetic source")
        self.revision = self.git("rev-parse", "HEAD").decode().strip()

    def git(self, *args):
        return pilot.git(self.root, *args)

    def test_rejects_nested_inherited_identity_before_execution(self):
        nested = self.root / "ignored"
        (nested / pilot.HELPER).parent.mkdir(parents=True)
        (nested / pilot.HELPER).write_text("raise RuntimeError('must not execute')")
        with self.assertRaisesRegex(ValueError, "actual Git root"):
            pilot.validate_source(nested, self.revision)

    def test_rejects_dirty_source_and_index_hiding_flags(self):
        self.helper.write_text("raise RuntimeError('must not execute')")
        with self.assertRaisesRegex(ValueError, "clean"):
            pilot.validate_source(self.root, self.revision)
        for flag in ("assume-unchanged", "skip-worktree"):
            self.git("update-index", "--" + flag, pilot.HELPER)
            with self.assertRaisesRegex(ValueError, "index"):
                pilot.validate_source(self.root, self.revision)
            self.git("update-index", "--no-" + flag, pilot.HELPER)

    def test_rejects_symlink_and_wrong_revision(self):
        with self.assertRaisesRegex(ValueError, "reviewed revision"):
            pilot.validate_source(self.root, "0" * 40)
        self.helper.unlink()
        self.helper.symlink_to(self.root / ".gitignore")
        with self.assertRaises(ValueError):
            pilot.validate_source(self.root, self.revision)

    def test_ignores_ambient_git_routing_and_replacement_objects(self):
        with patch.dict(os.environ, {"GIT_DIR": "/missing", "GIT_WORK_TREE": "/missing", "GIT_INDEX_FILE": "/missing"}):
            self.assertEqual(pilot.validate_source(self.root, self.revision), self.helper)
        original = self.git("rev-parse", f"HEAD:{pilot.HELPER}").decode().strip()
        alternate = self.root / "ignored" / "alternate"
        alternate.parent.mkdir()
        alternate.write_text("raise RuntimeError('substituted blob')")
        replacement = self.git("hash-object", "-w", str(alternate)).decode().strip()
        self.git("replace", original, replacement)
        self.helper.write_bytes(alternate.read_bytes())
        with self.assertRaises(ValueError):
            pilot.validate_source(self.root, self.revision)

    def test_isolates_adjacent_python_imports(self):
        marker = self.root / "ignored" / "executed"
        marker.parent.mkdir()
        (self.helper.parent / "json.py").write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\nraise RuntimeError('shadow import')\n")
        helper = pilot.validate_source(self.root, self.revision)
        command = pilot.helper_command(helper, self.root, "validate")
        result = subprocess.run(command, env=pilot.git_environment(), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"isolated": True})
        self.assertFalse(marker.exists())


class NativeAccountingTests(unittest.TestCase):
    def test_rejects_selection_and_reporter_environment_overrides(self):
        for name in ("TEST_ARGS", "E2E_ARGS", "MAKEFLAGS", "PNPM", "NODE_OPTIONS", "VITEST_MAX_THREADS", "PW_TEST_GREP", "PLAYWRIGHT_JSON_OUTPUT_FILE", "KEEL_BROWSER_LANE"):
            with self.subTest(name=name), patch.dict(os.environ, {name: "narrowed"}):
                with self.assertRaisesRegex(ValueError, name):
                    pilot.require_unfiltered_environment()

    def test_native_suite_leases_allow_independent_suites_but_reject_same_suite(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(native, "ARTIFACTS", Path(temporary)):
            self.assertEqual(native.native_lease_name("browser-fixture"), "playwright")
            self.assertEqual(native.native_lease_name("migration-seed"), "playwright")
            self.assertEqual(native.native_lease_name("playwright-prepared"), "playwright")
            self.assertEqual(native.native_lease_name("preflight"), "vitest")
            self.assertEqual(native.native_lease_name("vitest-resource"), "vitest")
            self.assertEqual(native.native_lease_name("vitest-main"), "vitest")
            with native.native_lease("vitest"), native.native_lease("playwright"):
                with self.assertRaises(BlockingIOError):
                    with native.native_lease("vitest"):
                        self.fail("a second writer acquired the same suite report")
                with self.assertRaises(BlockingIOError):
                    with native.native_lease(native.native_lease_name("browser-fixture")):
                        self.fail("browser fixture preparation overlapped Playwright")
                contender = subprocess.run([
                    sys.executable, "-I", "-c",
                    "import fcntl,sys; f=open(sys.argv[1], 'a'); "
                    "fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)",
                    str(Path(temporary) / ".vitest.lease"),
                ], capture_output=True, text=True)
                self.assertNotEqual(contender.returncode, 0)
                self.assertIn("BlockingIOError", contender.stderr)
            # Cleanup releases ownership and a later invocation can proceed.
            with native.native_lease("vitest"):
                pass

    def test_browser_lane_accounting_rejects_swapped_files_and_worker_counts(self):
        def report(file, workers):
            return {"config": {"workers": workers}, "suites": [{"specs": [{
                "file": file, "title": "required", "tests": [{
                    "projectName": "chromium", "status": "expected", "expectedStatus": "passed",
                    "results": [{"status": "passed"}],
                }],
            }]}]}
        inventory = {"playwright": [f"e2e/{lane}.spec.ts :: chromium :: required" for lane in native.BROWSER_LANES], "exclusions": []}
        execution = {
            lane: {"workers": 4 if lane == "mocked-development" else 1}
            for lane in native.BROWSER_LANES
        }
        for lane in native.BROWSER_LANES:
            workers = execution[lane]["workers"]
            correct = report(f"{lane}.spec.ts", workers)
            native.check_browser_lane(lane, correct, [f"{lane}.spec.ts"], inventory, execution)
            other = next(candidate for candidate in native.BROWSER_LANES if candidate != lane)
            for incorrect in (report(f"{other}.spec.ts", workers), report(f"{lane}.spec.ts", 3)):
                with self.assertRaises(ValueError):
                    native.check_browser_lane(lane, incorrect, [f"{lane}.spec.ts"], inventory, execution)

    def test_browser_lane_reports_preserve_errors_and_require_complete_union(self):
        def report(title, errors=None):
            return {"suites": [{"specs": [{"file": "fixture.ts", "title": title, "tests": [{
                "projectName": "chromium", "status": "expected", "expectedStatus": "passed",
                "results": [{"status": "passed"}],
            }]}]}], "errors": errors or [], "stats": {
                "startTime": "2026-09-21T00:00:00Z", "duration": 10,
                "expected": 1, "skipped": 0, "unexpected": 0, "flaky": 0,
            }}
        reports = {lane: report(lane) for lane in native.BROWSER_LANES}
        reports["mocked"] = report("mocked", [{"message": "worker teardown failed"}])
        inventory = {"playwright": [f"e2e/fixture.ts :: chromium :: {lane}" for lane in native.BROWSER_LANES], "exclusions": []}
        merged = native.merge_browser_reports(reports)
        native.compare_cases("playwright", native.playwright_cases(merged), inventory)
        self.assertEqual(merged["stats"]["expected"], len(native.BROWSER_LANES))
        self.assertEqual(merged["stats"]["duration"], 10)
        self.assertEqual(merged["totalWorkDuration"], 50)
        self.assertEqual(merged["errors"], reports["mocked"]["errors"])
        for incomplete in (
            {"mocked": reports["mocked"]},
            {**reports, "unexpected": report("unexpected")},
        ):
            with self.assertRaises(ValueError):
                native.merge_browser_reports(incomplete)

    def test_browser_execution_rejects_oversubscription_and_unsafe_ports(self):
        lanes = {lane: [f"{lane}.spec.ts"] for lane in native.BROWSER_LANES}
        execution = {
            "mocked": {"server": "mocked", "frontend": "production", "workers": 1, "webPort": 31031, "apiPort": None},
            "mocked-development": {"server": "mocked", "frontend": "production", "workers": 4, "webPort": 31034, "apiPort": None},
            "stateful-development": {"server": "stateful", "frontend": "development", "workers": 1, "webPort": 31035, "apiPort": 32035},
            "stateful-a": {"server": "stateful", "frontend": "production", "workers": 1, "webPort": 31032, "apiPort": 32032},
            "stateful-b": {"server": "stateful", "frontend": "production", "workers": 1, "webPort": 31033, "apiPort": 32033},
        }
        schedule = {
            "mocked": [],
            "mocked-development": ["mocked", "stateful-development", "stateful-a", "stateful-b"],
            "stateful-development": [],
            "stateful-a": [],
            "stateful-b": [],
        }
        self.assertEqual(
            native.validate_browser_execution(lanes, execution, schedule),
            [31031, 31034, 31035, 32035, 31032, 32032, 31033, 32033],
        )
        for lane, field, value in (
            ("mocked", "workers", 2),
            ("mocked-development", "workers", 1),
            ("mocked-development", "frontend", "development"),
            ("stateful-a", "webPort", 40000),
            ("stateful-b", "apiPort", 32032),
        ):
            invalid = {name: dict(config) for name, config in execution.items()}
            invalid[lane][field] = value
            with self.subTest(lane=lane, field=field), self.assertRaises(ValueError):
                native.validate_browser_execution(lanes, invalid, schedule)

        invalid_schedules = (
            {**schedule, "mocked-development": ["unknown"]},
            {**schedule, "mocked-development": ["mocked-development"]},
            {**schedule, "stateful-development": ["mocked-development"]},
            {**schedule, "mocked-development": ["stateful-development"]},
        )
        for invalid in invalid_schedules:
            with self.subTest(schedule=invalid), self.assertRaises(ValueError):
                native.validate_browser_execution(lanes, execution, invalid)

        schedule = {
            "mocked": [],
            "mocked-development": ["mocked", "stateful-development", "stateful-a", "stateful-b"],
            "stateful-development": [],
            "stateful-a": [],
            "stateful-b": [],
        }
        execution = {
            lane: {"workers": 4 if lane == "mocked-development" else 1}
            for lane in native.BROWSER_LANES
        }

        class Process:
            def __init__(self, running=True):
                self.running = running
                self.pid = os.getpid()

            def poll(self):
                return None if self.running else 0

            def wait(self, timeout):
                return 0

        started = set()
        completed = set()
        initial = native.ready_browser_lanes(started, completed, schedule)
        self.assertEqual(initial, ["mocked", "stateful-development", "stateful-a", "stateful-b"])
        processes = {lane: Process() for lane in initial}
        self.assertEqual(native.active_browser_workers(processes, execution), 4)
        started.update(initial)
        self.assertEqual(native.ready_browser_lanes(started, completed, schedule), [])

        processes["stateful-development"].running = False
        self.assertEqual(native.active_browser_workers(processes, execution), 3)
        self.assertEqual(native.ready_browser_lanes(started, completed, schedule), [])
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        stateful_port = listener.getsockname()[1]
        teardown_execution = {
            "stateful-development": {"webPort": stateful_port, "apiPort": None}
        }
        try:
            with (
                patch.object(native, "browser_process_group_alive", return_value=False),
                self.assertRaisesRegex(ValueError, "did not release"),
            ):
                native.release_browser_lane(
                    "stateful-development",
                    processes,
                    teardown_execution,
                    timeout_seconds=0.05,
                )
            self.assertIn("stateful-development", processes)
            self.assertEqual(
                native.ready_browser_lanes(started, completed, schedule), []
            )
        finally:
            listener.close()
        with patch.object(native, "browser_process_group_alive", return_value=False):
            native.release_browser_lane(
                "stateful-development",
                processes,
                teardown_execution,
                timeout_seconds=0.05,
            )
        self.assertNotIn("stateful-development", processes)
        completed.add("stateful-development")
        self.assertEqual(native.ready_browser_lanes(started, completed, schedule), [])
        for lane in ("mocked", "stateful-a", "stateful-b"):
            processes[lane].running = False
            del processes[lane]
            completed.add(lane)
        handoff = native.ready_browser_lanes(started, completed, schedule)
        self.assertEqual(handoff, ["mocked-development"])
        processes["mocked-development"] = Process()
        self.assertEqual(native.active_browser_workers(processes, execution), 4)

    def test_browser_cleanup_targets_owned_process_groups(self):
        with tempfile.TemporaryDirectory(dir=pilot.ROOT / ".tugling/local") as temporary:
            root = Path(temporary)
            marker = root / "descendant-stopped"
            descendant = (
                "import signal,sys\n"
                "from pathlib import Path\n"
                "def stop(*_):\n"
                " Path(sys.argv[1]).write_text('stopped')\n"
                " raise SystemExit(0)\n"
                "signal.signal(signal.SIGINT, stop)\n"
                "print('ready', flush=True)\n"
                "signal.pause()\n"
            )
            leader = (
                "import signal,subprocess,sys\n"
                "child = None\n"
                "def stop(*_):\n"
                " child.wait(timeout=1)\n"
                " raise SystemExit(0)\n"
                "signal.signal(signal.SIGINT, stop)\n"
                "child = subprocess.Popen([sys.executable, '-c', sys.argv[2], sys.argv[1]])\n"
                "signal.pause()\n"
            )
            process = subprocess.Popen(
                [sys.executable, "-c", leader, str(marker), descendant],
                start_new_session=True,
                stdout=subprocess.PIPE,
                text=True,
            )
            self.assertEqual(process.stdout.readline(), "ready\n")
            native.cleanup_browser_processes([process])
            process.stdout.close()
            self.assertIsNotNone(process.poll())
            self.assertEqual(marker.read_text(), "stopped")

            class StuckProcess:
                pid = 999_999

                def poll(self):
                    return None

                def wait(self, timeout):
                    raise subprocess.TimeoutExpired("synthetic-browser", timeout)

            stuck = StuckProcess()
            with (
                patch.object(native.os, "killpg") as killpg,
                patch.object(native, "browser_process_group_alive", return_value=True),
                patch.object(native.time, "monotonic", side_effect=[0, 3]),
                self.assertRaisesRegex(ValueError, "could not prove"),
            ):
                native.cleanup_browser_processes([stuck])
            self.assertEqual(
                [call.args for call in killpg.call_args_list],
                [(stuck.pid, signal.SIGINT), (stuck.pid, signal.SIGKILL)],
            )

            original = RuntimeError("synthetic lane failure")

            def fail_then_cleanup():
                try:
                    raise original
                except BaseException as error:
                    native.cleanup_browser_runtime([stuck], error)
                    raise

            with (
                patch.object(
                    native,
                    "cleanup_browser_processes",
                    side_effect=ValueError("synthetic cleanup failure"),
                ),
                patch.object(native, "remove_browser_profiles") as remove_profiles,
                patch("sys.stderr") as stderr,
                self.assertRaisesRegex(RuntimeError, "synthetic lane failure"),
            ):
                fail_then_cleanup()
            remove_profiles.assert_not_called()
            self.assertIn("RuntimeError", "".join(call.args[0] for call in stderr.write.call_args_list))

            server_source = root / "detached-server.py"
            server_source.write_text(
                "import http.server,json,os,socketserver,sys\n"
                "from pathlib import Path\n"
                "class Handler(http.server.BaseHTTPRequestHandler):\n"
                " def do_GET(self):\n"
                "  self.send_response(204); self.end_headers()\n"
                " def log_message(self, *_): pass\n"
                "class Server(socketserver.TCPServer): allow_reuse_address=True\n"
                "with Server(('127.0.0.1', int(sys.argv[1])), Handler) as server:\n"
                " Path(sys.argv[2]).write_text(json.dumps({'pid':os.getpid(),'pgrp':os.getpgrp()}))\n"
                " server.serve_forever()\n"
            )
            fixture = root / "cancellation.spec.ts"
            fixture.write_text(
                "import {test} from '@playwright/test';\n"
                "test('waits for owned cancellation',async()=>{"
                "await new Promise(resolve=>setTimeout(resolve,60000));});\n"
            )

            ephemeral_range = (49_152, 65_535)
            if sys.platform == "linux":
                ephemeral_range = tuple(
                    int(value)
                    for value in Path(
                        "/proc/sys/net/ipv4/ip_local_port_range"
                    ).read_text().split()
                )
            used_ports = set()

            def available_port():
                # Keep readiness connections from claiming a just-released
                # listening port through the kernel's ephemeral allocation.
                for port in range(20_000, 21_000):
                    if (
                        port in used_ports
                        or ephemeral_range[0] <= port <= ephemeral_range[1]
                    ):
                        continue
                    with socket.socket() as reservation:
                        try:
                            reservation.bind(("127.0.0.1", port))
                        except OSError:
                            continue
                    used_ports.add(port)
                    return port
                self.fail("No free non-ephemeral cleanup-probe port")

            def port_open(port):
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                        return True
                except OSError:
                    return False

            def wait_for(check, message, timeout=10):
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    if check():
                        return
                    time.sleep(0.05)
                self.fail(message)

            def read_owned_server_group(server_identity):
                if server_identity.parent != root or server_identity.is_symlink():
                    raise ValueError("webServer identity escaped its owned temporary root")
                native.validate_owned_browser_path(
                    server_identity, "webServer identity"
                )
                identity = json.loads(server_identity.read_text())
                if (
                    not isinstance(identity, dict)
                    or set(identity) != {"pid", "pgrp"}
                    or type(identity["pid"]) is not int
                    or type(identity["pgrp"]) is not int
                    or identity["pid"] <= 0
                    or identity["pgrp"] <= 0
                    or os.getpgid(identity["pid"]) != identity["pgrp"]
                ):
                    raise ValueError("webServer identity did not name its live process group")
                return identity["pgrp"]

            def start_playwright(name, *, port=None, fail_after_ready=False):
                port = port or available_port()
                server_identity = root / f"{name}-server.json"
                command = " ".join(
                    shlex.quote(part)
                    for part in (
                        sys.executable,
                        str(server_source),
                        str(port),
                        str(server_identity),
                    )
                )
                config = root / f"{name}.config.cjs"
                config.write_text(
                    "module.exports="
                    + json.dumps(
                        {
                            "testDir": str(root),
                            "testMatch": fixture.name,
                            "timeout": 60_000,
                            "workers": 1,
                            "webServer": {
                                "command": command,
                                "timeout": 10_000,
                                "url": f"http://127.0.0.1:{port}/",
                            },
                        }
                    )
                    + ";\n"
                )
                playwright = subprocess.Popen(
                    [
                        "node",
                        str(pilot.ROOT / "node_modules/@playwright/test/cli.js"),
                        "test",
                        "--config",
                        str(config),
                        "--reporter=line",
                        f"--output={root / f'{name}-results'}",
                    ],
                    cwd=pilot.ROOT,
                    start_new_session=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                try:
                    wait_for(
                        lambda: server_identity.exists() and port_open(port),
                        f"Playwright {name} webServer did not become ready",
                    )
                    server_group = read_owned_server_group(server_identity)
                    self.assertNotEqual(playwright.pid, server_group)
                    if fail_after_ready:
                        raise RuntimeError("synthetic startup validation failure")
                    return playwright, port, server_group
                except BaseException as error:
                    native.cleanup_browser_processes([playwright])
                    if server_identity.exists() and not server_identity.is_symlink():
                        try:
                            server_group = read_owned_server_group(server_identity)
                        except (
                            OSError,
                            ValueError,
                            TypeError,
                            KeyError,
                            json.JSONDecodeError,
                        ):
                            server_group = None
                        if server_group is not None:
                            try:
                                os.killpg(server_group, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                    try:
                        os.set_blocking(playwright.stdout.fileno(), False)
                        output = os.read(playwright.stdout.fileno(), 16_384)
                    except BlockingIOError:
                        output = b""
                    error.add_note(
                        f"Playwright {name} exit={playwright.returncode}, port={port}:\n"
                        + output.decode("utf-8", errors="replace")
                    )
                    playwright.stdout.close()
                    raise

            failed_start_port = available_port()
            with self.assertRaisesRegex(RuntimeError, "startup validation failure"):
                start_playwright(
                    "startup-failure",
                    port=failed_start_port,
                    fail_after_ready=True,
                )
            failed_identity = json.loads(
                (root / "startup-failure-server.json").read_text()
            )
            wait_for(
                lambda: not native.browser_process_group_alive(
                    failed_identity["pgrp"]
                ),
                "startup failure left its detached webServer group alive",
            )
            self.assertFalse(port_open(failed_start_port))

            # Negative control for the previous implementation: Playwright's
            # SIGTERM path exits without tearing down its detached webServer.
            old_signal, old_port, old_server_group = start_playwright("sigterm")
            try:
                os.killpg(old_signal.pid, signal.SIGTERM)
                old_signal.wait(timeout=2)
                self.assertTrue(port_open(old_port))
                self.assertTrue(native.browser_process_group_alive(old_server_group))
            finally:
                if old_signal.poll() is None:
                    os.killpg(old_signal.pid, signal.SIGKILL)
                    old_signal.wait(timeout=1)
                try:
                    os.killpg(old_server_group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                wait_for(
                    lambda: not port_open(old_port),
                    "negative-control webServer did not stop",
                )
                old_signal.stdout.close()

            playwright, port, server_group = start_playwright("sigint")
            runtime = root / ".keel-local" / "e2e-lanes"
            (runtime / "stateful-a").mkdir(parents=True)
            try:
                native.cleanup_browser_processes([playwright])
                wait_for(
                    lambda: not native.browser_process_group_alive(server_group),
                    "Playwright left its detached webServer process group alive",
                )
                self.assertFalse(port_open(port))
            finally:
                if playwright.poll() is None:
                    os.killpg(playwright.pid, signal.SIGKILL)
                    playwright.wait(timeout=1)
                if native.browser_process_group_alive(server_group):
                    os.killpg(server_group, signal.SIGKILL)
                    wait_for(
                        lambda: not port_open(port),
                        "owned webServer cleanup did not release its port",
                    )
                playwright.stdout.close()
            with (
                patch.object(native, "ROOT", root),
                patch.object(native, "BROWSER_RUNTIME", runtime),
            ):
                native.remove_browser_profiles()
            self.assertFalse(runtime.exists())

    def test_browser_profiles_reject_symlinked_parent_and_unowned_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            outside = root / "outside"
            outside.mkdir()
            linked = root / "linked"
            linked.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "must not follow symlinks"):
                native.validate_owned_browser_path(linked, "synthetic browser profile")

            owned = root / "owned"
            owned.mkdir()
            (owned / "seed.sqlite").write_text("synthetic")
            with patch.object(native.os, "geteuid", return_value=os.geteuid() + 1):
                with self.assertRaisesRegex(ValueError, "only owned"):
                    native.validate_owned_browser_path(
                        owned, "synthetic browser profile", recursive=True
                    )

            repository = root / "repository"
            seed = repository / ".keel-local" / "e2e"
            seed.mkdir(parents=True)
            (seed / "seed.sqlite").write_text("synthetic")
            canonical = repository / ".keel-local" / "scenarios" / "default" / "v3" / "d1"
            canonical.mkdir(parents=True)
            (canonical / "seed.sqlite").write_text("canonical synthetic")
            prepared_seed = repository / ".keel-local" / "pilot-browser-seed"
            prepared_seal = repository / ".keel-local" / "pilot-browser-seed.json"
            runtime = repository / ".keel-local" / "e2e-lanes"
            execution = {
                "mocked": {"server": "mocked"},
                "mocked-development": {"server": "mocked"},
                "stateful-development": {"server": "stateful"},
                "stateful-a": {"server": "stateful"},
                "stateful-b": {"server": "stateful"},
            }
            def export_base(command, **_options):
                if command[0] == "node":
                    target = seed / "v3/d1"
                    target.mkdir(parents=True)
                    (target / "seed.sqlite").write_text("base synthetic")

            with (
                patch.object(native, "ROOT", repository),
                patch.object(native, "BROWSER_RUNTIME", runtime),
                patch.object(native, "BROWSER_SEED", prepared_seed),
                patch.object(native, "BROWSER_SEED_SEAL", prepared_seal),
                patch.object(
                    native, "browser_seed_input_digest", return_value="a" * 64
                ) as input_digest,
                patch.object(native.subprocess, "run", side_effect=export_base) as run,
            ):
                native.prepare_browser_seed()
                self.assertEqual(run.call_args_list, [
                    unittest.mock.call(["node", "--import", "tsx", "scripts/local-seed-scenarios.ts", "verify-ci", "default"], cwd=repository, check=True),
                    unittest.mock.call(["make", "db-check-e2e", "E2E_PERSIST_TO=.keel-local/e2e"], cwd=repository, check=True),
                ])
                self.assertFalse(seed.exists())
                native.validate_browser_seed_seal()
                self.assertFalse((prepared_seed / "seed.sqlite").exists())
                self.assertEqual((canonical / "seed.sqlite").read_text(), "canonical synthetic")

                run.reset_mock()
                native.run_suite("browser-fixture")
                native.prepare_browser_profiles(execution, prepared=True)
                run.assert_not_called()
                self.assertFalse(prepared_seed.exists())
                self.assertFalse(prepared_seal.exists())
                with self.assertRaisesRegex(ValueError, "must exist"):
                    native.prepare_browser_profiles(execution, prepared=True)
                run.assert_not_called()
                for lane in ("mocked", "mocked-development"):
                    self.assertEqual(list((runtime / lane).iterdir()), [])
                for lane in ("stateful-development", "stateful-a", "stateful-b"):
                    self.assertEqual(
                        (runtime / lane / "v3/d1/seed.sqlite").read_text(), "base synthetic"
                    )
                (runtime / "stateful-a/v3/d1/seed.sqlite").write_text("changed")
                self.assertEqual((canonical / "seed.sqlite").read_text(), "canonical synthetic")
                self.assertEqual((runtime / "stateful-b/v3/d1/seed.sqlite").read_text(), "base synthetic")

                prepared_seed.mkdir()
                (prepared_seed / "seed.sqlite").write_text("synthetic")
                native.write_browser_seed_seal()
                input_digest.return_value = "b" * 64
                with self.assertRaisesRegex(ValueError, "seal does not match"):
                    native.prepare_browser_profiles(execution, prepared=True)
                run.assert_not_called()
                input_digest.return_value = "a" * 64

                (prepared_seed / "seed.sqlite").write_text("tampered")
                with self.assertRaisesRegex(ValueError, "seal does not match"):
                    native.prepare_browser_profiles(execution, prepared=True)
                run.assert_not_called()
                self.assertTrue(prepared_seed.exists())

                (prepared_seed / "seed.sqlite").write_text("synthetic")
                native.write_browser_seed_seal()
                run.side_effect = subprocess.CalledProcessError(
                    1, ["make", "db-verify-e2e"]
                )
                with self.assertRaises(subprocess.CalledProcessError):
                    native.prepare_browser_seed()
                self.assertFalse(prepared_seed.exists())
                self.assertFalse(prepared_seal.exists())
                def fail_readback(command, **options):
                    if command[0] == "make":
                        raise subprocess.CalledProcessError(1, command)
                    export_base(command, **options)

                run.side_effect = fail_readback
                with self.assertRaises(subprocess.CalledProcessError):
                    native.prepare_browser_seed()
                self.assertFalse(prepared_seed.exists())
                self.assertFalse(prepared_seal.exists())
                run.side_effect = None
                run.reset_mock()

                prepared_seed.mkdir()
                (prepared_seed / "seed.sqlite").write_text("synthetic")
                native.write_browser_seed_seal()
                prepared_seal.unlink()
                prepared_seal.symlink_to(outside / "seal.json")
                with self.assertRaisesRegex(ValueError, "must not follow symlinks"):
                    native.prepare_browser_profiles(execution, prepared=True)
                run.assert_not_called()

                prepared_seal.unlink()
                native.remove_browser_seed()
                seed.mkdir(exist_ok=True)
                (seed / "seed.sqlite").write_text("standalone")
                native.prepare_browser_profiles(execution)
                run.assert_called_once_with(
                    ["make", "db-verify-e2e"], cwd=repository, check=True
                )
                self.assertEqual(
                    (runtime / "stateful-a" / "seed.sqlite").read_text(),
                    "standalone",
                )

    def test_mocked_browser_guard_rejects_unknown_reads_and_unexpected_writes(self):
        with tempfile.TemporaryDirectory(dir=pilot.ROOT / ".tugling/local") as temporary:
            root = Path(temporary)
            fixture = root / "fixture.ts"
            config = root / "config.cjs"
            config.write_text("module.exports={testDir:'.',testMatch:'fixture.ts',workers:1,use:{serviceWorkers:'allow'}};\n")
            imported = json.dumps(str(pilot.ROOT / "e2e/api-mocked-test.ts"))
            for path, method, success in (("legal-entities", "GET", True), ("unknown", "GET", False), ("legal-entities", "POST", False)):
                fixture.write_text(
                    f"import {{test,expect}} from {imported};\n"
                    "test('isolated API boundary',async({page,serviceWorkers})=>{"
                    "expect(serviceWorkers).toBe('block');"
                    "await page.route('http://keel.test/',r=>r.fulfill({contentType:'text/html',body:'synthetic'}));"
                    "await page.goto('http://keel.test/');"
                    "const value=await page.evaluate(async(args)=>{"
                    "const response=await fetch('/api/'+args.path,{method:args.method});"
                    "return response.json();}," + json.dumps({"path": path, "method": method}) + ");"
                    "expect(value.version).toBe(3);});\n"
                )
                result = subprocess.run([
                    "node", str(pilot.ROOT / "node_modules/@playwright/test/cli.js"), "test",
                    "--config", str(config), "--reporter=list", f"--output={root / 'results'}",
                ], cwd=pilot.ROOT, text=True, capture_output=True)
                with self.subTest(path=path, method=method):
                    if success:
                        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    else:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn("Mocked browser test made an unhandled application API request", result.stdout + result.stderr)

    def test_cost_seed_cleanup_on_success_failure_and_cancellation(self):
        with tempfile.TemporaryDirectory(dir=pilot.ROOT / ".tugling/local") as temporary:
            root = Path(temporary)
            sentinel = root / "unowned"
            sentinel.write_text("synthetic")
            with patch.object(native, "ARTIFACTS", root):
                with native.cost_seed_directory() as seed:
                    self.assertTrue(Path(seed).is_dir())
                self.assertFalse(Path(seed).exists())
                with self.assertRaises(ValueError):
                    with native.cost_seed_directory() as failed:
                        raise ValueError("synthetic failure")
                self.assertFalse(Path(failed).exists())
            code = f"""import sys, time
from pathlib import Path
sys.path.insert(0, {str(pilot.ROOT / 'scripts')!r})
import pilot_native as native
native.ARTIFACTS = Path({str(root)!r})
with native.cost_seed_directory() as seed:
    print(seed, flush=True)
    time.sleep(30)
"""
            process = subprocess.Popen([sys.executable, "-I", "-c", code], stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True)
            try:
                cancelled = Path(process.stdout.readline().strip())
                self.assertTrue(cancelled.is_relative_to(root))
                self.assertTrue(cancelled.is_dir())
                process.terminate()
                process.communicate(timeout=5)
                self.assertEqual(process.returncode, 128 + signal.SIGTERM)
                self.assertFalse(cancelled.exists())
            finally:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=5)
            self.assertEqual(sentinel.read_text(), "synthetic")

    def test_unit_pdf_boundary_is_absent_owned_and_independent_of_ambient_images(self):
        with tempfile.TemporaryDirectory(dir=pilot.ROOT / ".tugling/local") as temporary:
            root = Path(temporary)
            inventory = root / "inventory.json"
            inventory.write_text(json.dumps({"vitest": ["fixture.test.ts :: required"], "exclusions": []}))
            for provisioned in (False, True):
                seen = []
                seeds = []
                def execute(command, **options):
                    if "scripts/prepare-d1-cost-seed.ts" in command:
                        seed = Path(command[-1])
                        seeds.append(seed)
                        if provisioned:
                            (seed / "pdf-runtime-unavailable.json").write_text("synthetic")
                    else:
                        seen.append(command)
                        config = Path(options["env"]["KEEL_PDF_SANDBOX_CONFIG"])
                        self.assertTrue(config.is_relative_to(Path(options["env"]["KEEL_TEST_D1_SEED"])))
                        self.assertFalse(config.exists())
                        (root / "vitest.json").write_text(json.dumps({"success": True, "testResults": [{
                            "name": str(root / "fixture.test.ts"), "assertionResults": [{
                                "ancestorTitles": [], "title": "required", "status": "passed", "failureMessages": []
                            }]
                        }]}))
                    return subprocess.CompletedProcess(command, 0)
                with (patch.object(native, "ROOT", root), patch.object(native, "ARTIFACTS", root),
                      patch.object(native, "INVENTORY", inventory), patch.object(native.subprocess, "run", side_effect=execute),
                      patch.dict(os.environ, {"KEEL_PDF_SANDBOX_CONFIG": "/synthetic-ambient-config.json"})):
                    if provisioned:
                        with self.assertRaisesRegex(ValueError, "must remain unprovisioned"):
                            native.run_suite("vitest")
                    else:
                        native.run_suite("vitest")
                self.assertEqual(len(seen), 0 if provisioned else 1)
                self.assertTrue(seeds)
                self.assertTrue(all(not seed.exists() for seed in seeds))

    def test_native_vitest_removed_skipped_and_filtered_cases_fail_accounting(self):
        # Real native execution proves a green filtered/omitted run cannot pass
        # the reviewed inventory. The fixture is .ts, outside native discovery.
        with tempfile.TemporaryDirectory(dir=pilot.ROOT / ".tugling/local") as temporary:
            root = Path(temporary)
            fixture = root / "fixture.ts"
            config = root / "config.mjs"
            report = root / "report.json"
            config.write_text("export default {test:{include:['fixture.ts'],maxWorkers:1}}\n")
            prefix = fixture.relative_to(pilot.ROOT).as_posix() + " :: "
            inventory = {"vitest": [prefix + "kept", prefix + "required"], "exclusions": []}
            for variant in ("restored", "removed", "skipped", "filtered", "expected-failure", "retry-success"):
                source = "import {it,expect} from 'vitest';\nit('kept',()=>expect(1).toBe(1));\n"
                if variant == "expected-failure":
                    source += "it.fails('required',()=>expect(2).toBe(3));\n"
                elif variant == "retry-success":
                    source += "let tries=0;it('required',{retry:1},()=>expect(++tries).toBe(2));\n"
                elif variant != "removed":
                    source += "it" + (".skip" if variant == "skipped" else "") + "('required',()=>expect(2).toBe(2));\n"
                fixture.write_text(source)
                args = ["node", str(pilot.ROOT / "node_modules/vitest/vitest.mjs"), "run", "--root", str(root), "--config", str(config), "--reporter=json", f"--outputFile={report}"]
                if variant == "filtered":
                    args.extend(["-t", "^kept$"])
                args.append("--reporter=" + str(pilot.ROOT / "scripts/pilot-vitest-reporter.ts"))
                result = subprocess.run(args, cwd=pilot.ROOT, text=True, capture_output=True)
                if variant in ("expected-failure", "retry-success"):
                    self.assertNotEqual(result.returncode, 0, result.stderr)
                    self.assertIn("Required native cases cannot use", result.stderr)
                    continue
                self.assertEqual(result.returncode, 0, result.stderr)
                observed = native.vitest_cases(json.loads(report.read_text()))
                if variant == "restored":
                    native.compare_cases("vitest", observed, inventory)
                else:
                    with self.subTest(variant=variant), self.assertRaises(ValueError):
                        native.compare_cases("vitest", observed, inventory)


        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            strict_ids = [f"{file} :: required" for file in native.STRICT_VITEST_FILES]
            resource_ids = ["resource.test.ts :: required"]
            main_ids = ["main.test.ts :: required"]
            inventory = {"vitest": [*strict_ids, *resource_ids, *main_ids], "exclusions": []}
            context = {"revision": "synthetic-revision", "source_sha256": "synthetic-source",
                       "github": {"GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1"},
                       "coordinator": {"pid": 1, "started": "synthetic-start"}}
            registry = root / "resources.json"
            registry.write_text(json.dumps({"schema_version": 1, "files": ["resource.test.ts"]}))
            config = root / ".tugling/pilot.json"
            config.parent.mkdir()
            config.write_text(json.dumps({"project": {"verification_budget_seconds": 900}}))
            def report(identities, started=1000):
                result = {"success": True, "startTime": started, "testResults": [],
                          "snapshot": {"added": 0, "failure": False, "filesAdded": 0, "filesRemoved": 0,
                                       "filesRemovedList": [], "filesUnmatched": 0, "filesUpdated": 0,
                                       "matched": 0, "total": 0, "unchecked": 0, "uncheckedKeysByFile": [],
                                       "unmatched": 0, "updated": 0, "didUpdate": False}}
                for key in ("numTotalTestSuites", "numPassedTestSuites", "numTotalTests", "numPassedTests"):
                    result[key] = len(identities)
                for key in ("numFailedTestSuites", "numPendingTestSuites", "numFailedTests", "numPendingTests", "numTodoTests"):
                    result[key] = 0
                for identity in identities:
                    file, title = identity.split(" :: ", 1)
                    result["testResults"].append({"name": str(root / file), "assertionResults": [{
                        "ancestorTitles": [], "title": title, "status": "passed", "failureMessages": []
                    }]})
                return result
            snapshot = report([])["snapshot"]
            snapshot_faults = [("minimal", {"failure": False}), ("extra", {**snapshot, "extra": 0})]
            snapshot_faults.extend((f"missing-{key}", {name: value for name, value in snapshot.items() if name != key})
                                   for key in snapshot)
            for key in ("added", "filesAdded", "filesRemoved", "filesUnmatched", "filesUpdated",
                        "matched", "total", "unchecked", "unmatched", "updated"):
                snapshot_faults.extend((f"{key}-{value!r}", {**snapshot, key: value})
                                       for value in (True, -1, 1.5, "0", None, [], {}))
            for key in ("failure", "didUpdate"):
                snapshot_faults.extend((f"{key}-{value!r}", {**snapshot, key: value})
                                       for value in (0, 1, "false", None, [], {}))
            snapshot_faults.append(("failure-true", {**snapshot, "failure": True}))
            for key in ("filesRemovedList", "uncheckedKeysByFile"):
                snapshot_faults.extend((f"{key}-{value!r}", {**snapshot, key: value})
                                       for value in (None, "file", {}, [None], [1], [False], [[]], [{}]))
            snapshot_faults.extend((f"unchecked-entry-{value!r}", {**snapshot, "uncheckedKeysByFile": [value]})
                                   for value in ("file", {}, {"filePath": "file"}, {"keys": []},
                                                 {"filePath": "file", "keys": [], "extra": 0},
                                                 {"filePath": 1, "keys": []},
                                                 {"filePath": "file", "keys": "key"},
                                                 {"filePath": "file", "keys": None},
                                                 {"filePath": "file", "keys": {}},
                                                 {"filePath": "file", "keys": [None]},
                                                 {"filePath": "file", "keys": [1]},
                                                 {"filePath": "file", "keys": [False]},
                                                 {"filePath": "file", "keys": [{}]}))
            def stage(runner, identities, started, completed, change=None):
                stem = native.VITEST_PHASES[runner]["stem"]
                output = root / f"{stem}.json"
                output.write_text(json.dumps(report(identities, started)))
                value = {"context": json.loads(json.dumps(context)), "started_at": started,
                         "completed_at": completed, "report_sha256": native.hashlib.sha256(output.read_bytes()).hexdigest()}
                predecessor = native.VITEST_PHASES[runner]["predecessor"]
                if predecessor:
                    previous = native.VITEST_PHASES[predecessor]["stem"]
                    value.update(predecessor_proof_sha256=native.hashlib.sha256((root / f"{previous}-used.json").read_bytes()).hexdigest(),
                                 predecessor_report_sha256=native.hashlib.sha256((root / f"{previous}.json").read_bytes()).hexdigest())
                if change:
                    change(value)
                (root / f"{stem}-proof.json").write_text(json.dumps(value))
            def reset(resource=False, change=None):
                for path in root.glob("vitest*.json"):
                    path.unlink()
                stage("preflight", strict_ids, 1000, 1500, None if resource else change)
                if resource:
                    native.claim_vitest_phase("preflight", inventory, context)
                    stage("vitest-resource", resource_ids, 1500, 1800, change)
            with (patch.object(native, "ROOT", root), patch.object(native, "ARTIFACTS", root),
                  patch.object(native, "RESOURCE_INVENTORY", registry),
                  patch.object(native, "vitest_context", return_value=context), patch.object(native.time, "time", return_value=2)):
                parts = native.vitest_partitions(inventory)
                self.assertEqual(parts["strict"]["vitest"], strict_ids)
                self.assertEqual(parts["resource"]["vitest"], resource_ids)
                self.assertEqual(parts["remaining"]["vitest"], main_ids)
                for runner, identities in (("preflight", strict_ids), ("vitest-resource", resource_ids)):
                    resource = runner == "vitest-resource"
                    reset(resource)
                    proof_path = root / f"{native.VITEST_PHASES[runner]['stem']}-proof.json"
                    original = proof_path.read_bytes()
                    chain = native.claim_vitest_phase(runner, inventory, context)
                    self.assertEqual(chain[-1]["report"], report(identities, 1500 if resource else 1000))
                    self.assertFalse(proof_path.exists())
                    with self.assertRaises(FileNotFoundError):
                        native.claim_vitest_phase(runner, inventory, context)
                    proof_path.write_bytes(original)
                    used = root / f"{native.VITEST_PHASES[runner]['stem']}-used.json"
                    consumed = used.read_bytes()
                    with self.assertRaises(FileExistsError):
                        native.claim_vitest_phase(runner, inventory, context)
                    self.assertEqual(used.read_bytes(), consumed)
                    for label, change in (
                        ("source", lambda value: value["context"].update(source_sha256="other")),
                        ("revision", lambda value: value["context"].update(revision="other")),
                        ("attempt", lambda value: value["context"]["github"].update(GITHUB_RUN_ATTEMPT="2")),
                        ("coordinator", lambda value: value["context"]["coordinator"].update(pid=2)),
                        ("coordinator-start", lambda value: value["context"]["coordinator"].update(started="other")),
                        ("stale", lambda value: value.update(started_at=-901000, completed_at=-900000)),
                        ("future", lambda value: value.update(completed_at=3000)),
                        ("old-report", lambda value: value.update(started_at=1501 if resource else 1001)),
                        ("hash", lambda value: value.update(report_sha256="other")),
                        ("boolean-time", lambda value: value.update(started_at=True)),
                        ("extra", lambda value: value.update(unreviewed=True)),
                    ):
                        reset(resource, change)
                        with self.subTest(runner=runner, label=label), self.assertRaises(ValueError):
                            native.claim_vitest_phase(runner, inventory, context)
                    for changed in (identities[:-1], [*identities, identities[0]], [*identities, main_ids[0]]):
                        reset(resource)
                        stage(runner, changed, 1500 if resource else 1000, 1800 if resource else 1500)
                        with self.subTest(runner=runner, identities=changed), self.assertRaises(ValueError):
                            native.claim_vitest_phase(runner, inventory, context)
                    for mutation in (lambda value: value.update(success=False),
                                     lambda value: value.update(numPassedTests=0),
                                     lambda value: value.update(numTotalTestSuites=999),
                                     lambda value: value.update(snapshot={"failure": True}),
                                     lambda value: value.update(testResults=None),
                                     lambda value: value["testResults"][0]["assertionResults"][0].update(status="pending")):
                        reset(resource)
                        output = root / f"{native.VITEST_PHASES[runner]['stem']}.json"
                        value = json.loads(output.read_text()); mutation(value); output.write_text(json.dumps(value))
                        proof = json.loads(proof_path.read_text()); proof["report_sha256"] = native.hashlib.sha256(output.read_bytes()).hexdigest()
                        proof_path.write_text(json.dumps(proof))
                        with self.subTest(runner=runner, report=mutation), self.assertRaises(ValueError):
                            native.claim_vitest_phase(runner, inventory, context)
                    for label, invalid_snapshot in snapshot_faults:
                        reset(resource)
                        output = root / f"{native.VITEST_PHASES[runner]['stem']}.json"
                        value = json.loads(output.read_text()); value["snapshot"] = invalid_snapshot
                        output.write_text(json.dumps(value))
                        proof = json.loads(proof_path.read_text()); proof["report_sha256"] = native.hashlib.sha256(output.read_bytes()).hexdigest()
                        proof_path.write_text(json.dumps(proof))
                        with self.subTest(runner=runner, snapshot=label), self.assertRaises(ValueError):
                            native.claim_vitest_phase(runner, inventory, context)
                        self.assertTrue(proof_path.is_file())
                        self.assertFalse(used.exists())
                    for unsafe in ("symlink", "hardlink", "oversized"):
                        reset(resource)
                        if unsafe == "symlink":
                            proof_path.unlink(); proof_path.symlink_to(registry)
                        elif unsafe == "hardlink":
                            os.link(proof_path, root / "extra-proof-link")
                        else:
                            proof_path.write_bytes(b"x" * (4 * 1024 * 1024 + 1))
                        with self.subTest(runner=runner, unsafe=unsafe), self.assertRaises(ValueError):
                            native.claim_vitest_phase(runner, inventory, context)
                        (root / "extra-proof-link").unlink(missing_ok=True)
                for field in ("predecessor_proof_sha256", "predecessor_report_sha256"):
                    reset(True, lambda value: value.update({field: "other"}))
                    with self.subTest(predecessor=field), self.assertRaises(ValueError):
                        native.claim_vitest_phase("vitest-resource", inventory, context)
                reset(True, lambda value: value.update(started_at=1499))
                with self.assertRaises(ValueError):
                    native.claim_vitest_phase("vitest-resource", inventory, context)
                for path in ("vitest-preflight.json", "vitest-preflight-used.json"):
                    reset(True)
                    (root / path).write_text("{}")
                    with self.subTest(mutated=path), self.assertRaises(ValueError):
                        native.claim_vitest_phase("vitest-resource", inventory, context)
                valid_registry = registry.read_text()
                for value in ({}, {"schema_version": True, "files": ["resource.test.ts"]},
                              {"schema_version": 1, "files": []},
                              {"schema_version": 1, "files": ["resource.test.ts"] * 2},
                              {"schema_version": 1, "files": ["missing.test.ts"]},
                              {"schema_version": 1, "files": [native.STRICT_VITEST_FILES[0]]},
                              {"schema_version": 1, "files": ["./resource.test.ts"]},
                              {"schema_version": 1, "files": ["../resource.test.ts"]},
                              {"schema_version": 1, "files": ["/resource.test.ts"]}):
                    registry.write_text(json.dumps(value))
                    with self.subTest(registry=value), self.assertRaises(ValueError):
                        native.vitest_partitions(inventory)
                registry.write_text(valid_registry)
                reset(True)
                chain = native.claim_vitest_phase("vitest-resource", inventory, context)
                merged = report(main_ids, 1800)
                for earlier in reversed(chain):
                    merged = native.merge_vitest_reports(earlier["report"], merged)
                native.compare_cases("vitest", native.vitest_cases(merged), inventory)
                self.assertEqual(merged["numPassedTests"], len(inventory["vitest"]))
                ordered = [report(strict_ids), report(resource_ids), report(main_ids)]
                for index, value in enumerate(ordered, 1):
                    for key in ("added", "filesAdded", "filesRemoved", "filesUnmatched", "filesUpdated",
                                "matched", "total", "unchecked", "unmatched", "updated"):
                        value["snapshot"][key] = index
                    value["snapshot"].update(filesRemovedList=[str(index)], didUpdate=index == 2,
                                             uncheckedKeysByFile=[{"filePath": str(index), "keys": [f"key-{index}"]}])
                    native.validate_vitest_phase_report(value, {"vitest": (strict_ids, resource_ids, main_ids)[index - 1], "exclusions": []})
                combined = native.merge_vitest_reports(native.merge_vitest_reports(*ordered[:2]), ordered[2])
                expected_snapshot = {"added": 6, "failure": False, "filesAdded": 6, "filesRemoved": 6,
                                     "filesRemovedList": ["1", "2", "3"], "filesUnmatched": 6, "filesUpdated": 6,
                                     "matched": 6, "total": 6, "unchecked": 6,
                                     "uncheckedKeysByFile": [{"filePath": "1", "keys": ["key-1"]},
                                                             {"filePath": "2", "keys": ["key-2"]},
                                                             {"filePath": "3", "keys": ["key-3"]}],
                                     "unmatched": 6, "updated": 6, "didUpdate": True}
                self.assertEqual(combined["snapshot"], expected_snapshot)
                native.validate_vitest_phase_report(combined, inventory)

                for changed in ([], [*main_ids, strict_ids[0]], [*main_ids, resource_ids[0]]):
                    with self.subTest(remaining=changed), self.assertRaises(ValueError):
                        native.compare_cases("vitest", native.vitest_cases(native.merge_vitest_reports(
                            native.merge_vitest_reports(report(strict_ids), report(resource_ids)), report(changed))), inventory)
                prepared, directories = [], []
                selected = {"vitest-preflight.json": strict_ids, "vitest-resource.json": resource_ids,
                            "vitest-main.json": main_ids}
                def execute(command, **options):
                    if "scripts/prepare-d1-cost-seed.ts" in command:
                        prepared.append(Path(command[-1]))
                        (Path(command[-1]) / "synthetic-seal").write_text("prepared")
                    else:
                        output = Path(next(arg.split("=", 1)[1] for arg in command if arg.startswith("--outputFile=")))
                        if "env" in options:
                            directory = Path(options["env"]["KEEL_TEST_D1_SEED"])
                            directories.append(directory)
                            self.assertTrue(directory.is_dir())
                            pdf = Path(options["env"]["KEEL_PDF_SANDBOX_CONFIG"])
                            self.assertTrue(pdf.is_relative_to(directory))
                            self.assertFalse(pdf.exists())
                            self.assertEqual((directory / "synthetic-seal").exists(), output.name == "vitest-resource.json")
                            if output.name == "vitest-resource.json":
                                self.assertEqual((root / "vitest-resource-proof.json").read_bytes(), b"")
                            else:
                                self.assertFalse((root / "vitest-resource-proof.json").exists())
                                self.assertTrue((root / "vitest-resource-used.json").is_file())
                                self.assertFalse(prepared[0].exists())
                        value = report(selected[output.name], 2000)
                        value["snapshot"] = ordered[list(selected).index(output.name)]["snapshot"]
                        output.write_text(json.dumps(value))
                    return subprocess.CompletedProcess(command, 0)
                with (patch.object(native.subprocess, "run", side_effect=execute),
                      patch.dict(os.environ, {"KEEL_PDF_SANDBOX_CONFIG": "/synthetic/ambient.json"})):
                    for runner in ("preflight", "vitest-resource", "vitest-main"):
                        native.run_vitest(runner, inventory)
                self.assertEqual(len(prepared), 1)
                self.assertTrue(all(not path.exists() for path in directories))
                final = json.loads((root / "vitest.json").read_text())
                native.compare_cases("vitest", native.vitest_cases(final), inventory)
                self.assertEqual(final["snapshot"], expected_snapshot)
                for failure in ("process", "cancel", "cleanup", "source", "counters"):
                    reset()
                    def fail(command, **options):
                        value = execute(command, **options)
                        if "scripts/prepare-d1-cost-seed.ts" not in command:
                            if failure == "counters":
                                output = root / "vitest-resource.json"
                                invalid = json.loads(output.read_text()); invalid["numPassedTests"] = 0
                                output.write_text(json.dumps(invalid))
                            if failure == "cancel":
                                raise SystemExit(143)
                            if failure == "process":
                                return subprocess.CompletedProcess(command, 1)
                        return value
                    with (patch.object(native.subprocess, "run", side_effect=fail),
                          patch.object(native, "vitest_context", side_effect=[context, {**context, "source_sha256": "changed"}]
                                       if failure == "source" else None, return_value=context)):
                        if failure == "cleanup":
                            original_directory = native.cost_seed_directory
                            @contextmanager
                            def interrupted_cleanup():
                                with original_directory() as seed:
                                    yield seed
                                raise ValueError("synthetic cleanup failure")
                            with patch.object(native, "cost_seed_directory", interrupted_cleanup), self.assertRaises(ValueError):
                                native.run_vitest("vitest-resource", inventory)
                        else:
                            with self.subTest(failure=failure), self.assertRaises((ValueError, SystemExit)):
                                native.run_vitest("vitest-resource", inventory)
                    self.assertEqual((root / "vitest-resource-proof.json").read_bytes(), b"")
                    self.assertTrue(all(not path.exists() for path in directories))
                for runner in ("vitest-resource", "vitest-main"):
                    for label, invalid_snapshot in snapshot_faults:
                        reset(runner == "vitest-main")
                        def malformed_snapshot(command, **options):
                            result = execute(command, **options)
                            if "scripts/prepare-d1-cost-seed.ts" not in command:
                                output = root / f"{native.VITEST_PHASES[runner]['stem']}.json"
                                value = json.loads(output.read_text()); value["snapshot"] = invalid_snapshot
                                output.write_text(json.dumps(value))
                            return result
                        with (patch.object(native.subprocess, "run", side_effect=malformed_snapshot),
                              self.subTest(runner=runner, snapshot=label), self.assertRaises(ValueError)):
                            native.run_vitest(runner, inventory)
                        artifact = "vitest-resource-proof.json" if runner == "vitest-resource" else "vitest.json"
                        self.assertEqual((root / artifact).read_bytes(), b"")
                        self.assertTrue(all(not path.exists() for path in directories))
                reset(True)
                def malformed_main(command, **options):
                    result = execute(command, **options)
                    output = root / "vitest-main.json"
                    value = json.loads(output.read_text()); value["numPassedTests"] = 0
                    output.write_text(json.dumps(value))
                    return result
                with patch.object(native.subprocess, "run", side_effect=malformed_main), self.assertRaises(ValueError):
                    native.run_vitest("vitest-main", inventory)
                self.assertEqual((root / "vitest.json").read_bytes(), b"")
                self.assertTrue(all(not path.exists() for path in directories))


    def test_native_playwright_removed_skipped_and_filtered_cases_fail_accounting(self):
        with tempfile.TemporaryDirectory(dir=pilot.ROOT / ".tugling/local") as temporary:
            root = Path(temporary)
            fixture = root / "fixture.ts"
            config = root / "config.cjs"
            report = root / "report.json"
            config.write_text("module.exports={testDir:'.',testMatch:'fixture.ts',workers:1,projects:[{name:'synthetic'}]};\n")
            prefix = "e2e/fixture.ts :: synthetic :: "
            inventory = {"playwright": [prefix + "kept", prefix + "required"], "exclusions": []}
            for variant in ("restored", "removed", "skipped", "filtered"):
                source = "import {test,expect} from '@playwright/test';\ntest('kept',()=>expect(1).toBe(1));\n"
                if variant != "removed":
                    source += "test" + (".skip" if variant == "skipped" else "") + "('required',()=>expect(2).toBe(2));\n"
                fixture.write_text(source)
                args = ["node", str(pilot.ROOT / "node_modules/@playwright/test/cli.js"), "test", "--config", str(config), "--reporter=json", f"--output={root / 'results'}"]
                if variant == "filtered":
                    args.extend(["--grep", "kept"])
                result = subprocess.run(args, cwd=pilot.ROOT, text=True, capture_output=True,
                                        env={**os.environ, "PLAYWRIGHT_JSON_OUTPUT_FILE": str(report)})
                self.assertEqual(result.returncode, 0, result.stderr)
                observed = native.playwright_cases(json.loads(report.read_text()))
                if variant == "restored":
                    native.compare_cases("playwright", observed, inventory)
                else:
                    with self.subTest(variant=variant), self.assertRaises(ValueError):
                        native.compare_cases("playwright", observed, inventory)

    def test_rejects_replacement_identity_duplicates_and_unexpected_success(self):
        inventory = {"python": ["accepted"], "exclusions": []}
        for observed in ([('replacement', 'passed')], [('accepted', 'passed')] * 2, [('accepted', 'skipped')]):
            with self.assertRaises(ValueError):
                native.compare_cases("python", observed, inventory)

    def test_ci_selects_pr_head_and_keeps_privileged_actions_out(self):
        # Ordinary CI verifies the event merge candidate once; the manual probe
        # intentionally remains a separate exact-head experiment.
        workflow = (pilot.ROOT / ".github/workflows/native-verification.yml").read_text()
        ci = (pilot.ROOT / ".github/workflows/ci.yml").read_text()
        probe = (pilot.ROOT / ".github/workflows/tugling-pilot.yml").read_text()
        action = (pilot.ROOT / ".github/actions/verify-native-receipt/action.yml").read_text()
        post_merge = (pilot.ROOT / ".github/workflows/post-merge.yml").read_text()
        plan = json.loads((pilot.ROOT / ".tugling/pilot-verification.json").read_text())
        flows = {flow["id"]: flow for flow in plan["flows"]}
        self.assertIn("ref: ${{ github.sha }}", workflow)
        self.assertIn('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"', workflow)
        self.assertIn("runs-on: [self-hosted, Linux, X64, keel-ci]", workflow)
        self.assertEqual(workflow.count("make pilot-verify"), 1)
        self.assertIn("scripts/ci-verification.py publish", workflow)
        self.assertEqual(ci.count("needs: native"), 3)
        self.assertEqual(ci.count("if: ${{ !cancelled() }}"), 3)
        self.assertEqual(ci.count('test "$NATIVE_RESULT" = success'), 3)
        self.assertEqual(ci.count("./keel/.github/actions/verify-native-receipt"), 3)
        self.assertIn("uses: ./.github/workflows/native-verification.yml", post_merge)
        self.assertIn("scripts/ci-verification.py check", action)
        self.assertIn("NATIVE_RECEIPT: ${{ inputs.receipt }}", action)
        self.assertNotIn("download-artifact", action)
        self.assertEqual(ci.count("receipt: ${{ needs.native.outputs.receipt }}"), 3)
        self.assertIn("receipt: ${{ steps.receipt.outputs.receipt }}", workflow)
        self.assertNotIn("make pdf-sandbox-build", workflow)
        self.assertNotIn("make pdf-sandbox-build", probe)
        self.assertEqual(flows["pdf-sandbox-build"]["argv"], ["make", "pdf-sandbox-build"])
        self.assertEqual(flows["pdf-sandbox-build"]["timeout_seconds"], 1200)
        self.assertEqual(flows["pdf-sandbox-build"]["depends_on"], ["gate-and-artifact-integrity"])
        self.assertEqual(
            flows["pdf-isolation"]["depends_on"],
            ["gate-and-artifact-integrity", "pdf-sandbox-build", "provider-document-runtime", "source-quality"],
        )
        self.assertEqual(flows["provider-document-runtime"]["argv"], ["make", "provider-document-runtime-verify"])
        self.assertEqual(flows["provider-document-runtime"]["timeout_seconds"], 60)
        self.assertEqual(flows["provider-document-runtime"]["depends_on"], ["gate-and-artifact-integrity", "pdf-sandbox-build"])
        boundary = (pilot.ROOT / "scripts/provider-document-runtime-verify.ts").read_text()
        self.assertIn("timeout: 50_000, maxBuffer: 128 * 1024", boundary)
        self.assertIn('resolve("scripts/test-support/provider-documents-runtime-smoke.ts")', boundary)
        self.assertEqual(
            flows["native-unit-and-cost"]["depends_on"],
            ["gate-and-artifact-integrity", "native-resource-unit-and-cost"],
        )
        flow_order = [flow["id"] for flow in plan["flows"]]
        self.assertLess(flow_order.index("compose-configuration"), flow_order.index("migration-and-seed"))
        self.assertLess(flow_order.index("migration-and-seed"), flow_order.index("native-unit-and-cost"))
        self.assertLess(flow_order.index("native-unit-and-cost"), flow_order.index("provider-document-runtime"))
        self.assertLess(flow_order.index("migration-and-seed"), flow_order.index("provider-document-runtime"))
        self.assertLess(flow_order.index("provider-document-runtime"), flow_order.index("pdf-isolation"))
        self.assertLess(flow_order.index("browser-workflows"), flow_order.index("pdf-isolation"))
        # Workspace builds consume source files, not lint/typecheck or D1 output.
        # Their prerequisites remain independently required for gate acceptance.
        self.assertEqual(flows["build-and-entry-budget"]["depends_on"], ["gate-and-artifact-integrity"])
        required = {flow for requirement in plan["requirements"] for flow in requirement["flows"]}
        self.assertTrue({"source-quality", "migration-and-seed", "build-and-entry-budget"} <= required)
        self.assertEqual(flows["migration-and-seed"]["argv"], ["python3", "-I", "scripts/pilot_native.py", "migration-seed"])
        self.assertEqual(flows["browser-fixture-preparation"]["depends_on"], ["migration-and-seed"])
        self.assertIn("provider-document-runtime", flows["browser-workflows"]["depends_on"])
        self.assertEqual(flows["browser-workflows"]["depends_on"],
                         ["browser-fixture-preparation", "build-and-entry-budget", "provider-document-runtime", "native-resource-unit-and-cost", "source-quality"])
        # The sole Chromium PDF integration finishes before UI workers start;
        # remaining PDF kernel/scanner probes cannot add a fifth browser worker.
        self.assertNotIn("pdf-isolation", flows["browser-workflows"]["depends_on"])
        self.assertEqual(flows["source-quality"]["depends_on"], ["gate-and-artifact-integrity"])
        self.assertEqual(flows["gate-and-artifact-integrity"]["argv"], ["python3", "-I", "scripts/pilot_native.py", "preflight"])
        self.assertEqual(flows["native-unit-and-cost"]["argv"], ["python3", "-I", "scripts/pilot_native.py", "vitest-main"])
        resource = "native-resource-unit-and-cost"
        self.assertEqual(flows[resource]["depends_on"], ["gate-and-artifact-integrity"])
        expected_commands = {
            'source-quality': (['make', '-j2', 'data-scan', 'format-check', 'lint-typecheck', 'd1-migration-check'], 600),
            'compose-configuration': (['docker', 'compose', 'config', '--quiet'], 30),
            'gate-and-artifact-integrity': (['python3', '-I', 'scripts/pilot_native.py', 'preflight'], 120),
            'pdf-sandbox-build': (['make', 'pdf-sandbox-build'], 1200),
            'migration-and-seed': (['python3', '-I', 'scripts/pilot_native.py', 'migration-seed'], 300),
            'native-resource-unit-and-cost': (['python3', '-I', 'scripts/pilot_native.py', 'vitest-resource'], 390),
            'native-unit-and-cost': (['python3', '-I', 'scripts/pilot_native.py', 'vitest-main'], 1500),
            'provider-document-runtime': (['make', 'provider-document-runtime-verify'], 60),
            'browser-fixture-preparation': (['python3', '-I', 'scripts/pilot_native.py', 'browser-fixture'], 300),
            'build-and-entry-budget': (['make', 'build'], 300),
            'browser-workflows': (['python3', '-I', 'scripts/pilot_native.py', 'playwright-prepared'], 1800),
            'pdf-isolation': (['make', 'pdf-sandbox-verify'], 600),
        }
        self.assertEqual(flow_order, list(expected_commands))
        self.assertEqual({name: (flow["argv"], flow["timeout_seconds"]) for name, flow in flows.items()}, expected_commands)
        self.assertEqual(sum(flow["timeout_seconds"] for flow in flows.values()), 7200)
        registry = json.loads((pilot.ROOT / ".tugling/pilot-unit-resources.json").read_text())
        parts = native.vitest_partitions(json.loads((pilot.ROOT / ".tugling/pilot-cases.json").read_text()))
        self.assertEqual({name: len(value["vitest"]) for name, value in parts.items()},
                         {"strict": 84, "resource": 164, "remaining": 1400})
        self.assertEqual(registry["schema_version"], 1)
        self.assertEqual(len(registry["files"]), 39)
        for requirement in plan["requirements"]:
            if "native-unit-and-cost" in requirement["flows"]:
                self.assertIn(resource, requirement["flows"])
        self.assertIn(resource, next(item for item in plan["requirements"] if item["id"] == "temporary-work-ownership")["flows"])
        native.validate_preflight_dependencies(plan)
        for name in flows:
            if name == "gate-and-artifact-integrity":
                continue
            invalid = json.loads(json.dumps(plan))
            next(flow for flow in invalid["flows"] if flow["id"] == name)["depends_on"] = []
            with self.subTest(ungated=name), self.assertRaises(ValueError):
                native.validate_preflight_dependencies(invalid)
        invalid = json.loads(json.dumps(plan))
        next(flow for flow in invalid["flows"] if flow["id"] == "pdf-isolation")["depends_on"].remove("source-quality")
        with self.assertRaisesRegex(ValueError, "source-quality"):
            native.validate_preflight_dependencies(invalid)
        transitive = json.loads(json.dumps(plan))
        by_id = {flow["id"]: flow for flow in transitive["flows"]}
        by_id["compose-configuration"]["depends_on"] = ["source-quality"]
        by_id["pdf-isolation"]["depends_on"].remove("source-quality")
        by_id["pdf-isolation"]["depends_on"].append("compose-configuration")
        native.validate_preflight_dependencies(transitive)
        by_id["compose-configuration"]["depends_on"].append("compose-configuration")
        with self.assertRaisesRegex(ValueError, "cycle"):
            native.validate_preflight_dependencies(transitive)
        for name in ("native-unit-and-cost", "browser-workflows"):
            invalid = json.loads(json.dumps(plan))
            next(flow for flow in invalid["flows"] if flow["id"] == name)["depends_on"] = ["gate-and-artifact-integrity", "source-quality"]
            with self.subTest(resource_bypass=name), self.assertRaisesRegex(ValueError, "resource"):
                native.validate_preflight_dependencies(invalid)
        invalid = json.loads(json.dumps(plan))
        next(flow for flow in invalid["flows"] if flow["id"] == "browser-workflows")["depends_on"].remove("source-quality")
        with self.assertRaisesRegex(ValueError, "source-quality"):
            native.validate_preflight_dependencies(invalid)
        transitive = json.loads(json.dumps(plan))
        by_id = {flow["id"]: flow for flow in transitive["flows"]}
        by_id["compose-configuration"]["depends_on"] = [resource]
        by_id["native-unit-and-cost"]["depends_on"] = ["compose-configuration"]
        native.validate_preflight_dependencies(transitive)
        by_id["compose-configuration"]["depends_on"] = ["gate-and-artifact-integrity"]
        with self.assertRaisesRegex(ValueError, "resource"):
            native.validate_preflight_dependencies(transitive)
        invalid_graphs = [None, {}, {"flows": []}, {"flows": [None]}, {"flows": [{"id": "x", "depends_on": [1]}]}]
        invalid = json.loads(json.dumps(plan)); invalid["flows"].append(invalid["flows"][0]); invalid_graphs.append(invalid)
        for parents in (["unknown"], ["gate-and-artifact-integrity"] * 2, ["source-quality"]):
            invalid = json.loads(json.dumps(plan)); invalid["flows"][0]["depends_on"] = parents; invalid_graphs.append(invalid)
        invalid = json.loads(json.dumps(plan))
        by_id = {flow["id"]: flow for flow in invalid["flows"]}
        by_id["compose-configuration"]["depends_on"] = ["build-and-entry-budget"]
        by_id["build-and-entry-budget"]["depends_on"] = ["compose-configuration"]
        invalid_graphs.append(invalid)
        for name in ("gate-and-artifact-integrity", resource, "source-quality", "pdf-isolation", "native-unit-and-cost", "browser-workflows"):
            invalid = json.loads(json.dumps(plan)); invalid["flows"] = [flow for flow in invalid["flows"] if flow["id"] != name]; invalid_graphs.append(invalid)
        for index, invalid in enumerate(invalid_graphs):
            with self.subTest(graph=index), self.assertRaises(ValueError):
                native.validate_preflight_dependencies(invalid)
        self.assertEqual(plan["execution"]["max_parallel"], 3)
        config = json.loads((pilot.ROOT / ".tugling/pilot.json").read_text())
        self.assertEqual(config["project"]["verification_budget_seconds"], 900)
        self.assertLessEqual(
            sum(flow["timeout_seconds"] for flow in flows.values()), 7200
        )
        self.assertNotIn("pull_request:", probe)
        self.assertNotIn("merge_group:", probe)
        for duplicate in ("make check", "make e2e", "make db-verify", "make verify"):
            self.assertNotIn(duplicate, ci)
        for forbidden in ("sudo", "secrets.", "keel-deploy", "continue-on-error", "pull_request_target", "environment:"):
            self.assertNotIn(forbidden, workflow)




sampler = load("ci_sampler", "ci-resource-sampler.py")


class ResourceSamplerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.proc = Path(self.temporary.name).resolve() / "proc"
        self.repo = Path(self.temporary.name).resolve() / "repo"
        self.source = Path(self.temporary.name).resolve() / "tugling"
        self.proc.mkdir()
        self.repo.mkdir()
        self.flows = {"unit": ["python3", "-I", "scripts/pilot_native.py", "vitest"],
                      "browser": ["make", "browser"]}
        self.coordinator = ["python3", "-I", str(self.source / "plugins/tugling/scripts/project_contract.py"),
                            "--repo", str(self.repo), "--config", ".tugling/pilot.json",
                            "--source-root", str(self.source), "--source-mode", "pinned", "--json", "--run-required"]
        (self.proc / "sys/kernel").mkdir(parents=True)
        (self.proc / "sys/kernel/sched_schedstats").write_text("1\n")
        self.process(10, 1, start=100)
        self.process(20, 10, start=110, argv=self.coordinator)
        self.process(30, 20, start=120, argv=self.flows["unit"], leader=True)

    def process(self, pid, parent, *, start=130, cpu=10, delay=100, argv=None, leader=False, cwd=None):
        directory = self.proc / str(pid)
        directory.mkdir(exist_ok=True)
        fields = ["S", str(parent), str(pid if leader else 30), str(pid if leader else 30)] + ["0"] * 20
        fields[11], fields[12], fields[19] = str(cpu), "0", str(start)
        # A comm may contain spaces and closing parentheses; fields follow the final ')'.
        (directory / "stat").write_text(f"{pid} (synthetic ) task) " + " ".join(fields))
        (directory / "cmdline").write_bytes(b"\0".join(x.encode() for x in (argv or ["worker"])) + b"\0")
        (directory / "schedstat").write_text(f"50 {delay} 3\n")
        (directory / "cwd").unlink(missing_ok=True)
        (directory / "cwd").symlink_to(cwd or self.repo)

    def observer(self, **kwargs):
        return sampler.FlowSampler(self.repo, self.source, self.flows, proc=self.proc,
                                   scope_pid=10, ticks_per_second=100, **kwargs)

    def test_main_emits_flow_diagnostics_without_changing_host_fields(self):
        import io
        from contextlib import redirect_stdout
        output = io.StringIO()
        host = {"time": 1, "cpu": [0] * 8, "memory_available_mib": 123}
        with patch.object(sampler, "sample", return_value=host), patch.object(sampler.time, "sleep", side_effect=StopIteration), redirect_stdout(output):
            with self.assertRaises(StopIteration):
                sampler.main()
        record = json.loads(output.getvalue().splitlines()[0])
        self.assertEqual(record["memory_available_mib"], 123)
        self.assertIn("flow_resources", record)
        self.assertEqual(sampler.INTERVAL_SECONDS, 5)
        self.assertEqual(sampler.MAX_DURATION_SECONDS, 1800)

    def test_attributes_only_owned_flow_ancestry_and_deltas(self):
        self.process(31, 30)
        self.process(32, 31, leader=True)  # A descendant may create a new session.
        self.process(40, 20, argv=self.flows["browser"], leader=True)
        self.process(41, 40)
        self.process(50, 1, argv=self.flows["unit"], leader=True)  # Unrelated invocation.
        self.process(70, 1, argv=self.coordinator)
        self.process(71, 70, argv=self.flows["unit"], leader=True)
        self.process(60, 20, argv=self.flows["unit"], leader=True, cwd=self.source)
        self.process(61, 31, argv=self.flows["browser"], leader=True)  # Same argv within unit stays unit.
        observer = self.observer()
        first = observer.collect()
        self.assertIsNone(first["flows"]["unit"]["cpu_delta_ns"])
        for pid, parent in ((30, 20), (31, 30), (32, 31), (40, 20), (41, 40), (61, 31)):
            self.process(pid, parent, start=120 if pid == 30 else 130, cpu=20, delay=150,
                         argv=self.flows["unit"] if pid == 30 else self.flows["browser"] if pid in (40, 61) else None,
                         leader=pid in (30, 32, 40, 61))
        result = observer.collect()["flows"]
        self.assertEqual(result["unit"]["observed_processes"], 4)
        self.assertEqual(result["unit"]["cpu_delta_ns"], 400_000_000)
        self.assertEqual(result["unit"]["main_thread_runqueue_delta_ns"], 200)
        self.assertEqual(result["browser"]["cpu_delta_ns"], 200_000_000)
        self.assertNotIn("synthetic", json.dumps(result))
        self.assertNotIn(str(self.repo), json.dumps(result))

    def test_pid_reuse_scope_reuse_and_counter_decreases_never_become_activity(self):
        self.process(31, 30)
        observer = self.observer()
        observer.collect()
        self.process(31, 30, start=999, cpu=1000, delay=1000)
        self.process(30, 20, start=120, cpu=1, delay=1, argv=self.flows["unit"], leader=True)
        result = observer.collect()["flows"]["unit"]
        self.assertIsNone(result["cpu_delta_ns"])
        self.assertIsNone(result["main_thread_runqueue_delta_ns"])
        self.assertEqual(result["new_processes"], 1)
        self.assertEqual(result["lost_processes"], 1)
        self.assertEqual(result["counter_resets"], 2)
        self.process(10, 1, start=9999)
        result = observer.collect()
        self.assertEqual(result["status"], "scope-unavailable")
        self.assertIsNone(result["flows"]["unit"]["cpu_delta_ns"])

    def test_missing_inaccessible_and_disabled_counters_are_not_zero(self):
        self.process(31, 30)
        observer = self.observer()
        observer.collect()
        (self.proc / "31/stat").unlink()
        original = sampler.read_bytes
        def denied(path, limit):
            if Path(path) == self.proc / "30/schedstat":
                raise PermissionError("synthetic denial")
            return original(path, limit)
        with patch.object(sampler, "read_bytes", side_effect=denied):
            result = observer.collect()
        self.assertGreaterEqual(result["read_errors"], 2)
        self.assertEqual(result["flows"]["unit"]["lost_processes"], 1)
        self.assertEqual(result["flows"]["unit"]["cpu_delta_ns"], 0)
        self.assertIsNone(result["flows"]["unit"]["main_thread_runqueue_delta_ns"])
        (self.proc / "sys/kernel/sched_schedstats").write_text("0\n")
        result = observer.collect()
        self.assertFalse(result["schedstats_enabled"])
        self.assertIsNone(result["flows"]["unit"]["main_thread_runqueue_delta_ns"])
        (self.proc / "sys/kernel/sched_schedstats").unlink()
        self.assertIsNone(observer.collect()["schedstats_enabled"])

    def test_rejects_identity_change_during_counter_read(self):
        observer = self.observer()
        original = sampler.read_bytes
        def reused(path, limit):
            data = original(path, limit)
            if Path(path) == self.proc / "30/schedstat":
                self.process(30, 20, start=999, cpu=999, argv=self.flows["unit"], leader=True)
            return data
        with patch.object(sampler, "read_bytes", side_effect=reused):
            result = observer.collect()
        self.assertEqual(result["flows"]["unit"]["observed_processes"], 0)
        self.assertGreater(result["read_errors"], 0)

    def test_120_process_scale_and_explicit_discovery_tracking_and_byte_bounds(self):
        for pid in range(100, 220):
            self.process(pid, 30)
        observer = self.observer()
        original = sampler.read_bytes
        with patch.object(sampler, "read_bytes", wraps=original) as reads:
            first = observer.collect()
        self.assertEqual(first["flows"]["unit"]["observed_processes"], 121)
        self.assertLessEqual(reads.call_count, 385)
        self.assertLessEqual(len(json.dumps(first)), 4096)
        second = observer.collect()
        self.assertEqual(second["flows"]["unit"]["cpu_delta_processes"], 121)
        self.assertEqual(second["flows"]["unit"]["cpu_delta_ns"], 0)
        with patch.object(sampler, "MAX_TRACKED", 100):
            capped = self.observer().collect()
        self.assertTrue(capped["tracking_limited"])
        self.assertEqual(capped["flows"]["unit"]["observed_processes"], 100)
        with patch.object(sampler, "MAX_PIDS", 50):
            capped = self.observer().collect()
        self.assertTrue(capped["discovery_limited"])
        self.assertLessEqual(capped["pids_examined"], 50)
        with patch.object(sampler, "MAX_ENTRIES", 5):
            self.assertTrue(self.observer().collect()["discovery_limited"])
        (self.proc / "30/cmdline").write_bytes(b"x" * (sampler.MAX_CMD_BYTES + 1))
        self.assertEqual(self.observer().collect()["flows"]["unit"]["observed_processes"], 0)

    def test_wrong_coordinator_cycles_depth_and_parent_start_order_are_excluded(self):
        self.process(20, 10, start=110, argv=["python3", "other.py"])
        self.assertEqual(self.observer().collect()["flows"]["unit"]["observed_processes"], 0)
        self.process(20, 10, start=110, argv=self.coordinator)
        self.process(31, 32)
        self.process(32, 31)
        self.process(33, 30, start=50)  # Child predates the observed parent: PID reuse.
        result = self.observer().collect()
        self.assertEqual(result["flows"]["unit"]["observed_processes"], 1)
        with patch.object(sampler, "MAX_DEPTH", 1):
            result = self.observer().collect()
        self.assertEqual(result["flows"]["unit"]["observed_processes"], 0)
        self.assertGreater(result["ancestry_incomplete"], 0)

    def test_shared_ownership_rechecks_remain_bounded_and_invalidate_all_flows(self):
        self.process(40, 20, argv=self.flows["browser"], leader=True)
        observer = self.observer()
        original = sampler.read_stat
        counts = {}
        def inspect(proc, pid):
            counts[pid] = counts.get(pid, 0) + 1
            result = original(proc, pid)
            if pid == 20 and counts[pid] == 2:
                result["start"] += 1  # Shared coordinator reused at final validation.
            return result
        with patch.object(sampler, "read_stat", side_effect=inspect):
            result = observer.collect()
        self.assertEqual(counts[20], 2)  # Initial discovery, one shared final read.
        self.assertEqual(counts[10], 2)
        self.assertEqual(result["flows"]["unit"]["observed_processes"], 0)
        self.assertEqual(result["flows"]["browser"]["observed_processes"], 0)
        self.assertGreater(result["read_errors"], 0)

    def test_bounded_direct_reads_complete_short_reads_and_always_close(self):
        # Procfs reads can be short; the byte cap and close apply on every outcome.
        path = self.proc / "bounded-read"
        path.write_bytes(b"1 2")
        with patch.object(sampler.os, "open", return_value=42) as opened, patch.object(sampler.os, "read", side_effect=[b"1", b" 2", b""]) as reads, patch.object(sampler.os, "close") as closed:
            self.assertEqual(sampler.read_bytes(path, 8), b"1 2")
            opened.assert_called_once()
            self.assertEqual([call.args[1] for call in reads.call_args_list], [9, 8, 6])
            closed.assert_called_once_with(42)
        with patch.object(sampler.os, "open", return_value=43), patch.object(sampler.os, "read", return_value=b"1234"), patch.object(sampler.os, "close") as closed:
            with self.assertRaisesRegex(ValueError, "byte bound"):
                sampler.read_bytes(path, 3)
            closed.assert_called_once_with(43)
        with patch.object(sampler.os, "open", return_value=44), patch.object(sampler.os, "read", side_effect=PermissionError("synthetic")), patch.object(sampler.os, "close") as closed:
            with self.assertRaises(PermissionError):
                sampler.read_bytes(path, 8)
            closed.assert_called_once_with(44)
        with patch.object(sampler.os, "open", side_effect=PermissionError("synthetic")), patch.object(sampler.os, "close") as closed:
            with self.assertRaises(PermissionError):
                sampler.read_bytes(path, 8)
            closed.assert_not_called()

    def test_flow_map_validation_and_unobserved_flow_are_explicit(self):
        for invalid in ({}, {"bad/name": ["make"]}, {"unit": []}, {"unit": [1]},
                        {"unit": ["x" * 8193]}, {str(n): ["make"] for n in range(33)}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                sampler.FlowSampler(self.repo, self.source, invalid, proc=self.proc, scope_pid=10)
        result = self.observer().collect()["flows"]["browser"]
        self.assertEqual(result["observed_processes"], 0)
        self.assertIsNone(result["cpu_delta_ns"])
        self.assertIsNone(result["main_thread_runqueue_delta_ns"])


if __name__ == "__main__":
    unittest.main()
