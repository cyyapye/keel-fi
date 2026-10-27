"""Exercise receipt transport without weakening the existing native verifier."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ci_verification", Path(__file__).with_name("ci-verification.py"))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class ReceiptTransportTests(unittest.TestCase):
    def test_round_trip_preserves_every_field_and_has_no_output_delimiters(self):
        receipt = {"project_revision": "a" * 40, "results": [{"id": "synthetic-α", "log": "one\ntwo"}],
                   "attempt": "2", "status": "REQUIRED_PASS"}
        encoded = ci.encode_receipt(receipt)
        self.assertNotIn("\n", encoded)
        self.assertEqual(ci.decode_receipt(encoded), receipt)

    def test_missing_malformed_tampered_and_oversized_outputs_fail(self):
        valid = ci.encode_receipt({"synthetic": True})
        for value in ["", "bad", "0" * 64 + valid[64:], valid + "!", "x" * 100000]:
            with self.subTest(value=value[:10]), self.assertRaises((ValueError, TypeError)):
                ci.decode_receipt(value)
        with self.assertRaisesRegex(ValueError, "limit"):
            ci.encode_receipt({"too_large": "x" * ci.MAX_RECEIPT_BYTES})

    def test_received_receipt_still_runs_original_gate_and_failure_propagates(self):
        # Correct checksum and claimed success must not bypass actual evidence validation.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(ci, "ROOT", root), patch.dict(os.environ, {
                "NATIVE_RECEIPT": ci.encode_receipt({"status": "REQUIRED_PASS", "project_revision": "wrong"})
            }), patch("sys.argv", ["ci-verification.py", "check"]), patch.object(
                ci, "check", side_effect=ValueError("revision/attempt/coverage rejected")
            ) as verifier:
                with self.assertRaisesRegex(ValueError, "revision/attempt/coverage"):
                    ci.main()
                verifier.assert_called_once_with(ci.RECEIPT)
                self.assertEqual(json.loads((root / ci.RECEIPT).read_text())["project_revision"], "wrong")

    def test_empty_output_cannot_reuse_previous_run_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(ci, "ROOT", Path(directory)), patch.dict(os.environ, {"NATIVE_RECEIPT": ""}), \
                 patch("sys.argv", ["ci-verification.py", "check"]), patch.object(ci, "check") as verifier:
                ci.write_receipt({"status": "REQUIRED_PASS", "old": True})
                with self.assertRaisesRegex(ValueError, "Missing"):
                    ci.main()
                verifier.assert_not_called()


if __name__ == "__main__":
    unittest.main()
