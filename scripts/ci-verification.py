#!/usr/bin/env python3
"""Publish or validate the same-run required native receipt without rerunning tests."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
RECEIPT = ".tugling/local/verification/required.json"
MAX_RECEIPT_BYTES = 64 * 1024


def encode_receipt(evidence):
    raw = json.dumps(evidence, separators=(",", ":"), allow_nan=False).encode()
    if len(raw) > MAX_RECEIPT_BYTES:
        raise ValueError("CI receipt exceeds the job-output limit")
    return hashlib.sha256(raw).hexdigest() + "." + base64.b64encode(raw).decode()


def decode_receipt(value):
    if not value or len(value) > 65 + 4 * ((MAX_RECEIPT_BYTES + 2) // 3):
        raise ValueError("Missing or oversized CI receipt output")
    checksum, encoded = value.split(".", 1)
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > MAX_RECEIPT_BYTES or hashlib.sha256(raw).hexdigest() != checksum:
        raise ValueError("CI receipt output checksum mismatch")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("CI receipt must be an object")
    return result


def write_receipt(evidence):
    destination = ROOT / RECEIPT
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise ValueError("CI receipt must not follow a symlink")
    destination.write_text(json.dumps(evidence, indent=2) + "\n")


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
        write_receipt(evidence)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write("receipt=" + encode_receipt(evidence) + "\n")
    else:
        # A transport checksum is not verification. Always run the original
        # exact-revision, attempt, environment and complete-coverage gate below.
        write_receipt(decode_receipt(os.environ.get("NATIVE_RECEIPT", "")))
        evidence = check(RECEIPT)
    timing = evidence["performance"]
    lines = ["## Native verification", "",
             f"Revision: `{evidence['project_revision']}`", "",
             f"Active native time: {timing['active_seconds']:.1f}s / {timing['budget_seconds']}s budget.",
             f"Total flow work: {timing['total_flow_seconds']:.1f}s; maximum {evidence['execution_plan']['max_parallel']} concurrent flows.",
             "Queue and setup time are excluded. This job validates evidence; it does not rerun suites.",
             "", "| Flow | Start offset | Seconds |", "| --- | ---: | ---: |"]
    lines.extend(f"| {row['id']} | {row['started_offset_seconds']:.1f}s | {row['duration_seconds']:.1f} |"
                 for row in sorted(evidence["results"], key=lambda row: row["started_offset_seconds"]))
    summary = "\n".join(lines) + "\n"
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(summary)


if __name__ == "__main__":
    main()
