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
    expect(deployment).not.toMatch(/db:seed|seed:local|synthetic\.sql/);
    expect(deployment).not.toContain("environment:\n      name: production");

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

    expect(backup).toBeGreaterThan(-1);
    expect(backupVerification).toBeGreaterThan(backup);
    expect(backupUpload).toBeGreaterThan(backupVerification);
    expect(migrations).toBeGreaterThan(backupUpload);
    expect(apiDeploy).toBeGreaterThan(migrations);
    expect(webDeploy).toBeGreaterThan(apiDeploy);
    expect(smokes).toBeGreaterThan(webDeploy);
    expect(evidence).toBeGreaterThan(smokes);
  });
});
