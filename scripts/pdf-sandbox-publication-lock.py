#!/usr/bin/env python3
"""Cooperative publication lease. No Docker, document bytes or credentials."""
import fcntl
import hashlib
import os
from pathlib import Path
import stat
import sys


def acquire(socket, inherited=()):
    key = hashlib.sha256(os.fsencode(os.path.realpath(socket))).hexdigest()
    root = Path('/tmp') / f'keel-pdf-refresh-{os.getuid()}'
    root.mkdir(mode=0o700, exist_ok=True)
    metadata = root.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise RuntimeError('Unsafe publication lock directory')
    streams = []
    try:
        for index, name in enumerate(('publication.lock', key + '.lock')):
            path = root / name
            fd = os.dup(inherited[index]) if inherited else os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            stream = os.fdopen(fd, 'r+')
            streams.append(stream)
            metadata = os.fstat(fd)
            current = path.lstat()
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                    or metadata.st_mode & 0o077 or metadata.st_nlink != 1
                    or not stat.S_ISREG(current.st_mode)
                    or (current.st_dev, current.st_ino) != (metadata.st_dev, metadata.st_ino)):
                raise RuntimeError('Unsafe publication lock file')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return streams
    except BaseException:
        for stream in streams: stream.close()
        raise


if __name__ == '__main__':
    try:
        if len(sys.argv) not in (2, 3) or not os.path.isabs(sys.argv[1]):
            raise RuntimeError('Expected canonicalizable absolute socket path')
        inherited = (3, 4) if len(sys.argv) == 3 and sys.argv[2] in ('--inherit', '--acquire-fds') else ()
        if len(sys.argv) == 3 and not inherited: raise RuntimeError('Invalid mode')
        locks = acquire(sys.argv[1], inherited)
        try:
            if len(sys.argv) != 3 or sys.argv[2] != '--acquire-fds':
                print('LOCKED', flush=True)
                sys.stdin.buffer.read()
        finally:
            for stream in reversed(locks): stream.close()
    except Exception:
        print('PDF publication lock unavailable; no publication permitted', file=sys.stderr)
        sys.exit(1)
