import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { providerAgreementCollector } from "../scripts/provider-legal-document-capture";
import { createProviderPositionNaturalKeySha256 } from "../packages/connectors/src/provider-holdings-template-csv";
import {
  syntheticAgreementPdf,
  syntheticDocumentScan,
} from "../scripts/test-support/legal-documents";
import type {
  ProviderLegalDocumentCapture,
  ProviderLegalDocumentManifest,
} from "../packages/domain/src/provider-legal-documents";

const position = {
  investment: "Synthetic Atlas",
  legalPosition: "Synthetic source reference",
  heldThrough: "Synthetic Family LLC",
  investmentDate: "2026-01-01",
};
// Real scanner timestamps must agree with the real clock. Cache-age tests
// advance their injected observation clock relative to this run.
const currentCheck = new Date().toISOString();
const nextWeek = new Date(
  Date.parse(currentCheck) + 8 * 24 * 60 * 60_000,
).toISOString();
const urls = {
  sydecar:
    "https://storage.googleapis.com/sydecar-prod-documents/synthetic/agreement.pdf?synthetic=one",
  tokenfolio:
    "https://firebasestorage.googleapis.com/v0/b/tokenfolio-343020.appspot.com/o/synthetic%2Fagreement.pdf?synthetic=one",
};
async function documentPage(
  page: Page,
  provider: "sydecar" | "tokenfolio",
  url = urls[provider],
) {
  await page.setContent(
    provider === "sydecar"
      ? `<h2 data-testid="investment-docs-heading">Investment Docs</h2><a data-testid="data-room-doc-download" onclick="window.open('${url}')">Subscription Agreement (Counter-Signed) (Subscription Agreement)</a><a data-testid="data-room-doc-download" onclick="throw Error('Tax must not be opened')">Tax K-1</a>`
      : `<div role="dialog"><div>Documents 2</div><ul><li><span class="truncate font-medium">Synthetic Subscription Agreement.pdf</span><button onclick="window.open('${url}')">Download</button></li><li><span class="truncate font-medium">Synthetic Tax Document - K1.pdf</span><button onclick="throw Error('Tax must not be opened')">Download</button></li></ul></div>`,
  );
}

function sydecarCentralDocumentRow(input: {
  documentName: string;
  documentType: string;
  investment: string;
  investmentId?: string;
  url: string;
}): string {
  return `<tr><td><div onclick="window.open('${input.url}')">${input.documentName}</div></td><td>${input.documentType}</td><td>${input.investmentId === undefined ? `<div>${input.investment}</div>` : `<a href="/investments/${input.investmentId}">${input.investment}</a>`}</td><td><span>Investor</span></td><td>-</td><td>Sep 1, 2026</td></tr>`;
}

function sydecarCentralDocumentsPage(rows: readonly string[]): string {
  return `<!doctype html><html><body><table><thead><tr><th>Document Name</th><th>Type</th><th>Investment</th><th>Owner</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
}

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "Existing capture agents use desktop provider sessions.");
});

test("Sydecar associates same-label investments by source IDs and reads their linked memos", async ({
  page,
}) => {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const saved: ProviderLegalDocumentCapture[] = [];
  await page.route("https://app.sydecar.io/documents", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: sydecarCentralDocumentsPage(
        ids.map((id, index) =>
          sydecarCentralDocumentRow({
            investment: position.investment,
            investmentId: id,
            documentName: `Synthetic investment memo ${index}.pdf`,
            documentType: "Investment memo",
            url: urls.sydecar.replace("agreement.pdf", `memo-${index}.pdf`),
          }),
        ),
      ),
    }),
  );
  const collector = providerAgreementCollector({
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: (url) =>
      Promise.resolve(
        new Response(
          syntheticAgreementPdf([
            `Underlying Company: ${String(url).includes("memo-0") ? "Synthetic Robotics Inc." : "Synthetic Tools Inc."}`,
          ]),
        ),
      ),
    scan: (bytes) =>
      Promise.resolve(syntheticDocumentScan(bytes, new Date().toISOString())),
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });
  await collector.collectSydecarDocuments(
    page,
    ids.map((id, index) => ({
      ...position,
      providerInvestmentId: id,
      investmentDate: `2026-01-0${index + 1}`,
      sourceDisplayNameUnique: false,
    })),
  );
  await collector.flush();
  expect(saved).toHaveLength(2);
  for (const [index, capture] of saved.entries()) {
    expect(capture.sourceInvestment).toEqual({
      id: ids[index],
      association: "document_investment_id",
    });
    expect(capture.documents).toHaveLength(1);
    expect(capture.documents[0]?.extraction).toMatchObject({
      problem: "name_not_found",
      citations: [],
      companyCitations: [
        {
          companyName:
            index === 0 ? "Synthetic Robotics Inc." : "Synthetic Tools Inc.",
        },
      ],
    });
  }
});

test("does not read a document drawer belonging to a different source investment ID", async ({
  page,
}) => {
  const observed = "11111111-1111-4111-8111-111111111111";
  await page.route("https://app.tokenfolio.co/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Synthetic investment</p>",
    }),
  );
  await page.goto(
    `https://app.tokenfolio.co/portfolio?investmentId=${observed}`,
  );
  await documentPage(page, "tokenfolio");
  let downloads = 0;
  const saved: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    provider: "tokenfolio",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => {
      downloads += 1;
      throw new Error("Must not download the wrong investment.");
    },
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });
  await collector.collect(page, {
    ...position,
    providerInvestmentId: "22222222-2222-4222-8222-222222222222",
  });
  await collector.flush();
  expect(downloads).toBe(0);
  expect(saved[0]).toMatchObject({ problem: "page_changed", documents: [] });
});

for (const problem of ["scanner_unavailable", "security_blocked"] as const) {
  test(`preserves original bytes without PDF extraction when ${problem}`, async ({
    page,
  }) => {
    await documentPage(page, "sydecar");
    const saved: ProviderLegalDocumentCapture[] = [];
    let storedBytes = 0;
    const collector = providerAgreementCollector({
      provider: "sydecar",
      manifest: { version: 1, captures: [] },
      renew: () => Promise.resolve(),
      download: () => Promise.resolve(new Response(syntheticAgreementPdf())),
      scan: (bytes) => {
        if (problem === "scanner_unavailable")
          return Promise.reject(new Error("synthetic unavailable"));
        return Promise.resolve({
          ...syntheticDocumentScan(bytes, new Date().toISOString()),
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
    await collector.collect(page, position);
    await collector.flush();
    expect(storedBytes).toBe(syntheticAgreementPdf().length);
    expect(saved[0]?.documents[0]?.extraction).toMatchObject({
      problem,
      pageCount: 0,
      citations: [],
    });
  });
}

test("Sydecar central documents work through the production tsx runner", async () => {
  test.setTimeout(60_000);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/test-support/provider-documents-runtime-smoke.ts"),
    ],
    { timeout: 50_000, maxBuffer: 128 * 1024 },
  );
  expect(JSON.parse(stdout)).toMatchObject({
    requests: 1,
    downloads: 1,
    captures: [
      {
        problem: null,
        documents: [
          {
            extraction: {
              problem: null,
              citations: [{ legalName: "Synthetic Atlas SPV LLC", page: 1 }],
            },
          },
        ],
      },
    ],
  });
});

for (const provider of ["sydecar", "tokenfolio"] as const) {
  test(`${provider}: rechecks only the selected agreement among 120 positions and preserves sibling evidence`, async ({
    page,
  }) => {
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
    const collector = providerAgreementCollector({
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
          ...syntheticDocumentScan(bytes, new Date().toISOString()),
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
    await page.setContent("<p>No agreements on this unrelated page</p>");
    for (const other of others) await collector.collect(page, other);
    await documentPage(page, provider);
    await collector.collect(page, position);
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
    const missing = providerAgreementCollector({
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
  test(`${provider}: follows the provider popup, reads locally, caches original bytes and never persists signed URLs`, async ({
    page,
    context,
  }) => {
    // Two real antivirus processes load their databases across these four
    // capture phases. CI takes about 30 seconds; match the other multi-capture
    // tests without changing either sandbox's per-operation safety limits.
    test.setTimeout(90_000);
    await documentPage(page, provider);
    let downloads = 0;
    const saved: ProviderLegalDocumentCapture[] = [];
    const run = (
      manifest: ProviderLegalDocumentManifest,
      date = currentCheck,
    ) =>
      providerAgreementCollector({
        provider,
        manifest,
        now: () =>
          new Date(Date.now() + Date.parse(date) - Date.parse(currentCheck)),
        renew: () => Promise.resolve(),
        download: () => {
          downloads += 1;
          return Promise.resolve(new Response(syntheticAgreementPdf()));
        },
        save: ({ capture }) => {
          saved.push(capture);
          return Promise.resolve();
        },
      });
    const collector = run({ version: 1, captures: [] });
    await collector.collect(page, position);
    expect(saved).toHaveLength(0); // Full financial snapshot must finish first.
    await collector.flush();
    expect(downloads).toBe(1);
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
    expect(context.pages()).toHaveLength(1);
    const captures = saved.map((capture) => ({
      ...capture,
      documents: capture.documents.map((document) => ({
        ...document,
        id: crypto.randomUUID(),
      })),
    }));
    const cached = run({ version: 1, captures });
    await cached.collect(page, position);
    await cached.flush();
    expect(downloads).toBe(1);
    const previousVersion = run({
      version: 1,
      captures: captures.map((capture) => ({
        ...capture,
        documents: capture.documents.map((document) => ({
          ...document,
          extraction: {
            ...document.extraction,
            version: 1,
            problem: "name_not_found",
            citations: [],
          },
        })),
      })),
    });
    await previousVersion.collect(page, position);
    await previousVersion.flush();
    expect(downloads).toBe(2);
    expect(saved.at(-1)?.documents[0]?.extraction).toMatchObject({
      version: 6,
      problem: null,
      citations: [{ legalName: "Synthetic Atlas SPV LLC" }],
    });
    const refresh = run({ version: 1, captures }, nextWeek);
    await refresh.collect(page, position);
    await refresh.flush();
    expect(downloads).toBe(3); // Same path may be replaced: bounded weekly recheck.
    expect(saved.at(-1)?.documents[0]).toMatchObject({
      scan: { outcome: "clean" },
      extraction: { problem: null },
    });
  });
}

test("Sydecar indexes one central Documents page across 120 rows and opens only the exact position agreements", async ({
  context,
  page,
}) => {
  const rows = Array.from({ length: 120 }, (_, index) =>
    sydecarCentralDocumentRow({
      documentName: `Synthetic quarterly update ${index.toString()}`,
      documentType: "Update",
      investment: `Synthetic Other ${index.toString()}`,
      url: "https://unexpected.example/must-not-open.pdf",
    }),
  );
  rows[17] = sydecarCentralDocumentRow({
    documentName: "Synthetic Atlas Subscription Agreement.pdf",
    documentType: "Subscription Agreement",
    investment: position.investment,
    url: urls.sydecar,
  });
  rows[119] = sydecarCentralDocumentRow({
    documentName: "Synthetic Other Operating Agreement.pdf",
    documentType: "Operating Agreement",
    investment: "Synthetic Unrelated",
    url: "https://unexpected.example/must-not-open.pdf",
  });
  let documentPageRequests = 0;
  let legacyPageRequests = 0;
  const legacyUrl =
    "https://app.sydecar.io/investments/11111111-1111-4111-8111-111111111111";
  await page.route(legacyUrl, (route) => {
    legacyPageRequests += 1;
    return route.fulfill({ body: "Incomplete older document list" });
  });
  await page.route("https://app.sydecar.io/documents", (route) => {
    documentPageRequests += 1;
    return route.fulfill({
      body: sydecarCentralDocumentsPage(rows),
      contentType: "text/html",
    });
  });
  let downloads = 0;
  const saved: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => {
      downloads += 1;
      return Promise.resolve(new Response(syntheticAgreementPdf()));
    },
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });

  await collector.collectSydecarDocuments(page, [
    {
      ...position,
      sourceDisplayNameUnique: true,
      sydecarLegacyDocumentUrl: legacyUrl,
    },
  ]);
  expect(saved).toHaveLength(0);
  await collector.flush();

  expect(documentPageRequests).toBe(1);
  expect(legacyPageRequests).toBe(0);
  expect(downloads).toBe(1);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    problem: null,
    documents: [
      {
        extraction: {
          problem: null,
          citations: [{ legalName: "Synthetic Atlas SPV LLC", page: 1 }],
        },
      },
    ],
  });
  expect(context.pages()).toHaveLength(1);
});

test("Sydecar uses an exact reconciled legacy page only after central controls finish", async ({
  page,
}) => {
  const legacyUrl =
    "https://app.sydecar.io/investments/11111111-1111-4111-8111-111111111111";
  const visits: string[] = [];
  await page.route("https://app.sydecar.io/documents", (route) => {
    visits.push("central");
    return route.fulfill({
      contentType: "text/html",
      body: sydecarCentralDocumentsPage([
        sydecarCentralDocumentRow({
          documentName: "Synthetic subscription agreement",
          documentType: "Subscription Agreement",
          investment: "Synthetic Central",
          url: urls.sydecar,
        }),
      ]),
    });
  });
  await page.route(legacyUrl, (route) => {
    visits.push("legacy");
    return route.fulfill({
      contentType: "text/html",
      body: `<h2 data-testid="investment-docs-heading">Investment Docs</h2><a data-testid="data-room-doc-download" onclick="window.open('${urls.sydecar}')">Subscription Agreement</a>`,
    });
  });
  let downloads = 0;
  const captures: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => {
      downloads += 1;
      return Promise.resolve(new Response(syntheticAgreementPdf()));
    },
    save: ({ capture }) => {
      captures.push(capture);
      return Promise.resolve();
    },
  });
  await collector.collectSydecarDocuments(page, [
    {
      ...position,
      sourceDisplayNameUnique: true,
      sydecarLegacyDocumentUrl: legacyUrl,
    },
    {
      ...position,
      investment: "Synthetic Central",
      sourceDisplayNameUnique: true,
    },
    {
      ...position,
      investment: "Synthetic Invalid",
      sourceDisplayNameUnique: true,
      sydecarLegacyDocumentUrl: "https://unexpected.example/private",
    },
  ]);
  await collector.flush();
  expect(visits).toEqual(["central", "legacy"]);
  expect(downloads).toBe(2);
  expect(captures).toHaveLength(3);
  expect(
    new Set(captures.map((capture) => capture.naturalKeySha256)).size,
  ).toBe(3);
  expect(captures.map((capture) => capture.problem)).toEqual([
    null,
    null,
    "page_changed",
  ]);
});

test("Sydecar central Documents association fails closed for duplicate position labels", async ({
  page,
}) => {
  await page.route("https://app.sydecar.io/documents", (route) =>
    route.fulfill({
      body: sydecarCentralDocumentsPage([
        sydecarCentralDocumentRow({
          documentName: "Synthetic Atlas Subscription Agreement.pdf",
          documentType: "Subscription Agreement",
          investment: position.investment,
          url: urls.sydecar,
        }),
      ]),
      contentType: "text/html",
    }),
  );
  let downloads = 0;
  const saved: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => {
      downloads += 1;
      return Promise.resolve(new Response(syntheticAgreementPdf()));
    },
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });

  await collector.collectSydecarDocuments(page, [
    { ...position, sourceDisplayNameUnique: false },
    {
      ...position,
      legalPosition: "Synthetic second source reference",
      sourceDisplayNameUnique: false,
    },
  ]);
  await collector.flush();

  expect(downloads).toBe(0);
  expect(saved.map((capture) => capture.problem)).toEqual([
    "page_changed",
    "page_changed",
  ]);
});

test("Sydecar central agreement backfill resumes after the 24-download run budget", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const positions = Array.from({ length: 13 }, (_, index) => ({
    ...position,
    investment: `Synthetic Position ${index.toString()}`,
    legalPosition: `Synthetic source ${index.toString()}`,
    sourceDisplayNameUnique: true,
  }));
  const rows = positions.flatMap((item, positionIndex) =>
    Array.from({ length: 2 }, (_, documentIndex) =>
      sydecarCentralDocumentRow({
        documentName: `${item.investment} Subscription Agreement ${documentIndex.toString()}.pdf`,
        documentType: "Subscription Agreement",
        investment: item.investment,
        url: `https://storage.googleapis.com/sydecar-prod-documents/synthetic/${positionIndex.toString()}-${documentIndex.toString()}-agreement.pdf?synthetic=one`,
      }),
    ),
  );
  await page.route("https://app.sydecar.io/documents", (route) =>
    route.fulfill({
      body: sydecarCentralDocumentsPage(rows),
      contentType: "text/html",
    }),
  );
  let downloads = 0;
  const saved: ProviderLegalDocumentCapture[] = [];
  const build = (manifest: ProviderLegalDocumentManifest) =>
    providerAgreementCollector({
      provider: "sydecar",
      manifest,
      now: () => new Date(),
      renew: () => Promise.resolve(),
      download: () => {
        downloads += 1;
        return Promise.resolve(new Response(syntheticAgreementPdf()));
      },
      save: ({ capture }) => {
        saved.push(capture);
        return Promise.resolve();
      },
    });

  const first = build({ version: 1, captures: [] });
  await first.collectSydecarDocuments(page, positions);
  await first.flush();
  expect(downloads).toBe(24);
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
  await second.collectSydecarDocuments(page, positions);
  await second.flush();

  expect(downloads).toBe(26);
  expect(saved).toHaveLength(26);
  expect(saved.slice(13).every((capture) => capture.problem === null)).toBe(
    true,
  );
  expect(saved[25]?.documents).toHaveLength(2);
});

test("backfill reaches later positions before rechecking expired cached agreements", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await documentPage(page, "sydecar");
  const saved: ProviderLegalDocumentCapture[] = [];
  let downloads = 0;
  const build = (
    manifest: ProviderLegalDocumentManifest,
    date = currentCheck,
  ) =>
    providerAgreementCollector({
      provider: "sydecar",
      manifest,
      now: () =>
        new Date(Date.now() + Date.parse(date) - Date.parse(currentCheck)),
      renew: () => Promise.resolve(),
      download: () => {
        downloads += 1;
        return Promise.resolve(new Response(syntheticAgreementPdf()));
      },
      save: ({ capture }) => {
        saved.push(capture);
        return Promise.resolve();
      },
    });
  const first = build({ version: 1, captures: [] });
  for (let index = 0; index < 25; index += 1)
    await first.collect(page, {
      ...position,
      investment: `Synthetic ${index.toString()}`,
    });
  await first.flush();
  expect(downloads).toBe(24);
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
    await second.collect(page, {
      ...position,
      investment: `Synthetic ${index.toString()}`,
    });
  await second.flush();
  expect(downloads).toBe(48); // One new original, then 23 cached rechecks.
  expect(saved[49]).toMatchObject({ problem: null });
});

test("inaccessible or untrusted document locations become explicit gaps", async ({
  page,
}) => {
  const saved: ProviderLegalDocumentCapture[] = [];
  let downloads = 0;
  const collector = providerAgreementCollector({
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => {
      downloads += 1;
      return Promise.resolve(new Response(null, { status: 403 }));
    },
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });
  await documentPage(page, "sydecar");
  await collector.collect(page, position);
  await documentPage(
    page,
    "sydecar",
    "https://unexpected.example/agreement.pdf",
  );
  await collector.collect(page, { ...position, investment: "Synthetic Other" });
  await collector.flush();
  expect(downloads).toBe(1);
  expect(saved.map((capture) => capture.problem)).toEqual([
    "inaccessible",
    "page_changed",
  ]);
});

test("legacy Tokenfolio detail pages are checked and restored without guessing an external platform match", async ({
  page,
}) => {
  const sourceUrl =
    "https://app.tokenfolio.co/portfolio?tab=active&investmentId=11111111-1111-4111-8111-111111111111";
  await page.route("https://app.tokenfolio.co/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().includes("/portfolio")
        ? '<div role="dialog"><h2>Synthetic Atlas</h2><a href="https://app.sydecar.io/login">Investment managed through Sydecar</a><button>Close drawer</button><button onclick="location.href=\'/investments/11111111-1111-4111-8111-111111111111\'">Deal Snapshot</button></div>'
        : '<section data-testid="card"><header data-testid="card-header">Deal Documents</header><div data-testid="card-content"><div></div></div></section>',
    }),
  );
  await page.goto(sourceUrl);
  const saved: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    provider: "tokenfolio",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });
  await collector.collect(page, position);
  await collector.flush();
  expect(page.url()).toBe(sourceUrl);
  expect(saved[0]).toMatchObject({ problem: "missing", documents: [] });
});
