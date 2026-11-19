#!/usr/bin/env python3
"""Explicit local maintenance; never called by capture, CI, or make verify."""
import contextlib
import sys
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import signal
import subprocess
import tempfile


def private_bytes(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if (path.is_symlink() or not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077
                or metadata.st_size > 4096):
            raise RuntimeError('PDF binding must be a bounded owner-only regular file')
        return stream.read()


def bounded_run(args, *, timeout, check, **kwargs):
    with subprocess.Popen(args, start_new_session=True, **kwargs) as child:
        try:
            code = child.wait(timeout=timeout)
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            raise
        if check and code:
            raise subprocess.CalledProcessError(code, args)


@contextlib.contextmanager
def publication_locks(socket):
    if sys.platform == 'darwin':
        import importlib.util
        spec = importlib.util.spec_from_file_location('publication_lock', Path(__file__).with_name('pdf-sandbox-publication-lock.py'))
        publication_lock = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(publication_lock)
        try:
            locks = publication_lock.acquire(socket)
        except BlockingIOError as error:
            raise RuntimeError("Another explicit refresh owns this daemon or publication registry; no changes made") from error
        try:
            yield tuple(lock.fileno() for lock in locks)
        finally:
            for lock in reversed(locks): lock.close()
        return
    key = hashlib.sha256(os.fsencode(os.path.realpath(socket))).hexdigest()
    lockroot = Path('/tmp') / f'keel-pdf-refresh-{os.getuid()}'
    lockroot.mkdir(mode=0o700, exist_ok=True)
    metadata = lockroot.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid()
            or metadata.st_mode & 0o077):
        raise RuntimeError('Unsafe refresh lock directory')
    fd = os.open(lockroot / (key + '.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        metadata = os.fstat(lock.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                or metadata.st_mode & 0o077 or metadata.st_nlink != 1):
            raise RuntimeError('Unsafe refresh lock file')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Another explicit refresh owns this daemon; no changes made') from error
        yield (lock.fileno(),)


def refresh(root, run=bounded_run):
    root = Path(root).resolve()
    if os.environ.get('CI') or os.environ.get('KEEL_PDF_SANDBOX_CONFIG'):
        raise RuntimeError('Local default bindings only; CI and service overrides are not supported')
    base = root / '.keel-local/pdf-sandbox.json'
    parent = base.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid()
            or parent.st_mode & 0o022):
        raise RuntimeError('Unsafe local PDF binding directory')
    parent_identity = (parent.st_dev, parent.st_ino)
    paths = [base, Path(str(base) + '.probe'), Path(str(base) + '.scanner')]
    originals = [private_bytes(path) for path in paths]
    configs = [json.loads(value) for value in originals]
    socket = configs[0]['socket']
    if any(value['socket'] != socket for value in configs):
        raise RuntimeError('PDF profiles must use the same daemon')
    # The existing setup checker is authoritative for schema, socket, engine,
    # and immutable image validation. Never accept environment socket overrides.
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(Path.home())}
    lock_fds = ()
    def node(script, *args, extra=None):
        run(['node', '--import', 'tsx', script, *args], cwd=root,
            env=env | (extra or {}), check=True, timeout=420, pass_fds=lock_fds)
    node('scripts/pdf-sandbox-setup.ts', 'check')
    with publication_locks(socket) as inherited:
        lock_fds = inherited
        if sys.platform == 'darwin':
            env['KEEL_PDF_PUBLICATION_FDS'] = ','.join(str(fd) for fd in lock_fds)
        with tempfile.TemporaryDirectory(prefix='scanner-refresh-', dir=base.parent) as directory:
            candidate = Path(directory) / 'pdf-sandbox.json'
            for suffix, content in zip(('', '.probe'), originals[:2]):
                path = Path(str(candidate) + suffix)
                path.write_bytes(content)
                path.chmod(0o600)
            # Existing builder performs the real clean synthetic scan before its
            # atomic write. The active scanner is untouched on any build failure.
            node('scripts/pdf-sandbox-build.ts', '--scanner-only', extra={
                'KEEL_PDF_SANDBOX_SOCKET': socket,
                'KEEL_PDF_SANDBOX_CONFIG': str(candidate)})
            node('scripts/pdf-sandbox-setup.ts', 'check', extra={
                'KEEL_PDF_SANDBOX_CONFIG': str(candidate)})
            staged = Path(str(candidate) + '.scanner')
            private_bytes(staged)
            if any(private_bytes(path) != content for path, content in zip(paths, originals)):
                raise RuntimeError('Local bindings changed during refresh; candidate not adopted')
            current_parent = base.parent.lstat()
            if (not stat.S_ISDIR(current_parent.st_mode)
                    or current_parent.st_uid != os.getuid()
                    or current_parent.st_mode & 0o022
                    or (current_parent.st_dev, current_parent.st_ino) != parent_identity):
                raise RuntimeError('Local PDF binding directory changed; candidate not adopted')
            if sys.platform == 'darwin':
                receipt = Path(str(candidate) + '.scanner.receipt')
                private_bytes(receipt)
                # Builder emitted this proof only after its admitted clean scan.
                # Publish proof first; any interrupted pair fails identity checks.
                os.replace(receipt, Path(str(base) + '.scanner.receipt'))
            os.replace(staged, paths[2])
            try:
                node('scripts/pdf-sandbox-setup.ts', 'register')
            except Exception as error:
                raise RuntimeError('Scanner refreshed locally, but registry update failed; run make pdf-sandbox-register') from error
    print('Scanner refreshed and registered. Run make provider-document-runtime-verify and make pdf-sandbox-verify.')


if __name__ == '__main__':
    import sys
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Scanner refresh interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        if len(sys.argv) != 1:
            raise RuntimeError('Usage: make pdf-sandbox-refresh')
        refresh(Path.cwd())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
