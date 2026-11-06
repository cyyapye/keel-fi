import type * as FileSystem from "node:fs";
import type * as FileSystemPromises from "node:fs/promises";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { BrowserContext, CDPSession, Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { D1ServiceUnavailableError } from "../packages/domain/src/d1-service";
import type {
  MacAgentAuthorization,
  MacAgentTarget,
} from "../packages/domain/src/index";
import { __angellistMacAgentTest as angelList } from "./angellist-mac-agent";
import { runProviderAgentPolling } from "./provider-agent-polling";
import { macAgentApi } from "./mac-agent-auth";
import {
  __providerBrowserReconnectTest as reconnect,
  runProviderBrowserSession,
  type ProviderBrowserRuntimeOptions,
} from "./provider-browser-reconnect";
import { createProviderAgreementCollector } from "./provider-legal-document-capture";
import { __providerPortfolioMacAgentTest as portfolio } from "./provider-portfolio-mac-agent";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof FileSystem>()),
  createReadStream: () => Readable.from([new Uint8Array([65])]),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof FileSystemPromises>()),
  readFile: () =>
    Promise.reject(
      Object.assign(new Error("synthetic absent config"), { code: "ENOENT" }),
    ),
  writeFile: () => Promise.resolve(),
  mkdir: () => Promise.resolve(),
  chmod: () => Promise.resolve(),
  rename: () => Promise.resolve(),
  mkdtemp: () => Promise.resolve("/synthetic/downloads"),
  rm: () => Promise.resolve(),
}));

const START = Date.parse("2026-09-12T12:00:00.000Z");
const RESET = Date.parse("2026-09-13T00:00:00.000Z");
const origin = new URL("https://keel.synthetic.invalid");
const run = {
  id: "10000000-0000-4000-8000-000000000001",
  leaseToken: "b".repeat(43),
  expiresAt: new Date(START + 900_000).toISOString(),
};
const failure = {
  error:
    "Synthetic database allowance exhausted. Check for the record before trying again.",
  code: "d1_quota_exhausted",
  retryAt: new Date(RESET).toISOString(),
  outcome: "unknown",
};
const authorization = (target: MacAgentTarget): MacAgentAuthorization => ({
  version: 1,
  target,
  apiOrigin: origin.origin,
  token: `keel_agent_v1_${"a".repeat(43)}`,
});
const session = { ...run, viewerSubject: "synthetic-access-subject" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pausedDay(
  work: () => Promise<unknown>,
  kind: "update" | "reconnect" = "update",
) {
  let now = START;
  const controller = new AbortController();
  const errors: unknown[] = [];
  const updates = vi.fn(async () => {
    await work();
  });
  const renew = vi.fn();
  const checkReconnect = vi.fn(async () => {
    if (kind === "reconnect") await work();
    return "idle" as const;
  });
  await runProviderAgentPolling({
    checkReconnect,
    checkUpdates: kind === "update" ? updates : vi.fn(),
    checkSessionRenewal: renew,
    updateIntervalMs: 60_000,
    onError: (error) => {
      if (!(error instanceof D1ServiceUnavailableError)) throw error;
      errors.push(error);
      return "retryable";
    },
    now: () => now,
    sleep: (duration) => {
      now += duration;
      if (now >= RESET) controller.abort();
      return Promise.resolve();
    },
    signal: controller.signal,
  });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(D1ServiceUnavailableError);
  expect(errors[0]).toMatchObject({
    message: failure.error,
    code: failure.code,
    retryAt: failure.retryAt,
    outcome: failure.outcome,
  });
  expect(now).toBe(RESET);
  expect(checkReconnect).toHaveBeenCalledOnce();
  expect(renew).not.toHaveBeenCalled();
  if (kind === "update") expect(updates).toHaveBeenCalledOnce();
}

function transport(respond: (path: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input))
        .pathname;
      calls.push(path);
      return Promise.resolve(respond(path));
    }),
  );
  return calls;
}

describe("active provider quota propagation", () => {
  it.each(["sydecar", "tokenfolio"] as const)(
    "pauses after %s uncertain completion without failure reporting or replay",
    async (provider) => {
      let cleaned = false;
      const calls = transport((path) => {
        if (path.endsWith("/lease"))
          return Response.json({
            version: 1,
            provider,
            serverTime: new Date(START).toISOString(),
            run,
          });
        expect(cleaned).toBe(true);
        return Response.json(failure, { status: 503 });
      });
      await pausedDay(() =>
        portfolio.pollOnce(origin, provider, authorization(provider), () => {
          try {
            return Promise.resolve({
              asOfDate: "2026-09-12",
              bytes: new Uint8Array([65]),
            });
          } finally {
            cleaned = true;
          }
        }),
      );
      expect(calls.map((path) => path.split("/").at(-1))).toEqual([
        "lease",
        "complete",
      ]);
    },
  );

  it("does not replay a quota-denied agreement save inside an active capture", async () => {
    const calls = transport((path) =>
      path.endsWith("/lease")
        ? Response.json({
            version: 1,
            provider: "tokenfolio",
            serverTime: new Date(START).toISOString(),
            run,
          })
        : path.endsWith("document-manifest")
          ? Response.json({ version: 1, captures: [] })
          : Response.json(failure, { status: 503 }),
    );
    await pausedDay(() =>
      portfolio.pollOnce(
        origin,
        "tokenfolio",
        authorization("tokenfolio"),
        async () => {
          const collector = await createProviderAgreementCollector(
            authorization("tokenfolio"),
            "tokenfolio",
            run,
          );
          await collector.collect(
            {
              url: () =>
                "https://app.tokenfolio.co/portfolio?investmentId=other",
            } as Page,
            {
              investment: "Synthetic investment",
              legalPosition: "Synthetic position",
              heldThrough: "Synthetic vehicle",
              investmentDate: null,
              providerInvestmentId: "synthetic-investment",
            },
          );
          await collector.flush();
          return { asOfDate: "2026-09-12", bytes: new Uint8Array([65]) };
        },
      ),
    );
    expect(calls.map((path) => path.split("/").at(-1))).toEqual([
      "lease",
      "document-manifest",
      "documents",
    ]);
  });

  it.each(["complete", "fail"] as const)(
    "retains quota metadata from auxiliary renewal %s",
    async (operation) => {
      const calls = transport((path) =>
        path.endsWith("/lease")
          ? Response.json({
              version: 1,
              renewal: { leaseToken: run.leaseToken, expiresAt: run.expiresAt },
            })
          : Response.json(failure, { status: 503 }),
      );
      await pausedDay(() =>
        portfolio.checkSessionRenewal(origin, authorization("sydecar"), () =>
          operation === "fail"
            ? Promise.reject(new Error("synthetic provider outage"))
            : Promise.resolve(),
        ),
      );
      expect(calls.map((path) => path.split("/").at(-1))).toEqual([
        "lease",
        operation,
      ]);
    },
  );

  it("keeps ordinary capture failure reporting", async () => {
    const calls = transport((path) =>
      path.endsWith("/lease")
        ? Response.json({
            version: 1,
            provider: "sydecar",
            serverTime: new Date(START).toISOString(),
            run,
          })
        : Response.json({ version: 1 }),
    );
    await expect(
      portfolio.pollOnce(origin, "sydecar", authorization("sydecar"), () =>
        Promise.reject(new Error("synthetic capture failure")),
      ),
    ).rejects.toMatchObject({ code: "unexpected_failure" });
    expect(calls.map((path) => path.split("/").at(-1))).toEqual([
      "lease",
      "fail",
    ]);
  });

  it("preserves a quota pause encountered inside auxiliary browser work", async () => {
    const calls = transport((path) =>
      path.endsWith("/lease")
        ? Response.json({
            version: 1,
            renewal: { leaseToken: run.leaseToken, expiresAt: run.expiresAt },
          })
        : Response.json(failure, { status: 503 }),
    );
    await pausedDay(() =>
      portfolio.checkSessionRenewal(
        origin,
        authorization("sydecar"),
        async () => {
          await macAgentApi(
            authorization("sydecar"),
            "/api/synthetic-auxiliary",
            {
              method: "POST",
            },
          );
        },
      ),
    );
    expect(calls.map((path) => path.split("/").at(-1))).toEqual([
      "lease",
      "synthetic-auxiliary",
    ]);
  });

  it.each(["sydecar", "tokenfolio"] as const)(
    "preserves %s quota failure from ordinary failure reporting",
    async (provider) => {
      const calls = transport((path) =>
        path.endsWith("/lease")
          ? Response.json({
              version: 1,
              provider,
              serverTime: new Date(START).toISOString(),
              run,
            })
          : Response.json(failure, { status: 503 }),
      );
      await pausedDay(() =>
        portfolio.pollOnce(origin, provider, authorization(provider), () =>
          Promise.reject(new Error("synthetic browser failure")),
        ),
      );
      expect(calls.map((path) => path.split("/").at(-1))).toEqual([
        "lease",
        "fail",
      ]);
    },
  );
});

describe("active AngelList quota propagation", () => {
  function browser() {
    const download = new EventEmitter();
    const send = vi.fn().mockResolvedValue(undefined);
    const detach = vi.fn().mockResolvedValue(undefined);
    Object.assign(download, { send, detach });
    const exportButton = {
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: () => {
        download.emit("Browser.downloadWillBegin", {
          guid: run.id,
          suggestedFilename: "synthetic.csv",
        });
        download.emit("Browser.downloadProgress", {
          guid: run.id,
          state: "completed",
        });
        return Promise.resolve();
      },
    };
    const page = {
      url: () => "https://venture.angellist.com/",
      getByRole: () => exportButton,
    };
    const context = {
      pages: () => [page],
      browser: () => ({
        newBrowserCDPSession: () =>
          Promise.resolve(download as unknown as CDPSession),
      }),
    } as unknown as BrowserContext;
    return { context, send, detach, exportButton };
  }

  it("cleans up and pauses after an uncertain completion without failure reporting", async () => {
    const fixture = browser();
    const calls = transport(() => Response.json(failure, { status: 503 }));
    await pausedDay(() =>
      angelList.executeRun(
        fixture.context,
        origin,
        authorization("angellist"),
        run,
      ),
    );
    expect(calls.map((path) => path.split("/").at(-1))).toEqual(["complete"]);
    expect(fixture.detach).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenLastCalledWith(
      "Browser.setDownloadBehavior",
      { behavior: "default", eventsEnabled: false },
    );
  });

  it("preserves a quota pause from AngelList failure reporting", async () => {
    const fixture = browser();
    fixture.exportButton.click = () =>
      Promise.reject(new Error("synthetic browser failure"));
    const calls = transport(() => Response.json(failure, { status: 503 }));
    await pausedDay(() =>
      angelList.executeRun(
        fixture.context,
        origin,
        authorization("angellist"),
        run,
      ),
    );
    expect(calls.map((path) => path.split("/").at(-1))).toEqual(["fail"]);
    expect(fixture.detach).toHaveBeenCalledOnce();
  });
});

describe("active reconnect quota propagation", () => {
  it.each(["status", "complete"] as const)(
    "cleans up and pauses every loop after reconnect %s quota response",
    async (operation) => {
      const cleaned = vi.fn();
      const close = vi.fn().mockResolvedValue(undefined);
      const options: ProviderBrowserRuntimeOptions = {
        appDirectory: "/synthetic",
        chromePath: "/synthetic/chrome",
        profileDirectory: "/synthetic/profile",
        startUrl: "https://app.tokenfolio.co/portfolio",
        label: "Tokenfolio",
        provider: "tokenfolio",
        authorization: authorization("tokenfolio"),
        lease: session,
        isProviderReady: () => Promise.resolve(true),
        verifySavedSession: () => Promise.resolve(),
      };
      const calls = transport((path) =>
        path.endsWith(`/${operation}`)
          ? Response.json(failure, { status: 503 })
          : Response.json({
              version: 1,
              id: run.id,
              provider: "tokenfolio",
              status: "opened",
              requestedAt: new Date(START).toISOString(),
              openedAt: new Date(START).toISOString(),
              connectedAt: null,
              expiresAt: session.expiresAt,
              errorCode: null,
            }),
      );
      await pausedDay(
        () =>
          runProviderBrowserSession(options, async (current) => {
            try {
              return await reconnect.pollActiveBrowserSession({
                expiresAt: session.expiresAt,
                now: () => START,
                isAlive: () => true,
                readStatus: async () =>
                  (
                    await reconnect.sessionApi(
                      current.authorization,
                      current.provider,
                      current.lease.id,
                      "status",
                    )
                  ).status,
                onOpened: () => Promise.resolve(true),
                complete: () =>
                  reconnect.completeBrowserSession(current, close),
              });
            } finally {
              cleaned();
            }
          }),
        "reconnect",
      );
      expect(cleaned).toHaveBeenCalledOnce();
      expect(calls.map((path) => path.split("/").at(-1))).toEqual(
        operation === "status" ? ["status"] : ["status", "complete"],
      );
      expect(close).toHaveBeenCalledTimes(operation === "complete" ? 1 : 0);
    },
  );

  it.each(["angellist", "sydecar", "tokenfolio"] as const)(
    "preserves %s quota pauses after successful reconnect rotation and queued run",
    async (provider) => {
      for (const operation of ["rotate", "run"] as const) {
        const calls = transport((path) =>
          path.endsWith(`/${operation}`)
            ? Response.json(failure, { status: 503 })
            : Response.json(authorization(provider)),
        );
        const runtime = {
          closeControlledChrome: vi.fn().mockResolvedValue(undefined),
          chromeExecutable: vi.fn().mockResolvedValue("/synthetic/chrome"),
          runProviderBrowserSession: vi
            .fn()
            .mockResolvedValue("connected" as const),
          storeMacAgentAuthorization: vi.fn(),
        };
        await pausedDay(
          () =>
            provider === "angellist"
              ? angelList.handleManagedReconnect(
                  origin,
                  authorization(provider),
                  session,
                  runtime,
                )
              : portfolio.handleManagedReconnect(
                  origin,
                  provider,
                  authorization(provider),
                  session,
                  runtime,
                ),
          "reconnect",
        );
        expect(calls.map((path) => path.split("/").at(-1))).toEqual(
          operation === "rotate" ? ["rotate"] : ["rotate", "run"],
        );
      }
    },
  );

  it("retains ordinary reconnect failure telemetry after local cleanup", async () => {
    const calls = transport(() => Response.json({}));
    const cleaned = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const options = {
      provider: "angellist",
      authorization: authorization("angellist"),
      lease: session,
    } as ProviderBrowserRuntimeOptions;
    await expect(
      runProviderBrowserSession(options, (_options, stage) => {
        try {
          stage("provider_browser");
          return Promise.reject(new Error("synthetic browser failure"));
        } finally {
          cleaned();
        }
      }),
    ).rejects.toMatchObject({
      name: "ProviderBrowserRuntimeError",
      code: "browser_unavailable",
    });
    expect(cleaned).toHaveBeenCalledOnce();
    expect(calls.map((path) => path.split("/").at(-1))).toEqual(["fail"]);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "provider_browser_reconnect_failed",
        provider: "angellist",
        stage: "provider_browser",
        code: "browser_unavailable",
      }),
    );
  });
});
