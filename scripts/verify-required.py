"""Run the exact unreleased Tugling candidate in this isolated Keel pilot."""

import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    config = root / ".tugling/pilot.json"
    source = args.source_root.resolve()
    source_top = Path(subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "--show-toplevel"], text=True
    ).strip()).resolve()
    if source_top != source:
        parser.error("Tugling source must be the Git repository root, not a nested directory")
    # Check identity before executing candidate code. The pilot pin is not a
    # release acceptance; .tugling/project.json remains the accepted source.
    revision = json.loads(config.read_text())["tugling"]["revision"]
    actual = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    dirty = subprocess.check_output(
        ["git", "-C", str(source), "status", "--porcelain", "--untracked-files=all"],
        text=True,
    ).strip()
    flags = subprocess.check_output(
        ["git", "-C", str(source), "ls-files", "-v"], text=True
    ).splitlines()
    if actual != revision or dirty or any(line[:1] != "H" for line in flags):
        parser.error("Tugling must be the clean exact candidate declared in .tugling/pilot.json")
    helper_path = "plugins/tugling/scripts/project_contract.py"
    helper = source / helper_path
    committed_helper = subprocess.check_output(
        ["git", "-C", str(source), "show", f"{revision}:{helper_path}"]
    )
    if helper.is_symlink() or helper.read_bytes() != committed_helper:
        parser.error("Tugling helper must match the tracked helper at the pinned revision")
    return subprocess.call(
        [sys.executable, str(helper),
         "--repo", str(root), "--config", str(config), "--source-root", str(source),
         "--source-mode", "pinned", "--run-required", "--json"],
        cwd=root,
    )


if __name__ == "__main__":
    sys.exit(main())
