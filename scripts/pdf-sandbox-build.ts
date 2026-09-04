import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertSandboxEngine,
  dockerCommand,
  PdfSandboxConfigSchema,
  sandboxConfigPath,
} from "./pdf-sandbox";

// An explicit operator/build step. Capture never builds/pulls an image, starts a
// daemon, installs packages, or falls back to the host PDF reader.
async function main() {
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
  const temporary = await mkdtemp(join(tmpdir(), "keel-pdf-build-"));
  const command = dockerCommand(socket, temporary);
  try {
    const info = await command(["info", "--format", "{{json .}}"]);
    if (info.code !== 0)
      throw new Error(
        "Rootless Docker is unavailable; provision it before building the reader.",
      );
    assertSandboxEngine(JSON.parse(info.output));
    for (const target of ["reader", "probe"] as const) {
      const iidfile = join(temporary, `${target}.id`);
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
          : `${sandboxConfigPath()}.probe`;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
      });
      console.log(`PDF sandbox ${target}: ${config.image}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "PDF sandbox build failed",
  );
  process.exitCode = 1;
});
