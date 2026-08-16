import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("post-merge preview deployment workflow", () => {
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
    expect(workflow).toContain("preview_database_action:");
    expect(workflow).toContain("default: migrate-forward");
    expect(workflow).toContain("restore-pre-m9-canonical-cutover");

    const backup = deployment.indexOf("wrangler d1 export");
    const backupVerification = deployment.indexOf("cmp --silent");
    const backupUpload = deployment.indexOf(
      "Retain encrypted pre-migration D1 backup",
    );
    const canonicalRestore = deployment.indexOf(
      "wrangler d1 time-travel restore",
    );
    const migrations = deployment.indexOf("wrangler d1 migrations apply");
    const canonicalSchemaVerification = deployment.indexOf(
      "Verify canonical-only preview schema after reset",
    );
    const apiDeploy = deployment.indexOf("Deploy private API Worker");
    const webDeploy = deployment.indexOf("Build and deploy web Worker");
    const smokes = deployment.indexOf("Run protected post-deploy smokes");
    const evidence = deployment.indexOf("Record exact deployment evidence");

    expect(backup).toBeGreaterThan(-1);
    expect(backupVerification).toBeGreaterThan(backup);
    expect(backupUpload).toBeGreaterThan(backupVerification);
    expect(canonicalRestore).toBeGreaterThan(backupUpload);
    expect(canonicalRestore).toBeLessThan(migrations);
    expect(deployment).toMatch(
      /github\.event_name == 'workflow_dispatch' &&\s+inputs\.preview_database_action == 'restore-pre-m9-canonical-cutover'/u,
    );
    expect(deployment).toContain('timestamp "2026-08-15T23:27:50Z"');
    expect(migrations).toBeGreaterThan(backupUpload);
    expect(canonicalSchemaVerification).toBeGreaterThan(migrations);
    expect(deployment).toContain("transition_object_count");
    expect(deployment).toContain("removed_basis_contract_count");
    expect(deployment).toContain("0019_multi_source_holdings_contract.sql");
    expect(apiDeploy).toBeGreaterThan(canonicalSchemaVerification);
    expect(webDeploy).toBeGreaterThan(apiDeploy);
    expect(smokes).toBeGreaterThan(webDeploy);
    expect(evidence).toBeGreaterThan(smokes);
  });
});
