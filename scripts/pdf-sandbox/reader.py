"""Bytes on stdin, bounded untrusted text on stdout. No URLs or credentials."""
import importlib.util
import re
import subprocess
import sys

spec = importlib.util.spec_from_file_location("boundary", "/opt/keel/boundary.py")
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


def main():
    boundary.ready()
    pdf = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(pdf) > 8 * 1024 * 1024:
        boundary.respond("limit_reached")
        return
    if not pdf.startswith(b"%PDF-"):
        boundary.respond("unreadable")
        return

    def poppler(command, args):
        # No shell, inherited agent env, source filename, persistent file or logs.
        result = subprocess.run(
            ["/usr/bin/" + command, *args], input=pdf, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=15, check=True,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C.UTF-8"},
        )
        if len(result.stdout) > 1024 * 1024:
            raise OverflowError()
        return result.stdout.decode("utf-8", errors="strict")

    try:
        info = poppler("pdfinfo", ["-"])
        match = re.search(r"^Pages:\s+(\d+)\s*$", info, re.MULTILINE)
        pages = int(match[1]) if match else 0
        if pages > 150:
            boundary.respond("limit_reached")
        elif pages < 1 or re.search(r"^Encrypted:\s+yes\b", info, re.MULTILINE):
            boundary.respond("unreadable")
        else:
            text = poppler("pdftotext", ["-layout", "-enc", "UTF-8", "-", "-"])
            boundary.respond(page_count=pages, text=text)
    except (subprocess.SubprocessError, UnicodeError, ValueError):
        boundary.respond("unreadable")
    except OverflowError:
        boundary.respond("limit_reached")


if __name__ == "__main__":
    main()
