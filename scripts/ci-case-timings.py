#!/usr/bin/env python3
"""Decode a completed native CI run log to a duration-ranked CSV on stdout."""

import argparse
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys


def load_native():
    spec = importlib.util.spec_from_file_location("pilot_native", Path(__file__).with_name("pilot_native.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load_native()
SUITES = ("python", "vitest", "playwright")


def ranked_cases(lines, inventory, revision, run, attempt, suites):
    registry = native.timing_registry_hash(inventory)
    rows = []
    found = set()
    for line in lines:
        _, marker, record = line.partition(native.TIMING_PREFIX)
        if not marker:
            continue
        record = record.rstrip("\r\n")
        checksum, _, content = record.partition(" ")
        if (len(marker) + len(record) + 1 > native.TIMING_LINE_LIMIT
                or hashlib.sha256(content.encode()).hexdigest() != checksum):
            raise ValueError("truncated or corrupt case timing line")
        value = json.loads(content)
        if (not isinstance(value, dict)
                or set(value) != {"suite", "revision", "run", "attempt", "platform", "registry", "us"}
                or (value["revision"], value["run"], value["attempt"], value["platform"], value["registry"])
                != (revision, run, attempt, "linux", registry)):
            raise ValueError("case timings do not match the requested revision, attempt and registry")
        suite = value["suite"]
        if suite not in SUITES or suite in found:
            raise ValueError("unknown or repeated case timing suite")
        found.add(suite)
        names = inventory[suite]
        excluded = {entry["id"] for entry in inventory["exclusions"]
                    if entry["runner"] == suite and "linux" in entry["platforms"]}
        if (not names or len(names) != len(set(names)) or not isinstance(value["us"], list)
                or len(value["us"]) != len(names)):
            raise ValueError("incomplete case timing vector")
        for name, duration in zip(names, value["us"]):
            if name in excluded:
                if duration is not None:
                    raise ValueError("reviewed exclusion must have no timing")
            elif type(duration) is not int or not 0 <= duration <= 86_400_000_000:
                raise ValueError("required case has no valid duration")
            if suite in suites:
                rows.append((suite, name, "excluded" if name in excluded else "passed", duration))
    if set(suites) - found:
        raise ValueError("missing complete timing lines for " + ", ".join(sorted(set(suites) - found)))
    return sorted(rows, key=lambda row: (row[3] is None, -(row[3] or 0), row[0], row[1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog=(
        "Supply the exact checkout SHA and GitHub run/attempt from the native verification job. "
        "Use --suite to extract a completed suite when another was interrupted."))
    parser.add_argument("log", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--attempt", required=True)
    parser.add_argument("--suite", choices=SUITES, action="append")
    args = parser.parse_args()
    if (not re.fullmatch(r"[0-9a-f]{40}", args.revision)
            or not all(re.fullmatch(r"[1-9][0-9]{0,19}", n) for n in [args.run, args.attempt])):
        parser.error("expected a full Git SHA and positive numeric run and attempt IDs")
    try:
        # Read the registry at the requested SHA, which can differ from this checkout.
        proof = native.load_module("tugling-pilot")
        inventory = json.loads(proof.git(native.ROOT, "show", args.revision + ":.tugling/pilot-cases.json"))
        with args.log.open(encoding="utf-8", errors="replace") as stream:
            rows = ranked_cases(stream, inventory, args.revision, args.run, args.attempt, args.suite or SUITES)
    except (OSError, KeyError, ValueError, RecursionError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Cannot decode native case timings: {error}\n")
    writer = csv.writer(sys.stdout)
    writer.writerow(("revision", "run", "attempt", "suite", "identity", "state", "duration_microseconds"))
    writer.writerows((args.revision, args.run, args.attempt, *row) for row in rows)


if __name__ == "__main__":
    main()
