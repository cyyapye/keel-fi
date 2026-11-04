import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LegalDocumentScanFindingSchema } from "../packages/domain/src/provider-legal-documents";

const signatures = [
  ["Heuristics.Encrypted.PDF", "encrypted"],
  ["Heuristics.Limits.Exceeded.MaxScanSize", "scan_limit"],
  ["Heuristics.Limits.Exceeded.MaxFiles", "scan_limit"],
  ["Heuristics.Broken.Executable", "broken_executable"],
  ["Heuristics.Synthetic.Alert", "heuristic"],
  ["Win.Test.EICAR_HDB-1", "malware_signature"],
] as const;

function classify(inputs: Record<string, readonly [number, string]>) {
  const process = spawnSync(
    "python3",
    [
      "-I",
      "-B",
      "-c",
      `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("scanner", sys.argv[1])
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)
results = {}
for key, (code, output) in json.load(sys.stdin).items():
    try:
        results[key] = scanner.findings_for(code, output.encode("utf-8"))
    except ValueError:
        results[key] = "unavailable"
print(json.dumps(results))
`,
      resolve("scripts/pdf-sandbox/scanner.py"),
    ],
    {
      input: JSON.stringify(inputs),
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 8192,
    },
  );
  expect(process.status).toBe(0);
  expect(process.stderr).toBe("");
  const results = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(process.stdout));
  expect(Object.keys(results).sort()).toEqual(Object.keys(inputs).sort());
  return results;
}

describe("the actual isolated scanner's reason decoder", () => {
  let findings: Record<string, unknown>;
  beforeAll(() => {
    const inputs: Record<string, [number, string]> = {
      privatePath: [
        1,
        "private-path.pdf: https://example.invalid/private?secret=synthetic FOUND\n",
      ],
      emptyAlert: [1, ""],
      repeatedAlert: [1, "stdin: Heuristics.Encrypted.PDF FOUND\n".repeat(3)],
      clean: [0, ""],
      failed: [2, ""],
      oversized: [1, "x".repeat(4097)],
      contradictory: [0, "stdin: Heuristics.Encrypted.PDF FOUND\n"],
    };
    for (const [signature] of signatures)
      inputs[signature] = [1, `stdin: ${signature} FOUND\n`];
    findings = classify(inputs);
  });
  it.each(signatures)(
    "preserves %s without logging content",
    (signature, reason) => {
      expect(findings[signature]).toEqual([{ signature, reason }]);
      expect(
        LegalDocumentScanFindingSchema.array().safeParse(findings[signature])
          .success,
      ).toBe(true);
    },
  );
  it("keeps unknown alerts blocked and discards paths, URLs and excerpts", () => {
    expect(findings.privatePath).toEqual([
      { reason: "unknown_alert", signature: null },
    ]);
    expect(findings.emptyAlert).toEqual([
      { reason: "unknown_alert", signature: null },
    ]);
    expect(findings.repeatedAlert).toEqual([
      { reason: "encrypted", signature: "Heuristics.Encrypted.PDF" },
    ]);
  });
  it("never calls an incomplete, oversized or contradictory result clean", () => {
    expect(findings.clean).toEqual([]);
    expect(findings.failed).toBe("unavailable");
    expect(findings.oversized).toBe("unavailable");
    expect(findings.contradictory).toBe("unavailable");
  });
});
