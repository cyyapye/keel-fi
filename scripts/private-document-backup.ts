import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Readable, Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { privateR2 } from "./private-document-r2";

// One-owner alpha envelope. Fail rather than silently omit an oversized vault.
export const BACKUP_MAX_DOCUMENTS = 4096;
export const BACKUP_MAX_BYTES = 1024 * 1024 * 1024;
const MAX_SQL_BYTES = 64 * 1024 * 1024;
const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Document = z
  .object({
    id: z.string().min(1).max(128),
    household_id: z.string().min(1).max(128),
    object_key: z.string().min(1).max(1024),
    byte_size: z.number().int().positive().max(MAX_OBJECT_BYTES),
    sha256: Hash,
  })
  .strict();
type Document = z.infer<typeof Document>;
const Header = z
  .object({
    kind: z.literal("database"),
    version: z.literal(1),
    sql: z.string(),
    sha256: Hash,
  })
  .strict();
const Record = z
  .object({
    kind: z.literal("document"),
    metadata: Document,
    base64: z.string(),
  })
  .strict();
const Footer = z
  .object({
    kind: z.literal("complete"),
    documents: z.number().int(),
    bytes: z.number().int(),
  })
  .strict();

export function backupInventory(sql: string): Document[] {
  if (Buffer.byteLength(sql) > MAX_SQL_BYTES)
    throw new Error("Database backup exceeds the private-alpha limit");
  // A D1 dump needs no filesystem SQL. Strip literals/comments before rejecting
  // file access and extension primitives, including quoted function names.
  const instructions = sql.replace(
    /'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//gu,
    " ",
  );
  if (
    /\b(?:attach|detach|vacuum|load_extension|writefile|readfile|writable_schema|temp_store_directory|data_store_directory)\b/iu.test(
      instructions,
    )
  )
    throw new Error("Unexpected filesystem SQL in database export");
  // Restore into an isolated in-memory database, never a live binding. Extension
  // loading is disabled. The SQL comes only from our authenticated D1 export.
  const database = new DatabaseSync(":memory:", { allowExtension: false });
  try {
    database.exec(sql);
    const rows = z
      .array(Document)
      .max(BACKUP_MAX_DOCUMENTS)
      .parse(
        database
          .prepare(
            `SELECT id, household_id, object_key, byte_size, sha256 FROM source_documents
       WHERE content_type = 'application/pdf' ORDER BY id LIMIT ?`,
          )
          .all(BACKUP_MAX_DOCUMENTS + 1),
      );
    if (rows.reduce((sum, row) => sum + row.byte_size, 0) > BACKUP_MAX_BYTES)
      throw new Error("Document backup exceeds the private-alpha limit");
    if (database.prepare("PRAGMA foreign_key_check").all().length !== 0)
      throw new Error("Restored metadata fails its foreign-key checks");
    return rows;
  } finally {
    database.close();
  }
}

export async function* backupRecords(
  sql: string,
  get: (document: Document) => Promise<Uint8Array>,
) {
  const documents = backupInventory(sql);
  yield JSON.stringify({
    kind: "database",
    version: 1,
    sha256: sha(sql),
    sql,
  }) + "\n";
  let bytes = 0;
  for (const document of documents) {
    const content = await get(document);
    if (
      content.length !== document.byte_size ||
      sha(content) !== document.sha256
    )
      throw new Error("Document bytes do not match the canonical metadata");
    bytes += content.length;
    yield JSON.stringify({
      kind: "document",
      metadata: document,
      base64: Buffer.from(content).toString("base64"),
    }) + "\n";
  }
  yield JSON.stringify({
    kind: "complete",
    documents: documents.length,
    bytes,
  }) + "\n";
}

// Bounded line reader; readline alone can accumulate an arbitrarily large line.
async function* lines(stream: AsyncIterable<Buffer | string>) {
  let pending = "";
  let pendingBytes = 0;
  let scanFrom = 0;
  const decoder = new StringDecoder("utf8");
  for await (const chunk of stream) {
    const decoded = typeof chunk === "string" ? chunk : decoder.write(chunk);
    pending += decoded;
    pendingBytes += Buffer.byteLength(decoded);
    let index: number;
    while ((index = pending.indexOf("\n", scanFrom)) !== -1) {
      const line = pending.slice(0, index);
      if (Buffer.byteLength(line) > MAX_SQL_BYTES * 2)
        throw new Error("Oversized backup record");
      yield line;
      pending = pending.slice(index + 1);
      pendingBytes = Buffer.byteLength(pending);
      scanFrom = 0;
    }
    scanFrom = pending.length;
    if (pendingBytes > MAX_SQL_BYTES * 2)
      throw new Error("Oversized backup record");
  }
  if (pending !== "" || decoder.end() !== "")
    throw new Error("Truncated backup record");
}

export async function verifyBackupRecords(
  stream: AsyncIterable<Buffer | string>,
  restore?: (document: Document, bytes: Uint8Array) => Promise<void>,
) {
  let expected: Map<string, Document> | null = null;
  let count = 0;
  let bytes = 0;
  let complete = false;
  for await (const line of lines(stream)) {
    if (complete) throw new Error("Unexpected records after backup completion");
    const value: unknown = JSON.parse(line);
    if (expected === null) {
      const header = Header.parse(value);
      if (sha(header.sql) !== header.sha256)
        throw new Error("Database backup hash mismatch");
      expected = new Map(
        backupInventory(header.sql).map((document) => [document.id, document]),
      );
      continue;
    }
    const footer = Footer.safeParse(value);
    if (footer.success) {
      if (
        expected.size !== 0 ||
        footer.data.documents !== count ||
        footer.data.bytes !== bytes
      )
        throw new Error("Incomplete document backup");
      complete = true;
      continue;
    }
    const record = Record.parse(value);
    const original = expected.get(record.metadata.id);
    if (
      original === undefined ||
      JSON.stringify(original) !== JSON.stringify(record.metadata)
    )
      throw new Error("Unexpected or duplicate document in backup");
    if (record.base64.length > Math.ceil(MAX_OBJECT_BYTES / 3) * 4)
      throw new Error("Oversized encoded document");
    const content = Buffer.from(record.base64, "base64");
    if (
      content.length !== original.byte_size ||
      sha(content) !== original.sha256
    )
      throw new Error("Restored document hash mismatch");
    await restore?.(original, content);
    expected.delete(original.id);
    count += 1;
    bytes += content.length;
  }
  if (!complete) throw new Error("Backup has no completion record");
  return { documents: count, bytes };
}

async function boundedObject(
  response: Response,
  size: number,
): Promise<Uint8Array> {
  if (!response.ok || response.body === null)
    throw new Error("Private object download failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > size) throw new Error("Object exceeded its recorded size");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, length);
}

async function gpg(
  args: string[],
  work: (process: ReturnType<typeof spawn>) => Promise<unknown>,
) {
  const keyring = await mkdtemp(join(tmpdir(), "keel-backup-keyring-"));
  const child = spawn(
    "gpg",
    [
      "--no-options",
      "--homedir",
      keyring,
      "--batch",
      "--no-symkey-cache",
      "--no-tty",
      "--pinentry-mode",
      "loopback",
      ...args,
    ],
    {
      stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
    },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", () =>
      reject(new Error("Encryption program unavailable")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Backup encryption or authentication failed")),
    );
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
  try {
    return (await Promise.all([work(child), exited]))[0];
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await exited.catch(() => undefined);
    // GPG requires an agent even for loopback symmetric operations. Kill only
    // this disposable keyring's agent, never the operator's existing keyring.
    await new Promise<void>((accept, reject) => {
      const cleanup = spawn(
        "gpgconf",
        ["--homedir", keyring, "--kill", "gpg-agent"],
        { stdio: "ignore", env: { PATH: process.env.PATH } },
      );
      const deadline = setTimeout(() => cleanup.kill("SIGKILL"), 10_000);
      cleanup.once("error", () => {
        clearTimeout(deadline);
        reject(new Error("Private encryption cleanup failed"));
      });
      cleanup.once("close", (code) => {
        clearTimeout(deadline);
        if (code === 0) accept();
        else reject(new Error("Private encryption cleanup failed"));
      });
    }).finally(() => rm(keyring, { recursive: true, force: true }));
  }
}

async function verifyEncrypted(
  path: string,
  passphrase: string,
  temporary: string,
) {
  const plaintext = join(temporary, "restore.jsonl");
  try {
    // Authenticate the COMPLETE GPG message before parsing any recovered SQL.
    await gpg(
      ["--passphrase-file", passphrase, "--decrypt", path],
      async (child) => {
        child.stdin!.end();
        let decryptedBytes = 0;
        const bound = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            decryptedBytes += chunk.length;
            // JSON escaping for the SQL plus base64 documents and bounded metadata.
            callback(
              decryptedBytes > BACKUP_MAX_BYTES * 2 + MAX_SQL_BYTES * 6
                ? new Error("Backup plaintext exceeds its envelope")
                : null,
              chunk,
            );
          },
        });
        await pipeline(
          child.stdout!,
          bound,
          createWriteStream(plaintext, { flags: "wx", mode: 0o600 }),
        );
      },
    );
    return await verifyBackupRecords(createReadStream(plaintext));
  } finally {
    await rm(plaintext, { force: true });
  }
}

async function main() {
  const command = z.enum(["backup", "verify"]).parse(process.argv[2]);
  const passphrase = z
    .string()
    .min(1)
    .parse(process.env.KEEL_DOCUMENT_BACKUP_PASSPHRASE_FILE);
  if ((await stat(passphrase)).mode & 0o077)
    throw new Error("Backup key file must be owner-only");
  const output = resolve(
    z.string().min(1).parse(process.env.KEEL_DOCUMENT_BACKUP_PATH),
  );
  if (command === "verify") {
    const temporary = await mkdtemp(
      join(dirname(output), ".keel-document-restore-"),
    );
    try {
      const proof = await verifyEncrypted(output, passphrase, temporary);
      console.log(
        JSON.stringify({
          event: "private_document_restore_verified",
          ...proof,
        }),
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    return;
  }
  const account = z
    .string()
    .regex(/^[a-f0-9]{32}$/u)
    .parse(process.env.CLOUDFLARE_ACCOUNT_ID);
  const bucket = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u)
    .parse(process.env.KEEL_PREVIEW_R2_BUCKET);
  const get = privateR2({
    account,
    bucket,
    accessKeyId: process.env.KEEL_DOCUMENT_SOURCE_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.KEEL_DOCUMENT_SOURCE_SECRET_ACCESS_KEY ?? "",
  });
  const sqlPath = z
    .string()
    .min(1)
    .parse(process.env.KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH);
  if ((await stat(sqlPath)).size > MAX_SQL_BYTES)
    throw new Error("Database export exceeds limit");
  const sql = await readFile(sqlPath, "utf8");
  const temporary = await mkdtemp(
    join(dirname(output), ".keel-document-backup-"),
  );
  await chmod(temporary, 0o700);
  const candidate = join(temporary, "documents.gpg");
  try {
    await gpg(
      [
        "--passphrase-file",
        passphrase,
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "--output",
        candidate,
      ],
      (child) =>
        pipeline(
          Readable.from(
            backupRecords(sql, async (document) => {
              return boundedObject(
                await get(document.object_key),
                document.byte_size,
              );
            }),
          ),
          child.stdin!,
        ),
    );
    await verifyEncrypted(candidate, passphrase, temporary);
    // Exclusive output: never overwrite the only verified recovery artifact.
    await pipeline(
      createReadStream(candidate),
      createWriteStream(output, { flags: "wx", mode: 0o600 }),
    );
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(output))
      hash.update(chunk as Buffer);
    console.log(
      JSON.stringify({
        event: "private_document_backup_verified",
        encryptedSha256: hash.digest("hex"),
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "Private document backup failed; no success claim was recorded.",
    );
    process.exitCode = 1;
  });
}
