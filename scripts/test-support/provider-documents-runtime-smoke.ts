import { chromium } from "@playwright/test";
import { providerAgreementCollector } from "../provider-legal-document-capture";
import { syntheticAgreementPdf } from "./legal-documents";
import type { ProviderLegalDocumentCapture } from "../../packages/domain/src/provider-legal-documents";

// Invoked by the mandatory native boundary through the service tsx entrypoint.
// Playwright's own test transpiler does not reproduce tsx's browser-callback
// serialization, so an in-process fixture alone cannot cover this boundary.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let requests = 0;
  await page.route("https://app.sydecar.io/documents", (route) => {
    requests += 1;
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><table><thead><tr><th>Document Name</th><th>Type</th><th>Investment</th><th>Date Uploaded</th><th>Profile</th><th>Uploaded By</th></tr></thead><tbody>${Array.from(
        { length: 120 },
        (_, index) =>
          `<tr><td><div onclick="window.open('https://storage.googleapis.com/sydecar-prod-documents/synthetic/runtime-${index.toString()}.pdf')">Synthetic Agreement</div></td><td>Subscription Agreement</td><td>Synthetic Investment ${index.toString()}</td><td>Sep 1, 2026</td><td>Synthetic Profile</td><td>Investor</td></tr>`,
      ).join("")}</tbody></table>`,
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
      investment: "Synthetic Investment 119",
      legalPosition: "Synthetic source reference",
      heldThrough: "Synthetic Family LLC",
      investmentDate: "2026-01-01",
      sourceDisplayNameUnique: true,
    },
  ]);
  await collector.flush();
  console.log(JSON.stringify({ requests, downloads, captures }));
} finally {
  await browser.close();
}
