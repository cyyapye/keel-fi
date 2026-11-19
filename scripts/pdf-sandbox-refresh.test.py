import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('pdf-sandbox-refresh.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RefreshTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.base = self.root / '.keel-local/pdf-sandbox.json'
        self.base.parent.mkdir()
        self.originals = []
        for i, suffix in enumerate(('', '.probe', '.scanner')):
            p = Path(str(self.base) + suffix)
            b = json.dumps({'version': 1, 'socket': str(self.root / 'socket'), 'image': 'sha256:' + str(i)*64}).encode()
            p.write_bytes(b)
            p.chmod(0o600)
            self.originals.append(b)
        self.calls = []
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def fake(self, args, **kw):
        self.calls.append((args, kw))
        if args[3].endswith('build.ts'):
            p = Path(kw['env']['KEEL_PDF_SANDBOX_CONFIG'] + '.scanner')
            p.write_bytes(b'new verified scanner')
            p.chmod(0o600)
            receipt = Path(str(p) + '.receipt')
            receipt.write_bytes(b'new verified proof')
            receipt.chmod(0o600)

    def test_success_preserves_reader_probe_and_uses_bound_socket(self):
        module.refresh(self.root, self.fake)
        self.assertEqual(self.base.read_bytes(), self.originals[0])
        self.assertEqual(Path(str(self.base)+'.probe').read_bytes(), self.originals[1])
        self.assertEqual(Path(str(self.base)+'.scanner').read_bytes(), b'new verified scanner')
        self.assertEqual(self.calls[1][1]['env']['KEEL_PDF_SANDBOX_SOCKET'], str(self.root/'socket'))
        self.assertEqual(self.calls[1][0][-1], '--scanner-only')
        self.assertEqual(len(self.calls[1][1]['pass_fds']), 2 if sys.platform == 'darwin' else 1)
        self.assertEqual(self.calls[-1][0][-1], 'register')

    def test_failed_build_keeps_original_binding_and_no_registration(self):
        def fail(args, **kw):
            if args[3].endswith('build.ts'):
                raise subprocess.CalledProcessError(1, args)
            self.fake(args, **kw)
        with self.assertRaises(subprocess.CalledProcessError):
            module.refresh(self.root, fail)
        self.assertEqual(Path(str(self.base)+'.scanner').read_bytes(), self.originals[2])
        self.assertFalse(any(a[-1]=='register' for a,k in self.calls))

    def test_concurrent_binding_change_refuses_adoption(self):
        def change(args, **kw):
            self.fake(args, **kw)
            if args[3].endswith('build.ts'):
                self.base.write_bytes(b'changed externally')
        with self.assertRaisesRegex(RuntimeError, 'changed during refresh'):
            module.refresh(self.root, change)
        self.assertEqual(Path(str(self.base)+'.scanner').read_bytes(), self.originals[2])

    def test_unsafe_parent_rejected_before_commands(self):
        self.base.parent.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, 'Unsafe local PDF binding directory'):
            module.refresh(self.root, self.fake)
        self.assertEqual(self.calls, [])

    def test_symlink_parent_rejected_before_commands(self):
        other = self.root / 'other'
        self.base.parent.rename(other)
        self.base.parent.symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'Unsafe local PDF binding directory'):
            module.refresh(self.root, self.fake)
        self.assertEqual(self.calls, [])

    def test_override_and_ci_refused_before_commands(self):
        for key in ['CI', 'KEEL_PDF_SANDBOX_CONFIG']:
            with patch.dict(os.environ, {key:'true'}):
                with self.assertRaisesRegex(RuntimeError, 'not supported'):
                    module.refresh(self.root, self.fake)
        self.assertEqual(self.calls, [])

    def test_registry_failure_reports_partial_success(self):
        def fail(args, **kw):
            self.fake(args, **kw)
            if args[-1] == 'register':
                raise subprocess.CalledProcessError(1,args)
        with self.assertRaisesRegex(RuntimeError,'refreshed locally, but registry update failed'):
            module.refresh(self.root, fail)
        self.assertEqual(Path(str(self.base)+'.scanner').read_bytes(),b'new verified scanner')

    def test_nested_refresh_refuses_same_daemon_lock(self):
        def nested(args, **kw):
            if args[3].endswith('build.ts'):
                with self.assertRaisesRegex(RuntimeError,'Another explicit refresh'):
                    module.refresh(self.root,self.fake)
            self.fake(args, **kw)
        module.refresh(self.root,nested)

if __name__ == '__main__':
    unittest.main()
