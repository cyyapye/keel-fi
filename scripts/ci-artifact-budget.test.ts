import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  admitArtifact,
  artifactPolicy,
  payloadBytes,
  retainedBytes,
} from "./ci-artifact-budget";

describe("GitHub artifact storage budgets", () => {
  it("pauses optional uploads while refusing to discard required backup or release evidence", async () => {
    const action = await readFile(
      ".github/actions/upload-bounded-artifact/action.yml",
      "utf8",
    );
    const script = action
      .split("      run: |\n")[1]!
      .split("    - name:")[0]!
      .replace(/^ {8}/gm, "");
    const root = await mkdtemp(join(tmpdir(), "keel-upload-pause-"));
    try {
      for (const kind of ["receipt", "diagnostics", "backup", "release"]) {
        const result = spawnSync("bash", ["-e", "-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            ARTIFACT_KIND: kind,
            GITHUB_STEP_SUMMARY: join(root, "summary"),
          },
        });
        expect(result.status).toBe(
          kind === "backup" || kind === "release" ? 1 : 0,
        );
      }
      expect(await readFile(join(root, "summary"), "utf8")).toContain(
        "complete receipt travels through job outputs",
      );
      const deployment = await readFile(
        ".github/workflows/post-merge.yml",
        "utf8",
      );
      expect(deployment).not.toContain("KEEL_PAUSE_ARTIFACT_UPLOADS");
      expect(deployment).toContain(
        "scripts/preview-deployment-storage.ts backup",
      );
      expect(deployment).toContain(
        "scripts/preview-deployment-storage.ts release",
      );
      expect(action).toContain("inputs.paused == 'true'");
      // Repository variables are not available inside composite actions.
      expect(action).not.toMatch(/\bvars\./);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("counts all 120 retained artifacts across pages, including foreign names, and excludes expired objects", async () => {
    const urls: string[] = [];
    const request: typeof fetch = (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      urls.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      const artifacts = Array.from(
        { length: page === 1 ? 100 : 20 },
        (_, index) => ({
          id: (page - 1) * 100 + index + 1,
          name: "foreign-or-backup",
          size_in_bytes: 1024 * 1024,
          expired: page === 2 && index === 19,
        }),
      );
      return Promise.resolve(Response.json({ total_count: 120, artifacts }));
    };
    expect(await retainedBytes("synthetic/keel", "synthetic", request)).toBe(
      119 * 1024 * 1024,
    );
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("page=2");
  });

  it("fails closed on inaccessible, malformed, incomplete and moving inventories", async () => {
    for (const response of [
      new Response("denied", { status: 403 }),
      Response.json({
        total_count: 1,
        artifacts: [{ id: 1, size_in_bytes: "unknown", expired: false }],
      }),
      Response.json({ total_count: 120, artifacts: [] }),
    ]) {
      await expect(
        retainedBytes("synthetic/keel", "synthetic", () =>
          Promise.resolve(response),
        ),
      ).rejects.toThrow();
    }
    const artifacts = Array.from({ length: 100 }, (_, id) => ({
      id: id + 1,
      size_in_bytes: 1,
      expired: false,
    }));
    await expect(
      retainedBytes("synthetic/keel", "synthetic", () =>
        Promise.resolve(Response.json({ total_count: 120, artifacts })),
      ),
    ).rejects.toThrow("changed during pagination");
  });

  it("accepts empty storage and rejects payload and aggregate growth at the independent ceilings", async () => {
    expect(
      await retainedBytes("synthetic/keel", "synthetic", () =>
        Promise.resolve(Response.json({ total_count: 0, artifacts: [] })),
      ),
    ).toBe(0);
    expect(() =>
      admitArtifact(299 * 1024 * 1024, 1024 * 1024, 12 * 1024 * 1024),
    ).not.toThrow();
    expect(() =>
      admitArtifact(299 * 1024 * 1024, 1024 * 1024 + 1, 12 * 1024 * 1024),
    ).toThrow("300 MiB");
    expect(() =>
      admitArtifact(0, 12 * 1024 * 1024 + 1, 12 * 1024 * 1024),
    ).toThrow("payload");
  });

  it("uses one-day success diagnostics and bounded failure/cancellation evidence while preserving backups", () => {
    expect(artifactPolicy("diagnostics", "success")).toEqual({
      bytes: 1024 * 1024,
      days: 1,
    });
    for (const status of ["failure", "cancelled"] as const) {
      expect(artifactPolicy("diagnostics", status)).toEqual({
        bytes: 12 * 1024 * 1024,
        days: 7,
      });
    }
    expect(artifactPolicy("backup", "success")).toEqual({
      bytes: 16 * 1024 * 1024,
      days: 14,
    });
    expect(artifactPolicy("receipt", "success")).toEqual({
      bytes: 256 * 1024,
      days: 7,
    });
    expect(artifactPolicy("release", "success")).toEqual({
      bytes: 256 * 1024,
      days: 90,
    });
  });

  it("measures actual files, reserves outer ZIP overhead and refuses directories or symlinks", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "keel-artifact-budget-")),
    );
    try {
      const file = join(root, "backup.gpg");
      await writeFile(file, Buffer.alloc(512));
      expect(await payloadBytes([file])).toBe(512 + 64 * 1024);
      await expect(payloadBytes([root])).rejects.toThrow("regular file");
      await symlink(file, join(root, "link"));
      await expect(payloadBytes([join(root, "link")])).rejects.toThrow();
      await expect(payloadBytes([])).rejects.toThrow("explicit artifact files");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes every upload through the fail-closed guard and disables implicit secret-scan uploads", async () => {
    const allFiles = await readdir(".github", { recursive: true });
    for (const file of allFiles.filter((file) => /\.ya?ml$/.test(file))) {
      if (file === "actions/upload-bounded-artifact/action.yml") continue;
      expect(await readFile(join(".github", file), "utf8")).not.toMatch(
        /uses:\s*actions\/upload-artifact@/,
      );
    }
    const files = await readdir(".github/workflows");
    const uploaders: string[] = [];
    for (const file of files.filter((file) => /\.ya?ml$/.test(file))) {
      const source = await readFile(join(".github/workflows", file), "utf8");
      expect(source).not.toMatch(/uses:\s*actions\/upload-artifact@/);
      if (source.includes("upload-bounded-artifact")) {
        uploaders.push(file);
        expect(source).toContain("actions: read");
        for (const step of source.split(/^ {6}- /m)) {
          if (
            !step.includes("uses: ./") ||
            !step.includes("upload-bounded-artifact")
          )
            continue;
          expect(step).toContain(
            "paused: ${{ vars.KEEL_PAUSE_ARTIFACT_UPLOADS || 'false' }}",
          );
        }
      }
      if (source.includes("gitleaks/gitleaks-action@")) {
        expect(source).toContain('GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"');
      }
    }
    expect(uploaders.sort()).toEqual([
      "native-verification.yml",
      "tugling-pilot.yml",
    ]);
    const action = await readFile(
      ".github/actions/upload-bounded-artifact/action.yml",
      "utf8",
    );
    expect(action).toContain("pnpm exec tsx scripts/ci-artifact-budget.ts");
    expect(action.replace(/\s+/g, " ")).toContain(
      "if: ${{ always() && inputs.paused != 'true' && steps.budget.outcome == 'success' }}",
    );
    expect(action).toContain(
      "retention-days: ${{ steps.budget.outputs.retention-days }}",
    );
    expect(action).toContain("path: ${{ steps.budget.outputs.paths }}");
    expect(action).not.toContain("continue-on-error");
    for (const file of ["native-verification.yml", "tugling-pilot.yml"]) {
      const source = await readFile(join(".github/workflows", file), "utf8");
      expect(source).toContain(
        'scripts/ci-diagnostics.py --status "$DIAGNOSTIC_STATUS"',
      );
      expect(source).not.toContain("pilot/browser-results/");
      expect(source).toContain(
        "path: .tugling/local/ci-upload/diagnostics.zip",
      );
      const uploadCondition =
        file === "native-verification.yml"
          ? "if: ${{ always() && inputs.layout_plan == '' && steps.diagnostics.outcome == 'success' }}"
          : "if: ${{ always() && steps.diagnostics.outcome == 'success' }}";
      expect(source.replace(/\s+/g, " ")).toContain(uploadCondition);
    }
  });
});
