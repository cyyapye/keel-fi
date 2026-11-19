#!/usr/bin/env python3
"""Fail-fast pre-build check; never erase a journal, create a container or restart."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

spec=importlib.util.spec_from_file_location('owner',Path(__file__).with_name('pdf-sandbox-owner.py'))
owner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)

def check(socket):
    if not os.path.isabs(socket) or not stat.S_ISSOCK(os.stat(socket).st_mode):
        raise ValueError('invalid_runtime')
    root=owner.LOCK_ROOT
    metadata=root.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid!=os.geteuid() or metadata.st_mode & 0o077:
        raise ValueError('unsafe_owner_directory')
    key=hashlib.sha256(os.fsencode(os.path.realpath(socket))).hexdigest()
    # Existing owner's exact lock/validation, nonblocking and read-only journal.
    with owner.owned_lock(root/(key+'.capacity')) as capacity:
        fcntl.flock(capacity,fcntl.LOCK_EX|fcntl.LOCK_NB)
        value=capacity.read(256)
        if value and value!=json.dumps({'state':'idle'}):
            raise ValueError('owner_recovery_required')
        with tempfile.TemporaryDirectory(prefix='keel-scanner-idle-') as directory:
            code, output=owner.docker(socket,directory,['ps','--all','--filter','label=keel.pdf-sandbox=1','--format','{{.ID}}'])
            if code or output: raise ValueError('runtime_busy')

if __name__=='__main__':
    try:
        if len(sys.argv)!=2: raise ValueError('invalid_arguments')
        check(sys.argv[1])
    except Exception:
        print('scanner_refresh_busy_or_unavailable',file=sys.stderr)
        sys.exit(1)
