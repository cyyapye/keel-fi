#!/usr/bin/env python3
"""One-off PR #340 shadow replay. Remove this entrypoint when promoting draft checks."""

import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys


# These are the original GitHub pull-request merge commits, not their later squash commits.
EXAMPLES = {
    "184": ("da43cdf5e3be134321ba62191435d32faf75d3f6", "5d53926976ff89d77d0bab6fe8396689a537ca63",
            "951c473d5605a204386e465512fcfddb010e570b", "58d41793d3d322a34ba86e1d67d7d8a3bd0a552e"),
    "334": ("493843e56224374edf15138645bf21df67621088", "ebea3e06c7c3d8d0a30452dded9daab630a28c7a",
            "0239c79e26d883c1afd93e47d4dc16fa7b29aabc", "5a0218f97b54d54b833b263960153a848e74716a"),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("example", choices=EXAMPLES)
    example = parser.parse_args().example
    base, head, merge, tree = EXAMPLES[example]
    tools = Path(__file__).resolve().parent
    root = Path.cwd()
    select = runpy.run_path(str(tools / "ci-draft-plan.py"))["plan"]
    execute = runpy.run_path(str(tools / "ci-draft-checks.py"))
    plan = select(base, head)
    encoded = json.dumps(plan).encode()
    files = [] if example == "184" else ["packages/database/src/exposures.test.ts"]
    if (plan["profile"], plan["test_files"], plan["changed_count"]) != (
        "docs" if example == "184" else "test-files", files, 1 if example == "184" else 2,
    ):
        raise ValueError("historical draft selected unexpected checks")
    execute["checked_plan"](io.BytesIO(encoded), select)
    actual_tree = subprocess.check_output(["git", "--no-replace-objects", "rev-parse", "HEAD^{tree}"], text=True).strip()
    if execute["checked_merge"](plan) != merge or actual_tree != tree:
        raise ValueError("historical checkout does not match its hosted merge and tree")
    if example == "184":
        subprocess.run([sys.executable, "-I", str(tools / "ci-draft-checks.py"), "--plan-stdin"],
                       input=encoded, check=True)
    else:
        # The original Makefile ran separate complete lint and typecheck targets.
        # Run them from the historical tree, with its own frozen dependency lock.
        subprocess.run(["make", "-j2", "data-scan", "format-check", "lint", "typecheck"], check=True)
        # This revision predates the complete phase-report validator. Run today's trusted
        # validator against historical case paths; Vitest and its reporter run from that tree.
        spec = importlib.util.spec_from_file_location("trusted_native", tools / "pilot_native.py")
        native = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(native)
        native.ROOT = root
        cases = execute["run_selected_tests"](files, root, vars(native))
        digest = hashlib.sha256(json.dumps(sorted(cases), separators=(",", ":")).encode()).hexdigest()
        if len(cases) != 28 or digest != "531c92b7394b577d50d9cc91ea085cb700f6cc8b57ae9d212139b576481ea0e6":
            raise ValueError("historical exposures case identities differ")
    if execute["checked_merge"](plan) != merge:
        raise ValueError("historical merge changed during selected checks")
    print(f"Historical partial shadow passed for PR {example}, merge {merge}, tree {tree}, {len(files)} Vitest files.")


if __name__ == "__main__":
    main()
