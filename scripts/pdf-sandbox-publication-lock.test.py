import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).with_name('pdf-sandbox-publication-lock.py')
spec = importlib.util.spec_from_file_location('lease', HELPER)
lease = importlib.util.module_from_spec(spec); spec.loader.exec_module(lease)

class PublicationTests(unittest.TestCase):
    def test_inherited_description_retains_lock_after_validator_exit(self):
        with tempfile.TemporaryDirectory() as d:
            socket = str(Path(d) / 'synthetic.sock')
            locks = lease.acquire(socket)
            try:
                fds = tuple(x.fileno() for x in locks)
                code = "import importlib.util,sys; s=importlib.util.spec_from_file_location('l',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);x=m.acquire(sys.argv[2],tuple(map(int,sys.argv[3:])));[f.close() for f in x]"
                subprocess.run([sys.executable, '-c', code, str(HELPER), socket, *map(str,fds)], pass_fds=fds, check=True)
                with self.assertRaises(BlockingIOError): lease.acquire(socket)
                with self.assertRaises(BlockingIOError): lease.acquire(socket+'-other-daemon')
            finally:
                for stream in locks: stream.close()
            locks = lease.acquire(socket)
            for stream in locks: stream.close()

    def test_fake_inherited_descriptor_fails_closed(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryFile() as fake:
            with self.assertRaises((RuntimeError, FileNotFoundError)):
                lease.acquire(str(Path(d)/'synthetic.sock'), (fake.fileno(),fake.fileno()))

if __name__ == '__main__': unittest.main()
