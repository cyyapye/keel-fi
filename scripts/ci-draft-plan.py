#!/usr/bin/env python3
"""Classify an exact draft PR diff. Only an explicit, verified owner can narrow it."""

import argparse
import json
import os
import re
import resource
import subprocess
import tempfile
import time


# Historical human-readable documents. The source-quality check also covers
# ci-performance.md. UI contracts read by the catalogue are deliberately absent.
DOCS = frozenset({
    "docs/engineering/ci-performance.md",
    "docs/product/holdings-concept-map.md",
    "docs/product/holdings-ux-pilot.md",
    "docs/product/holdings-ux-proposal-v10.md",
    "docs/product/legal-entities-inventory-polish.md",
    "docs/product/portfolio-performance.md",
    "docs/product/ui-refactor-targets.md",
})
# Each file owns its own registered tests in an isolated Vitest process.
# exposures is a real SQLite integration suite and runs with one worker.
TEST_FILES = frozenset({
    "packages/database/src/exposures.test.ts",
    "packages/domain/src/position-economics.test.ts",
    "packages/domain/src/position-value.test.ts",
    "packages/domain/src/valuation-record.test.ts",
})
# These stylesheets are consumed by the web entry points. Keep the entire
# native suite for layout changes, including browser, PDF build and extraction.
LAYOUT_FILES = frozenset({
    "apps/web/src/startup.css",
    "apps/web/src/styles.css",
    "packages/ui/src/styles.css",
})
OVERVIEW_SPEC = "e2e/overview-links.visual.spec.ts"
OVERVIEW_REFERENCES = frozenset(
    f"{OVERVIEW_SPEC}-snapshots/overview-goal-overview{state}-{project}-{platform}.png"
    for state in ("", "-swiped")
    for project in ("chromium", "mobile-chromium")
    for platform in ("darwin", "linux")
)
LAYOUT_COMPANIONS = {OVERVIEW_SPEC} | OVERVIEW_REFERENCES
REVIEWED_FILES = DOCS | TEST_FILES | LAYOUT_FILES | LAYOUT_COMPANIONS
OID = re.compile(r"[0-9a-f]{40}\Z")
MODIFIED = re.compile(rb":100644 100644 ([0-9a-f]{40}) ([0-9a-f]{40}) M\Z")
DIFF_LIMIT = 128 * 1024
BLOB_LIMIT = 1024 * 1024
PNG_LIMIT = 256 * 1024
PNG_HEADER = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"


def read_git(*args, deadline, limit=DIFF_LIMIT):
    """Bound both Git's run time and the size of the output it can produce."""
    def bound_output():
        resource.setrlimit(resource.RLIMIT_FSIZE, (limit + 1, limit + 1))

    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ValueError("time limit")
    with tempfile.TemporaryFile() as output:
        subprocess.run(
            ["git", "--no-replace-objects", *args], stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.DEVNULL, check=True, timeout=remaining,
            env={**os.environ, "GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0"},
            preexec_fn=bound_output,
        )
        output.seek(0)
        data = output.read(limit + 1)
        if len(data) > limit:
            raise ValueError("output limit")
        return data


def reviewed_changes(raw):
    """Return the complete count and regular files owned by this policy."""
    if not raw:
        return 0, {}, "empty-diff"
    fields = raw.split(b"\0")
    if fields.pop() or len(fields) % 2:
        return None, {}, "unverified-diff"
    count = len(fields) // 2
    if count > len(REVIEWED_FILES):
        return count, {}, "outside-reviewed-owners"
    files = {}
    for status, path in zip(fields[::2], fields[1::2]):
        match = MODIFIED.fullmatch(status)
        if not match:
            # Rename folding is off, so any move includes a deletion.
            return count, {}, "unsupported-change"
        name = path.decode("utf-8")
        if name not in REVIEWED_FILES or name in files:
            return count, {}, "outside-reviewed-owners"
        files[name] = match.groups()
    if ((files.keys() & LAYOUT_COMPANIONS and not files.keys() & LAYOUT_FILES)
            or (files.keys() & OVERVIEW_REFERENCES and OVERVIEW_SPEC not in files)):
        return count, {}, "outside-reviewed-owners"
    return count, files, None


def plan(base, head):
    base = base if isinstance(base, str) and OID.fullmatch(base) else None
    head = head if isinstance(head, str) and OID.fullmatch(head) else None
    result = dict(schema_version=1, profile="full", base=base, head=head,
                  merge_base=None, changed_count=None, reason="invalid-revision", test_files=[])
    if base is None or head is None:
        return result
    deadline = time.monotonic() + 8

    def git(*args, limit=DIFF_LIMIT):
        return read_git(*args, deadline=deadline, limit=limit)

    try:
        result["reason"] = "unverified-history"
        if git("rev-parse", "--show-prefix") != b"\n":
            return result
        for rev in (base, head):
            if git("cat-file", "-t", rev) != b"commit\n":
                return result
        if git("rev-parse", "--is-shallow-repository") != b"false\n":
            return result
        # Multiple best ancestors do not define one unambiguous PR diff.
        ancestor = git("merge-base", "--all", base, head).decode("ascii").strip()
        if not OID.fullmatch(ancestor):
            return result
        result["merge_base"] = ancestor
        result["reason"] = "unverified-diff"
        raw = git("diff", "--raw", "--abbrev=40", "-z", "--no-ext-diff", "--no-textconv",
                  "--no-renames", "--no-relative", "--ignore-submodules=none", ancestor, head, "--")
        count, files, reason = reviewed_changes(raw)
        result["changed_count"] = count
        if reason:
            return {**result, "reason": reason}
        result["reason"] = "unverified-content"
        inputs = {(name in OVERVIEW_REFERENCES, oid) for name, pair in files.items() for oid in pair}
        for reference, oid in sorted(inputs):
            content = git("cat-file", "blob", oid.decode("ascii"), limit=PNG_LIMIT if reference else BLOB_LIMIT)
            if reference:
                if not content.startswith(PNG_HEADER) or not content.endswith(PNG_END):
                    return result
            else:
                if not content or b"\0" in content:
                    return result
                content.decode("utf-8")
        tests = sorted(files.keys() & TEST_FILES)
        if tests:
            # The selected executor must verify *every* current reviewed identity
            # for these exact files against its fresh native result.
            registry = json.loads(git("cat-file", "blob", head + ":.tugling/pilot-cases.json", limit=BLOB_LIMIT))
            ids = registry["vitest"]
            if (type(registry.get("schema_version")) is not int or registry["schema_version"] != 1
                    or not isinstance(ids, list) or not all(isinstance(i, str) for i in ids)
                    or len(set(ids)) != len(ids)
                    or not all(any(i.startswith(f + " :: ") for i in ids) for f in tests)):
                return result
        layout = sorted(files.keys() & (LAYOUT_FILES | LAYOUT_COMPANIONS))
        if layout:
            return {**result, "profile": "layout", "reason": "reviewed-layout-files",
                    "test_files": tests, "layout_files": layout}
        return {**result, "profile": "test-files" if tests else "docs",
                "reason": "reviewed-test-files" if tests else "reviewed-docs", "test_files": tests}
    except (OSError, ValueError, TypeError, KeyError, RecursionError, subprocess.SubprocessError):
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    print(json.dumps(plan(args.base, args.head), sort_keys=True))
