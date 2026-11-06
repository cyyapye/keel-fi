import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LegalDocumentScanFindingSchema,
  LegalDocumentScanSchema,
} from "../packages/domain/src/provider-legal-documents";

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

describe("the production scanner's ClamAV process contract", () => {
  const content = Buffer.from(
    "%PDF-1.4\nSynthetic scanner input\0\xff",
    "latin1",
  );
  const ResultSchema = z.object({
    exitCode: z.number(),
    stdout: z.string(),
    calls: z.array(
      z.object({
        argv: z.array(z.string()),
        options: z.record(z.string(), z.unknown()),
      }),
    ),
  });
  let results: Record<string, z.infer<typeof ResultSchema>>;
  beforeAll(() => {
    const cases = {
      clean: { returncode: 0, output: "" },
      limit: {
        returncode: 1,
        output: "stdin: Heuristics.Limits.Exceeded.MaxFiles FOUND\n",
      },
      failed: { returncode: 2, output: "synthetic private failure" },
      timeout: { timeout: true },
    };
    const process = spawnSync(
      "python3",
      [
        "-I",
        "-B",
        resolve("scripts/test-support/scanner-process.py"),
        resolve("scripts/pdf-sandbox/scanner.py"),
      ],
      {
        input: JSON.stringify(
          Object.fromEntries(
            Object.entries(cases).map(([name, value]) => [
              name,
              { ...value, input: content.toString("hex") },
            ]),
          ),
        ),
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 16_384,
      },
    );
    expect(process.status).toBe(0);
    expect(process.stderr).toBe("");
    results = z
      .record(z.string(), ResultSchema)
      .parse(JSON.parse(process.stdout));
    expect(Object.keys(results).sort()).toEqual(Object.keys(cases).sort());
  });

  it("sends unchanged bytes with bounded flags and never retries a rejected scan", () => {
    for (const result of Object.values(results)) {
      expect(result.calls).toEqual([
        {
          argv: ["/usr/bin/clamscan", "--version"],
          options: { capture_output: true, timeout: 10, check: true },
        },
        {
          argv: [
            "/usr/bin/clamscan",
            "--stdout",
            "--no-summary",
            "--infected",
            "--max-filesize=8M",
            "--max-scansize=32M",
            "--max-files=10000",
            "--max-recursion=8",
            "--max-scantime=30000",
            "--alert-exceeds-max=yes",
            "--alert-encrypted=yes",
            "--alert-broken=yes",
            "-",
          ],
          options: {
            input: content.toString("hex"),
            stdout: "file",
            stderr: -3,
            timeout: 70,
            env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" },
          },
        },
      ]);
    }
  });

  it("emits a valid clean scan for the submitted bytes", () => {
    expect(results.clean!.exitCode).toBe(0);
    expect(
      LegalDocumentScanSchema.parse(JSON.parse(results.clean!.stdout)),
    ).toMatchObject({
      version: 2,
      engineVersion: "1.4.3",
      databaseVersion: 27000,
      sha256: createHash("sha256").update(content).digest("hex"),
      outcome: "clean",
      findings: [],
    });
  });

  it("emits a blocked scan with the MaxFiles finding for the submitted bytes", () => {
    expect(results.limit!.exitCode).toBe(0);
    expect(
      LegalDocumentScanSchema.parse(JSON.parse(results.limit!.stdout)),
    ).toMatchObject({
      version: 2,
      sha256: createHash("sha256").update(content).digest("hex"),
      outcome: "blocked",
      findings: [
        {
          reason: "scan_limit",
          signature: "Heuristics.Limits.Exceeded.MaxFiles",
        },
      ],
    });
  });

  it("exits unavailable without output when ClamAV fails or times out", () => {
    for (const name of ["failed", "timeout"]) {
      expect(results[name]!.exitCode).toBe(2);
      expect(results[name]!.stdout).toBe("");
    }
  });
});
