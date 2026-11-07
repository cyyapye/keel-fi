import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ProviderLegalDocumentCaptureSchema } from "../packages/domain/src/provider-legal-documents";

// The same real Chromium/tsx/scanner/reader boundary formerly wrapped by the
// application browser suite. Preserve its child deadline and output bound.
const { stdout } = await promisify(execFile)(
  process.execPath,
  [
    resolve("node_modules/tsx/dist/cli.mjs"),
    resolve("scripts/test-support/provider-documents-runtime-smoke.ts"),
  ],
  { timeout: 50_000, maxBuffer: 128 * 1024 },
);
const report = z
  .object({
    requests: z.literal(1),
    downloads: z.literal(1),
    captures: z.array(ProviderLegalDocumentCaptureSchema).length(1),
  })
  .strict()
  .parse(JSON.parse(stdout));
const capture = report.captures[0]!;
assert.equal(capture.problem, null);
assert.equal(capture.documents.length, 1);
// This is the fresh, plain agreement from the real scanner and Poppler. Keep
// its complete verdict here so the isolation probes need not open it again.
const { scan, extraction } = capture.documents[0]!;
assert.equal(
  scan?.version,
  2,
  "PDF scanner unavailable. Run make pdf-sandbox-check for setup diagnostics.",
);
assert.equal(scan.outcome, "clean");
assert.deepEqual(scan.findings, []);
assert.equal(extraction.problem, null);
assert.equal(extraction.pageCount, 1);
assert.deepEqual(
  extraction.citations.map(({ legalName, page }) => ({ legalName, page })),
  [{ legalName: "Synthetic Atlas SPV LLC", page: 1 }],
);
console.log(
  "PASS: production tsx/Chromium capture scans and reads the exact synthetic agreement",
);
