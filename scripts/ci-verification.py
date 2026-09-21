#!/usr/bin/env python3
"""Publish or validate the same-run required native receipt without rerunning tests."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
RECEIPT = ".tugling/local/verification/required.json"


def check(relative):
    result = subprocess.run(
        [sys.executable, "-I", "scripts/tugling-pilot.py", "evidence", relative],
        cwd=ROOT, text=True, capture_output=True, check=True,
    )
    report = json.loads(result.stdout)
    if report["status"] != "PASS" or report["flow_verification"]["state"] != "REQUIRED_PASS":
        raise ValueError("complete native evidence did not pass")
    return report["flow_verification"]["evidence"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("publish", "check"))
    args = parser.parse_args()
    if args.mode == "publish":
        report = json.loads((ROOT / ".tugling/local/pilot-required.json").read_text())
        relative = report["flow_verification"]["path"]
        evidence = check(relative)
        destination = ROOT / RECEIPT
        if destination.is_symlink():
            raise ValueError("CI receipt must not follow a symlink")
        destination.write_text(json.dumps(evidence, indent=2) + "\n")
    else:
        evidence = check(RECEIPT)
    timing = evidence["performance"]
    lines = ["## Native verification", "",
             f"Revision: `{evidence['project_revision']}`", "",
             f"Active native time: {timing['active_seconds']:.1f}s / {timing['budget_seconds']}s budget.",
             "Queue and setup time are excluded. This job validates evidence; it does not rerun suites.",
             "", "| Flow | Seconds |", "| --- | ---: |"]
    lines.extend(f"| {row['id']} | {row['duration_seconds']:.1f} |" for row in timing["slowest_flows"])
    summary = "\n".join(lines) + "\n"
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(summary)


if __name__ == "__main__":
    main()
