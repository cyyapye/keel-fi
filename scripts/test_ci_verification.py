"""Exercise receipt transport without weakening the existing native verifier."""
import importlib.util
import json
import os
import runpy
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ci_verification", Path(__file__).with_name("ci-verification.py"))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class ReceiptTransportTests(unittest.TestCase):
    def test_round_trip_preserves_every_field_and_has_no_output_delimiters(self):
        receipt = {"project_revision": "a" * 40, "results": [{"id": "synthetic-α", "log": "one\ntwo"}],
                   "attempt": "2", "status": "REQUIRED_PASS"}
        encoded = ci.encode_receipt(receipt)
        self.assertNotIn("\n", encoded)
        self.assertEqual(ci.decode_receipt(encoded), receipt)

    def test_missing_malformed_tampered_and_oversized_outputs_fail(self):
        valid = ci.encode_receipt({"synthetic": True})
        for value in ["", "bad", "0" * 64 + valid[64:], valid + "!", "x" * 100000]:
            with self.subTest(value=value[:10]), self.assertRaises((ValueError, TypeError)):
                ci.decode_receipt(value)
        with self.assertRaisesRegex(ValueError, "limit"):
            ci.encode_receipt({"too_large": "x" * ci.MAX_RECEIPT_BYTES})

    def test_received_receipt_still_runs_original_gate_and_failure_propagates(self):
        # Correct checksum and claimed success must not bypass actual evidence validation.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(ci, "ROOT", root), patch.dict(os.environ, {
                "NATIVE_RECEIPT": ci.encode_receipt({"status": "REQUIRED_PASS", "project_revision": "wrong"})
            }), patch("sys.argv", ["ci-verification.py", "check"]), patch.object(
                ci, "check", side_effect=ValueError("revision/attempt/coverage rejected")
            ) as verifier:
                with self.assertRaisesRegex(ValueError, "revision/attempt/coverage"):
                    ci.main()
                verifier.assert_called_once_with(ci.RECEIPT)
                self.assertEqual(json.loads((root / ci.RECEIPT).read_text())["project_revision"], "wrong")

    def test_empty_output_cannot_reuse_previous_run_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(ci, "ROOT", Path(directory)), patch.dict(os.environ, {"NATIVE_RECEIPT": ""}), \
                 patch("sys.argv", ["ci-verification.py", "check"]), patch.object(ci, "check") as verifier:
                ci.write_receipt({"status": "REQUIRED_PASS", "old": True})
                with self.assertRaisesRegex(ValueError, "Missing"):
                    ci.main()
                verifier.assert_not_called()


class DraftSelectionTests(unittest.TestCase):
    def test_requires_complete_git_history_and_reviewed_file_ownership(self):
        checks = runpy.run_path(str(Path(__file__).with_name("ci-draft-checks.py")))
        selector_spec = importlib.util.spec_from_file_location(
            "ci_draft_plan", Path(__file__).with_name("ci-draft-plan.py"))
        selector = importlib.util.module_from_spec(selector_spec)
        selector_spec.loader.exec_module(selector)
        owner = "packages/database/src/exposures.test.ts"
        doc = "docs/engineering/ci-performance.md"

        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            def git(*args):
                return subprocess.check_output(
                    ["git", "-c", "user.name=Synthetic Contributor", "-c", "user.email=unit@example.invalid",
                     "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args],
                    cwd=root, text=True, stderr=subprocess.DEVNULL).strip()

            def change(path, text):
                target = root / path
                target.parent.mkdir(exist_ok=True, parents=True)
                target.write_text(text)

            def commit():
                git("add", "-A")
                git("commit", "-qm", "synthetic change")
                return git("rev-parse", "HEAD")

            git("init", "-q", "-b", "base")
            change(owner, "original synthetic case")
            change(doc, "original synthetic notes")
            change(".tugling/pilot-cases.json",
                   json.dumps({"schema_version": 1, "vitest": [owner + " :: synthetic"]}))
            initial = commit()
            git("switch", "-qc", "topic")
            change(doc, "updated notes")
            docs_head = commit()
            change(owner, "updated case")
            test_head = commit()
            git("switch", "-q", "base")
            change("packages/database/migrations/new.sql", "base-only input")
            base = commit()

            # The planner reads git objects from the repository, not working-tree contents.
            previous = os.getcwd()
            try:
                os.chdir(root)
                result = selector.plan(base, test_head)
                self.assertEqual((result["profile"], result["merge_base"], result["changed_count"],
                                  result["test_files"]), ("test-files", initial, 2, [owner]))
                self.assertEqual(selector.plan(base, docs_head)["profile"], "docs")
                self.assertEqual(selector.plan("HEAD", test_head)["profile"], "full")
                self.assertEqual(selector.plan(base, "f" * 40)["profile"], "full")
                self.assertEqual(selector.plan(initial, base)["profile"], "full")

                header = b":100644 100644 " + b"a" * 40 + b" " + b"b" * 40 + b" M\0"
                regular = header + doc.encode() + b"\0"
                for diff in [regular + header + b".github/workflows/ci.yml\0",
                             regular + header + b"pnpm-lock.yaml\0", regular + header + b"-odd\nfile\0",
                             regular.replace(b" M\0", b" D\0"), regular.replace(b"100644", b"120000"),
                             regular + header + b"docs/new", regular * 351]:
                    with self.subTest(diff=diff[-70:]):
                        _, files, reason = selector.reviewed_changes(diff)
                        self.assertEqual(files, {})
                        self.assertIsNotNone(reason)
                # The PR's cumulative diff is eligible, including when main has advanced.
                git("merge", "--no-ff", "--no-edit", test_head)
                merge = git("rev-parse", "HEAD")
                self.assertEqual(checks["select_merge"](vars(selector), base, test_head, merge), result)
                with self.assertRaisesRegex(ValueError, "event SHA"):
                    checks["select_merge"](vars(selector), base, test_head, test_head)
                # A merge tree with the correct parents but extra runtime changes requires FULL.
                change("runtime.ts", "unexpected effective change")
                git("add", "runtime.ts")
                invalid = git("commit-tree", git("write-tree"), "-p", base, "-p", test_head, "-m", "untrusted tree")
                git("switch", "-q", "--detach", invalid)
                effective = checks["select_merge"](vars(selector), base, test_head, invalid)
                self.assertEqual((effective["profile"], effective["reason"]), ("full", "effective-merge-differs"))
            finally:
                os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
