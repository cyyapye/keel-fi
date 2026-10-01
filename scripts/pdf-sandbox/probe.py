"""Synthetic isolation tests only; excluded from the production image."""
import importlib.util
import errno
import json
import os
import socket
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location("boundary", "/opt/keel/boundary.py")
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)
boundary.ready()
request = json.loads(sys.stdin.buffer.read(4096))
mode = request["mode"]
if mode == "access":
    def blocked(fn):
        try:
            fn()
            return False
        except OSError:
            return True

    connection = socket.socket()
    connection.settimeout(1)
    try:
        connection.connect(("192.0.2.1", 443))
        network_blocked = False
    except OSError as error:
        # An unreachable test server or timeout is not proof of isolation. This
        # netns must reject the attempt immediately because it has no route.
        network_blocked = error.errno == errno.ENETUNREACH
    result = {
        "hostReadBlocked": blocked(lambda: open(request["canary"], "rb")),
        "hostWriteBlocked": blocked(lambda: open(request["canary"], "wb")),
        "rootWriteBlocked": blocked(lambda: open("/etc/keel-synthetic-canary", "wb")),
        "networkBlocked": network_blocked,
        "credentialMissing": "KEEL_SYNTHETIC_SECRET" not in os.environ,
        "socketMissing": not os.path.exists("/var/run/docker.sock"),
    }
    boundary.respond(page_count=1, text=json.dumps(result))
elif mode == "memory":
    chunks = []
    while True:
        chunks.append(bytearray(16 * 1024 * 1024))
elif mode == "processes":
    children = []
    try:
        for _ in range(40):
            children.append(subprocess.Popen(["/bin/sleep", "60"]))
        boundary.respond(page_count=1, text="process-limit-not-enforced")
    except OSError:
        boundary.respond(page_count=1, text="process-limit-enforced")
    finally:
        for child in children:
            child.kill()
            child.wait()
elif mode == "timeout":
    time.sleep(60)
elif mode == "orphan":
    # Test-only execution barrier; excluded from the production reader image.
    print("KEEL_PDF_ORPHAN_RUNNING_V1", flush=True)
    time.sleep(60)
elif mode == "output":
    sys.stdout.write("x" * (7 * 1024 * 1024))
    sys.stdout.flush()
