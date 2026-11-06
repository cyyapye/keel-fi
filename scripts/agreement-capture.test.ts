import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  agreementCapture,
  type AgreementPosition,
} from "./provider-legal-document-capture";
import { createProviderPositionNaturalKeySha256 } from "../packages/connectors/src/provider-holdings-template-csv";
import { syntheticDocumentScan } from "./test-support/legal-documents";
import { documentReaderFixture } from "./test-support/document-reader";
import type {
  ProviderLegalDocumentCapture,
  ProviderLegalDocumentManifest,
} from "../packages/domain/src/provider-legal-documents";
const reader = documentReaderFixture();
const syntheticAgreementPdf = reader.pdf;
const position = {
  investment: "Synthetic Atlas",
  legalPosition: "Synthetic source reference",
  heldThrough: "Synthetic Family LLC",
  investmentDate: "2026-01-01",
};
const currentCheck = "2026-10-01T12:00:00.000Z";
const nextWeek = "2026-10-09T12:00:00.000Z";
const cleanSyntheticScan = (bytes: Uint8Array, scannedAt = currentCheck) =>
  Promise.resolve({
    ...syntheticDocumentScan(bytes, scannedAt),
    version: 2 as const,
    findings: [],
  });
const urls = {
  sydecar:
    "https://storage.googleapis.com/sydecar-prod-documents/synthetic/agreement.pdf?synthetic=one",
  tokenfolio:
    "https://firebasestorage.googleapis.com/v0/b/tokenfolio-343020.appspot.com/o/synthetic%2Fagreement.pdf?synthetic=one",
};
function collect(
  collector: ReturnType<typeof agreementCapture>,
  item: AgreementPosition,
  provider: "sydecar" | "tokenfolio" = "sydecar",
  links = [urls[provider]],
) {
  return collector.collect(item, () =>
    Promise.resolve({
      items: links.map((url) => () => Promise.resolve(new URL(url))),
      problem: null,
      restore: () => Promise.resolve(),
    }),
  );
}
for (const problem of ["scanner_unavailable", "security_blocked"] as const) {
  test(`preserves original bytes without PDF extraction when ${problem}`, async () => {
    const saved: ProviderLegalDocumentCapture[] = [];
    const extract = vi.fn(reader.extract);
    let storedBytes = 0;
    const collector = agreementCapture({
      extract,
      now: () => new Date(currentCheck),
      provider: "sydecar",
      manifest: { version: 1, captures: [] },
      renew: () => Promise.resolve(),
      download: () => Promise.resolve(new Response(syntheticAgreementPdf())),
      scan: (bytes) => {
        if (problem === "scanner_unavailable")
          return Promise.reject(new Error("synthetic unavailable"));
        return Promise.resolve({
          ...syntheticDocumentScan(bytes, currentCheck),
          outcome: "blocked",
        });
      },
      save: ({ capture, files }) => {
        saved.push(capture);
        for (const bytes of files.values()) {
          expect(bytes).toEqual(Buffer.from(syntheticAgreementPdf()));
          storedBytes += bytes.length;
        }
        return Promise.resolve();
      },
    });
    await collect(collector, position);
    await collector.flush();
    expect(extract).not.toHaveBeenCalled();
    expect(storedBytes).toBe(syntheticAgreementPdf().length);
    expect(saved[0]?.documents[0]?.extraction).toMatchObject({
      problem,
      pageCount: 0,
      citations: [],
    });
  });
}

test("extracts the original bytes after a clean scan", async () => {
  const bytes = syntheticAgreementPdf();
  const extract = vi.fn(reader.extract);
  const saved: ProviderLegalDocumentCapture[] = [];
  const collector = agreementCapture({
    extract,
    now: () => new Date(currentCheck),
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => Promise.resolve(new Response(bytes)),
    scan: cleanSyntheticScan,
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });
  await collect(collector, position);
  await collector.flush();
  expect(extract).toHaveBeenCalledExactlyOnceWith(Buffer.from(bytes));
  expect(saved[0]?.documents[0]?.extraction).toMatchObject({
    problem: null,
    pageCount: 1,
    citations: [
      { legalName: "Synthetic Atlas SPV LLC", page: 1, role: "issuer" },
    ],
  });
});

for (const provider of ["sydecar", "tokenfolio"] as const) {
  test(`${provider}: rechecks only the selected agreement among 120 positions and preserves sibling evidence`, async () => {
    const naturalKeySha256 = await createProviderPositionNaturalKeySha256({
      provider,
      ...position,
    });
    const url = new URL(urls[provider]);
    const documentKey = createHash("sha256")
      .update(
        JSON.stringify([provider, naturalKeySha256, url.origin, url.pathname]),
      )
      .digest("hex");
    const id = crypto.randomUUID();
    const document = {
      id,
      documentKey,
      sha256: syntheticDocumentScan().sha256,
      fileName: "agreement.pdf",
      byteSize: syntheticAgreementPdf().length,
      checkedAt: currentCheck,
      scan: {
        ...syntheticDocumentScan(syntheticAgreementPdf(), currentCheck),
        version: 2 as const,
        findings: [],
      },
      extraction: {
        version: 3 as const,
        pageCount: 1,
        problem: null,
        citations: [
          {
            legalName: "Synthetic Atlas SPV LLC",
            page: 1,
            quote: "Issuer: Synthetic Atlas SPV LLC",
            role: "issuer" as const,
          },
        ],
      },
    };
    const sibling = {
      ...document,
      id: crypto.randomUUID(),
      documentKey: "c".repeat(64),
      sha256: "d".repeat(64),
      scan: { ...document.scan, sha256: "d".repeat(64) },
    };
    const others = Array.from({ length: 119 }, (_, index) => ({
      ...position,
      investment: `Synthetic Other ${index.toString()}`,
    }));
    const captures: ProviderLegalDocumentManifest["captures"] = [];
    for (const other of others)
      captures.push({
        version: 1,
        naturalKeySha256: await createProviderPositionNaturalKeySha256({
          provider,
          ...other,
        }),
        ownershipLabel: position.heldThrough,
        problem: "missing",
        documents: [],
      });
    captures.push({
      version: 1,
      naturalKeySha256,
      ownershipLabel: position.heldThrough,
      problem: null,
      documents: [document, sibling],
    });
    const saved: ProviderLegalDocumentCapture[] = [];
    let downloads = 0;
    let scans = 0;
    const collector = agreementCapture({
      extract: reader.extract,
      now: () => new Date(currentCheck),
      provider,
      manifest: { version: 1, captures },
      recheckDocumentId: id,
      renew: () => Promise.resolve(),
      download: () => {
        downloads += 1;
        return Promise.resolve(new Response(syntheticAgreementPdf()));
      },
      scan: (bytes) => {
        scans += 1;
        return Promise.resolve({
          ...syntheticDocumentScan(bytes, currentCheck),
          version: 2,
          outcome: "blocked",
          findings: [
            {
              reason: "scan_limit",
              signature: "Heuristics.Limits.Exceeded.MaxFileSize",
            },
          ],
        });
      },
      save: ({ capture, files }) => {
        saved.push(capture);
        expect(files.size).toBe(0);
        return Promise.resolve();
      },
    });
    // No provider controls at all for unrelated positions: visiting one would
    // fail this test, not merely return the same canned agreement.
    expect(await collector.targetPositions([...others, position])).toEqual([
      position,
    ]);
    for (const other of others)
      await collector.collect(other, () => {
        throw Error("Unrelated document discovery");
      });
    await collect(collector, position, provider);
    expect(saved).toHaveLength(0);
    await collector.flush();
    expect(downloads).toBe(1);
    expect(scans).toBe(1); // Fresh clean cache cannot satisfy an explicit recheck.
    expect(saved).toHaveLength(1);
    expect(saved[0]!.documents[0]!.scan).toMatchObject({
      version: 2,
      outcome: "blocked",
      findings: [{ reason: "scan_limit" }],
    });
    expect(saved[0]!.documents[0]!.extraction.problem).toBe("security_blocked");
    const { id: siblingId, ...priorSibling } = sibling;
    expect(siblingId).not.toBe(id);
    expect(saved[0]!.documents[1]).toEqual(priorSibling);
    const missing = agreementCapture({
      extract: reader.extract,
      now: () => new Date(currentCheck),
      provider,
      manifest: { version: 1, captures },
      recheckDocumentId: id,
      renew: () => Promise.resolve(),
      save: () => {
        throw new Error("must not save");
      },
    });
    await expect(missing.flush()).rejects.toThrow(
      "agreement_recheck_target_unavailable",
    );
  });
  test(`${provider}: caches bytes, upgrades extraction, expires scans and never persists signed URLs`, async () => {
    // Keep a generous bound for four browser capture phases and real PDF
    // extraction without weakening either sandbox's per-operation limits.
    let downloads = 0;
    let scans = 0;
    const saved: ProviderLegalDocumentCapture[] = [];
    const run = (
      manifest: ProviderLegalDocumentManifest,
      date = currentCheck,
    ) => {
      const observedAt = () => new Date(date);
      return agreementCapture({
        extract: reader.extract,
        provider,
        manifest,
        now: observedAt,
        renew: () => Promise.resolve(),
        download: () => {
          downloads += 1;
          return Promise.resolve(new Response(syntheticAgreementPdf()));
        },
        scan: (bytes) => {
          scans += 1;
          return cleanSyntheticScan(bytes, observedAt().toISOString());
        },
        save: ({ capture }) => {
          saved.push(capture);
          return Promise.resolve();
        },
      });
    };
    const collector = run({ version: 1, captures: [] });
    await collect(collector, position, provider);
    expect(saved).toHaveLength(0); // Full financial snapshot must finish first.
    await collector.flush();
    expect(downloads).toBe(1);
    expect(scans).toBe(1);
    expect(saved[0]).toMatchObject({
      problem: null,
      documents: [
        {
          fileName: "agreement.pdf",
          extraction: {
            problem: null,
            citations: [{ legalName: "Synthetic Atlas SPV LLC", page: 1 }],
          },
        },
      ],
    });
    expect(JSON.stringify(saved)).not.toContain("synthetic=one");
    const captures = saved.map((capture) => ({
      ...capture,
      documents: capture.documents.map((document) => ({
        ...document,
        id: crypto.randomUUID(),
      })),
    }));
    const cached = run({ version: 1, captures });
    await collect(cached, position, provider);
    await cached.flush();
    expect(downloads).toBe(1);
    expect(scans).toBe(1);
    const previousVersion = run({
      version: 1,
      captures: captures.map((capture) => ({
        ...capture,
        documents: capture.documents.map((document) => ({
          ...document,
          extraction: {
            ...document.extraction,
            version: 6,
            problem: "name_not_found",
            citations: [],
          },
        })),
      })),
    });
    await collect(previousVersion, position, provider);
    await previousVersion.flush();
    expect(downloads).toBe(2);
    expect(scans).toBe(1); // A current clean scan can feed a newer extractor.
    expect(saved.at(-1)?.documents[0]?.extraction).toMatchObject({
      version: 7,
      problem: null,
      citations: [{ legalName: "Synthetic Atlas SPV LLC" }],
    });
    const refresh = run({ version: 1, captures }, nextWeek);
    await collect(refresh, position, provider);
    await refresh.flush();
    expect(downloads).toBe(3); // Same path may be replaced: bounded weekly recheck.
    expect(scans).toBe(2);
    expect(saved.at(-1)?.documents[0]).toMatchObject({
      scan: { outcome: "clean" },
      extraction: { problem: null },
    });
  });
}

test("Sydecar central agreement backfill resumes after the 24-download run budget", async () => {
  const positions = Array.from({ length: 13 }, (_, index) => ({
    ...position,
    investment: `Synthetic Position ${index.toString()}`,
    legalPosition: `Synthetic source ${index.toString()}`,
    sourceDisplayNameUnique: true,
  }));
  const gather = async (collector: ReturnType<typeof agreementCapture>) => {
    for (const [index, item] of positions.entries())
      await collect(
        collector,
        item,
        "sydecar",
        [0, 1].map(
          (part) =>
            `https://storage.googleapis.com/sydecar-prod-documents/synthetic/${index}-${part}-agreement.pdf?synthetic=one`,
        ),
      );
  };
  let downloads = 0;
  let scans = 0;
  const saved: ProviderLegalDocumentCapture[] = [];
  const build = (manifest: ProviderLegalDocumentManifest) =>
    agreementCapture({
      extract: reader.extract,
      provider: "sydecar",
      manifest,
      now: () => new Date(currentCheck),
      renew: () => Promise.resolve(),
      download: () => {
        downloads += 1;
        return Promise.resolve(new Response(syntheticAgreementPdf()));
      },
      scan: (bytes) => {
        scans += 1;
        return cleanSyntheticScan(bytes, currentCheck);
      },
      save: ({ capture }) => {
        saved.push(capture);
        return Promise.resolve();
      },
    });

  const first = build({ version: 1, captures: [] });
  await gather(first);
  await first.flush();
  expect(downloads).toBe(24);
  expect(scans).toBe(1);
  expect(saved).toHaveLength(13);
  expect(saved[12]).toMatchObject({
    problem: "limit_reached",
    documents: [],
  });

  const second = build({
    version: 1,
    captures: saved.map((capture) => ({
      ...capture,
      documents: capture.documents.map((document) => ({
        ...document,
        id: crypto.randomUUID(),
      })),
    })),
  });
  await gather(second);
  await second.flush();

  expect(downloads).toBe(26);
  expect(scans).toBe(1); // The second collector reuses the fresh hash receipt.
  expect(saved).toHaveLength(26);
  expect(saved.slice(13).every((capture) => capture.problem === null)).toBe(
    true,
  );
  expect(saved[25]?.documents).toHaveLength(2);
});

test("backfill reaches later positions before rechecking expired cached agreements", async () => {
  const saved: ProviderLegalDocumentCapture[] = [];
  let downloads = 0;
  let scans = 0;
  const build = (
    manifest: ProviderLegalDocumentManifest,
    date = currentCheck,
  ) => {
    const observedAt = () => new Date(date);
    return agreementCapture({
      extract: reader.extract,
      provider: "sydecar",
      manifest,
      now: observedAt,
      renew: () => Promise.resolve(),
      download: () => {
        downloads += 1;
        return Promise.resolve(new Response(syntheticAgreementPdf()));
      },
      scan: (bytes) => {
        scans += 1;
        return cleanSyntheticScan(bytes, observedAt().toISOString());
      },
      save: ({ capture }) => {
        saved.push(capture);
        return Promise.resolve();
      },
    });
  };
  const first = build({ version: 1, captures: [] });
  for (let index = 0; index < 25; index += 1)
    await collect(first, {
      ...position,
      investment: `Synthetic ${index.toString()}`,
    });
  await first.flush();
  expect(downloads).toBe(24);
  expect(scans).toBe(1);
  expect(saved[24]).toMatchObject({ problem: "limit_reached", documents: [] });
  const second = build(
    {
      version: 1,
      captures: saved.map((capture) => ({
        ...capture,
        documents: capture.documents.map((document) => ({
          ...document,
          id: crypto.randomUUID(),
        })),
      })),
    },
    nextWeek,
  );
  for (let index = 0; index < 25; index += 1)
    await collect(second, {
      ...position,
      investment: `Synthetic ${index.toString()}`,
    });
  await second.flush();
  expect(downloads).toBe(48); // One new original, then 23 cached rechecks.
  expect(scans).toBe(2); // One expired hash is rescanned, then reused this run.
  expect(saved[49]).toMatchObject({ problem: null });
});
