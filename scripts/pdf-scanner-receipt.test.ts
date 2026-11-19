import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScannerReceipt,
  readScannerReceipt,
  writeScannerReceipt,
} from "./pdf-scanner-receipt";
import { syntheticAgreementPdf } from "./test-support/legal-documents";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "scanner-proof-test-"));
  roots.push(root);
  const config = {
    version: 1 as const,
    socket: root,
    image: `sha256:${"a".repeat(64)}`,
  };
  const scan = {
    version: 2 as const,
    engineVersion: "1.4.3",
    databaseVersion: 123,
    databaseUpdatedAt: new Date(Date.now() - 3600000).toISOString(),
    scannedAt: new Date(Date.now() - 1000).toISOString(),
    sha256: createHash("sha256").update(syntheticAgreementPdf()).digest("hex"),
    outcome: "clean" as const,
    findings: [],
  };
  const receipt = await createScannerReceipt(config, scan);
  const file = join(root, "receipt.json");
  await writeScannerReceipt(file, receipt);
  return { root, config, scan, receipt, file };
}
describe("scanner trust receipt", () => {
  it("retains exact clean proof and rejects different image", async () => {
    const f = await fixture();
    expect(await readScannerReceipt(f.config, f.file)).toEqual(f.receipt);
    await expect(
      readScannerReceipt(
        { ...f.config, image: `sha256:${"b".repeat(64)}` },
        f.file,
      ),
    ).rejects.toThrow("identity_mismatch");
  });
  it("rejects corrupted timestamp and unsafe permissions", async () => {
    const f = await fixture();
    const bad = JSON.parse(await readFile(f.file, "utf8"));
    bad.scan.databaseUpdatedAt = new Date(Date.now() - 7200000).toISOString();
    await writeFile(f.file, JSON.stringify(bad));
    await expect(readScannerReceipt(f.config, f.file)).rejects.toThrow(
      "integrity_mismatch",
    );
    await writeScannerReceipt(f.file, f.receipt);
    await chmod(f.file, 0o644);
    await expect(readScannerReceipt(f.config, f.file)).rejects.toThrow(
      "unsafe",
    );
  });
  it("cannot mint blocked, wrong-document or future proof", async () => {
    const f = await fixture();
    await expect(
      createScannerReceipt(f.config, { ...f.scan, outcome: "blocked" }),
    ).rejects.toThrow();
    await expect(
      createScannerReceipt(f.config, { ...f.scan, sha256: "b".repeat(64) }),
    ).rejects.toThrow("invalid");
    await expect(
      createScannerReceipt(f.config, {
        ...f.scan,
        scannedAt: new Date(Date.now() + 60000).toISOString(),
      }),
    ).rejects.toThrow("time");
  });
});
