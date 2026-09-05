import { createHash } from "node:crypto";
import type { Locator, Page, Route } from "@playwright/test";
import { z } from "zod";

import {
  createProviderPositionNaturalKeySha256,
  MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS,
} from "../packages/connectors/src/provider-holdings-template-csv";
import type {
  MacAgentAuthorization,
  ProviderPortfolioAgentLease,
  ProviderPortfolioAgentProvider,
} from "../packages/domain/src/index";
import {
  CapturedLegalDocumentSchema,
  LEGAL_DOCUMENT_EXTRACTOR_VERSION,
  LEGAL_DOCUMENT_RECHECK_MS,
  MAX_LEGAL_DOCUMENT_BYTES,
  MAX_LEGAL_DOCUMENT_POSITION_BYTES,
  MAX_LEGAL_DOCUMENT_RUN_BYTES,
  MAX_LEGAL_DOCUMENTS_PER_POSITION,
  MAX_LEGAL_DOCUMENTS_PER_RUN,
  ProviderLegalDocumentCaptureSchema,
  ProviderLegalDocumentManifestSchema,
  type CapturedLegalDocument,
  type LegalDocumentProblem,
  type ProviderLegalDocumentCapture,
  type ProviderLegalDocumentManifest,
} from "../packages/domain/src/provider-legal-documents";
import { extractLegalNameFromPdf } from "./legal-document-extraction";
import { MacAgentAccessError, macAgentApi } from "./mac-agent-auth";

type Provider = ProviderPortfolioAgentProvider;
type Run = NonNullable<ProviderPortfolioAgentLease["run"]>;
type Position = {
  investment: string;
  legalPosition: string;
  heldThrough: string;
  investmentDate: string | null;
  sourceDisplayNameUnique?: boolean;
};
type DocumentControls = {
  items: Locator[];
  problem: LegalDocumentProblem | null;
  restore: () => Promise<void>;
};
type PendingCapture = {
  capture: ProviderLegalDocumentCapture;
  files: Map<string, Uint8Array>;
};
export type AgreementCollector = {
  collect(page: Page, position: Position): Promise<void>;
  collectSydecarDocuments(
    page: Page,
    positions: readonly Position[],
  ): Promise<void>;
  flush(): Promise<void>;
};
class CaptureProblem extends Error {
  public constructor(public readonly problem: LegalDocumentProblem) {
    super(problem);
  }
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const agreementLabel =
  /\b(?:subscription|series|operating|limited liability company|limited partnership)\s+(?:agreement|pack)\b|\bLLCA\b/iu;
const excludedLabel = /\b(?:tax|K[- ]?1|W[- ]?[89]|wire|invoice)\b/iu;
const MAX_SYDECAR_DOCUMENT_ROWS = MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS * 10;
const SYDECAR_DOCUMENTS_URL = "https://app.sydecar.io/documents";
const SydecarDocumentRowsSchema = z
  .array(
    z
      .object({
        cellCount: z.literal(6),
        controlCount: z.number().int().min(0).max(20),
        documentName: z.string().max(1_000),
        documentType: z.string().max(1_000),
        investment: z.string().max(1_000),
      })
      .strict(),
  )
  .max(MAX_SYDECAR_DOCUMENT_ROWS);

const normalizedLabel = (value: string) =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

// Only the two storage locations observed through provider-owned download
// controls. Never fetch arbitrary page-supplied URLs, redirects or localhost.
export function agreementUrl(provider: Provider, value: string): URL {
  const url = new URL(value);
  const allowed =
    provider === "sydecar"
      ? url.hostname === "storage.googleapis.com" &&
        url.pathname.startsWith("/sydecar-prod-documents/")
      : url.hostname === "firebasestorage.googleapis.com" &&
        url.pathname.startsWith("/v0/b/tokenfolio-343020.appspot.com/o/");
  if (
    !allowed ||
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  )
    throw new CaptureProblem("page_changed");
  return url;
}

async function agreementPopupUrl(
  page: Page,
  control: Locator,
  provider: Provider,
): Promise<URL> {
  const popups = new Set<Page>();
  const track = (popup: Page) => {
    popups.add(popup);
  };
  let resolveUrl: (url: URL) => void = () => undefined;
  let rejectUrl: (error: Error) => void = () => undefined;
  const result = new Promise<URL>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  // Observe the navigation initiated by this exact control and prevent Chrome
  // from downloading an unbounded PDF before the streaming size check below.
  const route = async (request: Route) => {
    if (!request.request().isNavigationRequest()) {
      await request.fallback();
      return;
    }
    // Chromium exposes the first popup navigation before its frame exists.
    // Verify its opener AND exact URL after the popup event below, before any
    // bytes are fetched or attributed to a position.
    let requestPage: Page | null = null;
    try {
      requestPage = request.request().frame().page();
    } catch {
      /* Initial popup request. */
    }
    if (requestPage !== null && (await requestPage.opener()) !== page) {
      await request.fallback();
      return;
    }
    {
      if (requestPage !== null) popups.add(requestPage);
      try {
        const url = agreementUrl(provider, request.request().url());
        await request.fulfill({ contentType: "text/html", body: "" });
        resolveUrl(url);
      } catch {
        await request.abort().catch(() => undefined);
        rejectUrl(new CaptureProblem("page_changed"));
      }
    }
  };
  const timer = setTimeout(
    () => rejectUrl(new CaptureProblem("inaccessible")),
    15_000,
  );
  page.on("popup", track);
  await page.context().route("**/*", route);
  try {
    // Attach both rejection handlers before activating the UI.
    const [url, popup] = await Promise.all([
      result,
      page.waitForEvent("popup", { timeout: 15_000 }),
      control.click({ timeout: 10_000 }),
    ]);
    if ((await popup.opener()) !== page)
      throw new CaptureProblem("page_changed");
    await popup.waitForURL(url.href, { timeout: 10_000 });
    return url;
  } finally {
    clearTimeout(timer);
    await page.context().unroute("**/*", route);
    page.off("popup", track);
    await Promise.all(
      [...popups].map((popup) => popup.close().catch(() => undefined)),
    );
  }
}

export async function readAgreementResponse(
  response: Response,
  maxBytes = MAX_LEGAL_DOCUMENT_BYTES,
  onBytes: (size: number) => void = () => undefined,
): Promise<Uint8Array> {
  if (!response.ok || response.body === null)
    throw new CaptureProblem("inaccessible");
  const declared = response.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)
  ) {
    await response.body.cancel();
    throw new CaptureProblem("limit_reached");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      onBytes(next.value.byteLength);
      if (size > maxBytes) throw new CaptureProblem("limit_reached");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = Buffer.concat(chunks, size);
  if (bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new CaptureProblem("unreadable");
  return bytes;
}

async function controls(
  page: Page,
  provider: Provider,
): Promise<DocumentControls> {
  if (provider === "sydecar") {
    const heading = page.getByTestId("investment-docs-heading");
    if (!(await heading.isVisible().catch(() => false)))
      throw new CaptureProblem("page_changed");
    const links = page.locator(
      '[data-testid="data-room-doc-download"]:visible',
    );
    const items: Locator[] = [];
    for (const link of await links.all()) {
      const label = await link.innerText();
      if (agreementLabel.test(label) && !excludedLabel.test(label))
        items.push(link);
    }
    return {
      items,
      problem: items.length === 0 ? "missing" : null,
      restore: () => Promise.resolve(),
    };
  }
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText("Loading documents…", { exact: true })
    .waitFor({ state: "hidden", timeout: 15_000 });
  await dialog
    .getByText("Loading documents...", { exact: true })
    .waitFor({ state: "hidden", timeout: 15_000 });
  const items: Locator[] = [];
  for (const row of await dialog.locator("li").all()) {
    const label = await row
      .locator("span.truncate.font-medium")
      .innerText()
      .catch(() => "");
    if (agreementLabel.test(label) && !excludedLabel.test(label)) {
      const download = row.getByRole("button", {
        name: "Download",
        exact: true,
      });
      if ((await download.count()) !== 1)
        throw new CaptureProblem("page_changed");
      items.push(download);
    }
  }
  if (items.length > 0)
    return { items, problem: null, restore: () => Promise.resolve() };
  // Older positions expose only their original deal page. Follow that page,
  // but never match a generic external-platform login to a company name.
  const sourceUrl = page.url();
  const source = new URL(sourceUrl);
  const investmentId = source.searchParams.get("investmentId");
  if (investmentId === null || !/^[a-f0-9-]{36}$/u.test(investmentId))
    throw new CaptureProblem("page_changed");
  const snapshot = dialog.getByRole("button", {
    name: "Deal Snapshot",
    exact: true,
  });
  if ((await snapshot.count()) !== 1)
    return { items, problem: "missing", restore: () => Promise.resolve() };
  const restore = async () => {
    await page.goto(sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .getByRole("button", { name: "Close drawer" })
      .waitFor({ state: "visible", timeout: 30_000 });
  };
  try {
    await snapshot.click();
    await page.waitForURL(
      (url) =>
        url.origin === source.origin &&
        url.pathname === `/investments/${investmentId}`,
      { timeout: 15_000 },
    );
    const card = page.getByTestId("card").filter({
      has: page
        .getByTestId("card-header")
        .filter({ hasText: "Deal Documents" }),
    });
    const content = card.getByTestId("card-content");
    await card.waitFor({ state: "visible", timeout: 15_000 });
    await content.waitFor({ state: "attached", timeout: 15_000 });
    // Only the empty legacy layout is verified. An unfamiliar populated card
    // stays explicit rather than clicking an unrelated action or guessing.
    const empty = (await content.innerText()).trim() === "";
    return { items, problem: empty ? "missing" : "page_changed", restore };
  } catch (error) {
    await restore();
    throw error;
  }
}

function controlsWithProblem(problem: LegalDocumentProblem): DocumentControls {
  return { items: [], problem, restore: () => Promise.resolve() };
}

async function stableSydecarDocumentRows(page: Page): Promise<Locator> {
  const table = page.locator("table:visible");
  await table.first().waitFor({ state: "visible", timeout: 30_000 });
  if ((await table.count()) !== 1) throw new CaptureProblem("page_changed");
  const headers = (
    await table.locator(":scope > thead th").allInnerTexts()
  ).map(normalizedLabel);
  if (
    headers.length !== 6 ||
    headers[0] !== "document name" ||
    headers[1] !== "type" ||
    headers[2] !== "investment"
  )
    throw new CaptureProblem("page_changed");

  const rows = table.locator(":scope > tbody > tr");
  let previousCount = -1;
  let stablePasses = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    const count = await rows.count();
    if (count > MAX_SYDECAR_DOCUMENT_ROWS)
      throw new CaptureProblem("limit_reached");
    if (count === previousCount) {
      stablePasses += 1;
      // Do not accept an initially empty async table before its first fetch has
      // had a bounded opportunity to render.
      if (stablePasses >= 2 && attempt >= 5) return rows;
    } else {
      previousCount = count;
      stablePasses = 0;
    }
  }
  throw new CaptureProblem("page_changed");
}

async function sydecarCentralDocumentControls(
  page: Page,
  positions: readonly Position[],
): Promise<DocumentControls[]> {
  try {
    await page.goto(SYDECAR_DOCUMENTS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (page.url() !== SYDECAR_DOCUMENTS_URL)
      throw new CaptureProblem("page_changed");
    const rows = await stableSydecarDocumentRows(page);
    const parsed = SydecarDocumentRowsSchema.safeParse(
      await rows.evaluateAll((elements) =>
        elements.map((row) => {
          const cells = [...row.querySelectorAll(":scope > td")];
          const read = (index: number) =>
            (cells[index]?.textContent ?? "")
              .replace(/\s+/gu, " ")
              .trim()
              .slice(0, 1_001);
          return {
            cellCount: cells.length,
            controlCount:
              cells[0]?.querySelectorAll(":scope > div").length ?? 0,
            documentName: read(0),
            documentType: read(1),
            investment: read(2),
          };
        }),
      ),
    );
    if (!parsed.success) throw new CaptureProblem("page_changed");

    const positionOccurrences = new Map<string, number>();
    for (const position of positions) {
      const key = normalizedLabel(position.investment);
      positionOccurrences.set(key, (positionOccurrences.get(key) ?? 0) + 1);
    }

    return positions.map((position) => {
      const key = normalizedLabel(position.investment);
      if (
        position.sourceDisplayNameUnique !== true ||
        positionOccurrences.get(key) !== 1
      )
        return controlsWithProblem("page_changed");
      const indexes = parsed.data.flatMap((row, index) => {
        const label = `${row.documentName} ${row.documentType}`;
        return normalizedLabel(row.investment) === key &&
          agreementLabel.test(label) &&
          !excludedLabel.test(label)
          ? [index]
          : [];
      });
      if (indexes.some((index) => parsed.data[index]?.controlCount !== 1))
        return controlsWithProblem("page_changed");
      const items = indexes.map((index) =>
        rows.nth(index).locator(":scope > td").nth(0).locator(":scope > div"),
      );
      return {
        items,
        problem: items.length === 0 ? "missing" : null,
        restore: () => Promise.resolve(),
      };
    });
  } catch (error) {
    const problem =
      error instanceof CaptureProblem ? error.problem : "page_changed";
    return positions.map(() => controlsWithProblem(problem));
  }
}

export function providerAgreementCollector(options: {
  provider: Provider;
  manifest: ProviderLegalDocumentManifest;
  save: (pending: PendingCapture) => Promise<void>;
  renew: () => Promise<void>;
  now?: () => Date;
  download?: (url: URL) => Promise<Response>;
}): AgreementCollector {
  const now = options.now ?? (() => new Date());
  const pending: PendingCapture[] = [];
  const rechecks: { checkedAt: string; run: () => Promise<void> }[] = [];
  const known = new Map(
    options.manifest.captures.flatMap((capture) =>
      capture.documents.map(
        (document) => [document.documentKey, document] as const,
      ),
    ),
  );
  const knownHashes = new Map(
    [...known.values()].map((document) => [document.sha256, document]),
  );
  let bytesDownloaded = 0;
  let downloads = 0;
  let renewedAt = now().getTime();
  const startedAt = renewedAt;
  const renew = async () => {
    if (now().getTime() - renewedAt > 60_000) {
      await options.renew();
      renewedAt = now().getTime();
    }
  };
  const downloadDocument = async (
    url: URL,
    documentKey: string,
    positionBytes: number,
    files: Map<string, Uint8Array>,
  ): Promise<CapturedLegalDocument> => {
    if (
      downloads >= MAX_LEGAL_DOCUMENTS_PER_RUN ||
      bytesDownloaded >= MAX_LEGAL_DOCUMENT_RUN_BYTES ||
      positionBytes >= MAX_LEGAL_DOCUMENT_POSITION_BYTES ||
      now().getTime() - startedAt >= 20 * 60_000
    )
      throw new CaptureProblem("limit_reached");
    downloads += 1;
    const response = await (
      options.download ??
      ((url) =>
        fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        }))
    )(url);
    const bytes = await readAgreementResponse(
      response,
      Math.min(
        MAX_LEGAL_DOCUMENT_BYTES,
        MAX_LEGAL_DOCUMENT_RUN_BYTES - bytesDownloaded,
        MAX_LEGAL_DOCUMENT_POSITION_BYTES - positionBytes,
      ),
      (size) => {
        bytesDownloaded += size;
      },
    );
    const sha256 = hash(bytes);
    const sameBytes = knownHashes.get(sha256);
    const extraction =
      sameBytes !== undefined &&
      sameBytes.extraction.version === LEGAL_DOCUMENT_EXTRACTOR_VERSION &&
      sameBytes.extraction.problem !== "extractor_unavailable"
        ? sameBytes.extraction
        : await extractLegalNameFromPdf(bytes);
    const decodedPath = decodeURIComponent(url.pathname);
    const fileName = decodedPath.split("/").at(-1) ?? "agreement.pdf";
    const document = CapturedLegalDocumentSchema.parse({
      documentKey,
      sha256,
      fileName,
      byteSize: bytes.length,
      checkedAt: now().toISOString(),
      extraction,
    });
    if (sameBytes === undefined) files.set(sha256, bytes);
    return document;
  };
  const collectWithControls = async (
    page: Page,
    position: Position,
    getControls: () => Promise<DocumentControls>,
  ) => {
    await renew();
    const naturalKeySha256 = await createProviderPositionNaturalKeySha256({
      provider: options.provider,
      ...position,
    });
    const documents: CapturedLegalDocument[] = [];
    const files = new Map<string, Uint8Array>();
    const capture: ProviderLegalDocumentCapture = {
      version: 1,
      naturalKeySha256,
      ownershipLabel: position.heldThrough,
      problem: null,
      documents,
    };
    let restore: () => Promise<void> = () => Promise.resolve();
    try {
      // Leave time to finish the existing snapshot and upload within its
      // renewable 30-minute lease, even when provider controls stop responding.
      if (now().getTime() - startedAt >= 20 * 60_000)
        throw new CaptureProblem("limit_reached");
      const found = await getControls();
      restore = found.restore;
      capture.problem = found.problem;
      if (found.items.length > MAX_LEGAL_DOCUMENTS_PER_POSITION)
        capture.problem = "limit_reached";
      for (const control of found.items.slice(
        0,
        MAX_LEGAL_DOCUMENTS_PER_POSITION,
      )) {
        const positionBytes = documents.reduce(
          (total, document) => total + document.byteSize,
          0,
        );
        await renew();
        const url = await agreementPopupUrl(page, control, options.provider);
        const documentKey = hash(
          JSON.stringify([
            options.provider,
            naturalKeySha256,
            url.origin,
            url.pathname,
          ]),
        );
        const cached = known.get(documentKey);
        const cacheAge =
          cached === undefined
            ? Infinity
            : now().getTime() - Date.parse(cached.checkedAt);
        if (cached !== undefined) {
          if (
            positionBytes + cached.byteSize >
            MAX_LEGAL_DOCUMENT_POSITION_BYTES
          )
            throw new CaptureProblem("limit_reached");
          const document = CapturedLegalDocumentSchema.parse({
            documentKey: cached.documentKey,
            sha256: cached.sha256,
            fileName: cached.fileName,
            byteSize: cached.byteSize,
            checkedAt: cached.checkedAt,
            extraction: cached.extraction,
          });
          const index = documents.push(document) - 1;
          if (
            cacheAge < 0 ||
            cacheAge >= LEGAL_DOCUMENT_RECHECK_MS ||
            cached.extraction.version !== LEGAL_DOCUMENT_EXTRACTOR_VERSION ||
            cached.extraction.problem === "extractor_unavailable"
          ) {
            // First-time downloads get the run budget before routine rechecks.
            // The signed URL exists only in this run's memory; it is never
            // stored or logged. Keep the original's actual check date until
            // its oldest-first recheck succeeds.
            rechecks.push({
              checkedAt: cached.checkedAt,
              run: async () => {
                await renew();
                try {
                  const otherBytes = documents.reduce(
                    (total, item, itemIndex) =>
                      total + (itemIndex === index ? 0 : item.byteSize),
                    0,
                  );
                  documents[index] = await downloadDocument(
                    url,
                    documentKey,
                    otherBytes,
                    files,
                  );
                } catch (error) {
                  capture.problem =
                    error instanceof CaptureProblem
                      ? error.problem
                      : "inaccessible";
                }
              },
            });
          }
          continue;
        }
        documents.push(
          await downloadDocument(url, documentKey, positionBytes, files),
        );
      }
    } catch (error) {
      capture.problem =
        error instanceof CaptureProblem ? error.problem : "inaccessible";
    } finally {
      await restore();
    }
    pending.push({ capture, files });
  };
  return {
    collect(page, position) {
      return collectWithControls(page, position, () =>
        controls(page, options.provider),
      );
    },
    async collectSydecarDocuments(page, positions) {
      if (options.provider !== "sydecar") {
        for (const position of positions) {
          await collectWithControls(page, position, () =>
            Promise.reject(new CaptureProblem("page_changed")),
          );
        }
        return;
      }
      const found = await sydecarCentralDocumentControls(page, positions);
      for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index];
        const positionControls = found[index];
        if (position === undefined || positionControls === undefined) continue;
        await collectWithControls(page, position, () =>
          Promise.resolve(positionControls),
        );
      }
    },
    async flush() {
      // Only invoked after the existing full snapshot and identity checks pass.
      // No partial or duplicate-position scrape can publish name observations.
      for (const recheck of rechecks.sort((a, b) =>
        a.checkedAt.localeCompare(b.checkedAt),
      )) {
        if (
          downloads >= MAX_LEGAL_DOCUMENTS_PER_RUN ||
          bytesDownloaded >= MAX_LEGAL_DOCUMENT_RUN_BYTES ||
          now().getTime() - startedAt >= 20 * 60_000
        )
          break;
        await recheck.run();
      }
      for (const item of pending) {
        await renew();
        await options.save({
          ...item,
          capture: ProviderLegalDocumentCaptureSchema.parse(item.capture),
        });
      }
    },
  };
}

export async function createProviderAgreementCollector(
  authorization: MacAgentAuthorization,
  provider: Provider,
  run: Run,
): Promise<AgreementCollector> {
  const prefix = `/api/automation/provider-holdings/${provider}/mac-agent/runs/${run.id}`;
  const request = async (operation: string, body?: FormData) => {
    const result = await macAgentApi(authorization, `${prefix}/${operation}`, {
      method: "POST",
      headers: { "X-Keel-Agent-Lease": run.leaseToken },
      ...(body === undefined ? {} : { body }),
    });
    if (result.status !== 200) throw new Error("agreement_upload_failed");
    return result.body;
  };
  const manifest = ProviderLegalDocumentManifestSchema.parse(
    await request("document-manifest"),
  );
  return providerAgreementCollector({
    provider,
    manifest,
    renew: async () => {
      await request("document-manifest");
    },
    save: async ({ capture, files }) => {
      const form = new FormData();
      form.append("capture", JSON.stringify(capture));
      for (const [sha256, bytes] of files)
        form.append(
          sha256,
          new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
          "agreement.pdf",
        );
      // An ambiguous transport failure is retried with exactly the same run,
      // capture, hashes and bytes; server-side reservations are idempotent.
      try {
        await request("documents", form);
      } catch (error) {
        if (error instanceof MacAgentAccessError) throw error;
        await request("documents", form);
      }
    },
  });
}
