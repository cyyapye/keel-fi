// Synthetic caller-death proof. Never used by provider capture.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { acquireSandboxOwner } from "../pdf-sandbox-owner";
import { startOrphanProbe } from "./pdf-orphan-client";
import {
  assertSandboxContainer,
  assertSandboxEngine,
  dockerCommand,
  PdfSandboxConfigSchema,
  sandboxCreateArgs,
} from "../pdf-sandbox";

const config = PdfSandboxConfigSchema.parse(JSON.parse(process.argv[2] ?? ""));
const name = z
  .string()
  .regex(/^keel-pdf-[a-f0-9-]{36}$/u)
  .parse(process.argv[3]);
const directory = await mkdtemp(join(tmpdir(), "keel-pdf-caller-"));
const owner = await acquireSandboxOwner(config.socket, directory, name);
const command = dockerCommand(config.socket, directory);
try {
  const info = await command(["info", "--format", "{{json .}}"], {
    signal: owner.signal,
  });
  assertSandboxEngine(JSON.parse(info.output));
  const created = await command(sandboxCreateArgs(config, name), {
    signal: owner.signal,
  });
  if (created.code !== 0) throw new Error("synthetic create failed");
  await owner.creationSettled();
  const inspect = await command(["inspect", name], { signal: owner.signal });
  assertSandboxContainer(
    z.array(z.unknown()).length(1).parse(JSON.parse(inspect.output))[0],
    config.image,
  );
  const attached = await startOrphanProbe(config.socket, directory, name);
  process.stdout.write("KEEL_PDF_CALLER_RUNNING_V1\n");
  await attached.finished;
} finally {
  await owner.release();
  await rm(directory, { recursive: true, force: true });
}
