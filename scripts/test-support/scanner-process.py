"""Run the production scanner with a controlled ClamAV process boundary."""
import contextlib
import datetime
import importlib.util
import io
import json
import runpy
import subprocess
import sys
from unittest.mock import patch


class BoundaryLoader:
    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.ready = lambda **options: None


original_spec = importlib.util.spec_from_file_location


def module_spec(name, path, *args, **kwargs):
    if path == "/opt/keel/boundary.py":
        return importlib.util.spec_from_loader(name, BoundaryLoader())
    return original_spec(name, path, *args, **kwargs)


def scan(source, case):
    calls = []
    output = io.StringIO()
    database_time = datetime.datetime.now(datetime.timezone.utc).strftime("%a %b %d %H:%M:%S %Y")

    def run(argv, **options):
        calls.append({"argv": argv, "options": {
            key: value.hex() if isinstance(value, bytes)
            else "file" if isinstance(value, io.IOBase) else value
            for key, value in options.items()
        }})
        if argv == ["/usr/bin/clamscan", "--version"]:
            return subprocess.CompletedProcess(argv, 0, f"ClamAV 1.4.3/27000/{database_time}\n".encode())
        if case.get("timeout"):
            raise subprocess.TimeoutExpired(argv, options.get("timeout"))
        options["stdout"].write(case["output"].encode())
        return subprocess.CompletedProcess(argv, case["returncode"])

    with (patch("importlib.util.spec_from_file_location", module_spec),
          patch("subprocess.run", run),
          patch("sys.stdin", io.TextIOWrapper(io.BytesIO(bytes.fromhex(case["input"])))),
          contextlib.redirect_stdout(output)):
        try:
            runpy.run_path(source, run_name="__main__")
            exit_code = 0
        except SystemExit as error:
            exit_code = error.code
    return {"exitCode": exit_code, "stdout": output.getvalue(), "calls": calls}


if __name__ == "__main__":
    print(json.dumps({name: scan(sys.argv[1], case)
                      for name, case in json.load(sys.stdin).items()}))
