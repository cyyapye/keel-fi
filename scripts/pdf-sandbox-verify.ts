import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { extractLegalNameFromPdf } from "./legal-document-extraction";
import { acquireSandboxOwner } from "./pdf-sandbox-owner";
import {
  dockerCommand,
  assertSandboxContainer,
  loadSandboxConfig,
  PdfSandboxConfigSchema,
  runSandbox,
  sandboxCreateArgs,
  type SandboxCommand,
  sandboxConfigPath,
  scanDocumentInSandbox,
} from "./pdf-sandbox";
import { syntheticAgreementPdf } from "./test-support/legal-documents";
import { startOrphanProbe } from "./test-support/pdf-orphan-client";
import { describeSandboxProofFailure } from "./test-support/sandbox-proof-diagnostics";
import { observeWatchdogLifecycle } from "./test-support/watchdog-removal";
import {
  syntheticManyFileZip,
  syntheticManyStreamPdf,
} from "./test-support/scanner-documents";

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
  command.ownership = transport.ownership;
  const priorCanary = process.env.KEEL_SYNTHETIC_SECRET;
  process.env.KEEL_SYNTHETIC_SECRET = "SYNTHETIC-ONLY-NOT-A-CREDENTIAL";
  const invoke = (mode: string) =>
    runSandbox(probe, Buffer.from(JSON.stringify({ mode, canary })), command);
  try {
    // A real caller process owns a live probe. SIGKILL bypasses all caller
    // finally blocks. Competing requests must finish without retries, retain
    // one-container capacity, and leave no caller-owned container behind.
    const abandonedName = `keel-pdf-${randomUUID()}`;
    ownedNames.add(abandonedName);
    const caller = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(
          new URL("./test-support/pdf-sandbox-caller.ts", import.meta.url),
        ),
        JSON.stringify(probe),
        abandonedName,
      ],
      {
        env: {
          PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
          LANG: "C.UTF-8",
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const callerClosed = new Promise<void>((resolve) => {
      caller.once("close", () => resolve());
    });
    const callerReady = new Promise<void>((resolve, reject) => {
      let output = "";
      caller.once("error", reject);
      caller.once("close", () =>
        reject(new Error("synthetic caller exited before readiness")),
      );
      caller.stdout.on("data", (data: Buffer) => {
        output += data.toString("utf8");
        if (output === "KEEL_PDF_CALLER_RUNNING_V1\n") resolve();
        else if (output.length > 1024)
          reject(new Error("synthetic caller protocol"));
      });
    });
    const contending: Promise<unknown>[] = [];
    try {
      await callerReady;
      const checked: SandboxCommand = async (args, options) => {
        const result = await command(args, options);
        if (args[0] === "create" && result.code === 0) {
          const active = await command([
            "ps",
            "--all",
            "--filter",
            "label=keel.pdf-sandbox=1",
            "--format",
            "{{.ID}}",
          ]);
          assert.equal(active.code, 0);
          assert.equal(
            active.output.trim().split("\n").filter(Boolean).length,
            1,
          );
        }
        return result;
      };
      checked.ownership = command.ownership;
      for (let index = 0; index < 4; index += 1)
        contending.push(
          runSandbox(config, syntheticAgreementPdf(), checked).then(
            (result) => {
              assert.equal(result.problem, null);
              assert.equal(result.pageCount, 1);
              assert.match(result.text, /Synthetic Atlas SPV LLC/u);
            },
          ),
        );
      caller.kill("SIGKILL");
      await callerClosed;
      const completed = await Promise.allSettled(contending);
      const rejected = completed.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (rejected.length)
        throw new AggregateError(
          rejected.map((result) => result.reason as unknown),
        );
      const gone = await command([
        "ps",
        "--all",
        "--filter",
        `name=^/${abandonedName}$`,
        "--format",
        "{{.ID}}",
      ]);
      assert.equal(gone.code, 0);
      assert.equal(gone.output.trim(), "");
      console.log(
        "PASS: SIGKILL caller cleanup and four racing real readers keep one-container capacity without retries",
      );
    } finally {
      if (caller.exitCode === null && caller.signalCode === null)
        caller.kill("SIGTERM");
      await callerClosed;
      await Promise.allSettled(contending);
    }
    // The scanner/reader fixtures and kernel boundary probes share the same
    // cross-process capacity owner and unchanged resource budgets. Await both branches
    // even after failure so their finally blocks finish before shared cleanup.
    const verification = await Promise.allSettled([
      (async () => {
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
          "PASS: isolated scanner blocks the inert antivirus test sample",
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
        // Reproduce the old 100-item false block with actual compressed PDF
        // streams, not a mocked verdict or a renamed archive. Measure the same
        // fixture under the fixed container CPU/memory/deadline budget.
        const manyStreams = syntheticManyStreamPdf(512);
        const started = Date.now();
        const complex = await scanDocumentInSandbox(manyStreams);
        assert.equal(complex.outcome, "clean");
        assert.equal(complex.version, 2);
        assert.deepEqual(complex.findings, []);
        const complexName = await extractLegalNameFromPdf(manyStreams);
        assert.equal(complexName.problem, null);
        assert.equal(complexName.pageCount, 1);
        assert.equal(
          complexName.citations[0]?.legalName,
          "Synthetic Atlas SPV LLC",
        );
        assert.equal(complexName.citations[0]?.page, 1);
        console.log(
          `PASS: 512-stream synthetic PDF scanned and exact name extracted (${(Date.now() - started).toString()} ms, ${manyStreams.length.toString()} input bytes)`,
        );
        // The inert marker is compressed in the final stream, beyond the old
        // boundary. A scanner that only checks the outer bytes or stops after
        // 100 streams cannot satisfy this assertion.
        const embeddedThreat = await scanDocumentInSandbox(
          syntheticManyStreamPdf(512, eicar),
        );
        assert.equal(embeddedThreat.outcome, "blocked");
        assert.equal(embeddedThreat.findings[0]?.reason, "malware_signature");
        assert.match(embeddedThreat.findings[0]?.signature ?? "", /EICAR/iu);
        console.log("PASS: inert antivirus marker in stream 512 is detected");
        // A huge PDF may correctly hit the unchanged scan-time budget before its
        // item budget. Use small ZIP entries to prove the exact MaxFiles boundary
        // independently; do not increase scan time to make a negative test pass.
        const overBudget = syntheticManyFileZip(10_001);
        assert.ok(overBudget.length < 8 * 1024 * 1024);
        const exhausted = await scanDocumentInSandbox(overBudget);
        assert.equal(exhausted.outcome, "blocked");
        assert.ok(
          exhausted.findings.some(
            (finding) =>
              finding.reason === "scan_limit" &&
              finding.signature === "Heuristics.Limits.Exceeded.MaxFiles",
          ),
        );
        console.log(
          "PASS: container exceeding 10000 items is still blocked by MaxFiles",
        );
      })(),
      (async () => {
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
        assert.equal(
          (await invoke("processes")).text,
          "process-limit-enforced",
        );
        console.log("PASS: process limit enforced by the kernel");
        for (const mode of ["memory", "output", "timeout"]) {
          await assert.rejects(invoke(mode), { message: "limit_reached" });
          console.log(
            `PASS: ${mode} limit terminates the sandbox and cleans up`,
          );
        }
        // Independent worker-side negative control: bypass the launcher's inspect
        // guard with a synthetic test only. The kernel handshake must still refuse
        // an incorrectly configured CPU limit, before consuming any input.
        const unsafeName = `keel-pdf-${randomUUID()}`;
        const unsafeOwner = await acquireSandboxOwner(
          config.socket,
          temporary,
          unsafeName,
        );
        try {
          const args = sandboxCreateArgs(probe, unsafeName).map((arg) =>
            arg === "--cpus=1" ? "--cpus=2" : arg,
          );
          assert.equal((await command(args)).code, 0);
          await unsafeOwner.creationSettled();
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
          await unsafeOwner.release();
        }
        // Killing only the attached CLI simulates a lost caller. Deliberately leave
        // the worker running: the attested 32s PID-1 watchdog must terminate it.
        const orphan = `keel-pdf-${randomUUID()}`;
        const orphanOwner = await acquireSandboxOwner(
          config.socket,
          temporary,
          orphan,
        );
        try {
          console.log("CHECK: orphan watchdog container creation");
          assert.equal(
            (await command(sandboxCreateArgs(probe, orphan))).code,
            0,
            "orphan-created",
          );
          await orphanOwner.creationSettled();
          const inspection = await command(["inspect", orphan]);
          assert.equal(inspection.code, 0, "orphan-inspection-query");
          assertSandboxContainer(
            z
              .array(z.unknown())
              .length(1)
              .parse(JSON.parse(inspection.output))[0],
            probe.image,
          );
          const orphanStarted = performance.now();
          const lifecycle = await observeWatchdogLifecycle(
            config.socket,
            orphan,
            async () => {
              const attached = await startOrphanProbe(
                config.socket,
                temporary,
                orphan,
              );
              attached.kill();
              await attached.finished;
              const alive = await command([
                "ps",
                "--filter",
                `name=^/${orphan}$`,
                "--format",
                "{{.State}}",
              ]);
              assert.equal(alive.code, 0, "orphan-alive-query");
              assert.equal(
                alive.output.trim(),
                "running",
                "orphan-survives-caller",
              );
            },
          );
          console.log(
            JSON.stringify({
              probe: "orphan-watchdog",
              elapsedMs: Math.round(performance.now() - orphanStarted),
              ...lifecycle,
            }),
          );
          console.log(
            "PASS: independent watchdog kills orphaned work after the caller disappears",
          );
        } finally {
          await orphanOwner.release();
        }
      })(),
    ]);
    const failures = verification.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((result) => result.reason as unknown),
        "PDF sandbox runtime proof failed",
      );
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
  console.error(describeSandboxProofFailure(error));
  process.exitCode = 1;
});
