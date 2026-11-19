import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { PdfSandboxConfig } from "./pdf-sandbox";
import { withPdfPublicationLock } from "./pdf-sandbox-publication";

const Pending = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    socket: z.string(),
    candidate: z.string(),
    startedAt: z.string().datetime(),
  })
  .strict();
const Completion = z
  .object({
    version: z.literal(1),
    operationId: z.string().uuid(),
    socket: z.string(),
    candidate: z.string(),
    phase: z.enum(["build_completed", "not_started"]),
  })
  .strict();
type PendingValue = z.infer<typeof Pending>;
async function pendingPath(socket: string) {
  const canonical = await realpath(socket);
  return `/tmp/keel-pdf-refresh-${process.getuid!()}/${createHash("sha256").update(canonical).digest("hex")}.pending.json`;
}
async function privateJson(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid!() ||
      info.mode & 0o077 ||
      info.size > 4096
    )
      throw new Error("unsafe_maintenance_record");
    return JSON.parse(await file.readFile("utf8")) as unknown;
  } finally {
    await file.close();
  }
}
async function readPending(socket: string) {
  try {
    const value = Pending.parse(await privateJson(await pendingPath(socket)));
    if (value.socket !== (await realpath(socket)))
      throw new Error("pending_runtime_mismatch");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function assertScannerBuildAllowed(
  socket: string,
  candidate: string,
) {
  if (process.platform !== "darwin" || process.env.CI) return;
  const pending = await readPending(socket);
  if (
    pending &&
    (pending.candidate !== resolve(candidate) ||
      !process.env.KEEL_PDF_PUBLICATION_FDS)
  )
    throw new Error("scanner_maintenance_reconciliation_required");
}
export async function beginScannerMaintenance(
  config: PdfSandboxConfig,
  candidate: string,
) {
  if (await readPending(config.socket))
    throw new Error("scanner_maintenance_reconciliation_required");
  const value = Pending.parse({
    version: 1,
    id: randomUUID(),
    socket: await realpath(config.socket),
    candidate: resolve(candidate),
    startedAt: new Date().toISOString(),
  });
  await writeFile(
    await pendingPath(config.socket),
    JSON.stringify(value) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return value;
}
export async function enterScannerMaintenance(
  socket: string,
  candidate: string,
) {
  const existing = await readPending(socket);
  if (existing) {
    await assertScannerBuildAllowed(socket, candidate);
    return { pending: existing, owned: false };
  }
  return {
    pending: await beginScannerMaintenance(
      { version: 1, socket, image: `sha256:${"0".repeat(64)}` },
      candidate,
    ),
    owned: true,
  };
}
function completionPath(pending: PendingValue) {
  return `${pending.candidate}.build-completed.${pending.id}`;
}
async function recordCompletion(
  socket: string,
  candidate: string,
  phase: "build_completed" | "not_started",
) {
  const pending = await readPending(socket);
  if (!pending || pending.candidate !== resolve(candidate)) return;
  const value = Completion.parse({
    version: 1,
    operationId: pending.id,
    socket: await realpath(socket),
    candidate: resolve(candidate),
    phase,
  });
  await mkdir(dirname(candidate), { recursive: true, mode: 0o700 });
  await writeFile(completionPath(pending), JSON.stringify(value) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
export async function recordScannerBuildCompletion(
  config: PdfSandboxConfig,
  candidate: string,
) {
  await recordCompletion(config.socket, candidate, "build_completed");
}
export async function recordScannerBuildNotStarted(
  socket: string,
  candidate: string,
) {
  await recordCompletion(socket, candidate, "not_started");
}
async function confirmed(pending: PendingValue) {
  try {
    const value = Completion.parse(await privateJson(completionPath(pending)));
    return (
      value.operationId === pending.id &&
      value.socket === pending.socket &&
      value.candidate === pending.candidate
    );
  } catch {
    return false;
  }
}
export async function finishScannerMaintenance(pending: PendingValue) {
  const current = await readPending(pending.socket);
  if (!current || current.id !== pending.id)
    throw new Error("maintenance_record_changed");
  if (!(await confirmed(pending))) return false;
  await unlink(await pendingPath(pending.socket));
  return true;
}
/** No download, container action, scanner-owner reset, or unconfirmed clearing. */
export async function scannerMaintenanceStatus(
  config: PdfSandboxConfig,
  reconcile = false,
) {
  return withPdfPublicationLock(config.socket, async () => {
    const pending = await readPending(config.socket);
    if (!pending) return "No pending scanner maintenance.";
    if (!(await confirmed(pending)))
      return "Completion unconfirmed; automatic refresh remains blocked. Inspect the prior build before operator recovery.";
    if (!reconcile)
      return "Build completion recorded; explicit reconciliation can release the maintenance marker.";
    const path = await pendingPath(config.socket);
    const parent = await lstat(resolve(path, ".."));
    if (!parent.isDirectory() || parent.mode & 0o077)
      throw new Error("unsafe_maintenance_directory");
    await writeFile(
      `${path}.${pending.id}.reconciled`,
      JSON.stringify(pending) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await finishScannerMaintenance(pending);
    return "Confirmed completion reconciled; scanner ownership and bindings were not changed.";
  });
}
