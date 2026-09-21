"""Synthetic native-runner and pre-execution source boundary holdouts."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
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
        for name in ("TEST_ARGS", "E2E_ARGS", "MAKEFLAGS", "PNPM", "NODE_OPTIONS", "VITEST_MAX_THREADS", "PW_TEST_GREP", "PLAYWRIGHT_JSON_OUTPUT_FILE"):
            with self.subTest(name=name), patch.dict(os.environ, {name: "narrowed"}):
                with self.assertRaisesRegex(ValueError, name):
                    pilot.require_unfiltered_environment()

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
        self.assertIn("ref: ${{ github.sha }}", workflow)
        self.assertIn('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"', workflow)
        self.assertIn("runs-on: [self-hosted, Linux, X64, keel-ci]", workflow)
        self.assertEqual(workflow.count("make pilot-verify"), 1)
        self.assertIn("scripts/ci-verification.py publish", workflow)
        self.assertEqual(ci.count("needs: native"), 3)
        self.assertEqual(ci.count('test "$NATIVE_RESULT" = success'), 3)
        self.assertEqual(ci.count("./keel/.github/actions/verify-native-receipt"), 3)
        self.assertIn("uses: ./.github/workflows/native-verification.yml", post_merge)
        self.assertIn("scripts/ci-verification.py check", action)
        self.assertIn("native-required-${{ github.sha }}-${{ github.run_attempt }}", action)
        self.assertNotIn("pull_request:", probe)
        self.assertNotIn("merge_group:", probe)
        for duplicate in ("make check", "make e2e", "make db-verify", "make verify"):
            self.assertNotIn(duplicate, ci)
        for forbidden in ("sudo", "secrets.", "keel-deploy", "continue-on-error", "pull_request_target", "environment:"):
            self.assertNotIn(forbidden, workflow)


if __name__ == "__main__":
    unittest.main()
