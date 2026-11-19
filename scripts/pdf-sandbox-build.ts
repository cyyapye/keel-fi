import {
  assertScannerBuildAllowed,
  enterScannerMaintenance,
  finishScannerMaintenance,
  recordScannerBuildNotStarted,
  recordScannerBuildCompletion,
} from "./pdf-scanner-maintenance";
import {
  createScannerReceipt,
  scannerFactoryIdentity,
  writeScannerReceipt,
} from "./pdf-scanner-receipt";
import { withPdfPublicationLock } from "./pdf-sandbox-publication";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertSandboxEngine,
  dockerCommand,
  PdfSandboxConfigSchema,
  sandboxConfigPath,
  runDocumentScan,
} from "./pdf-sandbox";
import { syntheticAgreementPdf } from "./test-support/legal-documents";
import { registerPdfSandbox } from "./pdf-sandbox-setup";

// An explicit operator/build step. Capture never builds/pulls an image, starts a
// daemon, installs packages, or falls back to the host PDF reader. The separately
// approved local preparation adapter may invoke this builder before scanning.
async function main() {
  if (process.platform === "darwin" && !process.env.CI) {
    return withPdfPublicationLock(
      process.env.KEEL_PDF_SANDBOX_SOCKET ?? "",
      build,
    );
  }
  return build();
}

async function build() {
  const socket =
    process.env.KEEL_PDF_SANDBOX_SOCKET ??
    (process.platform === "linux"
      ? `/run/user/${process.getuid!().toString()}/docker.sock`
      : "");
  PdfSandboxConfigSchema.parse({
    version: 1,
    socket,
    image: `sha256:${"0".repeat(64)}`,
  });
  await assertScannerBuildAllowed(socket, sandboxConfigPath());
  const temporary = await mkdtemp(join(tmpdir(), "keel-pdf-build-"));
  const command = dockerCommand(socket, temporary);
  const maintenance =
    process.platform === "darwin" && !process.env.CI
      ? await enterScannerMaintenance(socket, sandboxConfigPath())
      : undefined;
  let buildStarted = false;
  let factoryBefore: string | undefined;
  try {
    factoryBefore = maintenance ? await scannerFactoryIdentity() : undefined;
    const info = await command(["info", "--format", "{{json .}}"]);
    if (info.code !== 0)
      throw new Error(
        "Rootless Docker is unavailable; provision it before building the reader.",
      );
    assertSandboxEngine(JSON.parse(info.output));
    const targets = process.argv.slice(2);
    if (
      targets.length > 1 ||
      (targets.length === 1 && targets[0] !== "--scanner-only")
    )
      throw new Error("Use no arguments or --scanner-only.");
    for (const target of targets.length === 1
      ? (["scanner"] as const)
      : (["reader", "probe", "scanner"] as const)) {
      const iidfile = join(temporary, `${target}.id`);
      buildStarted = true;
      const result = await command(
        [
          "build",
          "--target",
          target,
          "--iidfile",
          iidfile,
          "--build-arg",
          `SECURITY_REFRESH_DATE=${new Date().toISOString().slice(0, 10)}`,
          resolve("scripts/pdf-sandbox"),
        ],
        { timeoutMs: 300_000, maxBytes: 1024 * 1024 },
      );
      if (result.code !== 0)
        throw new Error(
          `PDF ${target} image build failed. Inspect the synthetic-only Docker build directly.`,
        );
      const config = PdfSandboxConfigSchema.parse({
        version: 1,
        socket,
        image: (await readFile(iidfile, "utf8")).trim(),
      });
      const file =
        target === "reader"
          ? sandboxConfigPath()
          : `${sandboxConfigPath()}.${target}`;
      if (
        target === "scanner" &&
        process.platform === "darwin" &&
        !process.env.CI
      ) {
        await recordScannerBuildCompletion(config, sandboxConfigPath());
      }
      // Prove clean scanning before atomically replacing the active digest.
      // A failed refresh leaves the last working image configured; its own
      // freshness gate still prevents stale signatures from releasing bytes.
      if (target === "scanner") {
        const proof = await runDocumentScan(
          config,
          syntheticAgreementPdf(),
          command,
        );
        if (proof.outcome !== "clean")
          throw new Error("Scanner preflight failed.");
        if (process.platform === "darwin" && !process.env.CI) {
          const receipt = await createScannerReceipt(config, proof);
          if (receipt.factorySha256 !== factoryBefore)
            throw new Error(
              "Scanner factory changed during build; candidate not adopted.",
            );
          await writeScannerReceipt(`${file}.receipt`, receipt);
        }
      }
      await mkdir(dirname(file), { recursive: true });
      const staged = `${file}.pending`;
      await writeFile(staged, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(staged, file);
      console.log(`PDF sandbox ${target}: ${config.image}`);
    }
    if (process.env.CI !== "true" && !process.env.KEEL_PDF_SANDBOX_CONFIG) {
      await registerPdfSandbox();
      console.log(
        "Registered this PDF runtime for future development worktrees.",
      );
    }
  } finally {
    if (maintenance?.owned) {
      if (!buildStarted)
        await recordScannerBuildNotStarted(socket, sandboxConfigPath());
      await finishScannerMaintenance(maintenance.pending);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "PDF sandbox build failed",
  );
  process.exitCode = 1;
});
