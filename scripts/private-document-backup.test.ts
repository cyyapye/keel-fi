import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  backupInventory,
  backupRecords,
  BackupPassphraseSchema,
  verifyBackupRecords,
} from "./private-document-backup";
import { syntheticAgreementPdf } from "./test-support/legal-documents";

const pdf = syntheticAgreementPdf();
const digest = createHash("sha256").update(pdf).digest("hex");
function sql(count = 1) {
  return (
    `CREATE TABLE source_documents(id TEXT PRIMARY KEY, household_id TEXT, object_key TEXT, byte_size INTEGER, sha256 TEXT, content_type TEXT);
  CREATE TABLE synthetic_names(name TEXT); INSERT INTO synthetic_names VALUES ('Synthetic Zürich');\n` +
    Array.from(
      { length: count },
      (_, i) =>
        `INSERT INTO source_documents VALUES ('document-${i}', 'hh_synthetic', 'legal-entity-documents/hh_synthetic/${digest}.pdf', ${pdf.length}, '${digest}', 'application/pdf');`,
    ).join("\n")
  );
}
async function records(count = 1) {
  let result = "";
  for await (const row of backupRecords(sql(count), () => Promise.resolve(pdf)))
    result += row;
  return result;
}
describe("private document backup and recovery", () => {
  it("restores D1's child-before-parent export ordering and rejects actual foreign-key corruption", () => {
    const childFirst = `PRAGMA defer_foreign_keys=TRUE;
      CREATE TABLE source_documents(id TEXT PRIMARY KEY, household_id TEXT REFERENCES households(id), object_key TEXT, byte_size INTEGER, sha256 TEXT, content_type TEXT);
      INSERT INTO source_documents VALUES ('document-1', 'hh_synthetic', 'synthetic/${digest}.pdf', ${pdf.length}, '${digest}', 'application/pdf');
      CREATE TABLE households(id TEXT PRIMARY KEY);
      INSERT INTO households VALUES ('hh_synthetic');`;
    expect(backupInventory(childFirst)).toHaveLength(1);
    expect(() =>
      backupInventory(
        childFirst.replace("VALUES ('hh_synthetic')", "VALUES ('hh_other')"),
      ),
    ).toThrow("foreign-key");
  });
  it("rejects short or multiline passphrases that GPG would truncate", () => {
    for (const key of [
      "short",
      "short\n" + "long".repeat(20),
      "long".repeat(20) + "\r",
      "long".repeat(20) + "\0",
    ])
      expect(BackupPassphraseSchema.safeParse(key).success).toBe(false);
    expect(
      BackupPassphraseSchema.safeParse("synthetic-only-backup-test-passphrase")
        .success,
    ).toBe(true);
  });
  it("restores all 120 documents and metadata, including split Unicode", async () => {
    const content = Buffer.from(await records(120));
    let restored = 0;
    const proof = await verifyBackupRecords(
      Readable.from(
        Array.from({ length: Math.ceil(content.length / 73) }, (_, i) =>
          content.subarray(i * 73, (i + 1) * 73),
        ),
      ),
      (_, bytes) => {
        expect(bytes).toEqual(Buffer.from(pdf));
        restored += 1;
        return Promise.resolve();
      },
    );
    expect(restored).toBe(120);
    expect(proof).toEqual({ documents: 120, bytes: 120 * pdf.length });
  });
  it("rejects missing, duplicate, corrupt and truncated originals", async () => {
    const rows = (await records()).trimEnd().split("\n");
    await expect(
      verifyBackupRecords(Readable.from([rows[0] + "\n" + rows[2] + "\n"])),
    ).rejects.toThrow("Incomplete");
    await expect(
      verifyBackupRecords(
        Readable.from([
          rows[0] + "\n" + rows[1] + "\n" + rows[1] + "\n" + rows[2] + "\n",
        ]),
      ),
    ).rejects.toThrow("duplicate");
    const record = JSON.parse(rows[1]!);
    record.base64 = Buffer.from("corrupt").toString("base64");
    await expect(
      verifyBackupRecords(
        Readable.from([
          rows[0] + "\n" + JSON.stringify(record) + "\n" + rows[2] + "\n",
        ]),
      ),
    ).rejects.toThrow("hash mismatch");
    await expect(
      verifyBackupRecords(Readable.from([(await records()).slice(0, -1)])),
    ).rejects.toThrow("Truncated");
  });
  it("rejects unexpected filesystem SQL and over-budget inventories", () => {
    expect(() =>
      backupInventory("ATTACH '/tmp/synthetic.db' AS outside;" + sql()),
    ).toThrow("filesystem SQL");
    expect(() => backupInventory(sql(4097))).toThrow();
    expect(backupInventory(sql())).toHaveLength(1);
  });
  it("authenticates and restores a real encrypted archive, rejecting a damaged copy", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "keel-synthetic-backup-"));
    const key = join(temporary, "key");
    const archive = join(temporary, "documents.gpg");
    try {
      await writeFile(key, "synthetic-only-backup-test-passphrase", {
        mode: 0o600,
      });
      execFileSync(
        "gpg",
        [
          "--no-options",
          "--homedir",
          temporary,
          "--no-symkey-cache",
          "--batch",
          "--no-tty",
          "--pinentry-mode",
          "loopback",
          "--passphrase-file",
          key,
          "--symmetric",
          "--cipher-algo",
          "AES256",
          "--output",
          archive,
        ],
        { input: await records(), stdio: ["pipe", "pipe", "pipe"] },
      );
      const env = {
        ...process.env,
        KEEL_DOCUMENT_BACKUP_PASSPHRASE_FILE: key,
        KEEL_DOCUMENT_BACKUP_PATH: archive,
      };
      const invoke = () =>
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/private-document-backup.ts", "verify"],
          { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      expect(invoke()).toContain('"documents":1');
      const damaged = await readFile(archive);
      damaged[damaged.length - 10] = damaged[damaged.length - 10]! ^ 1;
      await writeFile(archive, damaged);
      expect(invoke).toThrow();
    } finally {
      execFileSync("gpgconf", ["--homedir", temporary, "--kill", "gpg-agent"], {
        stdio: "ignore",
      });
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
