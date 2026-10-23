import { expect, test, type Page } from "@playwright/test";
import { providerAgreementCollector } from "../scripts/provider-legal-document-capture";
import { syntheticDocumentScan } from "../scripts/test-support/legal-documents";
import { documentReaderFixture } from "../scripts/test-support/document-reader";
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
// Real scanner timestamps must agree with the real clock. Cache-age tests
// advance their injected observation clock relative to this run.
const currentCheck = new Date().toISOString();
// Scanner coverage inventory: mandatory provider-document-runtime verification
// omits scan/extraction injection and uses the real tsx service entrypoint.
// Browser permutations inject a clean synthetic receipt while retaining the
// real provider DOM, popup, URL validation, download and persistence paths.
// Agreement policy permutations and parsed-page name extraction run in
// agreement-capture.test.ts. Mandatory PDF and provider-document-runtime
// verification exercise real Chromium, scanning, reading and resource limits.
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
    extract: reader.extract,
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
    extract: reader.extract,
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

for (const provider of ["sydecar", "tokenfolio"] as const) {
  test(`${provider}: follows the provider popup, captures original bytes and never persists signed URLs`, async ({
    page,
    context,
  }) => {
    await documentPage(page, provider);
    let downloads = 0;
    let scans = 0;
    const saved: ProviderLegalDocumentCapture[] = [];
    const run = (
      manifest: ProviderLegalDocumentManifest,
      date = currentCheck,
    ) => {
      const observedAt = () =>
        new Date(Date.now() + Date.parse(date) - Date.parse(currentCheck));
      return providerAgreementCollector({
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
    await collector.collect(page, position);
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
    expect(context.pages()).toHaveLength(1);
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
  let scans = 0;
  const saved: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    extract: reader.extract,
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => {
      downloads += 1;
      return Promise.resolve(new Response(syntheticAgreementPdf()));
    },
    scan: (bytes) => {
      scans += 1;
      return cleanSyntheticScan(bytes);
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
  expect(scans).toBe(1);
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
  let scans = 0;
  const captures: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    extract: reader.extract,
    provider: "sydecar",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    download: () => {
      downloads += 1;
      return Promise.resolve(new Response(syntheticAgreementPdf()));
    },
    scan: (bytes) => {
      scans += 1;
      return cleanSyntheticScan(bytes);
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
  expect(scans).toBe(1); // Identical bytes are scanned once within a run.
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
    extract: reader.extract,
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

test("inaccessible or untrusted document locations become explicit gaps", async ({
  page,
}) => {
  const saved: ProviderLegalDocumentCapture[] = [];
  let downloads = 0;
  const collector = providerAgreementCollector({
    extract: reader.extract,
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
  const portfolioUrl = "https://app.tokenfolio.co/portfolio?tab=active";
  let portfolioLoads = 0;
  await page.route("https://app.tokenfolio.co/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().includes("/portfolio")
        ? '<button id="portfolio-tab-active" role="tab" aria-selected="true">Active Holdings 1</button>' +
          (portfolioLoads++ === 0
            ? '<div role="dialog"><h2>Synthetic Atlas</h2><a href="https://app.sydecar.io/login">Investment managed through Sydecar</a><button>Close drawer</button><button onclick="location.href=\'/investments/11111111-1111-4111-8111-111111111111\'">Deal Snapshot</button></div>'
            : "")
        : '<section data-testid="card"><header data-testid="card-header">Deal Documents</header><div data-testid="card-content"><div></div></div></section>',
    }),
  );
  await page.goto(sourceUrl);
  const saved: ProviderLegalDocumentCapture[] = [];
  const collector = providerAgreementCollector({
    extract: reader.extract,
    provider: "tokenfolio",
    manifest: { version: 1, captures: [] },
    renew: () => Promise.resolve(),
    save: ({ capture }) => {
      saved.push(capture);
      return Promise.resolve();
    },
  });
  await collector.collect(page, {
    ...position,
    providerInvestmentId: "11111111-1111-4111-8111-111111111111",
  });
  await collector.flush();
  expect(page.url()).toBe(portfolioUrl);
  await expect(
    page.getByRole("tab", { name: "Active Holdings 1" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Close drawer" })).toBeHidden();
  expect(portfolioLoads).toBe(2);
  expect(saved[0]).toMatchObject({
    problem: "missing",
    documents: [],
    sourceInvestment: {
      id: "11111111-1111-4111-8111-111111111111",
      association: "investment_page",
    },
  });
});
