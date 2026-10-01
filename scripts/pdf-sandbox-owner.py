"""Own one daemon's document capacity until exact-container cleanup completes.

No document bytes or credentials enter this helper. Kernel locks, not PID files
or expiring leases, coordinate independent processes and worktrees. Parent EOF
and signals clean up while the lock is still held. SIGKILL of this helper leaves
the container watchdog intact; the next owner refuses occupied capacity.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import subprocess
import sys
import tempfile
import time

LOCK_ROOT = Path(tempfile.gettempdir()) / f"keel-pdf-owners-{os.geteuid()}"
WAITERS = 8
ADMISSION_SECONDS = 120
OWNERSHIP_SECONDS = 180
CONTROL_SECONDS = 10
READY = "KEEL_PDF_OWNER_READY_V1"
RELEASED = "KEEL_PDF_OWNER_RELEASED_V1"
CREATED = "KEEL_PDF_OWNER_CREATE_SETTLED_V1"
UNSTARTED = "KEEL_PDF_OWNER_NO_CREATE_V1"


class OwnerFailure(Exception):
    def __init__(self, reason):
        self.reason = reason


def owned_lock(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        current = path.stat(follow_symlinks=False)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_nlink != 1 or info.st_mode & 0o077
                or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)):
            raise OwnerFailure("owner_unavailable")
        return os.fdopen(fd, "r+")
    except BaseException:
        os.close(fd)
        raise


def parent_closed(pipe, timeout):
    ready, _, _ = select.select([pipe], [], [], timeout)
    if ready:
        # Parent only closes this pipe. Never accept document bytes or commands.
        if os.read(pipe.fileno(), 1):
            raise OwnerFailure("owner_unavailable")
        return True
    return False


def wait_for_release(pipe, state):
    deadline = time.monotonic() + OWNERSHIP_SECONDS
    data = b""
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OwnerFailure("owner_lost")
        readable, _, _ = select.select([pipe], [], [], remaining)
        if not readable:
            raise OwnerFailure("owner_lost")
        chunk = os.read(pipe.fileno(), 128)
        if not chunk:
            if data:
                raise OwnerFailure("owner_unavailable")
            return
        data += chunk
        if len(data) > 128:
            raise OwnerFailure("owner_unavailable")
        if b"\n" in data:
            line, data = data.split(b"\n", 1)
            if state["settled"] or line not in (CREATED.encode(), UNSTARTED.encode()):
                raise OwnerFailure("owner_unavailable")
            state["settled"] = True
            if line == CREATED.encode():
                print(CREATED, flush=True)


def docker(socket, directory, args):
    try:
        result = subprocess.run(
            ["docker", "--config", directory, "--host", f"unix://{socket}", *args],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=CONTROL_SECONDS,
            env={"PATH": os.environ["PATH"], "LANG": "C.UTF-8"}, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise OwnerFailure("control_timeout") from None
    if len(result.stdout) > 65536:
        raise OwnerFailure("owner_unavailable")
    return result.returncode, result.stdout.strip()


def cleanup(socket, directory, name):
    # Always prove exact absence, even if rm reports success. AutoRemove may
    # already have removed it. Never delete by label or inspect another owner.
    docker(socket, directory, ["rm", "--force", name])
    for attempt in range(5):
        code, output = docker(socket, directory, [
            "ps", "--all", "--filter", f"name=^/{name}$", "--format", "{{.ID}}",
        ])
        if code != 0:
            raise OwnerFailure("cleanup_failed")
        if not output:
            return
        if attempt < 4:
            time.sleep(0.25)
    raise OwnerFailure("cleanup_failed")


def journal(capacity, state):
    capacity.seek(0)
    capacity.write(json.dumps(state))
    capacity.truncate()
    capacity.flush()
    os.fsync(capacity.fileno())


def run_owner(socket, directory, name, pipe=sys.stdin):
    if (not re.fullmatch(r"keel-pdf-[a-f0-9-]{36}", name)
            or not Path(socket).is_absolute() or not Path(directory).is_absolute()
            or not stat.S_ISSOCK(Path(socket).stat().st_mode)):
        raise OwnerFailure("owner_unavailable")
    config = Path(directory).stat(follow_symlinks=False)
    if (not stat.S_ISDIR(config.st_mode) or config.st_uid != os.geteuid()
            or config.st_mode & 0o077):
        raise OwnerFailure("owner_unavailable")
    LOCK_ROOT.mkdir(mode=0o700, exist_ok=True)
    root = LOCK_ROOT.stat(follow_symlinks=False)
    if (not stat.S_ISDIR(root.st_mode) or root.st_uid != os.geteuid()
            or root.st_mode & 0o077):
        raise OwnerFailure("owner_unavailable")
    key = hashlib.sha256(os.fsencode(os.path.realpath(socket))).hexdigest()
    waiter = None
    for slot in range(WAITERS):
        candidate = owned_lock(LOCK_ROOT / f"{key}.waiter-{slot}")
        try:
            fcntl.flock(candidate, fcntl.LOCK_EX | fcntl.LOCK_NB)
            waiter = candidate
            break
        except BlockingIOError:
            candidate.close()
    if waiter is None:
        raise OwnerFailure("runtime_busy")
    try:
        with owned_lock(LOCK_ROOT / f"{key}.capacity") as capacity:
            deadline = time.monotonic() + ADMISSION_SECONDS
            while True:
                if parent_closed(pipe, 0):
                    return
                try:
                    fcntl.flock(capacity, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise OwnerFailure("runtime_busy")
                    if parent_closed(pipe, 0.05):
                        return
            current = (LOCK_ROOT / f"{key}.capacity").stat(follow_symlinks=False)
            locked = os.fstat(capacity.fileno())
            if (current.st_dev, current.st_ino) != (locked.st_dev, locked.st_ino):
                raise OwnerFailure("owner_unavailable")
            # A hard-killed owner may have an in-flight daemon create request,
            # even if ps is momentarily empty. Never infer recovery from elapsed
            # time or absence alone. A durable dirty journal refuses new work.
            previous = capacity.read(256)
            if previous and previous != json.dumps({"state": "idle"}):
                raise OwnerFailure("runtime_busy")
            # A legacy run or a killed supervisor can retain a watchdog-owned
            # container. Do not overlap it or delete an unrelated operation.
            code, occupied = docker(socket, directory, [
                "ps", "--all", "--filter", "label=keel.pdf-sandbox=1",
                "--format", "{{.ID}}",
            ])
            if code != 0:
                raise OwnerFailure("owner_unavailable")
            if occupied:
                raise OwnerFailure("runtime_busy")
            journal(capacity, {"state": "owned", "name": name})
            state = {"settled": False}
            try:
                print(READY, flush=True)
                wait_for_release(pipe, state)
            finally:
                # Repeated cancellation must not interrupt the absence proof.
                previous_term = signal.signal(signal.SIGTERM, signal.SIG_IGN)
                previous_int = signal.signal(signal.SIGINT, signal.SIG_IGN)
                try:
                    cleanup(socket, directory, name)
                    if not state["settled"]:
                        # Caller death / CLI timeout during create can race rm
                        # and ps. Keep the dirty journal even after absence.
                        raise OwnerFailure("creation_unconfirmed")
                    journal(capacity, {"state": "idle"})
                finally:
                    signal.signal(signal.SIGTERM, previous_term)
                    signal.signal(signal.SIGINT, previous_int)
            print(RELEASED, flush=True)
    finally:
        waiter.close()
    # Never unlink lock files: replacing their inode would split ownership.


def main():
    def interrupted(_signum, _frame):
        raise OwnerFailure("owner_lost")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if len(sys.argv) != 4:
            raise OwnerFailure("owner_unavailable")
        run_owner(*sys.argv[1:])
    except OwnerFailure as error:
        print(json.dumps({"reason": error.reason}), flush=True)
        return 1
    except (OSError, ValueError):
        print(json.dumps({"reason": "owner_unavailable"}), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
