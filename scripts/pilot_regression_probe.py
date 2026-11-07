#!/usr/bin/env python3
"""Inject one polling regression in a disposable CI checkout and require rejection."""

import json
import contextlib
import os
import re
from pathlib import Path
import subprocess
import signal
import sys

ROOT = Path(__file__).resolve().parent.parent
TARGET = "scripts/provider-agent-polling.ts"


@contextlib.contextmanager
def defer_interrupts():
    pending = []
    previous = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
    try:
        for number in previous:
            signal.signal(number, lambda signum, frame: pending.append(signum))
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)
    if pending:
        raise KeyboardInterrupt


def run_required(output, errors):
    process = None
    try:
        # Call the identical required launcher used by make, without an extra
        # make process between this supervisor and the helper's signal handler.
        with defer_interrupts():
            process = subprocess.Popen(
                [sys.executable, "-I", "scripts/tugling-pilot.py", "required"],
                cwd=ROOT, stdout=output, stderr=errors, start_new_session=True,
            )
        return process.wait(timeout=1200)
    finally:
        with defer_interrupts():
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                    raise ValueError("required helper did not finish cancellation; native cleanup is unproven")


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()


def main():
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    expected = os.environ["EXPECTED_HEAD"]
    if os.environ.get("GITHUB_ACTIONS") != "true" or git("rev-parse", "HEAD") != expected:
        raise ValueError("the regression probe requires the asserted disposable Actions checkout")
    if git("status", "--porcelain", "--untracked-files=all"):
        raise ValueError("the regression probe requires a clean source checkout")
    target = ROOT / TARGET
    original = target.read_bytes()
    before = b"PROVIDER_AGENT_IDLE_INTERVAL_MS = 60_000;"
    after = b"PROVIDER_AGENT_IDLE_INTERVAL_MS = 30_000;"
    if original.count(before) != 1:
        raise ValueError("the reviewed polling mutation no longer matches; review the probe")
    local = ROOT / ".tugling/local"
    local.mkdir(parents=True, exist_ok=True)
    report_path = local / "pilot-probe-required.json"
    log_path = local / "pilot-probe.log"
    summary = {"source_revision": expected, "target": TARGET,
               "mutation": "halve idle polling interval from 60 to 30 seconds", "state": "FAIL"}
    try:
        with defer_interrupts():
            target.write_bytes(original.replace(before, after))
            git("add", "--", TARGET)
            git("-c", "user.name=Keel CI probe", "-c", "user.email=probe@example.invalid",
                "-c", "commit.gpgsign=false", "commit", "-qm", "Synthetic polling regression probe")
            summary["regression_revision"] = git("rev-parse", "HEAD")
        with report_path.open("w") as output, log_path.open("w") as errors:
            exit_code = run_required(output, errors)
        report = json.loads(report_path.read_text())
        receipt = report["flow_verification"]["evidence"]
        failed = [flow["id"] for flow in receipt["results"] if flow["failure"] is not None]
        failed_commands = [flow["id"] for flow in receipt["results"]
                           if type(flow["exit_code"]) is int and flow["exit_code"] > 0]
        if (exit_code == 0 or receipt["state"] != "REQUIRED_FAIL"
                or receipt["project_revision"] != summary["regression_revision"]
                or not receipt["worktree_unchanged"] or failed_commands != ["gate-and-artifact-integrity"]):
            raise ValueError("the real required gate did not reject the polling regression in preflight")
        preflight_result = next(flow for flow in receipt["results"]
                                if flow["id"] == "gate-and-artifact-integrity")
        if (preflight_result["failure"] != "command-failed"
                or preflight_result["forced_cleanup"] is not False):
            raise ValueError("preflight must finish with an assertion failure, not timeout or forced cleanup")
        native = json.loads((local / "pilot/vitest-preflight.json").read_text())
        polling_cases = [case for suite in native["testResults"]
                      if suite["name"].endswith("/scripts/provider-agent-usage.test.ts")
                      for case in suite["assertionResults"]
                      if case["title"] == "keeps recovery responsive when only update checks fail all day"]
        failure = "\n".join(polling_cases[0].get("failureMessages", [])) if len(polling_cases) == 1 else ""
        exceeded = re.search(r"expected (\d+) to be less than or equal to 1440", failure)
        if (len(polling_cases) != 1 or polling_cases[0]["status"] != "failed"
                or not exceeded or int(exceeded[1]) <= 1_440):
            raise ValueError("the rejection does not prove the intended reconnect-check budget violation")
        summary.update(state="EXPECTED_REGRESSION_REJECTED", failed_flows=failed,
                       reconnect_checks=int(exceeded[1]), reconnect_check_limit=1_440,
                       required_receipt=report["flow_verification"]["path"])
    finally:
        # Restore only the exact source this probe owns, then return to its input
        # revision. Any unrelated native tracked mutation makes switch fail closed.
        with defer_interrupts():
            target.write_bytes(original)
            git("add", "--", TARGET)
            git("switch", "--detach", expected)
            summary["restored_revision"] = git("rev-parse", "HEAD")
            summary["restored_clean"] = not git("status", "--porcelain", "--untracked-files=all")
            (local / "pilot-probe-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    if not summary["restored_clean"]:
        raise ValueError("the disposable probe checkout did not restore cleanly")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        sys.exit(f"Polling regression probe: {error}")
