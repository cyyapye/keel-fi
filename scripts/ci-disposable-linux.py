import errno
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import stat
import subprocess


NODE_CACHE_VARIABLE = "KEEL_CI_NODE_CACHE_ROOT"
NODE_CACHE_PHASES = {"preflight", "vitest-main", "vitest"}


def owned_cache_root(artifacts):
    root = artifacts / "node-compile"
    if root.resolve() != root:
        raise ValueError("Node cache must use its canonical owned path")
    for path in (root, artifacts, *artifacts.parents):
        info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (os.getuid(), 0)
                or info.st_mode & 0o022):
            raise ValueError("Node cache ancestors must be owned directories")
        if path == root and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError("Node cache root must be exclusively owned")
        if path == artifacts.parent.parent.parent:
            break
    return root


def prepare_unit_compile_cache(artifacts):
    artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
    root = artifacts / "node-compile"
    if artifacts.resolve() != artifacts:
        raise ValueError("Node cache artifacts must not follow symlinks")
    root.mkdir(mode=0o700)
    return owned_cache_root(artifacts)


def admit_unit_compile_cache(root):
    owned_cache_root(root.parent)
    phases = []
    with os.scandir(root) as children:
        for child in children:
            phases.append(Path(child.path))
            if len(phases) > 2:
                raise ValueError("Unexpected Node cache phase layout")
    names = {path.name for path in phases}
    if (len(phases) > 2 or not names.issubset(NODE_CACHE_PHASES)
            or ("vitest" in names and len(names) != 1)):
        raise ValueError("Unexpected Node cache phase layout")
    pending = [(path, 0) for path in phases]
    entries = logical_bytes = allocated_bytes = 0
    while pending:
        path, depth = pending.pop()
        info = path.lstat()
        if depth == 0 and not stat.S_ISDIR(info.st_mode):
            raise ValueError("Node cache phase must be a directory")
        entries += 1
        logical_bytes += info.st_size if stat.S_ISREG(info.st_mode) else 0
        allocated_bytes += info.st_blocks * 512
        if (entries > 8192 or logical_bytes > 64 * 1024**2 or allocated_bytes > 64 * 1024**2
                or depth > 2 or info.st_uid != os.getuid() or info.st_mode & 0o022):
            raise ValueError("Node cache exceeds owned storage admission")
        if stat.S_ISDIR(info.st_mode):
            with os.scandir(path) as children:
                for child in children:
                    if len(pending) + entries >= 8192:
                        raise ValueError("Node cache exceeds entry admission")
                    pending.append((Path(child.path), depth + 1))
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Node cache contains an unsafe entry")


def start_unit_compile_cache(artifacts, runner, environment):
    release = platform.freedesktop_os_release() if platform.system() == "Linux" else {}
    require_hosted_vm(environment, platform.system(), platform.machine(), release, os.getuid())
    root = artifacts / "node-compile"
    if environment[NODE_CACHE_VARIABLE] != str(root):
        raise ValueError("Node cache capability differs from the current artifacts")
    admit_unit_compile_cache(root)
    existing = {path.name for path in root.iterdir()}
    if (runner not in NODE_CACHE_PHASES or runner in existing
            or (runner == "vitest-main" and existing != {"preflight"})
            or (runner != "vitest-main" and existing)):
        raise ValueError("Node cache phase cannot be repeated or mixed")
    phase = root / runner
    phase.mkdir(mode=0o700)
    return phase


def require_hosted_vm(environment, system, machine, release, uid):
    expected = {
        "GITHUB_ACTIONS": "true",
        "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_OS": "Linux",
        "RUNNER_ARCH": "X64",
        "ImageOS": "ubuntu24",
    }
    if (any(environment.get(key) != value for key, value in expected.items())
            or system != "Linux" or machine != "x86_64" or uid == 0
            or release.get("ID") != "ubuntu" or release.get("VERSION_ID") != "24.04"):
        raise ValueError("Native setup requires a disposable GitHub-hosted Ubuntu 24.04 x64 VM")


def subordinate_options(user, uid, subuid, subgid):
    occupied = []
    missing = []
    for flag, text in (("--add-subuids", subuid), ("--add-subgids", subgid)):
        owned = []
        ranges = []
        for line in text.splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            owner, start, size = line.split(":")
            start, size = int(start), int(size)
            if start < 1 or size < 1 or start + size > 2**32 - 1:
                raise ValueError("Invalid subordinate ID range")
            ranges.append((start, start + size))
            if owner in (user, str(uid)):
                owned.append((start, start + size))
        ordered = sorted(ranges)
        if any(right[0] < left[1] for left, right in zip(ordered, ordered[1:])):
            raise ValueError("Overlapping subordinate ID ranges")
        if owned and not any(end - start >= 65536 for start, end in owned):
            raise ValueError("Existing subordinate range is too small")
        if not owned:
            missing.append(flag)
        occupied.extend(ranges)
    start = 100000
    for low, high in sorted(occupied):
        if start + 65536 <= low:
            break
        if start < high:
            start = high
    if start + 65536 > 2**32 - 1:
        raise ValueError("No available subordinate ID range")
    return [part for flag in missing for part in (flag, f"{start}-{start + 65535}")]


def run(*argv, contents=None, capture=False):
    result = subprocess.run(argv, input=contents, text=True, check=True, timeout=600,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def write_system_file(path, contents):
    run("sudo", "tee", path, contents=contents, capture=True)


def assert_worker_outside_manager(proc_root, pid, uid):
    seen = set()
    while pid:
        if pid in seen or len(seen) >= 100:
            raise ValueError("Cannot establish the Actions worker's process ancestry")
        seen.add(pid)
        process = Path(proc_root) / str(pid)
        if f"/user@{uid}.service" in (process / "cgroup").read_text():
            raise ValueError("Refusing to restart the Actions worker's own user manager")
        parent = [line.split()[1] for line in (process / "status").read_text().splitlines()
                  if line.startswith("PPid:")]
        if len(parent) != 1:
            raise ValueError("Cannot establish the Actions worker's parent")
        pid = int(parent[0])


def closed_rootful_socket(path, owner_uid):
    try:
        metadata = Path(path).lstat()
    except FileNotFoundError:
        return False
    if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != owner_uid:
        raise ValueError("Unexpected rootful Docker socket type or owner")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(1)
        try:
            connection.connect(str(path))
        except OSError as error:
            if error.errno == errno.ENOENT:
                return False
            if error.errno == errno.ECONNREFUSED:
                return True
            raise
    raise ValueError("Rootful Docker socket is still accepting connections")


def main():
    release = platform.freedesktop_os_release() if platform.system() == "Linux" else {}
    uid = os.getuid()
    require_hosted_vm(os.environ, platform.system(), platform.machine(), release, uid)
    environment_file = Path(os.environ["GITHUB_ENV"]).resolve(strict=True)
    if not environment_file.is_relative_to(Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)):
        raise ValueError("Unexpected GitHub environment output path")
    if run("stat", "-fc", "%T", "/sys/fs/cgroup", capture=True) != "cgroup2fs":
        raise ValueError("Native setup requires cgroup v2")
    user = run("id", "-un", capture=True)
    run("sudo", "apt-get", "update", "-qq")
    run("sudo", "apt-get", "install", "-y", "--no-install-recommends",
        "uidmap", "dbus-user-session", "slirp4netns", "apparmor")
    version = run("dpkg-query", "-W", "-f=${Version}", "docker-ce", capture=True)
    extras = subprocess.run(["dpkg-query", "-W", "-f=${Version}", "docker-ce-rootless-extras"],
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
    if (extras.returncode != 0 or extras.stdout.strip() != version
            or not all(shutil.which(tool) for tool in ("dockerd-rootless-setuptool.sh", "rootlesskit"))):
        run("sudo", "install", "-m", "0755", "-d", "/etc/apt/keyrings")
        run("sudo", "curl", "--fail", "--silent", "--show-error", "--location",
            "https://download.docker.com/linux/ubuntu/gpg", "-o", "/etc/apt/keyrings/keel-docker.asc")
        run("sudo", "chmod", "0644", "/etc/apt/keyrings/keel-docker.asc")
        write_system_file("/etc/apt/sources.list.d/keel-docker.sources",
                          "Types: deb\nURIs: https://download.docker.com/linux/ubuntu\n"
                          "Suites: noble\nComponents: stable\nArchitectures: amd64\n"
                          "Signed-By: /etc/apt/keyrings/keel-docker.asc\n")
        run("sudo", "apt-get", "update", "-qq")
        run("sudo", "apt-get", "install", "-y", "--no-install-recommends",
            f"docker-ce-rootless-extras={version}")
    if Path(shutil.which("rootlesskit") or "").resolve() != Path("/usr/bin/rootlesskit"):
        raise ValueError("Use the package-installed rootlesskit AppArmor path")
    apparmor = json.loads(run("sudo", "aa-status", "--json", capture=True))
    if not any(name in apparmor.get("profiles", {}) for name in ("rootlesskit", "/usr/bin/rootlesskit")):
        raise ValueError("The packaged rootlesskit AppArmor allowance is not loaded")
    options = subordinate_options(user, uid, Path("/etc/subuid").read_text(), Path("/etc/subgid").read_text())
    if options:
        run("sudo", "usermod", *options, user)
    assert_worker_outside_manager("/proc", os.getpid(), uid)
    delegation = f"/etc/systemd/system/user@{uid}.service.d"
    run("sudo", "install", "-d", "-m", "0755", delegation)
    write_system_file(delegation + "/keel-ci.conf", "[Service]\nDelegate=cpu cpuset io memory pids\n")
    run("sudo", "systemctl", "daemon-reload")
    run("sudo", "loginctl", "enable-linger", user)
    run("sudo", "systemctl", "restart", f"user@{uid}.service")
    runtime = Path(f"/run/user/{uid}")
    if runtime.stat().st_uid != uid or not (runtime / "bus").is_socket():
        raise ValueError("A real user systemd session is required")
    os.environ["XDG_RUNTIME_DIR"] = str(runtime)
    os.environ["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={runtime}/bus"
    run("systemctl", "--user", "start", "dbus.service")
    control_group = run("systemctl", "show", f"user@{uid}.service", "-p", "ControlGroup", "--value", capture=True)
    controllers = (Path("/sys/fs/cgroup") / control_group.lstrip("/") / "cgroup.controllers").read_text().split()
    if not {"cpu", "memory", "pids"}.issubset(controllers):
        raise ValueError("Required user cgroup controllers are not delegated")
    services = ("docker.service", "docker.socket", "containerd.service")
    run("sudo", "systemctl", "mask", "--now", *services)
    for service in services:
        if run("systemctl", "show", service, "-p", "ActiveState", "--value", capture=True) != "inactive":
            raise ValueError("A rootful container service remains active")
        if run("systemctl", "show", service, "-p", "UnitFileState", "--value", capture=True) != "masked":
            raise ValueError("A rootful container service is not masked")
    if closed_rootful_socket("/run/docker.sock", 0):
        run("sudo", "rm", "--", "/run/docker.sock")
    if os.path.lexists("/run/docker.sock"):
        raise ValueError("Rootful Docker socket remains available")
    run("dockerd-rootless-setuptool.sh", "check")
    run("dockerd-rootless-setuptool.sh", "install")
    run("systemctl", "--user", "start", "docker.service")
    socket = runtime / "docker.sock"
    if not socket.is_socket() or socket.stat().st_uid != uid:
        raise ValueError("Rootless Docker socket is missing or has the wrong owner")
    os.environ["KEEL_PDF_SANDBOX_SOCKET"] = str(socket)
    os.environ["DOCKER_HOST"] = f"unix://{socket}"
    run("node", "--import", "tsx", "--input-type=module", "-e",
        'import { execFileSync } from "node:child_process"; '
        'import { assertSandboxEngine } from "./scripts/pdf-sandbox.ts"; '
        'assertSandboxEngine(JSON.parse(execFileSync("docker", '
        '["info", "--format", "{{json .}}"], {encoding:"utf8"})));')
    run("pnpm", "exec", "playwright", "install-deps", "chromium")
    os.environ[NODE_CACHE_VARIABLE] = str(prepare_unit_compile_cache(
        Path(__file__).resolve().parent.parent / ".tugling/local/pilot"))
    with environment_file.open("a") as handle:
        for key in ("XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "KEEL_PDF_SANDBOX_SOCKET", "DOCKER_HOST", NODE_CACHE_VARIABLE):
            handle.write(f"{key}={os.environ[key]}\n")
    print(json.dumps({"runtime": "github-hosted-ubuntu24-x64", "docker": "rootless",
                      "controllers": sorted(controllers), "cpus": os.cpu_count(),
                      "imageVersion": os.environ.get("ImageVersion")}))


if __name__ == "__main__":
    main()
