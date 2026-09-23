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
            self.assertEqual(native.native_lease_name("playwright-prepared"), "playwright")
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
            "mocked-development": {"server": "mocked", "frontend": "development", "workers": 4, "webPort": 31034, "apiPort": None},
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
            ("mocked-development", "frontend", "production"),
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

            def available_port():
                with socket.socket() as reservation:
                    reservation.bind(("127.0.0.1", 0))
                    return reservation.getsockname()[1]

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
                except BaseException:
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
            with (
                patch.object(native, "ROOT", repository),
                patch.object(native, "BROWSER_RUNTIME", runtime),
                patch.object(native, "BROWSER_SEED", prepared_seed),
                patch.object(native, "BROWSER_SEED_SEAL", prepared_seal),
                patch.object(
                    native, "browser_seed_input_digest", return_value="a" * 64
                ) as input_digest,
                patch.object(native.subprocess, "run") as run,
            ):
                native.prepare_browser_seed()
                run.assert_called_once_with(
                    ["make", "db-verify-e2e"], cwd=repository, check=True
                )
                self.assertFalse(seed.exists())
                native.validate_browser_seed_seal()

                run.reset_mock()
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
                        (runtime / lane / "seed.sqlite").read_text(), "synthetic"
                    )

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
                seed.mkdir()
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
            config.write_text("module.exports={testDir:'.',testMatch:'fixture.ts',workers:1,use:{serviceWorkers:'block'}};\n")
            imported = json.dumps(str(pilot.ROOT / "e2e/api-mocked-test.ts"))
            for path, method, success in (("legal-entities", "GET", True), ("unknown", "GET", False), ("legal-entities", "POST", False)):
                fixture.write_text(
                    f"import {{test,expect}} from {imported};\n"
                    "test('isolated API boundary',async({page})=>{"
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
        self.assertIn("native-required-${{ github.sha }}-${{ github.run_attempt }}", action)
        self.assertNotIn("make pdf-sandbox-build", workflow)
        self.assertNotIn("make pdf-sandbox-build", probe)
        self.assertEqual(flows["pdf-sandbox-build"]["argv"], ["make", "pdf-sandbox-build"])
        self.assertEqual(flows["pdf-sandbox-build"]["timeout_seconds"], 1200)
        self.assertEqual(flows["pdf-sandbox-build"]["depends_on"], [])
        self.assertEqual(
            flows["pdf-isolation"]["depends_on"],
            ["gate-and-artifact-integrity", "pdf-sandbox-build"],
        )
        self.assertEqual(
            flows["native-unit-and-cost"]["depends_on"],
            ["source-quality", "migration-and-seed", "pdf-sandbox-build"],
        )
        self.assertIn("pdf-isolation", flows["browser-workflows"]["depends_on"])
        self.assertEqual(plan["execution"]["max_parallel"], 3)
        self.assertLessEqual(
            sum(flow["timeout_seconds"] for flow in flows.values()), 7200
        )
        self.assertNotIn("pull_request:", probe)
        self.assertNotIn("merge_group:", probe)
        for duplicate in ("make check", "make e2e", "make db-verify", "make verify"):
            self.assertNotIn(duplicate, ci)
        for forbidden in ("sudo", "secrets.", "keel-deploy", "continue-on-error", "pull_request_target", "environment:"):
            self.assertNotIn(forbidden, workflow)


if __name__ == "__main__":
    unittest.main()
