import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  LegalDocumentScanSchema,
  type LegalDocumentScan,
} from "../packages/domain/src/provider-legal-documents";
import type { PdfSandboxConfig } from "./pdf-sandbox";
import { syntheticAgreementPdf } from "./test-support/legal-documents";

const ReceiptBody = z
  .object({
    version: z.literal(1),
    socket: z.string(),
    image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    factorySha256: z.string().regex(/^[a-f0-9]{64}$/u),
    scan: LegalDocumentScanSchema,
  })
  .strict();
const Receipt = ReceiptBody.extend({
  receiptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type ScannerReceipt = z.infer<typeof Receipt>;
function receiptDigest(value: z.infer<typeof ReceiptBody>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function validateReceipt(value: unknown) {
  const receipt = Receipt.parse(value);
  const { receiptSha256, ...body } = receipt;
  if (receiptSha256 !== receiptDigest(ReceiptBody.parse(body)))
    throw new Error("scanner_receipt_integrity_mismatch");
  return receipt;
}
export async function scannerFactoryIdentity() {
  const hash = createHash("sha256");
  for (const name of [
    "scripts/pdf-sandbox/Dockerfile",
    "scripts/pdf-sandbox/freshclam.conf",
    "scripts/pdf-sandbox/scanner.py",
    "scripts/pdf-sandbox/boundary.py",
    "scripts/pdf-sandbox-build.ts",
    "scripts/pdf-sandbox.ts",
    "scripts/pdf-scanner-receipt.ts",
    "scripts/test-support/legal-documents.ts",
    "packages/domain/src/provider-legal-documents.ts",
  ]) {
    hash.update(name);
    hash.update("\0");
    hash.update(await readFile(resolve(name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function validateProof(scan: LegalDocumentScan, now = Date.now()) {
  const digest = createHash("sha256")
    .update(syntheticAgreementPdf())
    .digest("hex");
  if (
    scan.version !== 2 ||
    scan.outcome !== "clean" ||
    scan.findings.length ||
    scan.sha256 !== digest
  )
    throw new Error("invalid_scanner_receipt");
  const database = Date.parse(scan.databaseUpdatedAt),
    checked = Date.parse(scan.scannedAt);
  if (
    !Number.isFinite(database) ||
    !Number.isFinite(checked) ||
    database > checked ||
    checked > now ||
    checked - database > 72 * 3600000
  )
    throw new Error("invalid_scanner_receipt_time");
}

/** Called only after a genuine admitted clean proof, never from external input. */
export async function createScannerReceipt(
  config: PdfSandboxConfig,
  proof: LegalDocumentScan,
) {
  const scan = LegalDocumentScanSchema.parse(proof);
  validateProof(scan);
  const body = ReceiptBody.parse({
    version: 1,
    socket: await realpath(config.socket),
    image: config.image,
    factorySha256: await scannerFactoryIdentity(),
    scan,
  });
  return Receipt.parse({ ...body, receiptSha256: receiptDigest(body) });
}

export async function readScannerReceipt(
  config: PdfSandboxConfig,
  path: string,
) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const meta = await file.stat();
    if (
      !meta.isFile() ||
      meta.uid !== process.getuid!() ||
      meta.mode & 0o077 ||
      meta.size > 4096
    )
      throw new Error("unsafe_scanner_receipt");
    const receipt = validateReceipt(JSON.parse(await file.readFile("utf8")));
    if (
      receipt.image !== config.image ||
      receipt.socket !== (await realpath(config.socket)) ||
      receipt.factorySha256 !== (await scannerFactoryIdentity())
    )
      throw new Error("scanner_receipt_identity_mismatch");
    validateProof(receipt.scan);
    return receipt;
  } finally {
    await file.close();
  }
}

export async function writeScannerReceipt(
  path: string,
  receipt: ScannerReceipt,
) {
  validateReceipt(receipt);
  validateProof(receipt.scan);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.uid !== process.getuid!() ||
    parent.mode & 0o022
  )
    throw new Error("unsafe_receipt_directory");
  const staged = resolve(dirname(path), `${randomUUID()}.receipt-pending`);
  try {
    await writeFile(staged, JSON.stringify(receipt) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(staged, path);
  } finally {
    await rm(staged, { force: true });
  }
}
