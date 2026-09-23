import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("post-merge preview deployment workflow", () => {
  it("routes verification and deployment to isolated Keel runner lanes", async () => {
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

    expect(
      pullRequestWorkflow.match(
        /runs-on: \[self-hosted, Linux, X64, keel-ci\]/g,
      ),
    ).toHaveLength(4);
    expect(
      verification.match(/runs-on: \[self-hosted, Linux, X64, keel-ci\]/g),
    ).toHaveLength(2);
    expect(verification).toContain(
      "uses: ./.github/workflows/native-verification.yml",
    );
    expect(pullRequestNative).toContain("needs: secret-scan");
    expect(postMergeNative).toContain(
      "needs:\n      - secret-scan\n      - tugling-contract",
    );
    expect(deployment).toContain(
      "runs-on: [self-hosted, Linux, X64, keel-deploy]",
    );
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
    expect(tugling).toContain("ref: e709bd77128e3d14ebc8ded37ccc2afe8f4b6eba");
    expect(tugling).toContain("persist-credentials: false");
    expect(tugling).toContain("project_contract.py");
    expect(tugling).toContain("--source-mode pinned");

    const backup = deployment.indexOf("wrangler d1 export");
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
    expect(cleanupStep).toContain('"$KEEL_PREVIEW_RELEASE_EVIDENCE_PATH"');
    expect(cleanupStep).toContain('"$KEEL_WEB_WRANGLER_OUTPUT_PATH"');
  });
});
