import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  KeyReceiptSchema,
  AppAccessStateSchema,
} from "../packages/domain/src/app-access";

const capture = process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1";
test("returns from the last access page while preserving the key draft", async ({
  page,
}, info) => {
  const origin = new URL(info.project.use.baseURL as string).origin;
  const grant = {
    id: "12000000-0000-4000-8000-000000000001",
    sequence: 20,
    name: "Synthetic newest key",
    kind: "key",
    permissions: {
      goals: "read",
      holdings: "read",
      cash: "read",
      evidence: "read",
    },
    createdAt: "2026-11-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    revokedAt: null,
    rotation: "manual",
    suffix: "demo",
    previousKeyExpiresAt: null,
    clientOrigin: null,
  };
  await page.route("**/api/app-access?kind=key*", (route) => {
    const last = new URL(route.request().url()).searchParams.has("after");
    return route.fulfill({
      json: {
        apiOrigin: origin,
        mcpUrl: origin + "/mcp",
        openApiUrl: origin + "/api/v1/openapi.json",
        evaluatedAt: "2026-11-11T00:00:00.000Z",
        grants: [
          last
            ? {
                ...grant,
                id: "12000000-0000-4000-8000-000000000002",
                sequence: 1,
                name: "Synthetic oldest key",
              }
            : grant,
        ],
        nextAfter: last ? null : "20",
      },
    });
  });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "API keys", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic newest key", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Key name", { exact: true })
    .fill("Synthetic retained pagination draft");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic oldest key", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toHaveCount(0);
  await image(page, info, "last-page");
  await page.getByRole("button", { name: "Newest first", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic newest key", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Key name", { exact: true })).toHaveValue(
    "Synthetic retained pagination draft",
  );
});
async function image(page: Page, info: TestInfo, state: string) {
  if (capture) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(state + ".png"),
      fullPage: true,
      animations: "disabled",
      scale: "css",
      mask: [page.locator('[data-secret="true"]')],
      maskColor: "#222222",
    });
  }
}
async function select(page: Page, name: string, value: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
test("creates, persists, rotates and revokes a scoped key with a retained draft", async ({
  page,
}, info) => {
  const unwanted: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(alpha|holdings-page)/.test(request.url()))
      unwanted.push(request.url());
  });
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "App access", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Server URL", { exact: true })).toHaveValue(
    /^http:\/\/127\.0\.0\.1:[0-9]+\/mcp$/,
  );
  await image(page, info, "connected-apps");
  await expect(
    page.getByRole("button", { name: /Preview .*sign-in|Connect an app/ }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "API keys", exact: true }).click();
  await expect(page.getByLabel("Key name", { exact: true })).toBeVisible();
  await image(page, info, "key-form");
  await expect(page.locator(".app-access__form")).toHaveScreenshot(
    "app-access-key.png",
    {
      animations: "disabled",
      scale: "css",
      // The cropped form scrolls beneath the fixed mobile chrome.
      stylePath: fileURLToPath(
        new URL("./app-access-screenshot.css", import.meta.url),
      ),
    },
  );
  await page.getByLabel("Key name", { exact: true }).fill("");
  await page.getByLabel("Key name", { exact: true }).press("Tab");
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Enter a key name.");
  await image(page, info, "invalid-key");
  const name = "Synthetic browser agent " + info.project.name;
  await page.getByLabel("Key name", { exact: true }).fill(name);
  const group = page.getByRole("group", { name: "Key rotation", exact: true });
  await group.getByRole("radio", { name: /You rotate it/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    group.getByRole("radio", { name: /Agent may rotate/ }),
  ).toBeChecked();
  await group
    .getByText("Create a replacement in Keel, then update your tool.", {
      exact: true,
    })
    .click();
  await expect(
    group.getByRole("radio", { name: /You rotate it/ }),
  ).toBeChecked();
  await group
    .getByText("Let an agent replace its own saved key before it expires.", {
      exact: true,
    })
    .click();
  for (const tile of await group.locator("label").all()) {
    const rect = await tile.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  await select(page, "Holdings & valuations", "No access");
  await select(page, "Cash & debts", "No access");
  await select(page, "Evidence", "No access");
  await expect(
    page.getByText(/Full portfolio outlook and previews need read access/),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Connected apps", exact: true }).click();
  await page.getByRole("tab", { name: "API keys", exact: true }).click();
  await expect(page.getByLabel("Key name", { exact: true })).toHaveValue(name);
  await expect(
    group.getByRole("radio", { name: /Agent may rotate/ }),
  ).toBeChecked();
  await page.route("**/api/app-access/keys", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Synthetic temporary failure. Your draft is retained." },
    }),
  );
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic temporary failure",
  );
  await image(page, info, "failed-key");
  await expect(page.getByLabel("Key name", { exact: true })).toHaveValue(name);
  await page.unroute("**/api/app-access/keys");
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/app-access/keys", async (route) => {
    await barrier;
    await route.continue();
  });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/app-access/keys") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Creating…", exact: true }),
  ).toBeDisabled();
  await expect(
    group.getByRole("radio", { name: /Agent may rotate/ }),
  ).toBeDisabled();
  await image(page, info, "saving-key");
  release();
  const response = await saved;
  expect(response.status()).toBe(201);
  const receipt = KeyReceiptSchema.parse(await response.json());
  await expect(
    page.getByRole("heading", { name: "Save your key", exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
    receipt.key,
  );
  const base = new URL(page.url()).origin;
  await expect(page.getByLabel("API URL", { exact: true })).toHaveValue(
    base + "/api/v1",
  );
  const focusRect = await page
    .getByRole("heading", { name: "Save your key", exact: true })
    .boundingBox();
  const chromeRect = await page.locator(".topbar").boundingBox();
  expect(focusRect).not.toBeNull();
  expect(focusRect!.y).toBeGreaterThanOrEqual(
    chromeRect ? chromeRect.y + chromeRect.height : 0,
  );
  await image(page, info, "copy-once-key");
  const auth = { Authorization: "Bearer " + receipt.key };
  expect(
    (await page.request.get("/api/v1/goals", { headers: auth })).status(),
  ).toBe(200);
  expect(
    (await page.request.get("/api/v1/outlook", { headers: auth })).status(),
  ).toBe(403);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("tab", { name: "API keys", exact: true }).click();
  const row = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(row).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "View access", exact: true }).click();
  await expect(
    row.getByText("Agent may rotate its own key.", { exact: false }),
  ).toBeVisible();
  await image(page, info, "saved-readback");
  const rotate = page.waitForResponse((r) =>
    r.url().endsWith("/" + receipt.grant.id + "/rotate"),
  );
  await row.getByRole("button", { name: "Rotate key", exact: true }).click();
  const replacement = KeyReceiptSchema.parse(await (await rotate).json());
  await expect(
    page.getByRole("heading", {
      name: "Save your replacement key",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Save your replacement key",
      exact: true,
    }),
  ).toBeFocused();
  expect(replacement.grant.expiresAt).toBe(receipt.grant.expiresAt);
  expect(replacement.grant.permissions).toEqual(receipt.grant.permissions);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await row
    .getByRole("button", { name: "Confirm revoke", exact: true })
    .click();
  await expect(row.getByText("Disconnected", { exact: true })).toBeVisible();
  expect(
    (await page.request.get("/api/v1/goals", { headers: auth })).status(),
  ).toBe(401);
  expect(
    (
      await page.request.get("/api/v1/goals", {
        headers: { Authorization: "Bearer " + replacement.key },
      })
    ).status(),
  ).toBe(401);
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  expect(unwanted).toEqual([]);
});

test("recovers a failed access list without loading unrelated portfolio data", async ({
  page,
}, info) => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/app-access?kind=oauth", async (route) => {
    await barrier;
    await route.fulfill({
      status: 503,
      json: { error: "Synthetic list unavailable. Try again." },
    });
  });
  await page.goto("/settings");
  await expect(
    page.getByText("Loading access…", { exact: true }),
  ).toBeVisible();
  await image(page, info, "loading-list");
  release();
  await expect(
    page.getByText("Synthetic list unavailable. Try again.", { exact: false }),
  ).toBeVisible();
  await image(page, info, "failed-list");
  await page.unroute("**/api/app-access?kind=oauth");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Server URL", { exact: true })).toBeVisible();
});

test("shows consent only for a real app request and disconnects its OAuth grant", async ({
  page,
}, info) => {
  const host = "synthetic-" + info.project.name + ".invalid";
  const callbackUrl = "https://" + host + "/callback";
  const clientResponse = await page.request.post("/oauth/register", {
    data: {
      redirect_uris: [callbackUrl],
      token_endpoint_auth_method: "none",
    },
  });
  expect(clientResponse.status()).toBe(201);
  const client = (await clientResponse.json()) as { client_id: string };
  const base = new URL(info.project.use.baseURL as string).origin;
  const verifier = "b".repeat(43);
  const { createHash } = await import("node:crypto");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: callbackUrl,
    state: "synthetic-browser-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: base + "/mcp",
    scope: "goals:read holdings:read cash:read evidence:read",
  });
  await page.route(callbackUrl + "?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Synthetic app received the callback.</p>",
    }),
  );
  await page.goto("/oauth/authorize?" + query.toString());
  await expect(
    page.getByRole("heading", {
      name: "Allow " + host + " to access Keel?",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Key rotation" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("combobox", { name: "Access lasts", exact: true }),
  ).toContainText("Until you disconnect");
  await image(page, info, "oauth-consent");
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("^https://" + host + "/callback\\?"));
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe("synthetic-browser-state");
  const token = await page.request.post(base + "/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: callback.searchParams.get("code")!,
      redirect_uri: callbackUrl,
      code_verifier: verifier,
      resource: base + "/mcp",
    },
  });
  expect(token.status()).toBe(200);
  const access = (await token.json()) as {
    access_token: string;
    refresh_token: string;
  };
  const rpc = await page.request.post(base + "/mcp", {
    headers: { Authorization: "Bearer " + access.access_token },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "listGoals", arguments: {} },
    },
  });
  expect(rpc.status()).toBe(200);
  expect(await rpc.json()).toMatchObject({ result: { isError: false } });
  await page.goto(base + "/settings");
  const row = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: host,
      exact: true,
    }),
  });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "View access", exact: true }).click();
  await image(page, info, "connected-readback");
  await row.getByRole("button", { name: "Disconnect", exact: true }).click();
  await row
    .getByRole("button", { name: "Confirm disconnect", exact: true })
    .click();
  await expect(row.getByText("Disconnected", { exact: true })).toBeVisible();
  expect(
    (
      await page.request.get(base + "/api/v1/goals", {
        headers: { Authorization: "Bearer " + access.access_token },
      })
    ).status(),
  ).toBe(401);
  const state = AppAccessStateSchema.parse(
    await (await page.request.get(base + "/api/app-access?kind=oauth")).json(),
  );
  expect(
    state.grants.some((g) => g.name === host && g.revokedAt !== null),
  ).toBe(true);
});
