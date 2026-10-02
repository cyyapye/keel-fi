"""Cross-process ownership and interruption proofs; real Docker is proved separately."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location("owner", Path(__file__).with_name("pdf-sandbox-owner.py"))
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)

FAKE_DOCKER = '''#!/usr/bin/env python3
import os,sys,time
from pathlib import Path
root=Path(__file__).parent
args=sys.argv[5:]
if args[0]=='rm':
    (root/'cleanup.started').write_text(args[-1])
    while (root/'cleanup.gate').exists(): time.sleep(.01)
    if (root/'cleanup.fail').exists(): sys.exit(1)
    (root/'occupied').unlink(missing_ok=True)
    sys.exit(0)
if args[0]=='ps':
    if (root/'occupied').exists(): print('synthetic-container')
    sys.exit(0)
sys.exit(1)
'''


class SandboxOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.locks = self.root / 'locks'
        self.socket_path = self.root / 'docker.sock'
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(str(self.socket_path))
        self.addCleanup(self.socket.close)
        self.config = self.root / 'config'
        self.config.mkdir(mode=0o700)
        fake = self.root / 'docker'
        fake.write_text(FAKE_DOCKER)
        fake.chmod(0o700)
        self.environment = {'PATH': str(self.root) + os.pathsep + os.environ['PATH'], 'LANG': 'C.UTF-8'}
        self.key = hashlib.sha256(os.fsencode(os.path.realpath(self.socket_path))).hexdigest()
        self.serial = 0

    def launcher(self):
        return (
            "import importlib.util,sys; from pathlib import Path; "
            f"s=importlib.util.spec_from_file_location('owner', {str(Path(owner.__file__).resolve())!r}); "
            "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
            f"m.LOCK_ROOT=Path({str(self.locks)!r}); sys.exit(m.main())"
        )

    def start(self, settings=''):
        self.serial += 1
        name = f'keel-pdf-{self.serial:08x}-0000-0000-0000-000000000000'
        process = subprocess.Popen(
            [sys.executable, '-I', '-B', '-c', self.launcher().replace('sys.exit(m.main())', settings + '; sys.exit(m.main())' if settings else 'sys.exit(m.main())'), str(self.socket_path), str(self.config), name],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=self.environment, bufsize=0,
        )
        self.addCleanup(self.stop, process)
        return process

    @staticmethod
    def stop(process):
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for pipe in (process.stdin, process.stdout):
            if pipe and not pipe.closed: pipe.close()

    def line(self, process):
        self.assertTrue(select.select([process.stdout], [], [], 5)[0], 'owner did not reach protocol barrier')
        return process.stdout.readline().decode().strip()

    def ready(self, process):
        self.assertEqual(self.line(process), owner.READY)
        process.stdin.write((owner.CREATED + '\n').encode())
        process.stdin.flush()
        self.assertEqual(self.line(process), owner.CREATED)

    def release(self, process):
        process.stdin.close()
        self.assertEqual(self.line(process), owner.RELEASED)
        self.assertEqual(process.wait(timeout=5), 0)

    def until(self, predicate):
        deadline = time.monotonic() + 5
        while not predicate():
            if time.monotonic() >= deadline: self.fail('ownership barrier not reached')
            time.sleep(.005)

    def waiter_count(self):
        count = 0
        for path in self.locks.glob('*.waiter-*'):
            with path.open('r+') as lock:
                try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: count += 1
        return count

    def test_serializes_processes_through_confirmed_cleanup(self):
        first = self.start()
        self.ready(first)
        (self.root / 'occupied').touch()
        (self.root / 'cleanup.gate').touch()
        second = self.start()
        self.until(lambda: self.waiter_count() == 2)
        first.stdin.close()
        self.until(lambda: (self.root / 'cleanup.started').exists())
        self.assertFalse(select.select([second.stdout], [], [], 0)[0])
        (self.root / 'cleanup.gate').unlink()
        self.assertEqual(self.line(first), owner.RELEASED)
        self.assertEqual(first.wait(timeout=5), 0)
        self.ready(second)
        self.release(second)

    def test_parent_sigkill_cleans_up_before_next_admission(self):
        # The helper's stdin belongs to a real caller process. Killing the caller
        # closes the pipe even though none of its finally blocks can execute.
        command = [sys.executable, '-I', '-B', '-c', self.launcher(), str(self.socket_path), str(self.config),
                   'keel-pdf-aaaaaaaa-0000-0000-0000-000000000000']
        parent_code = (
            "import subprocess,time; "
            f"p=subprocess.Popen({command!r}, stdin=subprocess.PIPE, stdout=subprocess.PIPE); "
            "print(p.pid, flush=True); ready=p.stdout.readline().decode().strip(); "
            f"p.stdin.write({(owner.CREATED + chr(10)).encode()!r}); p.stdin.flush(); p.stdout.readline(); "
            "print(ready, flush=True); time.sleep(60)"
        )
        parent = subprocess.Popen([sys.executable, '-I', '-B', '-c', parent_code], stdout=subprocess.PIPE,
                                  env=self.environment, stderr=subprocess.DEVNULL, bufsize=0)
        self.addCleanup(self.stop, parent)
        helper_pid = int(self.line(parent))
        self.addCleanup(self.kill_if_owned, helper_pid)
        self.assertEqual(self.line(parent), owner.READY)
        (self.root / 'occupied').touch()
        (self.root / 'cleanup.gate').touch()
        next_owner = self.start()
        self.until(lambda: self.waiter_count() == 2)
        parent.kill()
        parent.wait(timeout=5)
        self.until(lambda: (self.root / 'cleanup.started').exists())
        self.assertFalse(select.select([next_owner.stdout], [], [], 0)[0])
        (self.root / 'cleanup.gate').unlink()
        self.ready(next_owner)
        self.release(next_owner)
        self.assertFalse((self.root / 'occupied').exists())

    def kill_if_owned(self, pid):
        args = subprocess.run(['ps', '-p', str(pid), '-o', 'args='], capture_output=True, text=True, check=False).stdout
        if str(self.root) in args and 'm.main()' in args:
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass

    def test_owner_sigterm_cleans_up_without_claiming_success(self):
        process = self.start()
        self.ready(process)
        (self.root / 'occupied').touch()
        process.terminate()
        self.assertEqual(json.loads(self.line(process)), {'reason': 'owner_lost'})
        self.assertEqual(process.wait(timeout=5), 1)
        self.assertFalse((self.root / 'occupied').exists())
        following = self.start()
        self.ready(following)
        self.release(following)

    def test_hard_killed_owner_refuses_even_temporarily_empty_daemon(self):
        first = self.start()
        self.ready(first)
        first.kill()
        first.wait(timeout=5)
        # No container is visible yet; an in-flight create could still arrive.
        second = self.start()
        self.assertEqual(json.loads(self.line(second)), {'reason': 'runtime_busy'})
        self.assertEqual(second.wait(timeout=5), 1)
        self.assertFalse((self.root / 'cleanup.started').exists())

    def test_bounded_admission_and_waiting_caller_exit(self):
        first = self.start()
        self.ready(first)
        waiting = [self.start() for _ in range(owner.WAITERS - 1)]
        self.until(lambda: self.waiter_count() == owner.WAITERS)
        rejected = self.start()
        self.assertEqual(json.loads(self.line(rejected)), {'reason': 'runtime_busy'})
        self.assertEqual(rejected.wait(timeout=5), 1)
        for process in waiting:
            process.stdin.close()
            self.assertEqual(process.wait(timeout=5), 0)
        self.assertEqual(self.waiter_count(), 1)
        self.release(first)

    def test_cleanup_failure_keeps_dirty_journal_and_refuses_new_work(self):
        first = self.start()
        self.ready(first)
        (self.root / 'occupied').touch()
        (self.root / 'cleanup.fail').touch()
        first.stdin.close()
        self.assertEqual(json.loads(self.line(first)), {'reason': 'cleanup_failed'})
        self.assertEqual(first.wait(timeout=5), 1)
        (self.root / 'occupied').unlink()
        second = self.start()
        self.assertEqual(json.loads(self.line(second)), {'reason': 'runtime_busy'})
        self.assertEqual(second.wait(timeout=5), 1)

    def test_refuses_legacy_occupancy_and_unsafe_lock_files(self):
        (self.root / 'occupied').touch()
        process = self.start()
        self.assertEqual(json.loads(self.line(process)), {'reason': 'runtime_busy'})
        self.assertEqual(process.wait(timeout=5), 1)
        self.assertFalse((self.root / 'cleanup.started').exists())
        (self.root / 'occupied').unlink()
        capacity = self.locks / f'{self.key}.capacity'
        capacity.unlink()
        capacity.symlink_to(self.root / 'occupied')
        process = self.start()
        self.assertEqual(json.loads(self.line(process)), {'reason': 'owner_unavailable'})
        self.assertEqual(process.wait(timeout=5), 1)
        capacity.unlink()
        capacity.touch(mode=0o666)
        capacity.chmod(0o666)
        process = self.start()
        self.assertEqual(json.loads(self.line(process)), {'reason': 'owner_unavailable'})
        self.assertEqual(process.wait(timeout=5), 1)

    def test_admission_and_owner_deadlines_cancel_without_retry(self):
        self.assertEqual((owner.WAITERS, owner.ADMISSION_SECONDS, owner.OWNERSHIP_SECONDS, owner.CONTROL_SECONDS), (8, 120, 180, 10))
        first = self.start()
        self.ready(first)
        rejected = self.start('m.ADMISSION_SECONDS=0')
        self.assertEqual(json.loads(self.line(rejected)), {'reason': 'runtime_busy'})
        self.assertEqual(rejected.wait(timeout=5), 1)
        self.assertFalse((self.root / 'cleanup.started').exists())
        self.release(first)
        clock = self.root / 'advance-clock'
        expiring = self.start(f'clock=Path({str(clock)!r}); real=m.time.monotonic; m.time.monotonic=lambda: real() + (181 if clock.exists() else 0)')
        self.ready(expiring)
        clock.touch()
        # Wake the wait after advancing its clock; no startup/expiry sleep.
        expiring.stdin.write(b'x')
        expiring.stdin.flush()
        self.assertEqual(json.loads(self.line(expiring)), {'reason': 'owner_lost'})
        self.assertEqual(expiring.wait(timeout=5), 1)
        following = self.start()
        self.ready(following)
        self.release(following)

    def test_unconfirmed_create_never_recovers_from_momentary_absence(self):
        first = self.start()
        self.assertEqual(self.line(first), owner.READY)
        first.stdin.close()
        self.assertEqual(json.loads(self.line(first)), {'reason': 'creation_unconfirmed'})
        self.assertEqual(first.wait(timeout=5), 1)
        self.assertFalse((self.root / 'occupied').exists())
        second = self.start()
        self.assertEqual(json.loads(self.line(second)), {'reason': 'runtime_busy'})
        self.assertEqual(second.wait(timeout=5), 1)


if __name__ == '__main__':
    unittest.main()
