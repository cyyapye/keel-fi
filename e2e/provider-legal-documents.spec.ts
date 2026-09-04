import { expect, test, type Page } from "@playwright/test";
import { providerAgreementCollector } from "../scripts/provider-legal-document-capture";
import { syntheticAgreementPdf } from "../scripts/test-support/legal-documents";
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

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "Existing capture agents use desktop provider sessions.");
});

for (const provider of ["sydecar", "tokenfolio"] as const) {
  test(`${provider}: follows the provider popup, reads locally, caches original bytes and never persists signed URLs`, async ({
    page,
    context,
  }) => {
    await documentPage(page, provider);
    let downloads = 0;
    const saved: ProviderLegalDocumentCapture[] = [];
    const run = (
      manifest: ProviderLegalDocumentManifest,
      date = "2026-09-01T12:00:00.000Z",
    ) =>
      providerAgreementCollector({
        provider,
        manifest,
        now: () => new Date(date),
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
    const refresh = run({ version: 1, captures }, "2026-09-09T12:00:00.000Z");
    await refresh.collect(page, position);
    await refresh.flush();
    expect(downloads).toBe(2); // Same path may be replaced: bounded weekly recheck.
  });
}

test("backfill reaches later positions before rechecking expired cached agreements", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await documentPage(page, "sydecar");
  const saved: ProviderLegalDocumentCapture[] = [];
  let downloads = 0;
  const build = (
    manifest: ProviderLegalDocumentManifest,
    date = "2026-09-01T12:00:00.000Z",
  ) =>
    providerAgreementCollector({
      provider: "sydecar",
      manifest,
      now: () => new Date(date),
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
    "2026-09-09T12:00:00.000Z",
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
