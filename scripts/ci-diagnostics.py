#!/usr/bin/env python3
"""Package bounded, synthetic CI diagnostics without copying browser profiles."""

import argparse
from collections import Counter
import json
from pathlib import Path
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
    print(json.dumps({"path": str(output), "bytes": output.stat().st_size}))
