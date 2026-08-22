import { expect, test } from "@playwright/test";

import { parseProviderHoldingsTemplateCsv } from "../packages/connectors/src/index";
import { __providerPortfolioMacAgentTest } from "../scripts/provider-portfolio-mac-agent";

const { captureSydecar, captureTokenfolio } = __providerPortfolioMacAgentTest;

function tokenfolioPage(activeCount = 2): string {
  const rows = [
    {
      company: "Synthetic Atlas",
      committed: "$12,500.00",
      current: "$18,750.25",
      currentSuffix: "(+50.0%)",
      entity: "Synthetic Family LLC",
      date: "Aug 20th, 2025",
    },
    {
      company: "Synthetic Beacon",
      committed: "$8,000",
      current: "-",
      currentSuffix: "",
      entity: "Synthetic Family Trust",
      date: "Jan 3rd, 2026",
    },
  ];
  const rowMarkup = rows
    .map(
      (row) => `
        <div role="button" class="relative cursor-pointer" tabindex="0"
          data-company="${row.company}" data-committed="${row.committed}"
          data-current="${row.current}" data-entity="${row.entity}"
          data-date="${row.date}">
          <div class="grid">
            <div><span>${row.company}</span></div>
            <div><span>Units:</span><span>100</span></div>
            <div><span>Entry Price:</span><span>$10.00</span></div>
            <div><span>Committed:</span><span>${row.committed}</span></div>
            <div><span>TF Price:</span><span>$15.00</span></div>
            <div><span>Current Value:</span><span>${row.current}<span>${row.currentSuffix}</span></span></div>
            <div><span>Status:</span><span>Active</span></div>
          </div>
        </div>`,
    )
    .join("");
  return `<!doctype html>
    <html><body>
      <button role="tab" aria-selected="true">Active Holdings${activeCount.toString()}</button>
      <button role="tab" aria-selected="false">Exited Investments0</button>
      ${rowMarkup}
      <div role="dialog" hidden>
        <h2></h2>
        <div><div class="text-xs text-gray-400 mb-1 truncate">Committed</div><div data-summary="committed"></div></div>
        <div><div class="text-xs text-gray-400 mb-1 truncate">Current Value</div><div data-summary="current"></div></div>
        <div><div class="text-xs text-gray-400 mb-1 truncate">Return</div><div>Not used</div></div>
        <dl>
          <div><dt>Entity</dt><dd data-detail="entity"></dd></div>
          <div><dt>Entry Price</dt><dd>$10.00</dd></div>
          <div><dt>Committed On</dt><dd data-detail="date"></dd></div>
        </dl>
        <button aria-label="Close drawer">Close</button>
      </div>
      <script>
        const dialog = document.querySelector('[role="dialog"]');
        document.querySelectorAll('div[role="button"].relative.cursor-pointer').forEach((row) => {
          row.addEventListener('click', () => {
            dialog.hidden = false;
            dialog.querySelector('h2').textContent = row.dataset.company.toUpperCase();
            dialog.querySelector('[data-summary="committed"]').textContent = row.dataset.committed;
            dialog.querySelector('[data-summary="current"]').textContent = row.dataset.current;
            dialog.querySelector('[data-detail="entity"]').textContent = row.dataset.entity;
            dialog.querySelector('[data-detail="date"]').textContent = row.dataset.date;
          });
        });
        dialog.querySelector('[aria-label="Close drawer"]').addEventListener('click', () => {
          dialog.hidden = true;
        });
      </script>
    </body></html>`;
}

function sydecarListPage(): string {
  return `<!doctype html>
    <html><body>
      <table data-testid="investments-table"><tbody>
        <tr data-testid="investment-row" onclick="location.href='/investments/11111111-1111-4111-8111-111111111111'">
          <td><span data-testid="investment-name">Synthetic Climate Labs</span></td>
          <td><span data-testid="investment-investing-as">Synthetic Investor LLC</span></td>
          <td><span data-testid="investment-status-closed">CLOSED</span></td>
          <td><span>$15,000.00</span></td>
          <td><span>$12,500.00</span></td>
          <td><span data-testid="investment-mgmt-fee">2%</span></td>
          <td><span data-testid="investment-carry">20%</span></td>
          <td><span>Closed</span></td><td><span>Today</span></td><td></td>
        </tr>
        <tr data-testid="investment-row" onclick="location.href='/investments/22222222-2222-4222-8222-222222222222'">
          <td><span data-testid="investment-name">Synthetic Offered Deal</span></td>
          <td><span data-testid="investment-investing-as">Synthetic Investor LLC</span></td>
          <td><span data-testid="investment-status-offered">OFFERED</span></td>
          <td><span>$5,000.00</span></td><td><span>$0.00</span></td>
          <td><span data-testid="investment-mgmt-fee">2%</span></td>
          <td><span data-testid="investment-carry">20%</span></td>
          <td><span>Open</span></td><td><span>Today</span></td><td></td>
        </tr>
      </tbody></table>
    </body></html>`;
}

function sydecarDetailPage(): string {
  return `<!doctype html>
    <html><body>
      <section data-testid="invest-deal-card.desktop">
        <h1 data-testid="invest-deal-card.title">Synthetic Climate Labs</h1>
        <div data-testid="invest-deal-card.commitment-amount-fixed">$15,000.00</div>
      </section>
      <div data-testid="amount-funded-value.currently-funded">$12,500.00</div>
      <fieldset data-testid="investor-activity-log">
        <div>
          <div>
            <div data-testid="investor-activity-log.label">Initial investment</div>
            <div data-testid="investor-activity-log.date">Apr 14, 2025</div>
          </div>
          <div data-testid="investor-activity-log.amount">$12,500.00</div>
        </div>
      </fieldset>
    </body></html>`;
}

test("captures and reconciles the supported Tokenfolio page contract", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({ body: tokenfolioPage(), contentType: "text/html" });
  });
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

  const bytes = await captureTokenfolio(page, "2026-08-21");
  const parsed = await parseProviderHoldingsTemplateCsv("tokenfolio", bytes);
  expect(parsed.rows).toMatchObject([
    {
      companyOrFund: "Synthetic Atlas",
      investedMinor: 1_250_000,
      unrealizedValueMinor: 1_875_025,
      investmentEntity: "Synthetic Family LLC",
      investDate: "2025-08-20",
    },
    {
      companyOrFund: "Synthetic Beacon",
      investedMinor: 800_000,
      unrealizedValueMinor: null,
      unrealizedValueState: "not_reported",
      investDate: "2026-01-03",
    },
  ]);
});

test("fails closed when the Tokenfolio visible count does not reconcile", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage(3),
      contentType: "text/html",
    });
  });
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

  await expect(captureTokenfolio(page, "2026-08-21")).rejects.toThrow(
    "incomplete_snapshot",
  );
});

test("captures funded Sydecar positions and leaves value unreported", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.sydecar.io/investments", async (route) => {
    await route.fulfill({ body: sydecarListPage(), contentType: "text/html" });
  });
  await page.route(
    "https://app.sydecar.io/investments/11111111-1111-4111-8111-111111111111",
    async (route) => {
      await route.fulfill({
        body: sydecarDetailPage(),
        contentType: "text/html",
      });
    },
  );
  await page.goto("https://app.sydecar.io/investments");

  const bytes = await captureSydecar(page, "2026-08-21");
  const parsed = await parseProviderHoldingsTemplateCsv("sydecar", bytes);
  expect(parsed.rows).toMatchObject([
    {
      companyOrFund: "Synthetic Climate Labs",
      investedMinor: 1_250_000,
      dealMetadata: { allocationMinor: 1_500_000 },
      unrealizedValueMinor: null,
      unrealizedValueState: "not_reported",
      investmentEntity: "Synthetic Investor LLC",
      investDate: "2025-04-14",
    },
  ]);
});
