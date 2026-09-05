"""Check kernel-enforced limits BEFORE reading a single private input byte."""
import json
import os
import resource
import sys

MEMORY = 256 * 1024 * 1024


def ready(memory=MEMORY):
    def read(path):
        with open(path, encoding="ascii") as source:
            return source.read().strip()

    status = dict(line.split(":", 1) for line in read("/proc/self/status").splitlines())
    assert os.getuid() == 65532 and os.getgid() == 65532
    assert status["NoNewPrivs"].strip() == "1"
    assert status["Seccomp"].strip() == "2"
    assert int(status["CapEff"].strip(), 16) == 0
    assert int(read("/sys/fs/cgroup/memory.max")) == memory
    assert read("/sys/fs/cgroup/memory.swap.max") == "0"
    assert int(read("/sys/fs/cgroup/pids.max")) == 32
    quota, period = read("/sys/fs/cgroup/cpu.max").split()
    assert 0 < int(quota) <= int(period)
    assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)
    assert resource.getrlimit(resource.RLIMIT_NOFILE) == (64, 64)
    assert os.statvfs("/").f_flag & os.ST_RDONLY
    # Independent of Docker's config: no external interface exists in this netns.
    assert set(os.listdir("/sys/class/net")) <= {"lo"}
    sys.stdout.write('KEEL_PDF_SANDBOX_READY_V1\n')
    sys.stdout.flush()


def respond(problem=None, page_count=0, text=""):
    sys.stdout.write(json.dumps({"pageCount": page_count, "problem": problem, "text": text}))
    sys.stdout.flush()
