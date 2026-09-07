#!/usr/bin/env python3
"""Run a command in an owned, automatically cleaned Linux test checkout."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

RUN_ROOT = Path("/private/tmp/keel-test-runs") / str(os.getuid())

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--keep", action="store_true", help="Retain for debugging, at most 7 days")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a command is required after --")
    if sys.platform != "linux":
        parser.error("run inside Linux, e.g. colima ssh -- python3 <script> ...")
    source = args.source.resolve(strict=True)
    root = RUN_ROOT
    if root.parent.is_symlink():
        raise RuntimeError("unsafe test-run parent")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or root.stat().st_uid != os.getuid():
        raise RuntimeError("unsafe test-run root")
    # Serialize creation/collection so a collector never sees a half-written run.
    with (root / ".registry.lock").open("a") as registry:
        fcntl.flock(registry, fcntl.LOCK_EX)
        run = Path(tempfile.mkdtemp(prefix="run-", dir=root))
        lease = (run / ".lease").open("w")
        fcntl.flock(lease, fcntl.LOCK_EX)
        (run / ".owner.json").write_text(json.dumps({
            "owner": "keel-linux-test-v1", "created": time.time(), "keep": args.keep,
        }))
    child = None
    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    print(f"Keel test directory: {run}", flush=True)
    try:
        checkout = run / "checkout"
        checkout.mkdir()
        files = subprocess.check_output(["git", "-C", str(source), "ls-files", "-z"]).split(b"\0")
        for raw in filter(None, files):
            relative = Path(os.fsdecode(raw))
            original = source / relative
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("invalid tracked path")
            if any(part.startswith(".env") for part in relative.parts):
                continue
            if original.is_symlink() or not original.is_file():
                continue
            if not original.resolve().is_relative_to(source):
                raise RuntimeError("tracked path escapes checkout")
            target = checkout / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, target)
        env = dict(os.environ, XDG_CACHE_HOME=str(run / "cache"),
                   npm_config_cache=str(run / "npm-cache"),
                   npm_config_store_dir=str(run / "pnpm-store"),
                   PLAYWRIGHT_BROWSERS_PATH=str(run / "browsers"),
                   PNPM_HOME=str(run / "pnpm"))
        child = subprocess.Popen(command, cwd=checkout, env=env,
                                 start_new_session=True, pass_fds=(lease.fileno(),))
        return child.wait()
    finally:
        if child:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        if args.keep:
            print(f"Retained for debugging (7-day expiry): {run}", flush=True)
        else:
            shutil.rmtree(run)
        lease.close()


if __name__ == "__main__":
    sys.exit(main())
