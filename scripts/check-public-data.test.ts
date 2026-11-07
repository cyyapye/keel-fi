import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scannerPath = fileURLToPath(
  new URL("./check-public-data.mjs", import.meta.url),
);
const syntheticSecret = ["gh", "p_", "a".repeat(36)].join("");

function withRepository(
  run: (repository: {
    root: string;
    git: (...args: string[]) => void;
    write: (name: string, contents: string) => void;
    scan: () => ReturnType<typeof spawnSync>;
  }) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), "keel-public-data-"));
  const git = (...args: string[]) => {
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  };
  try {
    git("init", "--quiet");
    run({
      root,
      git,
      write: (name, contents) => writeFileSync(path.join(root, name), contents),
      scan: () =>
        spawnSync(process.execPath, [scannerPath], {
          cwd: root,
          encoding: "utf8",
        }),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("public-data safety scan", () => {
  it("excludes an unstaged deleted asset and scans remaining tracked and untracked files", () => {
    withRepository(({ root, git, write, scan }) => {
      write("deleted.png", "synthetic asset");
      write("tracked.md", "Synthetic tracked content.\n");
      git("add", "--", "deleted.png", "tracked.md");
      unlinkSync(path.join(root, "deleted.png"));
      write("untracked.md", "Synthetic untracked content.\n");
      const result = scan();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("passed for 2 repository files");
    });
  });

  it("excludes a staged deletion of a forbidden file type", () => {
    withRepository(({ git, write, scan }) => {
      write("deleted.pdf", "Synthetic source fixture.");
      write("retained.md", "Synthetic retained content.\n");
      git("add", "--", "deleted.pdf", "retained.md");
      git(
        "-c",
        "user.name=Synthetic test",
        "-c",
        "user.email=synthetic@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Synthetic scanner fixture",
      );
      git("rm", "--quiet", "--", "deleted.pdf");
      const result = scan();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("passed for 1 repository files");
    });
  });

  it.each([
    {
      tracked: true,
      name: "tracked-source.pdf",
      contents: "Synthetic source fixture.",
      finding: "forbidden financial/source-document file type",
    },
    {
      tracked: false,
      name: "untracked-source.xlsx",
      contents: "Synthetic source fixture.",
      finding: "forbidden financial/source-document file type",
    },
    {
      tracked: true,
      name: "tracked-secret.md",
      contents: syntheticSecret,
      finding: "content resembles a secret or private key",
    },
    {
      tracked: false,
      name: "untracked-secret.md",
      contents: syntheticSecret,
      finding: "content resembles a secret or private key",
    },
    {
      tracked: true,
      name: "tracked\nsource.pdf",
      contents: "Synthetic source fixture.",
      finding: "forbidden financial/source-document file type",
    },
    {
      tracked: false,
      name: "untracked\nsecret.md",
      contents: syntheticSecret,
      finding: "content resembles a secret or private key",
    },
  ])("rejects retained $name", ({ tracked, name, contents, finding }) => {
    withRepository(({ git, write, scan }) => {
      write(name, contents);
      if (tracked) git("add", "--", name);
      const result = scan();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${name}: ${finding}`);
    });
  });

  it("does not suppress read errors for retained tracked paths", () => {
    withRepository(({ root, git, scan }) => {
      symlinkSync(
        "missing-synthetic-target",
        path.join(root, "retained-link.md"),
      );
      git("add", "--", "retained-link.md");
      const result = scan();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("ENOENT");
      expect(result.stderr).toContain("retained-link.md");
      expect(result.stdout).not.toContain("Public-data safety scan passed");
    });
  });
});
