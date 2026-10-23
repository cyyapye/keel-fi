import { EventEmitter } from "node:events";
import type { Request } from "@playwright/test";
import { afterEach, expect, test, vi } from "vitest";
import { __providerPortfolioMacAgentTest } from "./provider-portfolio-mac-agent";

const { AgentFailure, observeSydecarRefresh } = __providerPortfolioMacAgentTest;
const expires = "2026-09-02T00:00:00.000Z";
const origin = "https://api-backend.sydecar.io/authenticate/refresh_tokens";
const secret = "SYNTHETIC_REFRESH_SECRET";
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const events = new EventEmitter();
  // Chromium's Request/Response event boundary is the only substitute. The
  // observer, asynchronous body handling, sanitization and classification are real.
  const owned = new Set<Request>();
  const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const observer = observeSydecarRefresh(events, (request) =>
    owned.has(request),
  );
  function request(
    url = origin,
    method = "POST",
    transport: string | null = null,
    controlled = true,
  ) {
    const value = {
      url: () => url,
      method: () => method,
      failure: () => (transport === null ? null : { errorText: transport }),
    } as Request;
    if (controlled) owned.add(value);
    events.emit("request", value);
    return value;
  }
  function response(
    request: Request,
    status: number,
    body: string,
    headers: Record<string, string> = {},
    read: () => Promise<Buffer> = () => Promise.resolve(Buffer.from(body)),
  ) {
    const readBody = vi.fn(read);
    events.emit("response", {
      request: () => request,
      status: () => status,
      headers: () => ({
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body).toString(),
        ...headers,
      }),
      body: readBody,
    });
    return readBody;
  }
  const report = async (error: unknown = new Error(secret)) => {
    const failure = await observer.reportFailure(error, expires);
    const entry: unknown = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(output.mock.calls.flat().join(" ")).not.toContain(secret);
    expect(output.mock.calls.flat().join(" ")).not.toContain(
      "api-backend.sydecar.io",
    );
    return { failure, entry };
  };
  return { events, observer, request, response, report };
}

for (const kind of [
  "rejected",
  "invalid",
  "expired",
  "unknown",
  "html",
  "oversized",
  "service",
  "dns",
] as const) {
  test(`Sydecar identifies ${kind} refresh failures without logging credentials`, async () => {
    const f = fixture();
    const req = f.request(
      origin,
      "POST",
      kind === "dns" ? "net::ERR_NAME_NOT_RESOLVED" : null,
    );
    const status =
      kind === "rejected"
        ? 401
        : kind === "service"
          ? 503
          : kind === "dns"
            ? null
            : 403;
    const errorKey =
      kind === "invalid" || kind === "oversized"
        ? "INVALID_REFRESH_TOKEN"
        : kind === "expired"
          ? "EXPIRED_REFRESH_TOKEN"
          : kind === "unknown"
            ? "UNKNOWN_REFRESH_TOKEN"
            : secret;
    const body =
      kind === "html"
        ? `<html>${secret}</html>`
        : JSON.stringify({
            error_key: errorKey,
            message: secret,
            ...(kind === "oversized" ? { extra: secret.repeat(300) } : {}),
          });
    const read =
      status === null
        ? undefined
        : f.response(
            req,
            status,
            body,
            kind === "html" ? { "content-type": "text/html" } : {},
          );
    if (kind === "dns") f.events.emit("requestfailed", req);
    const code =
      kind === "service" || kind === "dns"
        ? "unexpected_failure"
        : "provider_sign_in_required";
    const reason =
      kind === "service"
        ? "unavailable"
        : kind === "dns"
          ? "transport"
          : "authorization";
    expect(await f.report()).toEqual({
      failure: { errorCode: code, reason, refreshExpiresAt: expires },
      entry: {
        event: "provider_session_renewal_failed",
        provider: "sydecar",
        code,
        refreshRequests: 1,
        refreshStatus: status,
        refreshTransport: kind === "dns" ? "dns" : null,
        refreshErrorCode: ["invalid", "expired", "unknown"].includes(kind)
          ? errorKey
          : null,
        refreshResponseKind:
          kind === "dns" ? null : kind === "html" ? "html" : "json",
        reason,
      },
    });
    if (kind === "html" || kind === "oversized")
      expect(read).not.toHaveBeenCalled();
    f.observer.dispose();
    expect(f.events.eventNames()).toEqual([]);
  });
}

test("refresh observation ignores unrelated origins, paths, methods and uncontrolled pages", async () => {
  const f = fixture();
  for (const request of [
    f.request("https://unrelated.example/authenticate/refresh_tokens"),
    f.request(origin + "/extra"),
    f.request(origin, "GET"),
    f.request(origin, "POST", null, false),
  ]) {
    expect(
      f.response(
        request,
        403,
        JSON.stringify({ error_key: "INVALID_REFRESH_TOKEN" }),
      ),
    ).not.toHaveBeenCalled();
    f.events.emit("requestfailed", request);
  }
  expect((await f.report()).entry).toMatchObject({
    refreshRequests: 0,
    refreshStatus: null,
    refreshTransport: null,
    refreshErrorCode: null,
    reason: "unverified",
  });
  f.observer.dispose();
});

test.each([
  { "content-length": "" },
  { "content-length": "-1" },
  { "content-length": "4097" },
  { "content-length": "99999" },
  { "content-encoding": "gzip" },
  { "content-type": "text/plain" },
])(
  "does not materialize an unbounded or encoded diagnostic body: %j",
  async (headers) => {
    const f = fixture();
    const read = f.response(
      f.request(),
      403,
      JSON.stringify({ error_key: "INVALID_REFRESH_TOKEN" }),
      headers,
    );
    expect((await f.report()).entry).toMatchObject({ refreshErrorCode: null });
    expect(read).not.toHaveBeenCalled();
    f.observer.dispose();
  },
);

test.each([
  ["invalid JSON", "invalid JSON"],
  ["private category", JSON.stringify({ error_key: secret })],
  ["oversized body", "x".repeat(4097)],
])("rejects %s materialized diagnostics", async (_name, body) => {
  const f = fixture();
  f.response(f.request(), 403, body, { "content-length": "20" });
  expect((await f.report()).entry).toMatchObject({
    refreshErrorCode: null,
    reason: "authorization",
  });
  f.observer.dispose();
});

test("an older response body cannot overwrite the latest refresh observation", async () => {
  const f = fixture();
  let resolve!: (value: Buffer) => void;
  f.response(
    f.request(),
    403,
    "{}",
    {},
    () =>
      new Promise<Buffer>((r) => {
        resolve = r;
      }),
  );
  f.response(f.request(), 503, "{}");
  resolve(Buffer.from(JSON.stringify({ error_key: "EXPIRED_REFRESH_TOKEN" })));
  expect((await f.report()).entry).toMatchObject({
    refreshRequests: 2,
    refreshStatus: 503,
    refreshErrorCode: null,
    reason: "unavailable",
  });
  f.observer.dispose();
});

test("a sign-in failure is classified without requiring a refresh response", async () => {
  const f = fixture();
  expect(
    (await f.report(new AgentFailure("provider_sign_in_required"))).failure,
  ).toEqual({
    errorCode: "provider_sign_in_required",
    reason: "authorization",
    refreshExpiresAt: expires,
  });
  f.observer.dispose();
});
