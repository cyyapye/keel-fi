#!/usr/bin/env python3
"""Tugling post-run check, executed in the isolated guidance fixture.

The output schema already contains artifacts_inspected. Hash receipts establish
access to the tested bytes, not comprehension or semantic quality. Keep this
checker outside the model's fixture and invoke it through post_run_commands.
"""

import hashlib
import json
from pathlib import Path
import sys


GUIDANCE = (
    ".codex/skills/keel-ui-quality/SKILL.md",
    "docs/product/ui-and-copy.md",
)


def check(output, root):
    receipts = output.get("artifacts_inspected", [])
    failures = []
    for name in GUIDANCE:
        digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
        if f"SHA256 {name} {digest}" not in receipts:
            failures.append(f"Missing or incorrect receipt for {name}")
    return failures


def main():
    try:
        output = json.loads(Path(sys.argv[1]).read_text())
        failures = check(output, Path.cwd())
    except (IndexError, OSError, ValueError, AttributeError) as error:
        print(f"Guidance receipt check failed: {error}", file=sys.stderr)
        return 1
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("Both guidance content receipts verified against the cloned fixture.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
