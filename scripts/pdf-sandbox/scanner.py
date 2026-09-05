"""Offline malware scan. Only bounded stdin bytes enter this disposable worker."""
import datetime
import hashlib
import importlib.util
import json
import re
import subprocess
import sys

spec = importlib.util.spec_from_file_location("boundary", "/opt/keel/boundary.py")
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


def main():
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
    result = subprocess.run([
        "/usr/bin/clamscan", "--stdout", "--no-summary", "--infected",
        "--max-filesize=8M", "--max-scansize=32M", "--max-files=100",
        "--max-recursion=8", "--max-scantime=30000", "--alert-exceeds-max=yes",
        "--alert-encrypted=yes", "--alert-broken=yes", "-",
    ], input=content, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
       timeout=70, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "TZ": "UTC"})
    if result.returncode not in (0, 1):
        raise ValueError("scanner did not finish")
    sys.stdout.write(json.dumps({
        "version": 1, "engineVersion": match[1], "databaseVersion": int(match[2]),
        "databaseUpdatedAt": database_time.isoformat().replace("+00:00", "Z"),
        "scannedAt": now.isoformat().replace("+00:00", "Z"),
        "sha256": hashlib.sha256(content).hexdigest(),
        "outcome": "clean" if result.returncode == 0 else "blocked",
    }))


try:
    main()
except Exception:
    # No filenames, content, signatures, credentials or raw tool errors in logs.
    sys.exit(2)
