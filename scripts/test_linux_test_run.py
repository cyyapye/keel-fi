import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runner", Path(__file__).with_name("linux-test-run.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_success_failure_and_debug_retention(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source = base / "source"
            source.mkdir()
            subprocess.run(["git", "init", "-q", str(source)], check=True)
            (source / "fixture.txt").write_text("synthetic")
            (source / ".env.example").write_text("excluded")
            (source / "untracked.txt").write_text("excluded")
            subprocess.run(["git", "-C", str(source), "add", "fixture.txt", ".env.example"], check=True)
            root = base / "runs"
            for status, keep in [(0, False), (7, False), (0, True)]:
                command = [sys.executable, "-c", "import pathlib,sys; assert pathlib.Path('fixture.txt').read_text() == 'synthetic'; assert not pathlib.Path('.env.example').exists(); assert not pathlib.Path('untracked.txt').exists(); sys.exit(" + str(status) + ")"]
                args = ["runner", "--source", str(source)] + (["--keep"] if keep else []) + ["--"] + command
                with patch.object(runner, "RUN_ROOT", root), patch.object(sys, "argv", args), patch.object(sys, "platform", "linux"):
                    self.assertEqual(runner.main(), status)
                runs = list(root.glob("run-*"))
                self.assertEqual(len(runs), int(keep))
                if keep:
                    self.assertTrue(json.loads((runs[0] / ".owner.json").read_text())["keep"])


    def test_signal_cleans_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source = base / "source"
            source.mkdir()
            subprocess.run(["git", "init", "-q", str(source)], check=True)
            root = base / "runs"
            args = ["runner", "--source", str(source), "--", sys.executable, "-c", "import os,signal,time; os.kill(os.getppid(), signal.SIGTERM); time.sleep(30)"]
            with patch.object(runner, "RUN_ROOT", root), patch.object(sys, "argv", args), patch.object(sys, "platform", "linux"):
                with self.assertRaises(SystemExit) as raised:
                    runner.main()
            self.assertEqual(raised.exception.code, 143)
            self.assertEqual(list(root.glob("run-*")), [])


if __name__ == "__main__":
    unittest.main()
