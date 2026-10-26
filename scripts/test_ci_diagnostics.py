"""Exercise the real CI packager with synthetic growth and partial runs."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("ci_diagnostics", Path(__file__).with_name("ci-diagnostics.py"))
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


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

    def test_failure_and_cancellation_bound_120_cases_and_record_omissions(self):
        report = b'{"stats":{"unexpected":120},"errors":["synthetic failure"]}'
        self.write("pilot/playwright.json", report)
        # One incompressible MiB per case forces actual compressed-byte admission.
        payload = os.urandom(1024 * 1024)
        for index in range(120):
            base = f"pilot/browser-results/stateful-a/case-{index:03}"
            self.write(base + "/actual.png", payload)
            self.write(base + "/error-context.md", b"synthetic failure context")
            self.write(base + "/trace.zip", payload)
            self.write(base + "/synthetic-provider-profile/Default/Cookies", b"never upload profile")
            self.write(base + "/downloads/source.pdf", b"never upload download")
        for status in ("failure", "cancelled"):
            with self.subTest(status=status):
                path, contents, manifest = self.bundle(status)
                self.assertLessEqual(path.stat().st_size, 12 * 1024 * 1024)
                self.assertEqual(contents["pilot/playwright.json"], report)
                self.assertEqual(sum(name.endswith("error-context.md") for name in contents), 120)
                self.assertGreater(manifest["omitted_counts"]["bundle byte budget"], 0)
                self.assertTrue(any(name.endswith("trace.zip") for name in contents))
                self.assertTrue(any(name.endswith("actual.png") for name in contents))
                self.assertFalse(any("profile" in name or "downloads" in name for name in contents))

    def test_partial_run_and_repeated_packaging_preserve_source_and_foreign_output(self):
        foreign = self.write("ci-upload/foreign.txt", b"foreign")
        for status in ("failure", "cancelled", "success"):
            _, contents, manifest = self.bundle(status)
            self.assertEqual(set(contents), {"manifest.json"})
            self.assertEqual(manifest["included"], [])
            self.assertEqual(foreign.read_bytes(), b"foreign")

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
        report.unlink()
        output = self.local / "ci-upload/diagnostics.zip"
        self.assertFalse(output.exists())
        output.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.bundle("failure")
        self.assertEqual(target.read_bytes(), b"foreign")

    def test_cli_and_oversized_file_keep_manifest_instead_of_unbounded_upload(self):
        self.write("pilot/vitest.json", b"x" * (8 * 1024 * 1024 + 1))
        result = subprocess.run([sys.executable, "-I", str(Path(diagnostics.__file__)), "--root", str(self.root), "--status", "failure"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(json.loads(result.stdout)["path"]) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        self.assertEqual(manifest["omitted_counts"], {"file exceeds 8 MiB": 1})


if __name__ == "__main__":
    unittest.main()
