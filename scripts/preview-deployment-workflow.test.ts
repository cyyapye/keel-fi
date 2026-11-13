import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("post-merge preview deployment workflow", () => {
  it("withholds provider export output on success and failure without hiding failure", async () => {
    const workflow = await readFile(".github/workflows/post-merge.yml", "utf8");
    const exportScript = workflow.match(
      / {10}if ! pnpm exec wrangler d1 export[\s\S]+? {10}echo "D1 export completed\."/u,
    )?.[0];
    expect(exportScript).toBeDefined();
    const directory = await mkdtemp(join(tmpdir(), "keel-export-output-"));
    const sentinel =
      "https://synthetic.example.invalid/export?signature=private-sentinel";
    try {
      await writeFile(
        join(directory, "pnpm"),
        `#!/bin/sh\nprintf '%s\\n' '${sentinel}'\nprintf '%s\\n' '${sentinel}' >&2\nexit "$SYNTHETIC_EXPORT_STATUS"\n`,
        { mode: 0o700 },
      );
      for (const status of [0, 7]) {
        const result = spawnSync("bash", ["-euc", exportScript!], {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            SYNTHETIC_EXPORT_STATUS: String(status),
            KEEL_PREVIEW_D1_NAME: "synthetic-database",
            KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH: join(directory, "export.sql"),
          },
          encoding: "utf8",
          timeout: 5000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(status === 0 ? 0 : 1);
        expect(result.stdout + result.stderr).not.toContain(sentinel);
        if (status === 0) {
          expect(result.stdout).toBe("D1 export completed.\n");
          expect(result.stderr).toBe("");
        } else {
          expect(result.stdout).toBe("");
          expect(result.stderr).toBe(
            "D1 export failed; provider output withheld.\n",
          );
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("isolates the manual protected storage probe from D1 and Worker deployment", async () => {
    const workflow = await readFile(
      ".github/workflows/preview-backup-storage-check.yml",
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).toContain("name: preview");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"');
    expect(workflow).toContain("group: keel-preview-deployment");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain(
      "scripts/preview-deployment-storage.ts preflight",
    );
    expect(workflow.match(/secrets\.[A-Z0-9_]+/gu)?.sort()).toEqual([
      "secrets.CLOUDFLARE_ACCOUNT_ID",
      "secrets.CLOUDFLARE_API_TOKEN",
      "secrets.KEEL_PREVIEW_R2_BUCKET",
    ]);
    expect(workflow).not.toMatch(
      /schedule:|push:|pull_request:|wrangler|artifact|D1_|PASSPHRASE|continue-on-error/u,
    );
  });

  it("routes every concrete workflow job to disposable workers and gates deployment separately", async () => {
    const workflowNames = (await readdir(".github/workflows")).filter((name) =>
      /\.ya?ml$/u.test(name),
    );
    for (const name of workflowNames) {
      const source = await readFile(`.github/workflows/${name}`, "utf8");
      expect(source, name).not.toMatch(/self-hosted|pull_request_target:/u);
      const jobs = source.split("\njobs:\n")[1];
      expect(jobs, name).toBeDefined();
      for (const job of jobs!.split(/(?=^ {2}[\w-]+:\s*$)/mu).filter(Boolean)) {
        const runners = [...job.matchAll(/^ {4}runs-on: (.+)$/gmu)];
        if (runners.length === 0) {
          expect(job, name).toContain("uses: ./.github/workflows/");
        } else {
          expect(
            runners.map((match) => match[1]),
            name,
          ).toEqual(["ubuntu-24.04"]);
        }
      }
    }
    const [pullRequestWorkflow, postMergeWorkflow] = await Promise.all([
      readFile(".github/workflows/ci.yml", "utf8"),
      readFile(".github/workflows/post-merge.yml", "utf8"),
    ]);
    const deploymentStart = postMergeWorkflow.indexOf("  deploy-preview:");
    expect(deploymentStart).toBeGreaterThan(-1);
    const verification = postMergeWorkflow.slice(0, deploymentStart);
    const deployment = postMergeWorkflow.slice(deploymentStart);
    const pullRequestNativeStart = pullRequestWorkflow.indexOf("  native:");
    const pullRequestQualityStart = pullRequestWorkflow.indexOf("  quality:");
    const postMergeNativeStart = postMergeWorkflow.indexOf("  verify:");
    const postMergeSecretScanStart =
      postMergeWorkflow.indexOf("  secret-scan:");
    expect(pullRequestNativeStart).toBeGreaterThan(-1);
    expect(pullRequestQualityStart).toBeGreaterThan(pullRequestNativeStart);
    expect(postMergeNativeStart).toBeGreaterThan(-1);
    expect(postMergeSecretScanStart).toBeGreaterThan(postMergeNativeStart);
    const pullRequestNative = pullRequestWorkflow.slice(
      pullRequestNativeStart,
      pullRequestQualityStart,
    );
    const postMergeNative = postMergeWorkflow.slice(
      postMergeNativeStart,
      postMergeSecretScanStart,
    );

    expect(verification).toContain(
      "uses: ./.github/workflows/native-verification.yml",
    );
    expect(pullRequestNative).toContain("needs: secret-scan");
    expect(postMergeNative).toContain(
      "needs:\n      - secret-scan\n      - tugling-contract",
    );
    expect(deployment).toContain("runs-on: ubuntu-24.04");
    expect(pullRequestWorkflow).not.toContain("runs-on: ubuntu-latest");
    expect(postMergeWorkflow).not.toContain("runs-on: ubuntu-latest");
    expect(pullRequestWorkflow).not.toContain("playwright install --with-deps");
    expect(postMergeWorkflow).not.toContain("playwright install --with-deps");
    expect(
      [pullRequestWorkflow, postMergeWorkflow]
        .join("\n")
        .match(/HOME: \$\{\{ runner\.workspace \}\}/g),
    ).toHaveLength(2);
  });

  it("preserves exact-SHA gates, safe ordering, and the no-seed boundary", async () => {
    const workflow = await readFile(".github/workflows/post-merge.yml", "utf8");
    const deploymentStart = workflow.indexOf("  deploy-preview:");
    expect(deploymentStart).toBeGreaterThan(-1);
    const deployment = workflow.slice(deploymentStart);
    const stepsStart = deployment.indexOf("    steps:");
    expect(stepsStart).toBeGreaterThan(-1);
    const jobConfiguration = deployment.slice(0, stepsStart);

    expect(jobConfiguration).toContain("- verify");
    expect(jobConfiguration).toContain("- secret-scan");
    expect(jobConfiguration).toContain("- tugling-contract");
    expect(jobConfiguration).toContain("name: preview");
    expect(jobConfiguration).toContain("cancel-in-progress: false");
    expect(jobConfiguration).not.toContain("secrets.");
    expect(jobConfiguration).not.toContain("${{ runner.");
    expect(deployment).toContain(
      'echo "KEEL_API_WRANGLER_OUTPUT_PATH=$RUNNER_TEMP/keel-api-deploy.jsonl"',
    );
    expect(jobConfiguration).toContain("if: github.ref == 'refs/heads/main'");
    expect(deployment).not.toContain("KEEL_PAUSE_ARTIFACT_UPLOADS");
    expect(deployment).not.toContain("upload-bounded-artifact");
    expect(deployment).not.toMatch(/db:seed|seed:local|synthetic\.sql/);
    expect(deployment).not.toContain("environment:\n      name: production");
    expect(deployment).not.toContain("KEEL_PREVIEW_ANGELLIST_");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("preview_database_action:");
    expect(workflow).not.toContain("wrangler d1 time-travel restore");

    const tuglingStart = workflow.indexOf("  tugling-contract:");
    expect(tuglingStart).toBeGreaterThan(-1);
    const tugling = workflow.slice(tuglingStart, deploymentStart);
    expect(tugling).toContain("ref: ${{ github.sha }}");
    expect(tugling).toContain("repository: cyyapye/tugling");
    expect(tugling).toContain("ref: 01af7eda080d3ef49d9fabcb7dfdf40e949a693c");
    expect(tugling).toContain("persist-credentials: false");
    expect(tugling).toContain("project_contract.py");
    expect(tugling).toContain("--source-mode pinned");

    const accepted = JSON.parse(
      await readFile(".tugling/project.json", "utf8"),
    );
    const pilot = JSON.parse(await readFile(".tugling/pilot.json", "utf8"));
    expect(accepted.tugling).toMatchObject({
      channel: "pinned",
      revision: "01af7eda080d3ef49d9fabcb7dfdf40e949a693c",
      version: "0.8.0",
    });
    expect(pilot.tugling).toEqual(accepted.tugling);
    for (const path of [
      ".github/workflows/tugling.yml",
      ".github/workflows/native-verification.yml",
      ".github/workflows/tugling-pilot.yml",
      ".github/actions/verify-native-receipt/action.yml",
    ]) {
      expect(await readFile(path, "utf8")).toContain(
        `ref: ${accepted.tugling.revision}`,
      );
    }

    const backup = deployment.indexOf("wrangler d1 export");
    const exportCommand = deployment.slice(
      backup,
      deployment.indexOf('echo "D1 export completed."'),
    );
    expect(exportCommand).toContain("--skip-confirmation >/dev/null 2>&1");
    expect(exportCommand).toContain("exit 1");
    const backupVerification = deployment.indexOf("cmp --silent");
    const backupUpload = deployment.indexOf(
      "Retain encrypted pre-migration D1 backup",
    );
    const migrations = deployment.indexOf("wrangler d1 migrations apply");
    const apiDeploy = deployment.indexOf("Deploy private API Worker");
    const webDeploy = deployment.indexOf("Build and deploy web Worker");
    const smokes = deployment.indexOf("Run protected post-deploy smokes");
    const evidence = deployment.indexOf("Record exact deployment evidence");
    const evidenceUpload = deployment.indexOf(
      "Retain preview release evidence",
    );
    const cleanup = deployment.indexOf("Remove private runner files");

    expect(backup).toBeGreaterThan(-1);
    expect(backupVerification).toBeGreaterThan(backup);
    expect(backupUpload).toBeGreaterThan(backupVerification);
    expect(deployment.slice(backupUpload, migrations)).toContain(
      "scripts/preview-deployment-storage.ts backup",
    );
    expect(deployment.slice(evidenceUpload, cleanup)).toContain(
      "scripts/preview-deployment-storage.ts release",
    );
    expect(deployment).toContain("KEEL_PREVIEW_BACKUP_BUCKET");
    expect(deployment).not.toContain("BACKUP_SECRET_ACCESS_KEY");
    expect(deployment).not.toContain("continue-on-error");
    expect(migrations).toBeGreaterThan(backupUpload);
    expect(apiDeploy).toBeGreaterThan(migrations);
    expect(webDeploy).toBeGreaterThan(apiDeploy);
    expect(smokes).toBeGreaterThan(webDeploy);
    expect(evidence).toBeGreaterThan(smokes);
    expect(evidenceUpload).toBeGreaterThan(evidence);
    expect(cleanup).toBeGreaterThan(evidenceUpload);

    const cleanupStep = deployment.slice(cleanup);
    expect(cleanupStep).toContain('"$KEEL_API_WRANGLER_OUTPUT_PATH"');
    expect(cleanupStep).toContain('"$KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH"');
    expect(cleanupStep).toContain('"$KEEL_PREVIEW_BACKUP_MANIFEST_PATH"');
    expect(cleanupStep).toContain(
      '"$KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH"',
    );
    expect(cleanupStep).toContain('"$KEEL_PREVIEW_RELEASE_EVIDENCE_PATH"');
    expect(cleanupStep).toContain('"$KEEL_WEB_WRANGLER_OUTPUT_PATH"');
  });
});
