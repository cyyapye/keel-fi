import { Readable } from "node:stream";

import type { Browser } from "@cloudflare/playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelAngelListSignInRefresh,
  getAngelListSignInRefresh,
  parseAngelListMagicLink,
  parseAngelListSessionPayload,
  runAngelListImport,
  shouldRunAngelListImport,
  startAngelListSignInRefresh,
  storeAngelListSession,
  submitAngelListMagicLink,
} from "./angellist-automation";
import type { Env } from "./types";

vi.mock("@cloudflare/playwright", () => ({ launch: vi.fn() }));

const storageState = {
  cookies: [
    {
      name: "synthetic_session",
      value: "synthetic-cookie-value",
      domain: ".angellist.com",
      path: "/",
      expires: 2_000_000_000,
      httpOnly: true,
      secure: true as const,
      sameSite: "Lax" as const,
    },
  ],
  origins: [
    {
      origin: "https://venture.angellist.com",
      localStorage: [{ name: "synthetic", value: "session" }],
    },
  ],
};

const syntheticLiveViewUrl =
  "https://live.browser.run/ui/view?wss=live.browser.run/api/devtools/browser/synthetic_browser_session/page/SYNTHETIC_TARGET?jwt=synthetic-live-view";
const syntheticTabLiveViewUrl =
  "https://live.browser.run/ui/view?wss=live.browser.run%2Fapi%2Fdevtools%2Fbrowser%2Fsynthetic_browser_session%2Fpage%2FSYNTHETIC_TARGET%3Fjwt%3Dsynthetic-live-view&mode=tab";

function automationEnv() {
  const values = new Map<string, string>();
  const browserFetch = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify([
          {
            id: "SYNTHETIC_TARGET",
            type: "page",
            url: "https://venture.angellist.com/",
            title: "Synthetic AngelList",
            description: "",
            devtoolsFrontendUrl: syntheticLiveViewUrl,
            webSocketDebuggerUrl:
              "wss://live.browser.run/api/devtools/browser/synthetic_browser_session/page/SYNTHETIC_TARGET?jwt=synthetic-live-view",
          },
        ]),
        { headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  const kv = {
    get: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    put: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
  } as unknown as KVNamespace;
  const env: Env = {
    ANGELLIST_ACCESS_SUBJECT: "synthetic-access-subject",
    ANGELLIST_AUTOMATION: kv,
    ANGELLIST_AUTOMATION_ENABLED: "true",
    ANGELLIST_BROWSER: { fetch: browserFetch },
    ANGELLIST_SESSION_KEY: "A".repeat(43),
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
  return { browserFetch, env, values };
}

function refreshBrowserFixture() {
  const state = {
    exportVisible: false,
    url: "about:blank",
  };
  const browserClose = vi.fn(() => Promise.resolve());
  const browserCdpSend = vi.fn(() => Promise.resolve({}));
  const exportButton = {
    isVisible: vi.fn(() => Promise.resolve(state.exportVisible)),
  };
  const page = {
    getByRole: vi.fn(() => exportButton),
    goto: vi.fn((url: string) => {
      state.url = url.startsWith("https://venture.angellist.com")
        ? url
        : "https://venture.angellist.com/";
      return Promise.resolve(null);
    }),
    url: vi.fn(() => state.url),
  };
  const refreshedStorageState = {
    ...storageState,
    cookies: [
      {
        ...storageState.cookies[0],
        name: "refreshed_session",
        value: "refreshed-cookie-value",
      },
    ],
  };
  const context = {
    newPage: vi.fn(() => Promise.resolve(page)),
    pages: vi.fn(() => [page]),
    storageState: vi.fn(() => Promise.resolve(refreshedStorageState)),
  };
  const browser = {
    close: browserClose,
    contexts: vi.fn(() => [context]),
    newBrowserCDPSession: vi.fn(() =>
      Promise.resolve({
        detach: vi.fn(() => Promise.resolve()),
        send: browserCdpSend,
      }),
    ),
    newContext: vi.fn(() => Promise.resolve(context)),
  } as unknown as Browser;
  return {
    browser,
    browserCdpSend,
    context,
    page,
    state,
  };
}

describe("AngelList Cloudflare automation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts only secure AngelList browser state", () => {
    expect(parseAngelListSessionPayload(JSON.stringify(storageState))).toEqual(
      storageState,
    );
    expect(() =>
      parseAngelListSessionPayload(
        JSON.stringify({
          ...storageState,
          cookies: [
            {
              ...storageState.cookies[0],
              domain: ".example.com",
            },
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "session_invalid" }));
  });

  it("encrypts the uploaded session and stages a downloaded export for review", async () => {
    const { env, values } = automationEnv();
    await storeAngelListSession(env, "synthetic-access-subject", storageState);
    const encryptedSession = values.get("angellist/session/v1");
    expect(encryptedSession).toBeDefined();
    expect(encryptedSession).not.toContain("synthetic-cookie-value");

    const csv = new TextEncoder().encode("synthetic CSV bytes");
    const download = {
      createReadStream: vi.fn(() => Promise.resolve(Readable.from([csv]))),
      delete: vi.fn(() => Promise.resolve()),
      failure: vi.fn(() => Promise.resolve(null)),
      suggestedFilename: vi.fn(() => "angellist_investments_2026_08_08.csv"),
    };
    const exportButton = {
      click: vi.fn(() => Promise.resolve()),
      isVisible: vi.fn(() => Promise.resolve(true)),
    };
    const page = {
      getByRole: vi.fn(() => exportButton),
      goto: vi.fn(() => Promise.resolve(null)),
      url: vi.fn(() => "https://venture.angellist.com/"),
      waitForEvent: vi.fn(() => Promise.resolve(download)),
    };
    const refreshedStorageState = {
      ...storageState,
      cookies: [
        ...storageState.cookies,
        {
          ...storageState.cookies[0],
          domain: ".example.com",
          name: "outside_session",
          value: "outside-cookie-value",
        },
      ],
      origins: [
        ...storageState.origins,
        {
          origin: "https://example.com",
          localStorage: [{ name: "outside", value: "outside-state-value" }],
        },
      ],
    };
    const context = {
      close: vi.fn(() => Promise.resolve()),
      newPage: vi.fn(() => Promise.resolve(page)),
      storageState: vi.fn(() => Promise.resolve(refreshedStorageState)),
    };
    const browser = {
      close: vi.fn(() => Promise.resolve()),
      newContext: vi.fn(() => Promise.resolve(context)),
    } as unknown as Browser;
    const launcher = vi.fn(() => Promise.resolve(browser));
    const stage = vi.fn(() =>
      Promise.resolve({
        importId: "holding_import_synthetic",
        status: "review_ready" as const,
      }),
    );

    await expect(
      runAngelListImport(env, {
        launcher,
        now: new Date("2026-08-08T16:00:00.000Z"),
        stage,
      }),
    ).resolves.toEqual({
      version: 1,
      status: "review_ready",
      checkedAt: "2026-08-08T16:00:00.000Z",
      importId: "holding_import_synthetic",
      errorCode: null,
    });
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: csv,
        filename: "angellist_investments_2026_08_08.csv",
      }),
    );
    expect(exportButton.click).toHaveBeenCalledOnce();
    expect(values.get("angellist/status/v1")).toContain("review_ready");
  });

  it("opens an unrecorded Live View and replaces the old session only after verification", async () => {
    const { browserFetch, env, values } = automationEnv();
    await storeAngelListSession(env, "synthetic-access-subject", storageState);
    const previousSession = values.get("angellist/session/v1");
    const fixture = refreshBrowserFixture();
    const acquirer = vi.fn(() =>
      Promise.resolve({ sessionId: "synthetic_browser_session" }),
    );
    const connector = vi.fn(() => Promise.resolve(fixture.browser));
    const now = new Date("2026-08-08T16:00:00.000Z");

    const started = await startAngelListSignInRefresh(
      env,
      "synthetic-access-subject",
      { acquirer, connector, now },
    );

    expect(started).toMatchObject({
      status: "waiting_for_sign_in",
      liveViewUrl: syntheticTabLiveViewUrl,
    });
    expect(acquirer).toHaveBeenCalledWith(env.ANGELLIST_BROWSER, {
      keep_alive: 600_000,
      recording: false,
    });
    expect(browserFetch).toHaveBeenCalledWith(
      "http://fake.host/v1/devtools/browser/synthetic_browser_session/json",
      { headers: { Accept: "application/json" } },
    );
    expect(connector).toHaveBeenNthCalledWith(1, env.ANGELLIST_BROWSER, {
      sessionId: "synthetic_browser_session",
      persistent: true,
    });
    expect(values.get("angellist/session/v1")).toBe(previousSession);
    expect([...values.values()].join("\n")).not.toContain(
      "synthetic-live-view",
    );

    await expect(
      getAngelListSignInRefresh(env, "synthetic-access-subject", started.id, {
        connector,
        now,
      }),
    ).resolves.toMatchObject({ status: "waiting_for_sign_in" });
    expect(values.get("angellist/session/v1")).toBe(previousSession);

    fixture.state.exportVisible = true;
    await expect(
      getAngelListSignInRefresh(env, "synthetic-access-subject", started.id, {
        connector,
        now,
      }),
    ).resolves.toMatchObject({
      status: "connected",
      liveViewUrl: null,
    });
    const replacementSession = values.get("angellist/session/v1");
    expect(replacementSession).not.toBe(previousSession);
    expect(replacementSession).not.toContain("refreshed-cookie-value");
    expect(values.has("angellist/sign-in-refresh/active/v1")).toBe(false);
    expect(fixture.browserCdpSend).toHaveBeenCalledWith("Browser.close");
  });

  it("rejects a Live View target outside Cloudflare and closes the new browser", async () => {
    const { browserFetch, env, values } = automationEnv();
    browserFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: "SYNTHETIC_TARGET",
            type: "page",
            url: "https://venture.angellist.com/",
            title: "Synthetic AngelList",
            description: "",
            devtoolsFrontendUrl:
              "https://example.com/?token=synthetic-live-view",
            webSocketDebuggerUrl:
              "wss://example.com/?token=synthetic-live-view",
          },
        ]),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const fixture = refreshBrowserFixture();

    await expect(
      startAngelListSignInRefresh(env, "synthetic-access-subject", {
        acquirer: vi.fn(() =>
          Promise.resolve({ sessionId: "synthetic_browser_session" }),
        ),
        connector: vi.fn(() => Promise.resolve(fixture.browser)),
        now: new Date("2026-08-08T16:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "browser_unavailable" });

    expect(values.has("angellist/sign-in-refresh/active/v1")).toBe(false);
    expect(fixture.browserCdpSend).toHaveBeenCalledWith("Browser.close");
  });

  it("cancels the remote browser without changing the saved session", async () => {
    const { env, values } = automationEnv();
    await storeAngelListSession(env, "synthetic-access-subject", storageState);
    const previousSession = values.get("angellist/session/v1");
    const fixture = refreshBrowserFixture();
    const connector = vi.fn(() => Promise.resolve(fixture.browser));
    const started = await startAngelListSignInRefresh(
      env,
      "synthetic-access-subject",
      {
        acquirer: vi.fn(() =>
          Promise.resolve({ sessionId: "synthetic_browser_session" }),
        ),
        connector,
        now: new Date("2026-08-08T16:00:00.000Z"),
      },
    );

    await expect(
      cancelAngelListSignInRefresh(
        env,
        "synthetic-access-subject",
        started.id,
        { connector },
      ),
    ).resolves.toMatchObject({ status: "cancelled", liveViewUrl: null });
    expect(values.get("angellist/session/v1")).toBe(previousSession);
    expect(fixture.browserCdpSend).toHaveBeenCalledWith("Browser.close");
  });

  it("uses a magic link without persisting or logging its value", async () => {
    const { env, values } = automationEnv();
    const fixture = refreshBrowserFixture();
    const connector = vi.fn(() => Promise.resolve(fixture.browser));
    const started = await startAngelListSignInRefresh(
      env,
      "synthetic-access-subject",
      {
        acquirer: vi.fn(() =>
          Promise.resolve({ sessionId: "synthetic_browser_session" }),
        ),
        connector,
        now: new Date("2026-08-08T16:00:00.000Z"),
      },
    );
    const magicLink =
      "https://venture.angellist.com/users/sign_in?token=synthetic-one-time-link";
    fixture.state.exportVisible = true;

    await expect(
      submitAngelListMagicLink(
        env,
        "synthetic-access-subject",
        started.id,
        magicLink,
        { connector, now: new Date("2026-08-08T16:01:00.000Z") },
      ),
    ).resolves.toMatchObject({ status: "connected" });
    expect(fixture.page.goto).toHaveBeenLastCalledWith(magicLink, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    expect([...values.values()].join("\n")).not.toContain(
      "synthetic-one-time-link",
    );
  });

  it("accepts only HTTPS AngelList magic links", () => {
    expect(
      parseAngelListMagicLink(
        "https://venture.angellist.com/users/sign_in?token=synthetic",
      ),
    ).toBe("https://venture.angellist.com/users/sign_in?token=synthetic");
    expect(() =>
      parseAngelListMagicLink("https://example.com/?token=synthetic"),
    ).toThrowError(expect.objectContaining({ code: "magic_link_invalid" }));
    expect(() =>
      parseAngelListMagicLink(
        "https://angellist.com.evil.example/?token=synthetic",
      ),
    ).toThrowError(expect.objectContaining({ code: "magic_link_invalid" }));
  });

  it("runs at Monday 09:00 Pacific across standard and daylight time", () => {
    expect(shouldRunAngelListImport(new Date("2026-01-05T17:00:00.000Z"))).toBe(
      true,
    );
    expect(shouldRunAngelListImport(new Date("2026-07-06T16:00:00.000Z"))).toBe(
      true,
    );
    expect(shouldRunAngelListImport(new Date("2026-07-06T17:00:00.000Z"))).toBe(
      false,
    );
  });
});
