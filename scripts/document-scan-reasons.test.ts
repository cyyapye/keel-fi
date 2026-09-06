import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LegalDocumentScanFindingSchema } from "../packages/domain/src/provider-legal-documents";

function classify(code: number, output: string) {
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
value = json.loads(sys.stdin.read())
try:
    print(json.dumps(scanner.findings_for(value["code"], value["output"].encode("utf-8"))))
except ValueError:
    print('"unavailable"')
`,
      resolve("scripts/pdf-sandbox/scanner.py"),
    ],
    {
      input: JSON.stringify({ code, output }),
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 8192,
    },
  );
  expect(process.status).toBe(0);
  expect(process.stderr).toBe("");
  return JSON.parse(process.stdout) as unknown;
}

describe("the actual isolated scanner's reason decoder", () => {
  it.each([
    ["Heuristics.Encrypted.PDF", "encrypted"],
    ["Heuristics.Limits.Exceeded.MaxScanSize", "scan_limit"],
    ["Heuristics.Broken.Executable", "broken_executable"],
    ["Heuristics.Synthetic.Alert", "heuristic"],
    ["Win.Test.EICAR_HDB-1", "malware_signature"],
  ])("preserves %s without logging content", (signature, reason) => {
    const findings = classify(1, `stdin: ${signature} FOUND\n`);
    expect(findings).toEqual([{ signature, reason }]);
    expect(
      LegalDocumentScanFindingSchema.array().safeParse(findings).success,
    ).toBe(true);
  });
  it("keeps unknown alerts blocked and discards paths, URLs and excerpts", () => {
    expect(
      classify(
        1,
        "private-path.pdf: https://example.invalid/private?secret=synthetic FOUND\n",
      ),
    ).toEqual([{ reason: "unknown_alert", signature: null }]);
    expect(classify(1, "")).toEqual([
      { reason: "unknown_alert", signature: null },
    ]);
    expect(
      classify(1, "stdin: Heuristics.Encrypted.PDF FOUND\n".repeat(3)),
    ).toEqual([{ reason: "encrypted", signature: "Heuristics.Encrypted.PDF" }]);
  });
  it("never calls an incomplete, oversized or contradictory result clean", () => {
    expect(classify(0, "")).toEqual([]);
    expect(classify(2, "")).toBe("unavailable");
    expect(classify(1, "x".repeat(4097))).toBe("unavailable");
    expect(classify(0, "stdin: Heuristics.Encrypted.PDF FOUND\n")).toBe(
      "unavailable",
    );
  });
});
