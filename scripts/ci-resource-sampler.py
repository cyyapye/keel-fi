#!/usr/bin/env python3
"""Bounded Linux host counters for synthetic CI performance diagnosis."""

import json
import os
import re
from pathlib import Path
import time


# Bounds apply even on a crowded or inaccessible host. No per-thread walk, target
# environment reads, subprocesses, network calls, or command/path disclosure.
MAX_ENTRIES = 8192
MAX_PIDS = 2048
MAX_TRACKED = 512
MAX_DEPTH = 32
MAX_CMD_BYTES = 8192
INTERVAL_SECONDS = 5
MAX_DURATION_SECONDS = 1800


def read_bytes(path, limit):
    # Procfs inputs are small and already bounded. Avoid a buffered stream and
    # its metadata/buffer setup for every read; still consume short reads to EOF.
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC)
    try:
        data = bytearray()
        while len(data) <= limit:
            chunk = os.read(descriptor, limit + 1 - len(data))
            if not chunk:
                return bytes(data)
            data.extend(chunk)
        raise ValueError("observer input exceeds byte bound")
    finally:
        os.close(descriptor)


def read_stat(proc, pid):
    raw = read_bytes(f"{proc}/{pid}/stat", 4096)
    fields = raw[raw.rindex(b")") + 2:].split()
    values = [int(fields[index]) for index in (1, 2, 3, 11, 12, 19)]
    if min(values) < 0 or max(values) > 2**64 - 1 or int(raw.split(b" ", 1)[0]) != pid:
        raise ValueError("invalid process counters")
    parent, group, session, user, system, start = values
    return {"pid": pid, "parent": parent, "group": group, "session": session,
            "start": start, "cpu": user + system}


def identity(process):
    return process["pid"], process["start"]


def same_process(first, second):
    return all(first[key] == second[key] for key in ("pid", "start", "parent", "group", "session"))


class FlowSampler:
    def __init__(self, repo, source, flows, *, proc=Path("/proc"), scope_pid=None, ticks_per_second=None):
        if (not isinstance(flows, dict) or not 1 <= len(flows) <= 32
                or any(not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", name)
                       or not isinstance(argv, list) or not 1 <= len(argv) <= 128
                       or any(not isinstance(arg, str) or not arg or "\0" in arg for arg in argv)
                       or sum(len(arg.encode()) + 1 for arg in argv) > MAX_CMD_BYTES
                       for name, argv in flows.items())
                or len({tuple(argv) for argv in flows.values()}) != len(flows)):
            raise ValueError("invalid bounded flow map")
        self.proc, self.repo = os.fspath(proc), repo.resolve()
        self.flows = flows
        self.commands = {tuple(arg.encode() for arg in argv): name for name, argv in flows.items()}
        source = source.resolve()
        self.coordinator_args = tuple(arg.encode() for arg in [
            "-I", str(source / "plugins/tugling/scripts/project_contract.py"),
            "--repo", str(self.repo), "--config", ".tugling/pilot.json",
            "--source-root", str(source), "--source-mode", "pinned", "--json", "--run-required",
        ])
        self.scope = read_stat(proc, os.getppid() if scope_pid is None else scope_pid)
        self.ticks = os.sysconf("SC_CLK_TCK") if ticks_per_second is None else ticks_per_second
        if not isinstance(self.ticks, int) or self.ticks <= 0:
            raise ValueError("invalid clock tick rate")
        self.previous = {}
        self.last_time = None

    @classmethod
    def from_environment(cls):
        repo = Path(__file__).resolve().parent.parent
        mapping = json.loads(read_bytes(repo / ".tugling/pilot-verification.json", 131072))
        flows = mapping["flows"]
        if not isinstance(flows, list) or not 1 <= len(flows) <= 32:
            raise ValueError("invalid bounded flow map")
        by_id = {flow["id"]: flow["argv"] for flow in flows}
        if len(by_id) != len(flows):
            raise ValueError("duplicate flow names")
        return cls(repo, Path(os.environ["TUGLING_PILOT_SOURCE"]), by_id)

    def collect(self):
        started, cpu_started = time.monotonic_ns(), time.process_time_ns()
        result = {"status": "sampled-lower-bound", "schedstats_enabled": None,
                  "clock_ticks_per_second": self.ticks,
                  "discovery_limited": False, "tracking_limited": False,
                  "pids_examined": 0, "read_errors": 0, "ancestry_incomplete": 0,
                  "interval_ns": None if self.last_time is None else started - self.last_time,
                  "flows": {name: {"observed_processes": 0, "new_processes": 0, "lost_processes": 0,
                                   "cpu_delta_processes": 0, "cpu_delta_ns": None,
                                   "runqueue_delta_processes": 0, "main_thread_runqueue_delta_ns": None,
                                   "counter_resets": 0} for name in self.flows}}
        self.last_time = started
        processes, current, roots = {}, {}, {}

        def read(call):
            try:
                return call()
            except (OSError, ValueError, IndexError):
                result["read_errors"] += 1
                return None

        def command(pid):
            raw = read_bytes(f"{self.proc}/{pid}/cmdline", MAX_CMD_BYTES)
            if not raw.endswith(b"\0"):
                raise ValueError("incomplete command")
            return tuple(raw[:-1].split(b"\0"))

        enabled = read(lambda: read_bytes(f"{self.proc}/sys/kernel/sched_schedstats", 16).strip())
        result["schedstats_enabled"] = {b"0": False, b"1": True}.get(enabled)
        try:
            with os.scandir(self.proc) as entries:
                for count, entry in enumerate(entries):
                    if count >= MAX_ENTRIES or result["pids_examined"] >= MAX_PIDS:
                        result["discovery_limited"] = True
                        break
                    if not entry.name.isdigit():
                        continue
                    result["pids_examined"] += 1
                    owner = read(lambda: entry.stat(follow_symlinks=False).st_uid)
                    if owner != os.getuid():
                        continue
                    process = read(lambda: read_stat(self.proc, int(entry.name)))
                    if process is not None:
                        processes[process["pid"]] = process
        except OSError:
            result["read_errors"] += 1

        scope = processes.get(self.scope["pid"])
        scope_ok = scope is not None and identity(scope) == identity(self.scope)

        def ancestors(pid):
            seen, chain = set(), []
            for _ in range(MAX_DEPTH):
                item = processes.get(pid)
                if item is None or pid in seen:
                    result["ancestry_incomplete"] += 1
                    return []
                seen.add(pid)
                chain.append(pid)
                if pid == self.scope["pid"]:
                    return chain if scope_ok else []
                if item["parent"] <= 1:
                    return []
                parent = processes.get(item["parent"])
                if parent is not None and parent["start"] > item["start"]:
                    result["ancestry_incomplete"] += 1
                    return []
                pid = item["parent"]
            result["ancestry_incomplete"] += 1
            return []

        chains = {pid: ancestors(pid) for pid in processes} if scope_ok else {}
        coordinators = {}
        for pid, item in processes.items():
            if not chains.get(pid) or not pid == item["group"] == item["session"]:
                continue
            parent = item["parent"]
            if parent not in coordinators:
                argv = read(lambda: command(parent))
                coordinators[parent] = bool(argv and argv[1:] == self.coordinator_args)
            if not coordinators[parent]:
                continue
            argv = read(lambda: command(pid))
            name = self.commands.get(argv)
            if name and read(lambda: Path(f"{self.proc}/{pid}/cwd").resolve(strict=True)) == self.repo:
                roots[pid] = (name, identity(item))

        # Visit roots first so a tracking cap cannot keep descendants but lose their root.
        selected = list(roots) + [pid for pid in processes if pid not in roots]
        for pid in selected:
            root = next((ancestor for ancestor in chains.get(pid, []) if ancestor in roots), None)
            if root is None:
                continue
            if len(current) >= MAX_TRACKED:
                result["tracking_limited"] = True
                break
            item = processes[pid]
            delay = None
            if result["schedstats_enabled"] is True:
                raw = read(lambda: read_bytes(f"{self.proc}/{pid}/schedstat", 128).split())
                if raw is not None:
                    def parse_delay():
                        values = list(map(int, raw))
                        if len(values) != 3 or min(values) < 0 or max(values) > 2**64 - 1:
                            raise ValueError("invalid scheduler counters")
                        return values[1]
                    delay = read(parse_delay)
            after = read(lambda: read_stat(self.proc, pid))
            if after is None or not same_process(item, after):
                result["read_errors"] += 1
                continue
            current[identity(item)] = {"owner": roots[root], "cpu": item["cpu"], "delay": delay}

        # Reject a root/coordinator/scope replaced or reparented during this scan.
        invalid, rechecked = set(), {}
        for root in roots:
            for pid in (root, processes[root]["parent"], self.scope["pid"]):
                if pid not in rechecked:
                    rechecked[pid] = read(lambda: read_stat(self.proc, pid))
                after = rechecked[pid]
                if after is None or not same_process(processes[pid], after):
                    invalid.add(roots[root])
                    result["read_errors"] += 1
        current = {key: value for key, value in current.items() if value["owner"] not in invalid}
        for key, value in current.items():
            row = result["flows"][value["owner"][0]]
            row["observed_processes"] += 1
            prior = self.previous.get(key)
            if prior is None or prior["owner"] != value["owner"]:
                row["new_processes"] += 1
                continue
            for field, total, count, multiplier in (
                ("cpu", "cpu_delta_ns", "cpu_delta_processes", 1_000_000_000),
                ("delay", "main_thread_runqueue_delta_ns", "runqueue_delta_processes", 1),
            ):
                if value[field] is None or prior[field] is None:
                    continue
                delta = value[field] - prior[field]
                if delta < 0:
                    row["counter_resets"] += 1
                    continue
                row[count] += 1
                row[total] = (row[total] or 0) + delta * multiplier // (self.ticks if field == "cpu" else 1)
        for key, prior in self.previous.items():
            if key not in current or current[key]["owner"] != prior["owner"]:
                result["flows"][prior["owner"][0]]["lost_processes"] += 1
        self.previous = current
        if not scope_ok:
            result["status"] = "scope-unavailable"
        result["collection_wall_ns"] = time.monotonic_ns() - started
        result["collection_cpu_ns"] = time.process_time_ns() - cpu_started
        return result


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
    try:
        flows = FlowSampler.from_environment()
    except (OSError, ValueError, KeyError, TypeError):
        flows = None

    def observed_sample():
        record = sample()
        record["flow_resources"] = flows.collect() if flows else {"status": "unavailable"}
        return record

    previous = observed_sample()
    print(json.dumps(previous), flush=True)
    # The workflow terminates this child on exit; this independent ceiling also
    # prevents an abandoned observer from becoming a persistent host workload.
    deadline = time.monotonic() + MAX_DURATION_SECONDS
    while time.monotonic() < deadline:
        time.sleep(INTERVAL_SECONDS)
        current = observed_sample()
        ticks = sum(current["cpu"]) - sum(previous["cpu"])
        idle = current["cpu"][3] - previous["cpu"][3]
        iowait = current["cpu"][4] - previous["cpu"][4]
        current["cpu_busy_percent"] = round(100 * (ticks - idle - iowait) / ticks, 1) if ticks else 0
        current["iowait_percent"] = round(100 * iowait / ticks, 1) if ticks else 0
        print(json.dumps(current), flush=True)
        previous = current


if __name__ == "__main__":
    main()
