import { expect, test } from "@playwright/test";

import { parseProviderHoldingsTemplateCsv } from "../packages/connectors/src/index";
import type { AgreementCollector } from "../scripts/provider-legal-document-capture";
import { __providerPortfolioMacAgentTest } from "../scripts/provider-portfolio-mac-agent";

const {
  captureSydecar,
  captureTokenfolio,
  providerPageReady,
  requireProviderPageReady,
} = __providerPortfolioMacAgentTest;

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
  }) => {
    let html =
      '<div role="button" class="relative cursor-pointer">Not a portfolio</div>';
    await page.route(`${origin}/**`, (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(`${origin}/portfolio`);
    await expect(providerPageReady(page, provider, 100)).resolves.toBe(false);
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "page_not_supported",
    );

    // A login link in a signed-in page must not count as a login form.
    html = '<a href="/login">Sign in</a><p>Temporarily unavailable</p>';
    await page.reload();
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "page_not_supported",
    );

    for (const form of [
      '<input type="password"><button>Sign in</button>',
      '<input autocomplete="one-time-code"><button>Verify</button>',
      '<input type="email"><button>Sign in</button>',
      `${control}<input type="password"><button>Sign in</button>`,
    ]) {
      html = form;
      await page.reload();
      await expect(
        requireProviderPageReady(page, provider, 100),
      ).rejects.toThrow("provider_sign_in_required");
    }

    await page.route("https://unrelated.example/**", (route) =>
      route.fulfill({
        body: '<input type="password"><button>Sign in</button>',
        contentType: "text/html",
      }),
    );
    await page.goto("https://unrelated.example/login");
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

  test(`${provider} recognizes a dedicated sign-in page before its form loads`, async ({
    page,
  }) => {
    let html = "<h1>Log in to your account</h1><div>Loading…</div>";
    await page.route(`${origin}/**`, (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
    await page.goto(`${origin}/login`);
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "provider_sign_in_required",
    );

    // A heading without the dedicated route is not proof of an expired session.
    await page.goto(`${origin}/portfolio?redirect=/login`);
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "page_not_supported",
    );
    // Neither an auth route alone nor hidden authentication copy is sufficient.
    for (const content of [
      "<h1>Temporarily unavailable</h1>",
      "<h1 hidden>Log in to your account</h1><div>Loading…</div>",
    ]) {
      html = content;
      await page.goto(`${origin}/login`);
      await expect(
        requireProviderPageReady(page, provider, 100),
      ).rejects.toThrow("page_not_supported");
    }
    await page.route("https://unrelated.example/**", (route) =>
      route.fulfill({
        body: "<h1>Log in to your account</h1>",
        contentType: "text/html",
      }),
    );
    await page.goto("https://unrelated.example/login");
    await expect(requireProviderPageReady(page, provider, 100)).rejects.toThrow(
      "page_not_supported",
    );
  });
}

test("Tokenfolio recognizes passkey sign-in and blocking MFA enrollment without treating security settings as sign-in", async ({
  page,
}) => {
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

  for (const content of [
    "<h1>Set up two-factor authentication</h1><button>Continue</button>",
    "<div hidden><form><h1>Verify your identity</h1><button>Verify</button></form></div>",
    "<form><h1 hidden>Verify your identity</h1><button>Verify</button></form>",
    "<form><h1>Verify your identity</h1><button hidden>Verify</button></form>",
    "<form><h1>Verify your identity</h1></form><form><button>Verify</button></form>",
    "<button hidden>Sign in with a passkey</button>",
    "<form><h1>Two-factor authentication</h1><button>Disable</button></form>",
    "<form><h1>Security settings</h1><button>Add passkey</button></form>",
  ]) {
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
});

test("Tokenfolio recognizes its hosted Auth0 login without accepting unrelated or incomplete pages", async ({
  page,
}) => {
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
  await expect(requireProviderPageReady(page, "sydecar", 100)).rejects.toThrow(
    "page_not_supported",
  );
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
});

function tokenfolioPage(
  activeCount = 2,
  statuses: readonly [string, string] = ["Funds Received", "Completed"],
  drawerInitiallyOpen = false,
  detailDelayMs = 0,
  tabCountDelayMs = 0,
  drawerUrlDelayMs = 0,
  rowRenderDelayMs = 0,
): string {
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
        if (${rowRenderDelayMs.toString()} > 0) {
          const list = document.querySelector('#portfolio-rows');
          const rows = [...list.children];
          list.replaceChildren();
          document.addEventListener('restore-portfolio-rows', () => {
            setTimeout(() => list.append(...rows), ${rowRenderDelayMs.toString()});
          }, { once: true });
        }
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
      body: tokenfolioPage(2, [firstStatus, "Completed"]),
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
            markDate: null,
            shareClass: null,
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
  }
});

test("captures explicit Tokenfolio quote dates and split basis without substituting the import date", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  for (const [basis, units] of [
    ["Before split", 1],
    ["After 10-for-1 split", 10],
  ] as const) {
    await page.route("https://app.tokenfolio.co/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: tokenfolioPage().replace(
          "<div><dt>Entry Price</dt>",
          `<div><dt>Mark date</dt><dd>Aug 18, 2026</dd></div><div><dt>Share class</dt><dd>Common</dd></div><div><dt>Share basis</dt><dd>${basis}</dd></div><div><dt>Entry Price</dt>`,
        ),
      }),
    );
    await page.goto("https://app.tokenfolio.co/portfolio?tab=active");
    const parsed = await parseProviderHoldingsTemplateCsv(
      "tokenfolio",
      await captureTokenfolio(page, "2026-08-21"),
    );
    expect(parsed.rows[0]!.dealMetadata?.sharePrices).toMatchObject({
      markDate: "2026-08-18",
      shareClass: "Common",
      shareBasis: { key: "issuer-original", unitsPerOriginal: units },
    });
    await page.unrouteAll();
  }
});

test("Tokenfolio waits for each drawer URL to open and clear before associating agreements", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  let firstLoad = true;
  await page.route("https://app.tokenfolio.co/**", (route) => {
    const body = tokenfolioPage(
      2,
      ["Funds Received", "Completed"],
      firstLoad,
      0,
      0,
      300,
    );
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
  await captureTokenfolio(page, "2026-08-21", () => undefined, agreements);
  expect(ids).toEqual([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  expect(new URL(page.url()).searchParams.has("investmentId")).toBe(false);
});

test("Tokenfolio waits for all holdings after document return before continuing and reconciling", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  let loads = 0;
  await page.route("https://app.tokenfolio.co/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: tokenfolioPage(
        2,
        ["Funds Received", "Completed"],
        false,
        0,
        0,
        0,
        loads++ === 0 ? 0 : 500,
      ),
    }),
  );
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");
  const ids: Array<string | null> = [];
  const agreements: AgreementCollector = {
    collect: async (sourcePage) => {
      ids.push(new URL(sourcePage.url()).searchParams.get("investmentId"));
      await sourcePage.goto("https://app.tokenfolio.co/portfolio?tab=active");
      await expect(sourcePage.locator("#portfolio-tab-active")).toBeVisible();
      expect(
        await sourcePage
          .locator('div[role="button"].relative.cursor-pointer')
          .count(),
      ).toBe(0);
      await sourcePage.evaluate(() => {
        document.dispatchEvent(new Event("restore-portfolio-rows"));
      });
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
  expect(parsed.rows).toHaveLength(2);
  expect(ids).toEqual([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  expect(loads).toBe(3);
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

test("recovers from a Tokenfolio drawer left open by an interrupted run", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage(2, ["Funds Received", "Completed"], true),
      contentType: "text/html",
    });
  });
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

  const bytes = await captureTokenfolio(page, "2026-08-21");
  const parsed = await parseProviderHoldingsTemplateCsv("tokenfolio", bytes);
  expect(parsed.rows).toHaveLength(2);
});

test("waits for asynchronously rendered Tokenfolio drawer details", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage(2, ["Funds Received", "Completed"], false, 250),
      contentType: "text/html",
    });
  });
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

  const bytes = await captureTokenfolio(page, "2026-08-21");
  const parsed = await parseProviderHoldingsTemplateCsv("tokenfolio", bytes);
  expect(parsed.rows).toHaveLength(2);
});

test("waits for the Tokenfolio active count after navigation", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage(2, ["Funds Received", "Completed"], false, 0, 250),
      contentType: "text/html",
    });
  });
  await page.goto("https://app.tokenfolio.co/portfolio?tab=active");

  const bytes = await captureTokenfolio(page, "2026-08-21");
  const parsed = await parseProviderHoldingsTemplateCsv("tokenfolio", bytes);
  expect(parsed.rows).toHaveLength(2);
});

test("fails closed for an unknown Tokenfolio active-row status", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.tokenfolio.co/**", async (route) => {
    await route.fulfill({
      body: tokenfolioPage(2, ["Exited", "Completed"]),
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
        body: sydecarDetailPage(250),
        contentType: "text/html",
      });
    },
  );
  await page.goto("https://app.sydecar.io/investments");

  const stages: string[] = [];
  const bytes = await captureSydecar(page, "2026-08-21", (stage) => {
    stages.push(stage);
  });
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
});

test("defers Sydecar agreement capture to one central Documents pass after snapshot reconciliation", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The local capture always uses a desktop viewport.");
  await page.route("https://app.sydecar.io/investments", (route) =>
    route.fulfill({ body: sydecarListPage(), contentType: "text/html" }),
  );
  await page.route(
    "https://app.sydecar.io/investments/11111111-1111-4111-8111-111111111111",
    (route) =>
      route.fulfill({
        body: `${sydecarDetailPage()}<h2 data-testid="investment-docs-heading">Investment Docs</h2>`,
        contentType: "text/html",
      }),
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

  await captureSydecar(page, "2026-08-21", () => undefined, agreements);

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
