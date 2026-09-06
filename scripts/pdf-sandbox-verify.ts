import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { extractLegalNameFromPdf } from "./legal-document-extraction";
import {
  dockerCommand,
  loadSandboxConfig,
  PdfSandboxConfigSchema,
  runSandbox,
  sandboxCreateArgs,
  type SandboxCommand,
  sandboxConfigPath,
  scanDocumentInSandbox,
} from "./pdf-sandbox";
import { syntheticAgreementPdf } from "./test-support/legal-documents";

// Mandatory real-runtime proof, separate from mocked unit tests. Never skip or
// substitute a host Poppler when the runtime has not been provisioned.
async function main() {
  const config = await loadSandboxConfig();
  const probe = PdfSandboxConfigSchema.parse(
    JSON.parse(await readFile(`${sandboxConfigPath()}.probe`, "utf8")),
  );
  assert.equal(probe.socket, config.socket);
  const temporary = await mkdtemp(join(tmpdir(), "keel-pdf-proof-"));
  const canary = join(temporary, "synthetic-credential");
  await writeFile(canary, "SYNTHETIC-ONLY-NOT-A-CREDENTIAL", { mode: 0o600 });
  const transport = dockerCommand(config.socket, temporary);
  const ownedNames = new Set<string>();
  const command: SandboxCommand = (args, options) => {
    if (args[0] === "create") ownedNames.add(args[2]!);
    return transport(args, options);
  };
  const priorCanary = process.env.KEEL_SYNTHETIC_SECRET;
  process.env.KEEL_SYNTHETIC_SECRET = "SYNTHETIC-ONLY-NOT-A-CREDENTIAL";
  const invoke = (mode: string) =>
    runSandbox(probe, Buffer.from(JSON.stringify({ mode, canary })), command);
  try {
    const clean = await scanDocumentInSandbox(syntheticAgreementPdf());
    assert.equal(clean.outcome, "clean");
    assert.equal(clean.version, 2);
    assert.deepEqual(clean.findings, []);
    // Standard inert antivirus test string, never a live malware sample. It
    // exists only in memory in this synthetic proof and never reaches R2.
    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    const threat = await scanDocumentInSandbox(eicar);
    assert.equal(threat.outcome, "blocked");
    assert.equal(threat.findings[0]?.reason, "malware_signature");
    assert.match(threat.findings[0]?.signature ?? "", /EICAR/iu);
    console.log(
      "PASS: isolated scanner accepts a synthetic PDF and blocks the inert antivirus test sample",
    );
    // Benign compressed data crosses the scanner's fixed expanded-file limit,
    // while remaining well below the input cap. No real documents or malware.
    const limited = await scanDocumentInSandbox(
      gzipSync(Buffer.alloc(9 * 1024 * 1024, 0x61)),
    );
    assert.equal(limited.outcome, "blocked");
    assert.equal(limited.findings[0]?.reason, "scan_limit");
    console.log(
      "PASS: a real scan-limit alert is blocked and distinguished from a threat match",
    );
    const result = await extractLegalNameFromPdf(syntheticAgreementPdf());
    assert.equal(result.problem, null);
    assert.equal(result.citations[0]?.legalName, "Synthetic Atlas SPV LLC");
    console.log(
      "PASS: real PDF -> isolated Poppler -> exact source name and page",
    );
    const access = await invoke("access");
    const checks = z
      .object({
        hostReadBlocked: z.literal(true),
        hostWriteBlocked: z.literal(true),
        rootWriteBlocked: z.literal(true),
        networkBlocked: z.literal(true),
        credentialMissing: z.literal(true),
        socketMissing: z.literal(true),
      })
      .strict()
      .parse(JSON.parse(access.text));
    assert.equal(Object.values(checks).length, 6);
    assert.equal(
      await readFile(canary, "utf8"),
      "SYNTHETIC-ONLY-NOT-A-CREDENTIAL",
    );
    console.log(
      "PASS: host reads/writes, root writes, network, credentials and Docker socket blocked",
    );
    assert.equal((await invoke("processes")).text, "process-limit-enforced");
    console.log("PASS: process limit enforced by the kernel");
    for (const mode of ["memory", "output", "timeout"]) {
      await assert.rejects(invoke(mode), { message: "limit_reached" });
      console.log(`PASS: ${mode} limit terminates the sandbox and cleans up`);
    }
    // Independent worker-side negative control: bypass the launcher's inspect
    // guard with a synthetic test only. The kernel handshake must still refuse
    // an incorrectly configured CPU limit, before consuming any input.
    const unsafeName = `keel-pdf-${randomUUID()}`;
    try {
      const args = sandboxCreateArgs(probe, unsafeName).map((arg) =>
        arg === "--cpus=1" ? "--cpus=2" : arg,
      );
      assert.equal((await command(args)).code, 0);
      const refused = await command(
        ["start", "--attach", "--interactive", unsafeName],
        {
          handshake: true,
          input: Buffer.from('{"mode":"access"}'),
        },
      );
      assert.equal(refused.ready, false);
      assert.notEqual(refused.code, 0);
      console.log(
        "PASS: kernel preflight refuses a misconfigured sandbox before reading bytes",
      );
    } finally {
      await command(["rm", "--force", unsafeName]);
    }
    // Killing only the attached CLI simulates a lost caller. Deliberately leave
    // the worker running: PID 1, not parent cleanup, must terminate it by 35s.
    const orphan = `keel-pdf-${randomUUID()}`;
    try {
      assert.equal((await command(sandboxCreateArgs(probe, orphan))).code, 0);
      await assert.rejects(
        command(["start", "--attach", "--interactive", orphan], {
          handshake: true,
          input: Buffer.from('{"mode":"timeout"}'),
          timeoutMs: 2_000,
        }),
        { message: "limit_reached" },
      );
      const alive = await command([
        "ps",
        "--filter",
        `name=^/${orphan}$`,
        "--format",
        "{{.ID}}",
      ]);
      assert.equal(alive.code, 0);
      assert.notEqual(alive.output.trim(), "");
      await delay(35_000);
      const gone = await command([
        "ps",
        "--all",
        "--filter",
        `name=^/${orphan}$`,
        "--format",
        "{{.ID}}",
      ]);
      assert.equal(gone.code, 0);
      assert.equal(gone.output.trim(), "");
      console.log(
        "PASS: independent watchdog kills orphaned work after the caller disappears",
      );
    } finally {
      await command(["rm", "--force", orphan]);
    }
    const remaining = await command([
      "ps",
      "--all",
      "--filter",
      "label=keel.pdf-sandbox=1",
      "--format",
      "{{.Names}}",
    ]);
    assert.equal(remaining.code, 0);
    assert.equal(
      remaining.output
        .trim()
        .split("\n")
        .some((name) => ownedNames.has(name)),
      false,
      "No owned probe containers may survive verification",
    );
    console.log(
      "PASS: no retained probe containers (other runs are untouched)",
    );
  } finally {
    if (priorCanary === undefined) delete process.env.KEEL_SYNTHETIC_SECRET;
    else process.env.KEEL_SYNTHETIC_SECRET = priorCanary;
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "PDF sandbox verification failed",
  );
  process.exitCode = 1;
});
