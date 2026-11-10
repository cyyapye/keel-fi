import { expect, test } from "@playwright/test";

import { parseProviderHoldingsTemplateCsv } from "../packages/connectors/src/index";
import type { AgreementCollector } from "../scripts/provider-legal-document-capture";
import { __providerPortfolioMacAgentTest } from "../scripts/provider-portfolio-mac-agent";

const {
  captureSydecar,
  captureTokenfolio,
  providerPageReady,
  providerPageReadyNow,
  requireProviderPageReady,
} = __providerPortfolioMacAgentTest;

const nonblockingMfaMarkup = [
  "<h1>Set up two-factor authentication</h1><button>Continue</button>",
  "<div hidden><form><h1>Verify your identity</h1><button>Verify</button></form></div>",
  "<form><h1 hidden>Verify your identity</h1><button>Verify</button></form>",
  "<form><h1>Verify your identity</h1><button hidden>Verify</button></form>",
  "<form><h1>Verify your identity</h1></form><form><button>Verify</button></form>",
  "<button hidden>Sign in with a passkey</button>",
  "<form><h1>Two-factor authentication</h1><button>Disable</button></form>",
  "<form><h1>Security settings</h1><button>Add passkey</button></form>",
] as const;

for (const [provider, origin, control] of [
  [
    "tokenfolio",
    "https://app.tokenfolio.co",
    '<button id="portfolio-tab-active" role="tab">Active Holdings0</button>',
  ],
  [
    "sydecar",
    "https://app.sydecar.io",
    '<table data-testid="investments-table"><thead><tr><th>Investment</th></tr></thead><tbody></tbody></table>',
  ],
] as const) {
  test(`${provider} distinguishes sign-in from missing, responsive, or delayed portfolio controls`, async ({
    page,
    isMobile,
  }) => {
    let html =
      '<div role="button" class="relative cursor-pointer">Not a portfolio</div>';
    await page.route(`${origin}/**`, (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );

    if (!isMobile) {
      await page.route("https://unrelated.example/**", (route) =>
        route.fulfill({
          body: '<input type="password"><button>Sign in with a passkey</button>',
          contentType: "text/html",
        }),
      );
      await page.goto("https://unrelated.example/login");
      await expect(
        requireProviderPageReady(page, provider, 100),
      ).rejects.toThrow("page_not_supported");

      await page.goto(`${origin}/portfolio`);
      await expect(providerPageReady(page, provider, 100)).resolves.toBe(false);
      await expect(
        requireProviderPageReady(page, provider, 100),
      ).rejects.toThrow("page_not_supported");

      html = '<a href="/login">Sign in</a><p>Temporarily unavailable</p>';
      await page.reload();
      await expect(
        requireProviderPageReady(page, provider, 100),
      ).rejects.toThrow("page_not_supported");

      for (const form of [
        '<input type="password"><button>Sign in</button>',
        '<input autocomplete="one-time-code"><button>Verify</button>',
        '<input type="email"><button>Sign in</button>',
      ]) {
        html = form;
        await page.reload();
        await expect(
          requireProviderPageReady(page, provider, 100),
        ).rejects.toThrow("provider_sign_in_required");
      }
    }

    // A real sign-in prompt takes priority over mounted holdings at both widths.
    html = `${control}<input type="password"><button>Sign in</button>`;
    await page.goto(`${origin}/portfolio`);
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "provider_sign_in_required",
    );

    if (isMobile) {
      // The remote desktop can resize to its viewer before saved-session verification.
      const responsive = `<meta name="viewport" content="width=device-width, initial-scale=1">
        <style>@media (max-width: 700px) { .wide-only { display: none } }
        @media (min-width: 701px) { .narrow-only { display: none } }</style>`;
      html = `${responsive}<div class="wide-only">${control}</div>`;
      await page.goto(`${origin}/portfolio`);
      await expect(page.locator(".wide-only")).toBeHidden();
      await expect(providerPageReady(page, provider)).resolves.toBe(
        provider === "sydecar",
      );

      html = `${responsive}<div id="portfolio" class="narrow-only">Loading</div>
        <script>setTimeout(() => document.getElementById("portfolio").innerHTML = ${JSON.stringify(control)}, 200)</script>`;
      await page.reload();
      await expect(page.locator(".narrow-only")).toBeVisible();
      await expect(
        requireProviderPageReady(page, provider),
      ).resolves.toBeUndefined();
      if (provider === "tokenfolio") {
        // Ordinary settings alone cannot establish a signed-in portfolio.
        html = `${responsive}${nonblockingMfaMarkup.join("")}`;
        await page.reload();
        await expect(providerPageReady(page, provider, 100)).resolves.toBe(
          false,
        );
        for (const optional of nonblockingMfaMarkup) {
          html = `${responsive}${control}<div class="narrow-only">${optional}</div>`;
          await page.reload();
          await expect(providerPageReady(page, provider)).resolves.toBe(true);
        }
        html = `${responsive}${control}<form class="narrow-only"><h1>Set up two-factor authentication</h1><button>Continue</button></form>`;
        await page.reload();
        await expect(providerPageReady(page, provider)).resolves.toBe(true);
        for (const challenge of [
          "<button>Sign in with a passkey</button>",
          "<button>Log in with your passkey</button>",
          '<div role="dialog"><h2>Set up your passkey</h2><button>Continue</button></div>',
        ]) {
          html = `${responsive}${control}<div class="narrow-only">${challenge}</div>`;
          await page.reload();
          await expect(providerPageReady(page, provider)).resolves.toBe(false);
          html = `${responsive}${control}<div class="wide-only">${challenge}</div>`;
          await page.reload();
          await expect(
            requireProviderPageReady(page, provider),
          ).resolves.toBeUndefined();
        }
      }
      return;
    }
    // A provider's own login page can arrive before its form has mounted.
    html = "<h1>Log in to your account</h1>";
    await page.goto(`${origin}/login`);
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "provider_sign_in_required",
    );
    await page.goto(`${origin}/portfolio?redirect=/login`);
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "page_not_supported",
    );

    html = `<div hidden>${control}</div>`;
    await page.goto(`${origin}/portfolio`);
    // This is a positive readiness check for Sydecar's mounted responsive
    // table. Use the production polling budget; 100 ms makes renderer
    // scheduling under concurrent CI load part of the assertion.
    await expect(providerPageReady(page, provider)).resolves.toBe(
      provider === "sydecar",
    );
    html = `<div id="loading">Loading</div><script>setTimeout(() => { document.body.innerHTML = ${JSON.stringify(control)}; }, 200)</script>`;
    await page.reload();
    await expect(
      requireProviderPageReady(page, provider, 2_000),
    ).resolves.toBeUndefined();
  });
}

test(
  "Tokenfolio recognizes passkey sign-in and blocking MFA enrollment without treating security settings as sign-in",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const origin = "https://app.tokenfolio.co";
    const control =
      '<button id="portfolio-tab-active" role="tab">Active Holdings0</button>';
    let html = "";
    await page.route(`${origin}/**`, (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );

    for (const content of [
      "<button>Sign in with a passkey</button>",
      "<button>Log in with your passkey</button>",
      '<form><h1>Verify your identity</h1><input inputmode="numeric"><button>Verify</button></form>',
      '<form><h1>Two-factor authentication</h1><input inputmode="numeric"><button>Verify</button></form>',
      "<form><h1>Set up two-factor authentication</h1><button>Continue</button></form>",
      `${control}<div role="dialog"><h2>Set up your passkey</h2><button>Continue</button></div>`,
    ]) {
      html = content;
      await page.goto(`${origin}/portfolio`);
      await expect(
        requireProviderPageReady(page, "tokenfolio", 100),
      ).rejects.toThrow("provider_sign_in_required");
    }

    for (const content of nonblockingMfaMarkup) {
      html = content;
      await page.goto(`${origin}/portfolio`);
      await expect(
        requireProviderPageReady(page, "tokenfolio", 100),
      ).rejects.toThrow("page_not_supported");
      html = `${control}${content}`;
      await page.reload();
      await expect(providerPageReady(page, "tokenfolio")).resolves.toBe(true);
    }

    // Optional enrollment within the portfolio's settings is not a sign-in gate.
    html = `${control}<form><h1>Set up two-factor authentication</h1><button>Continue</button></form>`;
    await page.goto(`${origin}/portfolio`);
    await expect(providerPageReady(page, "tokenfolio")).resolves.toBe(true);

    await page.route("https://unrelated.example/**", (route) =>
      route.fulfill({
        body: "<button>Sign in with a passkey</button>",
        contentType: "text/html",
      }),
    );
    await page.goto("https://unrelated.example/login");
    await expect(
      requireProviderPageReady(page, "tokenfolio", 100),
    ).rejects.toThrow("page_not_supported");
  },
);

test(
  "Tokenfolio recognizes its hosted Auth0 login without accepting unrelated or incomplete pages",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const origin = "https://tokenfolio.eu.auth0.com";
    let html =
      '<form><input autocomplete="username"><input type="password"><button>Continue</button></form>';
    await page.route(`${origin}/**`, (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(`${origin}/u/login/password?state=synthetic`);
    await expect(
      requireProviderPageReady(page, "tokenfolio", 100),
    ).rejects.toThrow("provider_sign_in_required");
    await expect(
      requireProviderPageReady(page, "sydecar", 100),
    ).rejects.toThrow("page_not_supported");
    for (const content of [
      '<form hidden><input type="password"><button>Continue</button></form>',
      '<form><input type="password"></form><form><button>Continue</button></form>',
      "<h1>Temporarily unavailable</h1>",
    ]) {
      html = content;
      await page.reload();
      await expect(
        requireProviderPageReady(page, "tokenfolio", 100),
      ).rejects.toThrow("page_not_supported");
    }
    html = '<form><input type="password"><button>Continue</button></form>';
    await page.goto(`${origin}/settings`);
    await expect(
      requireProviderPageReady(page, "tokenfolio", 100),
    ).rejects.toThrow("page_not_supported");
  },
);

function tokenfolioPage({
  activeCount = 2,
  statuses = ["Funds Received", "Completed"],
  drawerInitiallyOpen = false,
  detailDelayMs = 0,
  tabCountDelayMs = 0,
  drawerUrlDelayMs = 0,
  shareBases = [null, null],
}: {
  activeCount?: number;
  statuses?: readonly [string, string];
  drawerInitiallyOpen?: boolean;
  detailDelayMs?: number;
  tabCountDelayMs?: number;
  drawerUrlDelayMs?: number;
  shareBases?: readonly [string | null, string | null];
} = {}): string {
  const rows = [
    {
      company: "Synthetic Atlas",
      committed: "$12,500.00",
      current: "$18,750.25",
      currentSuffix: "(+50.0%)",
      entity: "Synthetic Family LLC",
      date: "Aug 20th, 2025",
      status: statuses[0],
    },
    {
      company: "Synthetic Beacon",
      committed: "$8,000",
      current: "-",
      currentSuffix: "",
      entity: "Synthetic Family Trust",
      date: "Jan 3rd, 2026",
      status: statuses[1],
    },
  ];
  const rowMarkup = rows
    .map(
      (row, index) => `
        <div role="button" class="relative cursor-pointer" tabindex="0"
          data-investment-id="${index === 0 ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222"}"
          data-quote-basis="${shareBases[index] ?? ""}"
          data-company="${row.company}" data-committed="${row.committed}"
          data-current="${row.current}" data-entity="${row.entity}"
          data-date="${row.date}">
          <div class="grid">
            <div><span>${row.company}</span></div>
            <div><span>Units:</span><span>100</span></div>
            <div><span>Entry Price:</span><span>$10.00</span></div>
            <div><span>Committed:</span><span>${row.committed}</span></div>
            <div><span>*TF Price:</span><span>$15.00</span></div>
            <div><span>Current Value:</span><span>${row.current}<span>${row.currentSuffix}</span></span></div>
            <div><span>Status:</span><span>${row.status}</span></div>
          </div>
        </div>`,
    )
    .join("");
  return `<!doctype html>
    <html><head><style>
      @keyframes tokenfolio-row-motion {
        from { transform: translateX(0); }
        to { transform: translateX(1px); }
      }
      div[role="button"].relative.cursor-pointer {
        animation: tokenfolio-row-motion 1ms infinite alternate;
      }
    </style></head><body>
      <button id="portfolio-tab-active" role="tab" aria-selected="true" onclick="this.dataset.clicked = 'true'">Active Holdings${tabCountDelayMs > 0 ? "" : activeCount.toString()}</button>
      <button role="tab" aria-selected="false">Exited Investments0</button>
      <div id="portfolio-rows">${rowMarkup}</div>
      <div role="dialog"${drawerInitiallyOpen ? "" : " hidden"}>
        <h2></h2>
        <div><div class="text-xs text-gray-400 mb-1 truncate">Committed</div><div data-summary="committed"></div></div>
        <div><div class="text-xs text-gray-400 mb-1 truncate">Current Value</div><div data-summary="current"></div></div>
        <div><div class="text-xs text-gray-400 mb-1 truncate">Return</div><div>Not used</div></div>
        <dl>
          <div><dt>Entity</dt><dd data-detail="entity"></dd></div>
          <div><dt>Entry Price</dt><dd>$10.00</dd></div>
          <div><dt>Committed On</dt><dd data-detail="date"></dd></div>
        </dl>
        <dl data-reported-quote></dl>
        <button aria-label="Close drawer">Close</button>
      </div>
      <script>
        setTimeout(() => {
          document.querySelector('#portfolio-tab-active').textContent = 'Active Holdings${activeCount.toString()}';
        }, ${tabCountDelayMs.toString()});
        const dialog = document.querySelector('[role="dialog"]');
        document.querySelectorAll('div[role="button"].relative.cursor-pointer').forEach((row) => {
          row.addEventListener('click', () => {
            dialog.hidden = false;
            setTimeout(() => {
              const url = new URL(location.href);
              url.searchParams.set('investmentId', row.dataset.investmentId);
              history.replaceState(null, '', url.href);
            }, ${drawerUrlDelayMs.toString()});
            setTimeout(() => {
              dialog.querySelector('h2').textContent = row.dataset.company.toUpperCase();
              dialog.querySelector('[data-summary="committed"]').textContent = row.dataset.committed;
              dialog.querySelector('[data-summary="current"]').textContent = row.dataset.current;
              dialog.querySelector('[data-detail="entity"]').textContent = row.dataset.entity;
              dialog.querySelector('[data-detail="date"]').textContent = row.dataset.date;
              dialog.querySelector('[data-reported-quote]').innerHTML = row.dataset.quoteBasis
                ? '<dt>Mark date</dt><dd>Aug 18, 2026</dd><dt>Share class</dt><dd>Common</dd><dt>Share basis</dt><dd>' + row.dataset.quoteBasis + '</dd>'
                : '';
            }, ${detailDelayMs.toString()});
          });
        });
        dialog.querySelector('[aria-label="Close drawer"]').addEventListener('click', () => {
          dialog.hidden = true;
          setTimeout(() => {
            const url = new URL(location.href);
            url.searchParams.delete('investmentId');
            history.replaceState(null, '', url.href);
          }, ${drawerUrlDelayMs.toString()});
        });
      </script>
    </body></html>`;
}

function sydecarListPage(duplicateFundedAmounts = false): string {
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
          <td><span data-testid="investment-status-${duplicateFundedAmounts ? "closed" : "offered"}">${duplicateFundedAmounts ? "CLOSED" : "OFFERED"}</span></td>
          <td><span>${duplicateFundedAmounts ? "$15,000.00" : "$5,000.00"}</span></td><td><span>${duplicateFundedAmounts ? "$12,500.00" : "$0.00"}</span></td>
          <td><span data-testid="investment-mgmt-fee">2%</span></td>
          <td><span data-testid="investment-carry">20%</span></td>
          <td><span>Open</span></td><td><span>Today</span></td><td></td>
        </tr>
      </tbody></table>
    </body></html>`;
}

function sydecarDetailPage(
  detailDelayMs = 0,
  detailTitle = "Synthetic Deal Vehicle",
  detailDate = "Apr 14, 2025",
  undated = false,
): string {
  const title = detailDelayMs === 0 ? detailTitle : "";
  const commitment = detailDelayMs === 0 ? "$15,000.00" : "";
  const funded = detailDelayMs === 0 ? "$12,500.00" : "";
  const activityLabel = detailDelayMs === 0 ? "Initial investment" : "";
  const activityDate = detailDelayMs === 0 ? detailDate : "";
  return `<!doctype html>
    <html><body>
      <section hidden>
        <h1 data-testid="invest-deal-card.title">Hidden duplicate</h1>
        <div data-testid="invest-deal-card.commitment-amount-fixed">$1.00</div>
        <div data-testid="amount-funded-value.currently-funded">$1.00</div>
        <fieldset data-testid="investor-activity-log">
          <div>
            <div data-testid="investor-activity-log.label">Hidden activity</div>
            <div data-testid="investor-activity-log.date">Jan 1, 2000</div>
          </div>
        </fieldset>
      </section>
      <section data-testid="invest-deal-card.desktop">
        <h1 id="sydecar-detail-title" data-testid="invest-deal-card.title">${title}</h1>
        <div id="sydecar-detail-commitment" data-testid="invest-deal-card.commitment-amount-fixed">${commitment}</div>
      </section>
      ${
        undated
          ? '<h2 data-testid="investment-docs-heading">Documents</h2>'
          : `<div id="sydecar-detail-funded" data-testid="amount-funded-value.currently-funded">${funded}</div>
      <fieldset data-testid="investor-activity-log">
        <div>
          <div>
            <div id="sydecar-detail-activity-label" data-testid="investor-activity-log.label">${activityLabel}</div>
            <div id="sydecar-detail-activity-date" data-testid="investor-activity-log.date">${activityDate}</div>
          </div>
          <div data-testid="investor-activity-log.amount">$12,500.00</div>
        </div>
      </fieldset>`
      }
      <script>
        setTimeout(() => {
          document.querySelector('#sydecar-detail-title').textContent = ${JSON.stringify(detailTitle)};
          document.querySelector('#sydecar-detail-commitment').textContent = '$15,000.00';
          ${
            undated
              ? ""
              : `document.querySelector('#sydecar-detail-funded').textContent = '$12,500.00';
          document.querySelector('#sydecar-detail-activity-label').textContent = 'Initial investment';
          document.querySelector('#sydecar-detail-activity-date').textContent = ${JSON.stringify(detailDate)};`
          }
        }, ${detailDelayMs.toString()});
      </script>
    </body></html>`;
}

test("captures and reconciles the supported Tokenfolio page contract", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  let firstStatus = "Funds Received";
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage({
        statuses: [firstStatus, "Completed"],
        detailDelayMs: firstStatus === "Funds Received" ? 250 : 0,
        tabCountDelayMs: firstStatus === "Partially Exited" ? 250 : 0,
        shareBases:
          firstStatus === "Funds Received"
            ? [null, "Before split"]
            : ["After 10-for-1 split", null],
      }),
      contentType: "text/html",
    });
  });
  for (firstStatus of ["Funds Received", "Partially Exited"]) {
    await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

    const bytes = await captureTokenfolio(page, "2026-08-21");
    await expect(
      page.getByRole("tab", { name: /^Active Holdings/u }),
    ).not.toHaveAttribute("data-clicked", "true");
    const parsed = await parseProviderHoldingsTemplateCsv("tokenfolio", bytes);
    expect(parsed.rows).toMatchObject([
      {
        companyOrFund: "Synthetic Atlas",
        dealMetadata: {
          sharePrices: {
            costMicros: 10000000,
            markMicros: 15000000,
          },
        },
        investedMinor: 1_250_000,
        status: "Live",
        unrealizedValueMinor: 1_875_025,
        realizedValueMinor: 0,
        netValueMinor: 1_875_025,
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
    const partialExit = firstStatus === "Partially Exited";
    const reported =
      parsed.rows[partialExit ? 0 : 1]!.dealMetadata?.sharePrices;
    const unknown = parsed.rows[partialExit ? 1 : 0]!.dealMetadata?.sharePrices;
    expect(reported).toMatchObject({
      markDate: "2026-08-18",
      shareClass: "Common",
      shareBasis: {
        key: "issuer-original",
        unitsPerOriginal: partialExit ? 10 : 1,
      },
    });
    expect(unknown).toMatchObject({
      markDate: null,
      shareClass: null,
      shareBasis: null,
    });
  }
});

test("Tokenfolio waits for each drawer URL to open and clear before associating agreements", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  let firstLoad = true;
  await page.route("https://app.tokenfolio.co/**", (route) => {
    const body = tokenfolioPage({
      drawerInitiallyOpen: firstLoad,
      drawerUrlDelayMs: 300,
    });
    firstLoad = false;
    return route.fulfill({
      contentType: "text/html",
      body,
    });
  });
  await page.goto(
    "https://app.tokenfolio.co/portfolio?tab=active&investmentId=33333333-3333-4333-8333-333333333333",
  );
  const ids: Array<string | null> = [];
  const agreements: AgreementCollector = {
    collect: async (sourcePage) => {
      ids.push(new URL(sourcePage.url()).searchParams.get("investmentId"));
      if (ids.length === 1) {
        await sourcePage.goto("https://app.tokenfolio.co/portfolio?tab=active");
      }
    },
    collectSydecarDocuments: () =>
      Promise.reject(new Error("Unexpected provider")),
    flush: () => Promise.resolve(),
  };
  const bytes = await captureTokenfolio(
    page,
    "2026-08-21",
    () => undefined,
    agreements,
  );
  const parsed = await parseProviderHoldingsTemplateCsv("tokenfolio", bytes);
  expect(parsed.rows.map((row) => row.companyOrFund)).toEqual([
    "Synthetic Atlas",
    "Synthetic Beacon",
  ]);
  expect(ids).toEqual([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  expect(new URL(page.url()).searchParams.has("investmentId")).toBe(false);
});

test("fails closed when the Tokenfolio visible count does not reconcile", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage({ activeCount: 3 }),
      contentType: "text/html",
    });
  });
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

  await expect(captureTokenfolio(page, "2026-08-21")).rejects.toThrow(
    "incomplete_snapshot",
  );
});

test("fails closed for an unknown Tokenfolio active-row status", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage({ statuses: ["Exited", "Completed"] }),
      contentType: "text/html",
    });
  });
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

  await expect(captureTokenfolio(page, "2026-08-21")).rejects.toThrow(
    "page_not_supported",
  );
});

test("captures the visible funded Sydecar position and leaves value unreported", async ({
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
        body: `${sydecarDetailPage(250)}<h2 data-testid="investment-docs-heading">Investment Docs</h2>`,
        contentType: "text/html",
      });
    },
  );
  await page.goto("https://app.sydecar.io/investments");

  let inlineCollections = 0;
  const centralBatches: Array<{
    count: number;
    unique: boolean | undefined;
    legacyUrl: string | undefined;
  }> = [];
  const agreements: AgreementCollector = {
    collect: () => {
      inlineCollections += 1;
      return Promise.resolve();
    },
    collectSydecarDocuments: (_page, positions) => {
      centralBatches.push({
        count: positions.length,
        unique: positions[0]?.sourceDisplayNameUnique,
        legacyUrl: positions[0]?.sydecarLegacyDocumentUrl,
      });
      return Promise.resolve();
    },
    flush: () => Promise.resolve(),
  };

  const stages: string[] = [];
  const bytes = await captureSydecar(
    page,
    "2026-08-21",
    (stage) => {
      stages.push(stage);
    },
    agreements,
  );
  expect(stages.at(-1)).toBe("csv");
  expect(stages).toContain("detail");
  const parsed = await parseProviderHoldingsTemplateCsv("sydecar", bytes);
  expect(parsed.rows).toMatchObject([
    {
      companyOrFund: "Synthetic Climate Labs",
      investedMinor: 1_250_000,
      dealMetadata: {
        allocationMinor: 1_500_000,
        managementFeePpm: 20_000,
        carryPpm: 200_000,
      },
      unrealizedValueMinor: null,
      unrealizedValueState: "not_reported",
      investmentEntity: "Synthetic Investor LLC",
      investDate: "2025-04-14",
    },
  ]);
  expect(inlineCollections).toBe(0);
  expect(centralBatches).toEqual([
    {
      count: 1,
      unique: true,
      legacyUrl:
        "https://app.sydecar.io/investments/11111111-1111-4111-8111-111111111111",
    },
  ]);
});

test("keeps equal-amount Sydecar rows distinct by row and destination", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.sydecar.io/investments", async (route) => {
    await route.fulfill({
      body: sydecarListPage(true),
      contentType: "text/html",
    });
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
  await page.route(
    "https://app.sydecar.io/investments/22222222-2222-4222-8222-222222222222",
    async (route) => {
      await route.fulfill({
        body: sydecarDetailPage(
          0,
          "Synthetic Second Vehicle",
          "May 15, 2025",
          true,
        ),
        contentType: "text/html",
      });
    },
  );
  await page.goto("https://app.sydecar.io/investments");

  const bytes = await captureSydecar(page, "2026-08-21");
  const parsed = await parseProviderHoldingsTemplateCsv("sydecar", bytes);
  expect(parsed.rows.map((row) => row.companyOrFund)).toEqual([
    "Synthetic Climate Labs",
    "Synthetic Offered Deal",
  ]);
  expect(parsed.rows[1]).toMatchObject({
    investDate: null,
    investDateState: "not_reported",
  });
});

function syntheticGoogleIdentity(email = "known@example.invalid") {
  return {
    decodedToken: {
      user: { email, email_verified: true, sub: "google-oauth2|synthetic" },
      claims: {
        sub: "google-oauth2|synthetic",
        iss: "https://tokenfolio.eu.auth0.com/",
        aud: "synthetic-client",
        exp: 4_000_000_000,
      },
    },
  };
}

for (const provider of ["tokenfolio", "sydecar"] as const) {
  test(`${provider} resumes the bound Google account and leaves MFA to the user`, async ({
    context,
  }) => {
    const { createHash } = await import("node:crypto");
    const { createProviderGoogleRecovery } =
      await import("../scripts/provider-google-recovery");
    const app =
      provider === "tokenfolio"
        ? "https://app.tokenfolio.co"
        : "https://app.sydecar.io";
    const login =
      provider === "tokenfolio"
        ? "https://tokenfolio.eu.auth0.com/u/login"
        : `${app}/login`;
    const portfolio =
      provider === "tokenfolio" ? `${app}/portfolio` : `${app}/investments`;
    const expectedHash = createHash("sha256")
      .update("known@example.invalid")
      .digest("hex");
    let authenticated = false,
      needsMfa = false,
      selected = 0,
      mfaSubmitted = 0,
      metadataReads = 0;
    let firstEnrollment = false;
    const accountUrl = "https://accounts.google.com/v3/signin/accountchooser";
    const finish =
      provider === "sydecar"
        ? `opener.location.href=${JSON.stringify(portfolio)};window.close()`
        : `location.href=${JSON.stringify(portfolio)}`;
    await context.route("https://api-backend.sydecar.io/user/", (route) => {
      if (route.request().method() === "OPTIONS")
        return route.fulfill({
          headers: {
            "Access-Control-Allow-Origin": app,
            "Access-Control-Allow-Headers": "authorization",
            "Access-Control-Allow-Methods": "GET",
          },
          body: "",
        });
      metadataReads++;
      expect(route.request().headers().authorization).toBe(
        "Bearer synthetic-token",
      );
      return route.fulfill({
        headers: { "Access-Control-Allow-Origin": app },
        json: { id: "synthetic-user", email: "known@example.invalid" },
      });
    });
    await context.route("https://accounts.google.com/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/selected") {
        selected++;
        if (needsMfa)
          return route.fulfill({
            contentType: "text/html",
            body: `<script>location.href='/challenge/totp'</script>`,
          });
        authenticated = true;
        return route.fulfill({
          contentType: "text/html",
          body: `<script>${finish}</script>`,
        });
      }
      if (path === "/challenge/totp")
        return route.fulfill({
          contentType: "text/html",
          body: `<h1>Verify your identity</h1><input autocomplete="one-time-code"><button onclick="location.href='/mfa-completed'">Verify</button>`,
        });
      if (path === "/mfa-completed") {
        mfaSubmitted++;
        authenticated = true;
        return route.fulfill({
          contentType: "text/html",
          body: `<script>${finish}</script>`,
        });
      }
      return route.fulfill({
        contentType: "text/html",
        body: `<h1>Choose an account</h1>${firstEnrollment ? "" : '<div role="link" data-identifier="other@example.invalid"><div data-email="other@example.invalid">Other</div></div>'}<div role="link" tabindex="0" data-identifier="known@example.invalid" onclick="location.href='/selected'"><div data-email="known@example.invalid">Known</div></div>`,
      });
    });
    const page = await context.newPage();
    await context.route(`${app}/**`, (route) => {
      if (!authenticated)
        return route.fulfill({
          contentType: "text/html",
          body: `<script>location.href=${JSON.stringify(login)}</script>`,
        });
      return route.fulfill({
        contentType: "text/html",
        body:
          provider === "tokenfolio"
            ? `<button id="portfolio-tab-active" role="tab">Active Holdings0</button><script>localStorage.setItem('@@auth0spajs@@::synthetic-client::@@user@@',${JSON.stringify(JSON.stringify(syntheticGoogleIdentity()))})</script>`
            : `<table data-testid="investments-table"></table><script>localStorage.setItem('auth_token','synthetic-token')</script>`,
      });
    });
    await context.route(login, (route) =>
      route.fulfill({
        contentType: "text/html",
        body:
          provider === "tokenfolio"
            ? `<button onclick="location.href='${accountUrl}'">Continue with Google</button>`
            : `<button type="button" style="position:relative;width:220px;height:44px"><div><iframe title="Sign in with Google Button" style="position:absolute;inset:0;width:100%;height:100%;border:0" srcdoc="<body style='margin:0'><button style='width:100%;height:44px' onclick='parent.open(&quot;${accountUrl}&quot;)'>Continue as Synthetic User</button>"></iframe></div></button>`,
      }),
    );
    for (const mode of ["background", "interactive-mfa", "first-enrollment"]) {
      const interactive = mode !== "background";
      firstEnrollment = mode === "first-enrollment";
      authenticated = false;
      needsMfa = mode === "interactive-mfa";
      await page.goto(login);
      const recovery = createProviderGoogleRecovery({
        provider,
        context,
        expectedHash: firstEnrollment ? null : expectedHash,
        interactive,
        deadline: Date.now() + 15_000,
        isReady: (candidate) => providerPageReadyNow(candidate, provider),
      });
      try {
        await expect
          .poll(() => recovery.check(page))
          .toBe(needsMfa ? "input_required" : "ready");
        if (needsMfa) {
          const auth =
            provider === "sydecar"
              ? context
                  .pages()
                  .find(
                    (candidate) =>
                      candidate !== page &&
                      candidate.url().includes("/challenge/"),
                  )!
              : page;
          await expect(auth.getByRole("textbox")).toHaveValue("");
          expect(mfaSubmitted).toBe(0);
          // Only this explicit test-user action submits MFA.
          await auth.getByRole("textbox").fill("123456");
          await auth
            .getByRole("button", { name: "Verify", exact: true })
            .click();
          await expect.poll(() => recovery.check(page)).toBe("ready");
        }
        expect(recovery.accountHash).toBe(expectedHash);
        const before = metadataReads;
        expect(await recovery.check(page)).toBe("ready");
        expect(metadataReads).toBe(before);
        await recovery.dispose(true);
      } finally {
        await recovery.dispose();
      }
    }
    expect(selected).toBe(3);
    expect(mfaSubmitted).toBe(1);
    expect(metadataReads).toBe(provider === "sydecar" ? 3 : 0);
  });

  test(
    `${provider} rejects unknown, duplicate and changed Google identities`,
    { tag: "@desktop-only" },
    async ({ context }) => {
      const { createHash } = await import("node:crypto");
      const { createProviderGoogleRecovery } =
        await import("../scripts/provider-google-recovery");
      const app =
        provider === "tokenfolio"
          ? "https://app.tokenfolio.co"
          : "https://app.sydecar.io";
      const login =
        provider === "tokenfolio"
          ? "https://tokenfolio.eu.auth0.com/u/login"
          : `${app}/login`;
      let scenario = "unknown",
        selected = 0;
      const expectedHash = createHash("sha256")
        .update("known@example.invalid")
        .digest("hex");
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === "https://api-backend.sydecar.io")
          return route.fulfill({
            headers: {
              "Access-Control-Allow-Origin": app,
              "Access-Control-Allow-Headers": "authorization",
            },
            json: { id: "synthetic", email: "other@example.invalid" },
          });
        if (url.origin === "https://accounts.google.com") {
          if (url.pathname === "/selected") {
            selected++;
            return route.fulfill({
              contentType: "text/html",
              body: `<script>location.href='${app}/portfolio'</script>`,
            });
          }
          return route.fulfill({
            contentType: "text/html",
            body: `<button data-identifier="known@example.invalid" onclick="location.href='/selected'">Known${scenario === "nested-conflict" ? '<span data-email="other@example.invalid">Other</span>' : ""}</button>${scenario === "duplicate" ? '<button data-identifier="known@example.invalid">Duplicate</button>' : scenario === "unknown" ? '<button data-identifier="other@example.invalid">Other</button>' : ""}`,
          });
        }
        if (url.pathname === "/portfolio")
          return route.fulfill({
            contentType: "text/html",
            body:
              provider === "tokenfolio"
                ? `<button id="portfolio-tab-active" role="tab">Active Holdings0</button><script>localStorage.setItem('@@auth0spajs@@::synthetic-client::@@user@@',${JSON.stringify(JSON.stringify(syntheticGoogleIdentity("other@example.invalid")))})</script>`
                : '<table data-testid="investments-table"></table><script>localStorage.setItem("auth_token","synthetic-token")</script>',
          });
        return route.fulfill({
          contentType: "text/html",
          body: `${scenario === "provider-mfa" ? '<input autocomplete="one-time-code">' : ""}<button onclick="location.href='https://accounts.google.com/v3/signin/accountchooser'">Continue with Google</button>`,
        });
      });
      for (const current of [
        "unknown",
        "duplicate",
        "nested-conflict",
        "changed",
        "provider-mfa",
      ]) {
        scenario = current;
        const page = await context.newPage();
        await page.goto(login);
        const before = selected;
        const recovery = createProviderGoogleRecovery({
          provider,
          context,
          expectedHash: scenario === "unknown" ? null : expectedHash,
          interactive: true,
          deadline: Date.now() + 10_000,
          isReady: (candidate) => providerPageReadyNow(candidate, provider),
        });
        try {
          await expect.poll(() => recovery.check(page)).toBe("input_required");
          expect(selected - before).toBe(scenario === "changed" ? 1 : 0);
        } finally {
          await recovery.dispose();
          await page.close();
        }
      }
    },
  );
}

test(
  "Google recovery cannot act on foreign pages or exceed its authentication request allowance",
  { tag: "@desktop-only" },
  async ({ page, context }) => {
    const { createHash } = await import("node:crypto");
    const { createProviderGoogleRecovery, PROVIDER_AUTH_REQUEST_CHAIN_LIMIT } =
      await import("../scripts/provider-google-recovery");
    let delivered = 0,
      clicked = 0;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/clicked") {
        clicked++;
        return route.fulfill({ body: "" });
      }
      if (url.pathname.startsWith("/flood")) {
        delivered++;
        return route.fulfill({ body: "" });
      }
      return route.fulfill({
        contentType: "text/html",
        body: `<button onclick="fetch('/clicked');for(let i=0;i<200;i++)fetch('/flood'+i).catch(()=>{})">Continue with Google</button>`,
      });
    });
    const expectedHash = createHash("sha256")
      .update("known@example.invalid")
      .digest("hex");
    await page.goto("https://foreign.example/login");
    const recovery = createProviderGoogleRecovery({
      provider: "tokenfolio",
      context,
      expectedHash,
      interactive: true,
      deadline: Date.now() + 10_000,
      isReady: () => Promise.resolve(false),
    });
    expect(await recovery.check(page)).toBe("waiting");
    expect(clicked).toBe(0);
    await page.goto("https://tokenfolio.eu.auth0.com/u/login");
    await expect.poll(() => recovery.check(page)).toBe("unavailable");
    expect(recovery.requestChains).toBe(PROVIDER_AUTH_REQUEST_CHAIN_LIMIT);
    expect(delivered).toBeLessThanOrEqual(PROVIDER_AUTH_REQUEST_CHAIN_LIMIT);
    expect(clicked).toBe(1);
    await recovery.dispose();
  },
);

test(
  "provider account fingerprints reject expired, foreign, malformed and oversized identity evidence",
  { tag: "@desktop-only" },
  async ({ page, context }) => {
    const { verifiedProviderGoogleAccount } =
      await import("../scripts/provider-google-account");
    let account: unknown = syntheticGoogleIdentity();
    await context.route("https://app.tokenfolio.co/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<button id="portfolio-tab-active" role="tab">Active Holdings0</button><script>localStorage.clear();localStorage.setItem('@@auth0spajs@@::synthetic-client::@@user@@',${JSON.stringify(JSON.stringify(account))})</script>`,
      }),
    );
    const valid = syntheticGoogleIdentity();
    for (const value of [
      {
        decodedToken: {
          ...valid.decodedToken,
          user: { ...valid.decodedToken.user, email_verified: false },
        },
      },
      {
        decodedToken: {
          ...valid.decodedToken,
          claims: { ...valid.decodedToken.claims, exp: 1 },
        },
      },
      {
        decodedToken: {
          ...valid.decodedToken,
          claims: {
            ...valid.decodedToken.claims,
            iss: "https://foreign.example/",
          },
        },
      },
      {
        decodedToken: {
          ...valid.decodedToken,
          claims: { ...valid.decodedToken.claims, aud: "foreign-client" },
        },
      },
    ]) {
      account = value;
      await page.goto("https://app.tokenfolio.co/portfolio");
      expect(
        await verifiedProviderGoogleAccount(page, "tokenfolio"),
      ).toBeNull();
    }
    account = valid;
    await page.reload();
    expect(
      await verifiedProviderGoogleAccount(page, "tokenfolio"),
    ).not.toBeNull();
    await page.evaluate(
      (value) =>
        localStorage.setItem(
          "@@auth0spajs@@::synthetic-client::conflicting",
          JSON.stringify(value),
        ),
      syntheticGoogleIdentity("other@example.invalid"),
    );
    expect(await verifiedProviderGoogleAccount(page, "tokenfolio")).toBeNull();
    const flight = (email: string, auth0Email = email) =>
      `<script>self.__next_f.push(${JSON.stringify([1, '1:["$","AuthBoundary",null,' + JSON.stringify({ authenticatedUser: { email }, auth0UserEmail: auth0Email }) + "]\n"])})</script>`;
    await page.evaluate(() => localStorage.clear());
    await context.route("https://app.tokenfolio.co/next-portal", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<button id="portfolio-tab-active" role="tab">Active Holdings0</button><script>self.__next_f=[];</script>${flight("known@example.invalid")}`,
      }),
    );
    await page.goto("https://app.tokenfolio.co/next-portal");
    expect(
      await verifiedProviderGoogleAccount(page, "tokenfolio"),
    ).not.toBeNull();
    await page.addScriptTag({
      content: `self.__next_f.push(${JSON.stringify([1, "2:" + JSON.stringify({ authenticatedUser: { email: "other@example.invalid" }, auth0UserEmail: "other@example.invalid" }) + "\n"])})`,
    });
    expect(await verifiedProviderGoogleAccount(page, "tokenfolio")).toBeNull();
    await context.route("https://app.sydecar.io/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<table data-testid="investments-table"></table><script>localStorage.setItem("auth_token","synthetic-token")</script>',
      }),
    );
    let response = "unauthorized",
      escaped = 0;
    await context.route("https://foreign.example/**", (route) => {
      escaped++;
      return route.fulfill({ body: "must never receive a credential" });
    });
    await context.route("https://api-backend.sydecar.io/user/", (route) => {
      const headers = {
        "Access-Control-Allow-Origin": "https://app.sydecar.io",
        "Access-Control-Allow-Headers": "authorization",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ headers, body: "" });
      if (response === "redirect")
        return route.fulfill({
          status: 302,
          headers: { ...headers, location: "https://foreign.example/user/" },
          body: "",
        });
      if (response === "unauthorized")
        return route.fulfill({ status: 401, headers, json: {} });
      return route.fulfill({
        headers,
        json:
          response === "oversized"
            ? {
                id: "synthetic",
                email: "known@example.invalid",
                large: "x".repeat(262144),
              }
            : { email: "known@example.invalid" },
      });
    });
    await page.goto("https://app.sydecar.io/investments");
    for (const value of [
      "unauthorized",
      "malformed",
      "oversized",
      "redirect",
    ]) {
      response = value;
      expect(await verifiedProviderGoogleAccount(page, "sydecar")).toBeNull();
    }
    expect(escaped).toBe(0);
  },
);

test(
  "Google account browser callbacks work through the production tsx runtime",
  { tag: "@desktop-only" },
  async ({ playwright }, testInfo) => {
    const { readFile } = await import("node:fs/promises");
    const { promisify } = await import("node:util");
    const { execFile } = await import("node:child_process");
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const profile = testInfo.outputPath("synthetic-google-profile");
    const context = await playwright.chromium.launchPersistentContext(profile, {
      headless: true,
      args: ["--remote-debugging-port=0"],
    });
    try {
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        const headers = {
          "Access-Control-Allow-Origin": "https://app.sydecar.io",
          "Access-Control-Allow-Headers": "authorization",
        };
        if (url.origin === "https://api-backend.sydecar.io")
          return route.fulfill({
            headers,
            json: { id: "synthetic", email: "known@example.invalid" },
          });
        if (url.origin === "https://accounts.google.com")
          return route.fulfill({
            contentType: "text/html",
            body: '<button data-identifier="other@example.invalid">Other</button><button data-identifier="known@example.invalid">Known</button>',
          });
        return route.fulfill({
          contentType: "text/html",
          body: `<button id="portfolio-tab-active" role="tab">Active Holdings0</button><table data-testid="investments-table"></table><script>self.__next_f=[];self.__next_f.push(${JSON.stringify([1, "1:" + JSON.stringify({ authenticatedUser: { email: "known@example.invalid" }, auth0UserEmail: "known@example.invalid" }) + "\n"])});</script><script>localStorage.setItem('auth_token','synthetic-token');localStorage.setItem('@@auth0spajs@@::synthetic-client::@@user@@',${JSON.stringify(JSON.stringify(syntheticGoogleIdentity()))})</script>`,
        });
      });
      const port = (
        await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      const module = pathToFileURL(
        path.resolve("scripts/provider-google-account.ts"),
      ).href;
      const script = `import {chromium} from '@playwright/test'; import {verifiedProviderGoogleAccount,matchingGoogleAccount} from ${JSON.stringify(module)}; const browser=await chromium.connectOverCDP('http://127.0.0.1:${port}',{noDefaults:true}); try {const page=browser.contexts()[0].pages()[0];await page.goto('https://app.tokenfolio.co/portfolio');const tokenfolio=await verifiedProviderGoogleAccount(page,'tokenfolio');await page.goto('https://app.sydecar.io/investments');const sydecar=await verifiedProviderGoogleAccount(page,'sydecar');await page.goto('https://accounts.google.com/v3/signin/accountchooser');const selected=await matchingGoogleAccount(page,tokenfolio);console.log(JSON.stringify({sameVerifiedIdentity:tokenfolio!==null&&tokenfolio===sydecar,selected}));} finally {await browser.close();}`;
      const result = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        { cwd: process.cwd(), timeout: 20_000, maxBuffer: 16_384 },
      );
      expect(JSON.parse(result.stdout)).toEqual({
        sameVerifiedIdentity: true,
        selected: 1,
      });
    } finally {
      await context.close();
    }
  },
);
