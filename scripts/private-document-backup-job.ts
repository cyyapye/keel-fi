import { createHash, randomUUID } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { privateR2, PrivateR2ConfigSchema } from "./private-document-r2";
import { BackupPassphraseSchema } from "./private-document-backup";
import { runMaintenanceCommand } from "./d1-maintenance-command";

export async function publishEncryptedBackup(
  archive: string,
  request: ReturnType<typeof privateR2>,
) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive))
    hash.update(chunk as Buffer);
  const digest = hash.digest("hex");
  const size = (await stat(archive)).size;
  if (size <= 0 || size > 2 * 1024 ** 3)
    throw new Error("Encrypted backup exceeds its envelope");
  const objectKey = `daily/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jsonl.gpg`;
  const result = await request(objectKey, {
    method: "PUT",
    body: await openAsBlob(archive),
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Amz-Content-Sha256": digest,
      "If-None-Match": "*",
    },
    signal: AbortSignal.timeout(20 * 60_000),
  });
  await result.body?.cancel();
  if (!result.ok) throw new Error("Encrypted backup upload failed");
  // Read back the exact randomized key and compare the complete ciphertext.
  const downloaded = await request(objectKey, {
    signal: AbortSignal.timeout(20 * 60_000),
  });
  if (!downloaded.ok || downloaded.body === null)
    throw new Error("Backup read-back failed");
  const reader = downloaded.body.getReader();
  const recoveredHash = createHash("sha256");
  let recoveredSize = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      recoveredSize += part.value.length;
      if (recoveredSize > size)
        throw new Error("Backup read-back exceeds expected size");
      recoveredHash.update(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (recoveredSize !== size || recoveredHash.digest("hex") !== digest)
    throw new Error("Backup read-back mismatch");
  return digest;
}

// One bounded job, one D1 snapshot, no pagination or deletion of live originals.
export async function runPrivateDocumentBackupJob(dependencies: {
  exportDatabase: (output: string) => Promise<unknown>;
}) {
  if (process.env.KEEL_PRIVATE_DOCUMENT_BACKUPS_ENABLED !== "true")
    throw new Error("Private backups need explicit operator activation.");
  const account = z
    .string()
    .regex(/^[a-f0-9]{32}$/u)
    .parse(process.env.CLOUDFLARE_ACCOUNT_ID);
  const source = PrivateR2ConfigSchema.parse({
    account,
    bucket: process.env.KEEL_PREVIEW_R2_BUCKET,
    accessKeyId: process.env.KEEL_DOCUMENT_SOURCE_ACCESS_KEY_ID,
    secretAccessKey: process.env.KEEL_DOCUMENT_SOURCE_SECRET_ACCESS_KEY,
  });
  const destination = PrivateR2ConfigSchema.parse({
    account,
    bucket: process.env.KEEL_DOCUMENT_BACKUP_BUCKET,
    accessKeyId: process.env.KEEL_DOCUMENT_BACKUP_ACCESS_KEY_ID,
    secretAccessKey: process.env.KEEL_DOCUMENT_BACKUP_SECRET_ACCESS_KEY,
  });
  if (
    source.bucket === destination.bucket ||
    source.accessKeyId === destination.accessKeyId
  )
    throw new Error(
      "Originals and backups require separate buckets and credentials.",
    );
  const secret = BackupPassphraseSchema.parse(
    process.env.KEEL_DOCUMENT_BACKUP_PASSPHRASE,
  );
  const directory = await mkdtemp(join(tmpdir(), "keel-private-backup-"));
  const baseEnv = { PATH: process.env.PATH, LANG: "C.UTF-8" };
  try {
    const sql = join(directory, "state.sql");
    const key = join(directory, "key");
    const archive = join(directory, "documents.gpg");
    await writeFile(key, secret, { mode: 0o600 });
    await dependencies.exportDatabase(sql);
    await runMaintenanceCommand(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("scripts/private-document-backup.ts"),
        "backup",
      ],
      {
        ...baseEnv,
        CLOUDFLARE_ACCOUNT_ID: account,
        KEEL_PREVIEW_R2_BUCKET: source.bucket,
        KEEL_DOCUMENT_SOURCE_ACCESS_KEY_ID: source.accessKeyId,
        KEEL_DOCUMENT_SOURCE_SECRET_ACCESS_KEY: source.secretAccessKey,
        KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH: sql,
        KEEL_DOCUMENT_BACKUP_PATH: archive,
        KEEL_DOCUMENT_BACKUP_PASSPHRASE_FILE: key,
      },
    );
    // The child has already authenticated, restored, and checked every original.
    const digest = await publishEncryptedBackup(
      archive,
      privateR2(destination),
    );
    // Only ciphertext identity and generic outcome may appear in CI logs.
    console.log(
      JSON.stringify({
        event: "private_document_backup_stored_and_verified",
        encryptedSha256: digest,
        completedAt: new Date().toISOString(),
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  import("./d1-maintenance")
    .then((module) => module.runD1Maintenance("daily-backup"))
    .catch(() => {
      console.error(
        "Private document backup failed. Check the private recovery runbook; no success claim was recorded.",
      );
      process.exitCode = 1;
    });
}
