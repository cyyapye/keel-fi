"""Exercise the real CI packager with synthetic growth and partial runs."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("ci_diagnostics", Path(__file__).with_name("ci-diagnostics.py"))
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)
sampler_spec = importlib.util.spec_from_file_location("ci_resource_sampler", Path(__file__).with_name("ci-resource-sampler.py"))
sampler = importlib.util.module_from_spec(sampler_spec)
sampler_spec.loader.exec_module(sampler)


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.local = self.root / ".tugling/local"
        self.local.mkdir(parents=True)

    def write(self, name, data):
        path = self.local / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def bundle(self, status):
        path = diagnostics.prepare(self.root, status)
        with zipfile.ZipFile(path) as archive:
            contents = {name: archive.read(name) for name in archive.namelist()}
        return path, contents, json.loads(contents["manifest.json"])

    def test_success_keeps_exact_reports_and_excludes_browser_and_foreign_files(self):
        report = b'{"stats":{"unexpected":0},"suites":[]}'
        self.write("pilot/playwright-stateful-a.json", report)
        self.write("verification/managed-v1/run-synthetic.json", b'{"status":"PASS"}')
        image = self.write("pilot/browser-results/stateful-a/test/actual.png", b"synthetic PNG")
        self.write("corrections.jsonl", b"local-only correction")
        self.write("unrelated.json", b"foreign")
        path, contents, manifest = self.bundle("success")
        self.assertEqual(contents["pilot/playwright-stateful-a.json"], report)
        self.assertEqual(set(contents), {"pilot/playwright-stateful-a.json", "verification/managed-v1/run-synthetic.json", "manifest.json"})
        self.assertLessEqual(path.stat().st_size, 1024 * 1024)
        self.assertEqual(manifest["status"], "success")
        self.assertTrue(image.exists())
        phases = ("vitest-preflight.json", "vitest-preflight-proof.json", "vitest-preflight-used.json", "vitest-main.json")
        for name in phases:
            self.write(f"pilot/{name}", b'{"synthetic":"phase"}')
        foreign = self.write("pilot/vitest-preflight-unrelated.json", b'{"foreign":"untouched"}')
        _, contents, _ = self.bundle("failure")
        self.assertTrue(all(f"pilot/{name}" in contents for name in phases))
        self.assertNotIn(f"pilot/{foreign.name}", contents)
        self.assertEqual(foreign.read_bytes(), b'{"foreign":"untouched"}')
        (self.root / ".tugling/pilot-verification.json").write_text(json.dumps({
            "flows": [{"id": "unit"}, {"id": "browser"}],
        }))
        samples = [
            {"time": 100, "cpu_busy_percent": 25, "iowait_percent": 2,
             "logical_cpu_count": 6, "memory_total_mib": 12000, "swap_total_mib": 4000,
             "memory_available_mib": 4000, "swap_used_mib": 10,
             "pressure": {"cpu": {"some": {"avg10": "40.5"}}},
             "flow_resources": {"status": "sampled-lower-bound", "read_errors": 1,
                                "schedstats_enabled": False,
                                "flows": {"unit": {"cpu_delta_ns": None, "observed_processes": 2,
                                                    "process_rss_bytes_sum": 4 * 1024 * 1024}}}},
            {"time": 105, "cpu_busy_percent": 75, "iowait_percent": 1,
             "logical_cpu_count": 4, "memory_total_mib": 11000, "swap_total_mib": 3000,
             "memory_available_mib": 3000, "swap_used_mib": 20,
             "pressure": {"cpu": {"some": {"avg10": "60.5"}}},
             "flow_resources": {"status": "sampled-lower-bound", "read_errors": 2,
                                "tracking_limited": True, "schedstats_enabled": True,
                                "flows": {"unit": {"cpu_delta_ns": 2_000_000_000,
                                                    "main_thread_runqueue_delta_ns": 500_000_000,
                                                    "observed_processes": 3,
                                                    "process_rss_bytes_sum": 6 * 1024 * 1024},
                                          "foreign-secret": {"cpu_delta_ns": 99}}}},
        ]
        self.write("ci-resources.jsonl", b"\n".join(json.dumps(row).encode() for row in samples))
        evidence = {"state": "FLOWS_FAIL", "performance": {"active_seconds": 900.1,
                    "budget_seconds": 900, "within_budget": False},
                    "results": [{"id": "unit", "started_offset_seconds": 4,
                                 "duration_seconds": 50, "exit_code": -15, "failure": "private-secret"},
                                {"id": "foreign-secret", "argv": ["private-secret"]}]}
        self.write("pilot-required.json", json.dumps({"flow_verification": {
            "evidence": evidence, "path": "https://private-secret"}, "unknown": "private-secret"}).encode())
        summary = diagnostics.diagnostic_summary(self.root)
        resources = summary["resources"]
        self.assertEqual(resources["samples"], 2)
        self.assertEqual(resources["sample_time_span_seconds"], 5)
        self.assertEqual(resources["host"], {"cpu_busy_percent": 75, "iowait_percent": 2,
            "logical_cpu_count": 4, "memory_total_mib": 11000, "swap_total_mib": 3000,
            "memory_available_mib": 3000, "swap_used_mib": 20, "load_average": None,
            "cpu_busy_percent_includes_steal": True,
            "cpu_tick_summary": {"scope": "host-wide", "aggregation": "weighted-tick-deltas",
                "valid_intervals": 0, "rejected_intervals": 1, "covered_ticks": None,
                "executing_percent": None, "steal_percent": None, "iowait_percent": None, "idle_percent": None},
            "pressure_some_avg10_peak": {"cpu": 60.5, "memory": None, "io": None}})
        self.assertEqual(resources["flows"], [
            {"id": "browser", "cpu_seconds_observed": None,
             "main_thread_runqueue_seconds_observed": None, "max_observed_processes": None,
             "max_observed_process_rss_sum_mib": None},
            {"id": "unit", "cpu_seconds_observed": 2,
             "main_thread_runqueue_seconds_observed": 0.5, "max_observed_processes": 3,
             "max_observed_process_rss_sum_mib": 6},
        ])
        self.assertEqual(resources["flow_rss_measurement"], {
            "aggregation": "peak-of-observed-process-rss-sums", "shared_pages_may_repeat": True,
            "excludes_processes_outside_verified_flow_tree": True})
        self.assertEqual((resources["read_errors"], resources["limited_samples"],
                          resources["schedstats_enabled_samples"]), (3, 1, 1))
        self.assertEqual(summary["native"], {"status": "available-unverified", "state": "FLOWS_FAIL",
            "active_seconds": 900.1, "budget_seconds": 900, "within_budget": False,
            "invalid_flow_rows": 1, "flows": [{"id": "unit", "started_offset_seconds": 4,
                "duration_seconds": 50, "exit_code": -15, "failure_present": True}]})
        self.assertNotIn("private-secret", json.dumps(summary))
        self.assertNotIn("foreign-secret", json.dumps(summary))

        def cpu_summary(rows):
            self.write("ci-resources.jsonl", b"\n".join(json.dumps(row).encode() for row in rows))
            return diagnostics.resource_summary(self.root, set())["host"]["cpu_tick_summary"]

        weighted = cpu_summary([
            {"time": 100, "cpu": [0] * 8},
            {"time": 105, "cpu": [10, 0, 0, 0, 0, 0, 0, 0]},
            {"time": 120, "cpu": [10, 0, 0, 180, 0, 0, 0, 10]},
        ])
        self.assertEqual(weighted, {"scope": "host-wide", "aggregation": "weighted-tick-deltas",
            "valid_intervals": 2, "rejected_intervals": 0, "covered_ticks": 200,
            "executing_percent": 5, "steal_percent": 5, "iowait_percent": 0, "idle_percent": 90})
        for rows in (
            [{"time": 1, "cpu": [10] * 8}, {"time": 2, "cpu": [5] * 8},
             {"time": 3, "cpu": [6] * 8}],
            [{"time": 2, "cpu": [10] * 8}, {"time": 1, "cpu": [20] * 8},
             {"time": 3, "cpu": [21] * 8}],
        ):
            with self.subTest(reset=rows):
                reset = cpu_summary(rows)
                self.assertEqual((reset["valid_intervals"], reset["rejected_intervals"], reset["covered_ticks"]),
                                 (1, 1, 8))
                self.assertEqual([reset[f"{name}_percent"] for name in ("executing", "steal", "iowait", "idle")],
                                 [62.5, 12.5, 12.5, 12.5])
        for invalid_cpu in (None, [], [0] * 7, [0] * 9,
                            *([value] + [0] * 7 for value in (True, -1, 1.0, "1", 10**19))):
            with self.subTest(invalid_cpu=invalid_cpu):
                absent = cpu_summary([{"time": 1, "cpu": [0] * 8},
                                      {"time": 2, "cpu": invalid_cpu},
                                      {"time": 3, "cpu": [20] * 8}])
                self.assertEqual((absent["valid_intervals"], absent["rejected_intervals"]), (0, 2))
                self.assertIsNone(absent["covered_ticks"])
                self.assertTrue(all(absent[f"{name}_percent"] is None
                                    for name in ("executing", "steal", "iowait", "idle")))
        for rows in (
            [{"time": 1, "cpu": [0] * 8}, {"time": 1, "cpu": [10] * 8}],
            [{"time": 1, "cpu": [10] * 8}, {"time": 2, "cpu": [10] * 8}],
            [{"time": 1, "cpu": [0] * 8}, {"time": "bad", "cpu": [10] * 8},
             {"time": 3, "cpu": [20] * 8}],
            [{"time": 1, "cpu": [0] * 8}, None, {"time": 3, "cpu": [20] * 8}],
        ):
            with self.subTest(invalid_interval=rows):
                absent = cpu_summary(rows)
                self.assertEqual(absent["valid_intervals"], 0)
                self.assertEqual(absent["rejected_intervals"], len(rows) - 1)
                self.assertIsNone(absent["covered_ticks"])
        self.write("ci-resources.jsonl", json.dumps({"time": 1, "cpu": [0] * 8}).encode()
                   + b"\ninvalid\n" + json.dumps({"time": 3, "cpu": [20] * 8}).encode())
        gap = diagnostics.resource_summary(self.root, set())["host"]["cpu_tick_summary"]
        self.assertEqual((gap["valid_intervals"], gap["rejected_intervals"], gap["covered_ticks"]), (0, 2, None))

        proc = self.root / "proc"
        (proc / "sys/kernel").mkdir(parents=True)
        (proc / "sys/kernel/sched_schedstats").write_text("0\n")
        def process(pid, parent, group, session, rss, command=()):
            directory = proc / str(pid)
            directory.mkdir(exist_ok=True)
            fields = ["0"] * 24
            fields[0] = "S"
            for index, value in ((1, parent), (2, group), (3, session), (11, 7), (12, 3), (19, pid), (21, rss)):
                fields[index] = str(value)
            if rss is None:
                fields = fields[:21]
            (directory / "stat").write_text(f"{pid} (synthetic process) " + " ".join(fields))
            (directory / "cmdline").write_bytes(b"\0".join(item.encode() for item in command) + b"\0")
        process(100, 1, 90, 90, 1000, ("python3", "wrapper"))
        with patch.object(sampler.os, "sysconf", return_value=4096) as page_query:
            observed = sampler.FlowSampler(self.root, self.root / "source", {"unit": ["make", "test"]},
                                           proc=proc, scope_pid=100, ticks_per_second=100)
        page_query.assert_called_once_with("SC_PAGE_SIZE")
        process(200, 100, 200, 200, 1000, ("python3", *[item.decode() for item in observed.coordinator_args]))
        process(300, 200, 300, 300, 3, ("make", "test"))
        process(301, 300, 300, 300, 2)
        process(400, 100, 400, 400, 10**9, ("make", "test"))
        (proc / "300/cwd").symlink_to(self.root)
        read_bytes = sampler.read_bytes
        reads = []
        def recorded_read(path, limit):
            reads.append((str(path), limit))
            return read_bytes(path, limit)
        with patch.object(sampler, "read_bytes", side_effect=recorded_read):
            first = observed.collect()
        self.assertEqual(first["flows"]["unit"]["observed_processes"], 2)
        self.assertEqual(first["flows"]["unit"]["process_rss_bytes_sum"], 5 * 4096)
        self.assertTrue(all(path.startswith(str(proc) + "/") and limit in (16, 4096, sampler.MAX_CMD_BYTES)
                            for path, limit in reads))
        self.assertLessEqual(len(reads), 15)
        for rss in (None, "invalid", -1, 2**64):
            with self.subTest(rss=rss):
                process(301, 300, 300, 300, rss)
                current = observed.collect()
                self.assertEqual(current["flows"]["unit"]["observed_processes"], 2)
                self.assertIsNone(current["flows"]["unit"]["process_rss_bytes_sum"])
        process(300, 200, 300, 300, 0, ("make", "test"))
        process(301, 300, 300, 300, 0)
        self.assertEqual(observed.collect()["flows"]["unit"]["process_rss_bytes_sum"], 0)
        process(300, 200, 300, 300, 3, ("make", "foreign"))
        self.assertIsNone(observed.collect()["flows"]["unit"]["process_rss_bytes_sum"])

        host_inputs = {
            "/proc/stat": "cpu 1 2 3 4 5 6 7 8\ncpu0 1 2 3\ncpu1 1 2 3\n",
            "/proc/meminfo": "MemTotal: 12288 kB\nMemAvailable: 4096 kB\nSwapTotal: 2048 kB\nSwapFree: 1024 kB\n",
            **{f"/proc/pressure/{kind}": "some avg10=0\n" for kind in ("cpu", "memory", "io")},
        }
        host_reads = []
        def host_read(path):
            host_reads.append(str(path))
            return host_inputs[str(path)]
        with patch.object(sampler.Path, "read_text", host_read):
            host = sampler.sample()
        self.assertEqual((host["logical_cpu_count"], host["memory_total_mib"], host["swap_total_mib"]),
                         (2, 12, 2))
        self.assertCountEqual(host_reads, host_inputs)

    def test_failure_and_cancellation_bound_120_cases_and_record_omissions(self):
        report = b'{"stats":{"unexpected":120},"errors":["synthetic failure"]}'
        self.write("pilot/playwright.json", report)
        mib = 1024 * 1024
        noise = hashlib.shake_256(b"synthetic diagnostics").digest(1488 * 1024)
        small = noise[:32 * 1024]
        for index in range(120):
            base = f"pilot/browser-results/stateful-a/case-{index:03}"
            image = noise[:mib] if index < 10 else small
            if index == 0:
                # The admitted inputs must exceed the cap before compression.
                image += bytes(2 * mib)
            self.write(base + "/actual.png", image)
            self.write(base + "/error-context.md", b"synthetic failure context")
            self.write(base + "/trace.zip", noise if index == 0 else small)
            self.write(base + "/synthetic-provider-profile/Default/Cookies", b"never upload profile")
            self.write(base + "/downloads/source.pdf", b"never upload download")
        for status in ("failure", "cancelled"):
            with self.subTest(status=status):
                path, contents, manifest = self.bundle(status)
                self.assertEqual(manifest["limit_bytes"], 12 * mib)
                self.assertLessEqual(path.stat().st_size, 12 * mib)
                self.assertEqual(contents["pilot/playwright.json"], report)
                self.assertEqual(sum(name.endswith("error-context.md") for name in contents), 120)
                self.assertGreater(sum(len(data) for name, data in contents.items() if name != "manifest.json"), 12 * mib)
                self.assertGreater(manifest["omitted_counts"]["bundle byte budget"], 200)
                self.assertEqual(len(manifest["omitted_sample"]), 200)
                self.assertIn("pilot/browser-results/stateful-a/case-000/trace.zip", contents)
                self.assertTrue(any(name.endswith("actual.png") for name in contents))
                self.assertFalse(any("profile" in name or "downloads" in name for name in contents))

    def test_partial_run_and_repeated_packaging_preserve_source_and_foreign_output(self):
        foreign = self.write("ci-upload/foreign.txt", b"foreign")
        for status in ("failure", "cancelled", "success"):
            _, contents, manifest = self.bundle(status)
            self.assertEqual(set(contents), {"manifest.json"})
            self.assertEqual(manifest["included"], [])
            self.assertEqual(foreign.read_bytes(), b"foreign")
        summary = diagnostics.diagnostic_summary(self.root)
        self.assertEqual(summary["resources"], {"status": "missing"})
        self.assertEqual(summary["native"], {"status": "missing"})
        self.write("ci-resources.jsonl", b'{"time":1,"unknown":"private-secret"}\ninvalid')
        summary = diagnostics.diagnostic_summary(self.root)
        self.assertEqual(summary["resources"]["status"], "partial")
        self.assertEqual(summary["resources"]["invalid_samples"], 1)
        self.assertIsNone(summary["resources"]["host"]["cpu_busy_percent"])
        self.assertIsNone(summary["resources"]["read_errors"])
        self.assertNotIn("private-secret", json.dumps(summary))
        for data in (b"x" * (diagnostics.SUMMARY_BYTES + 1),
                     b"x" * (diagnostics.SUMMARY_LINE_BYTES + 1),
                     b"{}\n" * (diagnostics.SUMMARY_LINES + 1)):
            self.write("ci-resources.jsonl", data)
            self.assertIn(diagnostics.diagnostic_summary(self.root)["resources"]["status"],
                          ("invalid", "limit-exceeded"))
        self.write("ci-resources.jsonl", b'{"time":1,"cpu_busy_percent":NaN,"swap_used_mib":1e300}')
        summary = diagnostics.diagnostic_summary(self.root)
        self.assertIsNone(summary["resources"]["host"]["cpu_busy_percent"])
        self.assertIsNone(summary["resources"]["host"]["swap_used_mib"])
        for invalid in (None, True, -1, "1", 1e300, float("nan")):
            with self.subTest(invalid_resource=invalid):
                self.write("ci-resources.jsonl", json.dumps({"time": 1,
                    "logical_cpu_count": invalid, "memory_total_mib": invalid,
                    "swap_total_mib": invalid,
                    "flow_resources": {"status": "sampled-lower-bound", "flows": {
                        "unit": {"observed_processes": 1, "process_rss_bytes_sum": invalid}}}}).encode())
                missing = diagnostics.resource_summary(self.root, {"unit"})
                self.assertTrue(all(missing["host"][key] is None for key in (
                    "logical_cpu_count", "memory_total_mib", "swap_total_mib")))
                self.assertIsNone(missing["flows"][0]["max_observed_process_rss_sum_mib"])
        for count, rss, expected in ((None, 10, None), (0, 10, None), (1, None, None), (1, 0, 0)):
            self.write("ci-resources.jsonl", json.dumps({"time": 1,
                "flow_resources": {"status": "sampled-lower-bound", "flows": {
                    "unit": {"observed_processes": count, "process_rss_bytes_sum": rss}}}}).encode())
            self.assertEqual(diagnostics.resource_summary(self.root, {"unit"})["flows"][0][
                "max_observed_process_rss_sum_mib"], expected)
        self.write("ci-resources.jsonl", b'{"time":1,"logical_cpu_count":1.5,"memory_total_mib":0,"swap_total_mib":0}')
        capacities = diagnostics.resource_summary(self.root, set())["host"]
        self.assertIsNone(capacities["logical_cpu_count"])
        self.assertIsNone(capacities["memory_total_mib"])
        self.assertEqual(capacities["swap_total_mib"], 0)
        self.write("verification/required.json", json.dumps({"results": [{"id": ["private-secret"]}]}).encode())
        self.assertNotIn("private-secret", json.dumps(diagnostics.diagnostic_summary(self.root)))
        self.write("verification/required.json", b'{"state":"REQUIRED_PASS"}')
        self.assertEqual(diagnostics.diagnostic_summary(self.root)["native"], {"status": "missing"})
        self.write("pilot-required.json", b'{"flow_verification":{"state":"FLOWS_FAIL"}}')
        self.assertEqual(diagnostics.diagnostic_summary(self.root)["native"],
                         {"status": "missing-current-evidence"})
        (self.root / ".tugling/pilot-verification.json").write_text('{"flows":[{"id":"unit"}]}')
        self.write("verification/managed-v1/current.json", json.dumps({"state": "FLOWS_FAIL",
            "performance": {"active_seconds": 900.2, "budget_seconds": 900, "within_budget": False},
            "results": [{"id": "unit", "started_offset_seconds": 3,
                         "duration_seconds": 897.2, "exit_code": -15, "failure": "private-secret"}]}).encode())
        wrapper = {"flow_verification": {"state": "FLOWS_FAIL",
                   "path": ".tugling/local/verification/managed-v1/current.json"}}
        self.write("pilot-required.json", json.dumps(wrapper).encode())
        current = diagnostics.diagnostic_summary(self.root)["native"]
        self.assertEqual((current["state"], current["active_seconds"], current["within_budget"]),
                         ("FLOWS_FAIL", 900.2, False))
        self.assertNotIn("private-secret", json.dumps(current))
        for name in (".tugling/local/verification/required.json", "../private-secret.json",
                     "/private-secret.json", "https://private-secret", ".tugling/local/verification/managed-v1/../current.json"):
            wrapper["flow_verification"]["path"] = name
            self.write("pilot-required.json", json.dumps(wrapper).encode())
            self.assertEqual(diagnostics.diagnostic_summary(self.root)["native"],
                             {"status": "missing-current-evidence"})
        nested = b"[" * 2000 + b"0" + b"]" * 2000
        self.write("pilot-required.json", nested)
        self.write("ci-resources.jsonl", nested)
        self.assertEqual(diagnostics.diagnostic_summary(self.root)["native"], {"status": "invalid"})
        self.assertEqual(diagnostics.diagnostic_summary(self.root)["resources"]["status"], "invalid")
        with patch.object(diagnostics.json, "loads", side_effect=RecursionError):
            summary = diagnostics.diagnostic_summary(self.root)
            self.assertEqual(summary["native"], {"status": "invalid"})
            self.assertEqual(summary["resources"]["status"], "invalid")

    def test_rejects_symlinks_and_hardlinks_without_touching_target(self):
        target = self.root / "foreign"
        target.write_bytes(b"foreign")
        report = self.local / "pilot-required.json"
        report.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.bundle("failure")
        report.unlink()
        os.link(target, report)
        with self.assertRaisesRegex(ValueError, "one link"):
            self.bundle("failure")
        with self.assertRaises(ValueError):
            diagnostics.summary_input(self.root, report)
        report.unlink()
        output = self.local / "ci-upload/diagnostics.zip"
        self.assertFalse(output.exists())
        output.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.bundle("failure")
        self.assertEqual(target.read_bytes(), b"foreign")
        report.symlink_to(target)
        with self.assertRaises(ValueError):
            diagnostics.summary_input(self.root, report)
        report.unlink(missing_ok=True)
        report.write_bytes(b"{}")
        with patch.object(diagnostics, "regular_file", side_effect=lambda *_: report.write_bytes(b"x" * 65)):
            with self.assertRaisesRegex(ValueError, "byte bound"):
                diagnostics.summary_input(self.root, report, 64)
        def replace_with_fifo(*_):
            report.unlink()
            os.mkfifo(report)
        with patch.object(diagnostics, "regular_file", side_effect=replace_with_fifo):
            with self.assertRaisesRegex(ValueError, "changed during acquisition"):
                diagnostics.summary_input(self.root, report, 64)

    def test_cli_and_oversized_file_keep_manifest_instead_of_unbounded_upload(self):
        self.write("pilot/vitest.json", b"x" * (8 * 1024 * 1024 + 1))
        result = subprocess.run([sys.executable, "-I", str(Path(diagnostics.__file__)), "--root", str(self.root), "--status", "failure"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(json.loads(result.stdout)["path"]) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        self.assertEqual(manifest["omitted_counts"], {"file exceeds 8 MiB": 1})
        result_data = json.loads(result.stdout)
        self.assertEqual(result_data["summary"]["schema_version"], 1)
        self.assertLessEqual(len(json.dumps(result_data["summary"]).encode()), diagnostics.SUMMARY_OUTPUT_BYTES)
        with patch.object(diagnostics, "SUMMARY_OUTPUT_BYTES", 64):
            summary = diagnostics.diagnostic_summary(self.root)
            self.assertEqual(summary, {"schema_version": 1, "status": "output-limit-exceeded"})
            self.assertLessEqual(len(json.dumps(summary).encode()), 64)


if __name__ == "__main__":
    unittest.main()
