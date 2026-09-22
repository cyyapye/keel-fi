#!/usr/bin/env python3
"""Bounded Linux host counters for synthetic CI performance diagnosis."""

import json
from pathlib import Path
import time


def sample():
    cpu = list(map(int, Path("/proc/stat").read_text().splitlines()[0].split()[1:9]))
    memory = {line.split(":")[0]: int(line.split()[1])
              for line in Path("/proc/meminfo").read_text().splitlines()}
    pressure = {
        kind: {line.split()[0]: dict(item.split("=") for item in line.split()[1:])
               for line in Path("/proc/pressure", kind).read_text().splitlines()}
        for kind in ("cpu", "memory", "io")
    }
    return {"time": time.time(), "cpu": cpu,
            "memory_available_mib": round(memory["MemAvailable"] / 1024, 1),
            "swap_used_mib": round((memory["SwapTotal"] - memory["SwapFree"]) / 1024, 1),
            "pressure": pressure}


def main():
    previous = sample()
    print(json.dumps(previous), flush=True)
    # The workflow terminates this child on exit; this independent ceiling also
    # prevents an abandoned observer from becoming a persistent host workload.
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        time.sleep(5)
        current = sample()
        ticks = sum(current["cpu"]) - sum(previous["cpu"])
        idle = current["cpu"][3] - previous["cpu"][3]
        iowait = current["cpu"][4] - previous["cpu"][4]
        current["cpu_busy_percent"] = round(100 * (ticks - idle - iowait) / ticks, 1) if ticks else 0
        current["iowait_percent"] = round(100 * iowait / ticks, 1) if ticks else 0
        print(json.dumps(current), flush=True)
        previous = current


if __name__ == "__main__":
    main()
