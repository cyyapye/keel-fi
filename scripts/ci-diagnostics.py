#!/usr/bin/env python3
"""Package bounded, synthetic CI diagnostics without copying browser profiles."""

import argparse
from collections import Counter
import json
import math
import os
from pathlib import Path
import re
import stat
import zipfile
import zlib

MIB = 1024 * 1024
LIMITS = {"success": MIB, "failure": 12 * MIB, "cancelled": 12 * MIB}
REPORTS = (
    "pilot-required.json", "pilot-probe-required.json", "pilot-probe-summary.json",
    "pilot-probe.log", "ci-resources.jsonl", "verification/required.json",
    "verification/managed-v1/*.json", "pilot/vitest.json", "pilot/playwright*.json",
)
SUMMARY_BYTES = 2 * MIB
SUMMARY_LINES = 361
SUMMARY_LINE_BYTES = 32 * 1024
SUMMARY_OUTPUT_BYTES = 16 * 1024


def summary_input(root, path, limit=SUMMARY_BYTES):
    if root.is_symlink():
        raise ValueError("diagnostic root must not be a symlink")
    regular_file(root, path)
    before = path.lstat()
    if before.st_uid != os.geteuid() or before.st_size > limit:
        raise ValueError("summary input exceeds ownership or byte bounds")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (not stat.S_ISREG(opened.st_mode)
                or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
                or opened.st_uid != os.geteuid() or opened.st_nlink != 1):
            raise ValueError("summary input changed during acquisition")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("summary input exceeds its byte bound")
    return data


def summary_json(root, path, limit=SUMMARY_BYTES):
    try:
        return "available", json.loads(summary_input(root, path, limit))
    except FileNotFoundError:
        return "missing", None
    except (OSError, ValueError, UnicodeError, RecursionError):
        return "invalid", None


def summary_number(value, maximum=10**18, minimum=0):
    return (value if type(value) in (int, float) and minimum <= value <= maximum
            and math.isfinite(value) else None)


def resource_summary(root, flow_ids):
    try:
        data = summary_input(root, root / ".tugling/local/ci-resources.jsonl")
    except FileNotFoundError:
        return {"status": "missing"}
    except (OSError, ValueError):
        return {"status": "invalid"}
    lines = data.splitlines()
    if len(lines) > SUMMARY_LINES or any(len(line) > SUMMARY_LINE_BYTES for line in lines):
        return {"status": "limit-exceeded"}
    extrema = {"cpu_busy_percent": ("max", 100), "iowait_percent": ("max", 100),
               "memory_available_mib": ("min", 10**12), "swap_used_mib": ("max", 10**12),
               "logical_cpu_count": ("min", 8192), "memory_total_mib": ("min", 10**12),
               "swap_total_mib": ("min", 10**12)}
    values = {key: None for key in extrema}
    pressure = {kind: None for kind in ("cpu", "memory", "io")}
    flows = {name: {"cpu_ns": None, "runqueue_ns": None, "max_observed_processes": None,
                    "max_process_rss_bytes_sum": None}
             for name in flow_ids}
    times, invalid, limited, errors, unavailable_flows, schedstats = [], 0, 0, None, 0, 0
    cpu_deltas, previous_cpu, previous_time = [0] * 8, None, None
    cpu_intervals, rejected_cpu_intervals = 0, 0
    for index, line in enumerate(lines):
        try:
            row = json.loads(line)
        except (ValueError, UnicodeError, RecursionError):
            invalid += 1
            rejected_cpu_intervals += int(index > 0)
            previous_cpu, previous_time = None, None
            continue
        instant = summary_number(row.get("time"), 10**12) if isinstance(row, dict) else None
        if instant is None:
            invalid += 1
            rejected_cpu_intervals += int(index > 0)
            previous_cpu, previous_time = None, None
            continue
        cpu = row.get("cpu")
        valid_cpu = (isinstance(cpu, list) and len(cpu) == 8
                     and all(type(value) is int and summary_number(value) is not None for value in cpu))
        delta = ([current - prior for current, prior in zip(cpu, previous_cpu)]
                 if valid_cpu and previous_cpu is not None and instant > previous_time else None)
        if delta is not None and min(delta) >= 0 and sum(delta) > 0:
            cpu_deltas = [total + value for total, value in zip(cpu_deltas, delta)]
            cpu_intervals += 1
        elif index:
            rejected_cpu_intervals += 1
        previous_cpu, previous_time = (cpu, instant) if valid_cpu else (None, None)
        times.append(instant)
        for key, (operation, maximum) in extrema.items():
            value = summary_number(row.get(key), maximum)
            if ((key == "logical_cpu_count" and type(value) is not int)
                    or (key in ("logical_cpu_count", "memory_total_mib") and value == 0)):
                value = None
            if value is not None:
                values[key] = value if values[key] is None else (
                    min(values[key], value) if operation == "min" else max(values[key], value))
        pressures = row.get("pressure", {})
        for kind in pressure:
            source = pressures.get(kind, {}) if isinstance(pressures, dict) else {}
            source = source.get("some", {}) if isinstance(source, dict) else {}
            raw = source.get("avg10") if isinstance(source, dict) else None
            try:
                value = summary_number(float(raw), 100) if type(raw) in (int, float, str) else None
            except (ValueError, OverflowError):
                value = None
            if value is not None:
                pressure[kind] = value if pressure[kind] is None else max(pressure[kind], value)
        observed = row.get("flow_resources")
        if not isinstance(observed, dict) or observed.get("status") != "sampled-lower-bound":
            unavailable_flows += 1
            continue
        limited += int(observed.get("discovery_limited") is True or observed.get("tracking_limited") is True)
        count = summary_number(observed.get("read_errors"))
        if type(count) is int:
            errors = (errors or 0) + count
        schedstats += int(observed.get("schedstats_enabled") is True)
        sources = observed.get("flows", {})
        if not isinstance(sources, dict):
            unavailable_flows += 1
            continue
        for name, total in flows.items():
            source = sources.get(name)
            if not isinstance(source, dict):
                continue
            for source_key, target in (("cpu_delta_ns", "cpu_ns"),
                                       ("main_thread_runqueue_delta_ns", "runqueue_ns")):
                value = summary_number(source.get(source_key))
                if type(value) is int:
                    total[target] = (total[target] or 0) + value
            count = summary_number(source.get("observed_processes"), 512)
            if type(count) is int:
                total["max_observed_processes"] = max(total["max_observed_processes"] or 0, count)
                rss = summary_number(source.get("process_rss_bytes_sum"))
                if count > 0 and type(rss) is int:
                    total["max_process_rss_bytes_sum"] = max(total["max_process_rss_bytes_sum"] or 0, rss)
    total_ticks = sum(cpu_deltas)
    cpu_ticks = {"scope": "host-wide", "aggregation": "weighted-tick-deltas",
                 "valid_intervals": cpu_intervals, "rejected_intervals": rejected_cpu_intervals,
                 "covered_ticks": total_ticks if cpu_intervals else None,
                 **{f"{name}_percent": round(sum(cpu_deltas[index] for index in indices) * 100 / total_ticks, 3)
                    if total_ticks else None for name, indices in {
                        "executing": (0, 1, 2, 5, 6), "steal": (7,), "iowait": (4,), "idle": (3,),
                    }.items()}}
    return {"status": "invalid" if not times else "partial" if invalid else "sampled",
            "samples": len(times), "invalid_samples": invalid,
            "sample_time_span_seconds": round(max(times) - min(times), 3) if times else None,
            "host": {**values, "cpu_busy_percent_includes_steal": True,
                     "cpu_tick_summary": cpu_ticks,
                     "load_average": None, "pressure_some_avg10_peak": pressure},
            "flow_measurement": "sampled-lower-bound", "limited_samples": limited,
            "flow_rss_measurement": {"aggregation": "peak-of-observed-process-rss-sums",
                                     "shared_pages_may_repeat": True,
                                     "excludes_processes_outside_verified_flow_tree": True},
            "read_errors": errors, "unavailable_flow_samples": unavailable_flows,
            "schedstats_enabled_samples": schedstats,
            "flows": [{"id": name, "cpu_seconds_observed": round(total["cpu_ns"] / 10**9, 3)
                       if total["cpu_ns"] is not None else None,
                       "main_thread_runqueue_seconds_observed": round(total["runqueue_ns"] / 10**9, 3)
                       if total["runqueue_ns"] is not None else None,
                       "max_observed_processes": total["max_observed_processes"],
                       "max_observed_process_rss_sum_mib": round(total["max_process_rss_bytes_sum"] / MIB, 3)
                       if total["max_process_rss_bytes_sum"] is not None else None}
                      for name, total in sorted(flows.items())]}


def native_summary(root, flow_ids):
    local = root / ".tugling/local"
    status, report = summary_json(root, local / "pilot-required.json")
    if status == "available" and not isinstance(report, dict):
        return {"status": "invalid"}
    verification = report.get("flow_verification", {}) if isinstance(report, dict) else {}
    evidence = verification.get("evidence") if isinstance(verification, dict) else None
    if not isinstance(evidence, dict):
        relative = verification.get("path") if isinstance(verification, dict) else None
        parts = Path(relative).parts if isinstance(relative, str) else ()
        if (len(parts) != 5 or parts[:4] != (".tugling", "local", "verification", "managed-v1")
                or re.fullmatch(r"[A-Za-z0-9-]{1,80}\.json", parts[4]) is None):
            return {"status": status if status != "available" else "missing-current-evidence"}
        status, evidence = summary_json(root, root / relative)
    if not isinstance(evidence, dict):
        return {"status": status if status != "available" else "invalid"}
    timing = evidence.get("performance", {})
    timing = timing if isinstance(timing, dict) else {}
    results = evidence.get("results", [])
    if not isinstance(results, list) or len(results) > 32:
        return {"status": "invalid"}
    flows, seen, invalid = [], set(), 0
    for row in results:
        if (not isinstance(row, dict) or not isinstance(row.get("id"), str)
                or row["id"] not in flow_ids or row["id"] in seen):
            invalid += 1
            continue
        seen.add(row["id"])
        flows.append({"id": row["id"],
                      "started_offset_seconds": summary_number(row.get("started_offset_seconds"), 10**6),
                      "duration_seconds": summary_number(row.get("duration_seconds"), 10**6),
                      "exit_code": summary_number(row.get("exit_code"), 255, -255)
                      if type(row.get("exit_code")) is int else None,
                      "failure_present": row["failure"] is not None if "failure" in row else None})
    state = evidence.get("state")
    return {"status": "available-unverified", "state": state if state in (
                "REQUIRED_PASS", "REQUIRED_FAIL", "FLOWS_PASS", "FLOWS_FAIL") else None,
            "active_seconds": summary_number(timing.get("active_seconds"), 10**6),
            "budget_seconds": summary_number(timing.get("budget_seconds"), 10**6),
            "within_budget": timing.get("within_budget") if type(timing.get("within_budget")) is bool else None,
            "invalid_flow_rows": invalid, "flows": sorted(flows, key=lambda row: row["id"])}


def diagnostic_summary(root):
    root = root.absolute()
    status, mapping = summary_json(root, root / ".tugling/pilot-verification.json", 128 * 1024)
    declared = mapping.get("flows") if isinstance(mapping, dict) else None
    flow_ids = {row["id"] for row in declared if isinstance(row, dict)
                and isinstance(row.get("id"), str) and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", row["id"])} if isinstance(declared, list) and len(declared) <= 32 else set()
    valid = isinstance(declared, list) and bool(flow_ids) and len(flow_ids) == len(declared)
    summary = {"schema_version": 1, "flow_map": "available" if valid else status if status != "available" else "invalid",
               "resources": resource_summary(root, flow_ids if valid else set()),
               "native": native_summary(root, flow_ids if valid else set())}
    if len(json.dumps(summary, allow_nan=False).encode()) > SUMMARY_OUTPUT_BYTES:
        return {"schema_version": 1, "status": "output-limit-exceeded"}
    return summary


def regular_file(root, path):
    for component in (path, *path.parents):
        if component == root:
            break
        if component.is_symlink():
            raise ValueError("diagnostics must not follow symlinks")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("diagnostics require regular files with one link")
    return info.st_size


def prepare(root, status):
    root = root.absolute()
    local = root / ".tugling/local"
    candidates = set()
    for pattern in REPORTS:
        candidates.update(local.glob(pattern))
    if status != "success":
        # Exactly lane/test/file: never recurse into persistent Chromium profiles,
        # downloaded documents, runtime databases or nested cache directories.
        for path in local.glob("pilot/browser-results/*/*/*"):
            if path.name in ("error-context.md", "trace.zip") or path.suffix == ".png":
                candidates.add(path)
    if len(candidates) > 5000:
        raise ValueError("diagnostic discovery exceeds 5000 files")

    representatives = {}
    for path in sorted(candidates):
        if path.name == "trace.zip":
            representatives.setdefault(path.relative_to(local).parts[2], path)
    representative_traces = set(representatives.values())

    def priority(path):
        name = path.relative_to(local).as_posix()
        if not name.startswith("pilot/browser-results/"):
            return (0, name)
        if path in representative_traces:
            return (2, name)
        return ({".md": 1, ".png": 3, ".zip": 4}[path.suffix], name)

    output = local / "ci-upload/diagnostics.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    for path in (output.parent, *output.parent.parents):
        if path.is_symlink():
            raise ValueError("diagnostic output must not follow symlinks")
        if path == root:
            break
    if output.exists() or output.is_symlink():
        regular_file(root, output)
        output.unlink()
    included, omitted, reasons = [], [], Counter()
    archive_bytes = 22  # ZIP end record, plus each member's local/central records.
    pending = output.with_suffix(".pending")
    if pending.exists() or pending.is_symlink():
        regular_file(root, pending)
        pending.unlink()
    try:
        with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(candidates, key=priority):
                name = path.relative_to(local).as_posix()
                size = regular_file(root, path)
                reason = None
                if size > 8 * MIB:
                    reason = "file exceeds 8 MiB"
                else:
                    data = path.read_bytes()
                    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
                    compressed = compressor.compress(data) + compressor.flush()
                    cost = len(compressed) + 76 + 2 * len(name.encode("utf8"))
                    # Reserve 512 KiB for an explicit, bounded omission manifest.
                    if archive_bytes + cost > LIMITS[status] - 512 * 1024:
                        reason = "bundle byte budget"
                if reason:
                    reasons[reason] += 1
                    if len(omitted) < 200:
                        omitted.append({"path": name, "bytes": size, "reason": reason})
                    continue
                archive.writestr(name, data)
                archive_bytes += cost
                included.append({"path": name, "bytes": size})
            manifest = json.dumps({
                "schema_version": 1, "status": status, "limit_bytes": LIMITS[status],
                "included": included, "omitted_counts": dict(reasons),
                "omitted_sample": omitted,
                "browser_policy": "failure/cancellation only; lane/test PNG, error-context.md and trace.zip; no nested profiles",
            }, indent=2).encode()
            if len(manifest) > 512 * 1024 - 1024:
                raise ValueError("diagnostic manifest exceeds reserved capacity")
            archive.writestr("manifest.json", manifest)
        if pending.stat().st_size > LIMITS[status]:
            raise ValueError("diagnostic archive exceeds upload capacity")
        pending.replace(output)
    finally:
        pending.unlink(missing_ok=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--status", choices=LIMITS, required=True)
    args = parser.parse_args()
    output = prepare(args.root, args.status)
    print(json.dumps({"path": str(output), "bytes": output.stat().st_size,
                      "summary": diagnostic_summary(args.root)}, allow_nan=False))
