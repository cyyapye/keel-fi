"""Offline malware scan. Only bounded stdin bytes enter this disposable worker."""
import datetime
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile


def findings_for(returncode, output):
    """Only exact scanner signature tokens may leave the disposable worker."""
    if returncode not in (0, 1) or len(output) > 4096:
        raise ValueError("scanner did not finish")
    signatures = list(dict.fromkeys(re.findall(
        rb"^stdin: ([A-Za-z0-9][A-Za-z0-9_.-]{0,159}) FOUND\r?$", output, re.MULTILINE)))
    if returncode == 0:
        # Do not treat a contradictory result as a clean scan.
        if signatures or b"FOUND" in output:
            raise ValueError("inconsistent scanner result")
        return []
    if not signatures or len(signatures) > 8:
        return [{"reason": "unknown_alert", "signature": None}]
    findings = []
    for value in signatures:
        signature = value.decode("ascii")
        if signature.startswith("Heuristics.Encrypted."):
            reason = "encrypted"
        elif signature == "Heuristics.Limits.Exceeded" or signature.startswith("Heuristics.Limits.Exceeded."):
            reason = "scan_limit"
        elif signature.startswith("Heuristics.Broken."):
            reason = "broken_executable"
        elif signature.startswith("Heuristics."):
            reason = "heuristic"
        else:
            reason = "malware_signature"
        findings.append({"reason": reason, "signature": signature})
    return findings


def main():
    spec = importlib.util.spec_from_file_location("boundary", "/opt/keel/boundary.py")
    boundary = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(boundary)
    boundary.ready(memory=3 * 1024 * 1024 * 1024)
    content = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024:
        raise ValueError("bounded input")
    # Signature freshness is measured from the vendor's database timestamp,
    # never a copied file's mtime or the image build date.
    version = subprocess.run(["/usr/bin/clamscan", "--version"], capture_output=True,
                             timeout=10, check=True).stdout.decode("ascii").strip()
    match = re.fullmatch(r"ClamAV ([0-9.]+)/([0-9]+)/(.+)", version)
    if match is None:
        raise ValueError("scanner version")
    database_time = datetime.datetime.strptime(match[3], "%a %b %d %H:%M:%S %Y").replace(tzinfo=datetime.timezone.utc)
    now = datetime.datetime.now(datetime.timezone.utc)
    if not 0 <= (now - database_time).total_seconds() <= 72 * 3600:
        raise ValueError("stale signature database")
    # Output exists only on the container's bounded tmpfs, never in host logs.
    # Read at most 4 KiB; excess output fails closed. PDF streams count toward
    # MaxFiles: 100 incorrectly blocks ordinary multi-stream agreements. Use
    # ClamAV's documented 10000-item default, still bounded by our stricter
    # byte/time/depth budgets and unchanged OS-enforced sandbox limits. Never
    # retry with relaxed flags or treat an exceeded limit as a clean scan.
    with tempfile.TemporaryFile() as output:
        result = subprocess.run([
        "/usr/bin/clamscan", "--stdout", "--no-summary", "--infected",
        "--max-filesize=8M", "--max-scansize=32M", "--max-files=10000",
        "--max-recursion=8", "--max-scantime=30000", "--alert-exceeds-max=yes",
        "--alert-encrypted=yes", "--alert-broken=yes", "-",
        ], input=content, stdout=output, stderr=subprocess.DEVNULL,
           timeout=70, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "TZ": "UTC"})
        output.seek(0)
        findings = findings_for(result.returncode, output.read(4097))
    sys.stdout.write(json.dumps({
        "version": 2, "engineVersion": match[1], "databaseVersion": int(match[2]),
        "databaseUpdatedAt": database_time.isoformat().replace("+00:00", "Z"),
        "scannedAt": now.isoformat().replace("+00:00", "Z"),
        "sha256": hashlib.sha256(content).hexdigest(),
        "outcome": "clean" if result.returncode == 0 else "blocked",
        "findings": findings,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No filenames, content, credentials or raw tool errors in logs.
        sys.exit(2)
