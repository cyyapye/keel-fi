import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MacAgentTargetSchema,
  providerBrowserOrigin,
} from "../packages/domain/src/index";
import { storeMacAgentAuthorization } from "./mac-agent-auth";
import {
  loadReconnectAccess,
  startReconnectAccessGateway,
  type ReconnectAccessConfig,
  type ReconnectAccessGateway,
} from "./provider-reconnect-access";
import {
  checkProviderReconnectConfigs,
  validateProviderReconnectConfig,
} from "./provider-reconnect-check";

const config: ReconnectAccessConfig = {
  version: 1,
  apiOrigin: "https://keel-agents.example.com",
  provider: "tokenfolio",
  publicOrigin: "https://keel-tokenfolio-reconnect.example.com",
  teamDomain: "synthetic.cloudflareaccess.com",
  audience: "a".repeat(64),
  listenPort: 0, // Ephemeral test listener; production configuration rejects zero.
  tunnelTokenFile: "/synthetic/tunnel-token",
  probeCredentialsFile: "/synthetic/probe.json",
};
const accessToken = "c".repeat(43);
const nonce = "d".repeat(43);
const probeClientId = "e".repeat(32) + ".access";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: ReturnType<typeof createLocalJWKSet>;
let gateway: ReconnectAccessGateway | undefined;
let backend: Server | undefined;
let temporary: string | undefined;
const connections = new Set<Socket>();
const delivered = vi.fn();

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwks = createLocalJWKSet({
    keys: [
      { ...(await exportJWK(keys.publicKey)), kid: "synthetic", alg: "RS256" },
    ],
  });
});
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  for (const socket of connections) socket.destroy();
  connections.clear();
  if (backend?.listening)
    await new Promise<void>((resolve) => backend!.close(() => resolve()));
  backend = undefined;
  if (temporary !== undefined)
    await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
  delivered.mockClear();
  vi.unstubAllEnvs();
});
async function token(
  claims: JWTPayload = {},
  options: {
    issuer?: string;
    audience?: string;
    expires?: number;
    issued?: number;
  } = {},
) {
  return new SignJWT({ type: "app", sub: "synthetic-viewer", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
    .setIssuer(options.issuer ?? `https://${config.teamDomain}`)
    .setAudience(options.audience ?? config.audience)
    .setIssuedAt(options.issued ?? Math.floor(Date.now() / 1000))
    .setExpirationTime(options.expires ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(keys.privateKey);
}
async function start(expiresAt = new Date(Date.now() + 600000).toISOString()) {
  backend = createServer((incoming, response) => {
    delivered(incoming.url);
    response.end("synthetic viewer");
  });
  backend.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  backend.on("upgrade", (incoming, socket) => {
    delivered(incoming.url);
    const accept = createHash("sha1")
      .update(
        String(incoming.headers["sec-websocket-key"]) +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  await new Promise<void>((resolve) =>
    backend!.listen(0, "127.0.0.1", resolve),
  );
  const address = backend.address();
  if (!address || typeof address === "string")
    throw new Error("Synthetic listener unavailable");
  gateway = await startReconnectAccessGateway({
    config,
    probeClientId,
    probeNonce: nonce,
    viewerSubject: "synthetic-viewer",
    expiresAt,
    accessToken,
    scriptNonce: "f".repeat(43),
    backendPort: address.port,
    keys: jwks,
  });
}
async function get(
  assertion?: string,
  route = `/${accessToken}.html`,
  host = new URL(config.publicOrigin).host,
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port: gateway!.port,
        path: route,
        headers: {
          Host: host,
          ...(assertion ? { "Cf-Access-Jwt-Assertion": assertion } : {}),
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += String(chunk);
        });
        response.once("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}
async function upgrade(
  assertion: string,
  route = `/${accessToken}/websockify`,
  origin = config.publicOrigin,
) {
  return new Promise<{ status: number; socket?: Socket }>((resolve, reject) => {
    const outgoing = request({
      host: "127.0.0.1",
      port: gateway!.port,
      path: route,
      headers: {
        Host: new URL(config.publicOrigin).host,
        Origin: origin,
        "Cf-Access-Jwt-Assertion": assertion,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
      },
    });
    outgoing.once("upgrade", (response, socket) => {
      connections.add(socket);
      resolve({ status: response.statusCode ?? 0, socket });
    });
    outgoing.once("response", (response) => {
      response.resume();
      resolve({ status: response.statusCode ?? 0 });
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

describe("authenticated reconnect admission", () => {
  it("requires the exact signed user, application audience, issuer and unexpired JWT on HTTP", async () => {
    await start();
    const rejected = [
      undefined,
      "invalid",
      await token({ sub: "other-user", email: "synthetic@example.com" }),
      await token({ sub: "", common_name: probeClientId }),
      await token({}, { issuer: "https://other.cloudflareaccess.com" }),
      await token({}, { audience: "b".repeat(64) }),
      await token({}, { expires: Math.floor(Date.now() / 1000) - 1 }),
      await token({ type: "org" }),
      await token({}, { issued: Math.floor(Date.now() / 1000) + 60 }),
    ];
    for (const assertion of rejected)
      expect((await get(assertion)).status).toBe(403);
    expect(delivered).not.toHaveBeenCalled();
    expect(await get(await token())).toEqual({
      status: 200,
      body: "synthetic viewer",
    });
  });

  it("limits the service token to a lease-specific readiness response", async () => {
    await start();
    const service = await token({ sub: "", common_name: probeClientId });
    expect(await get(service, `/_keel/ready/${nonce}`)).toEqual({
      status: 200,
      body: nonce,
    });
    expect((await get(service)).status).toBe(403);
    expect((await get(await token(), `/_keel/ready/${nonce}`)).status).toBe(
      403,
    );
    expect((await upgrade(service)).status).toBe(403);
    expect((await get(service, `/_keel/ready/${"f".repeat(43)}`)).status).toBe(
      403,
    );
    expect(delivered).not.toHaveBeenCalled();
  });

  it("denies wrong host, traversal, queries and a previous lease's entry path", async () => {
    await start();
    const assertion = await token();
    for (const route of [
      "/",
      "/index.html",
      "/core/../private.json",
      "/core//rfb.js",
      `/${accessToken}.html?next=/`,
      `/${"f".repeat(43)}.html`,
    ])
      expect((await get(assertion, route)).status).toBe(403);
    expect(
      (await get(assertion, `/${accessToken}.html`, "other.example.com"))
        .status,
    ).toBe(403);
    expect((await get(assertion, "/core/rfb.js")).status).toBe(200);
    expect(delivered).toHaveBeenCalledExactlyOnceWith("/core/rfb.js");
  });

  it("authorizes the upgrade separately and admits exactly one viewer even concurrently", async () => {
    await start();
    const assertion = await token();
    expect((await upgrade(await token({ sub: "other-user" }))).status).toBe(
      403,
    );
    expect(
      (
        await upgrade(
          assertion,
          `/${accessToken}/websockify`,
          "https://other.example.com",
        )
      ).status,
    ).toBe(403);
    expect((await upgrade(assertion, "/websockify")).status).toBe(403);
    expect(
      (await upgrade(assertion, `/${"f".repeat(43)}/websockify`)).status,
    ).toBe(403);
    const viewers = await Promise.all([upgrade(assertion), upgrade(assertion)]);
    expect(viewers.map((viewer) => viewer.status).sort()).toEqual([101, 403]);
    expect(delivered).toHaveBeenCalledExactlyOnceWith("/websockify");
    expect((await get(assertion)).status).toBe(403);
    viewers.find((viewer) => viewer.socket)?.socket?.destroy();
    expect((await upgrade(assertion)).status).toBe(403);
  });

  it("closes an established viewer when its JWT expires before the lease", async ({
    onTestFinished,
  }) => {
    vi.useFakeTimers({
      now: new Date("2026-09-04T12:00:00Z"),
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    await start();
    const viewer = await upgrade(
      await token({}, { expires: Math.floor(Date.now() / 1000) + 1 }),
    );
    expect(viewer.status).toBe(101);
    expect(delivered).toHaveBeenCalledExactlyOnceWith("/websockify");
    const ended = new Promise<void>((resolve) =>
      viewer.socket!.once("close", () => resolve()),
    );
    vi.advanceTimersByTime(999);
    expect(gateway!.failed()).toBe(false);
    vi.advanceTimersByTime(1);
    await ended;
    expect(gateway!.failed()).toBe(true);
  });

  it("tears down sockets on cancellation and never admits a replay", async () => {
    await start();
    const viewer = await upgrade(await token());
    const ended = new Promise<void>((resolve) =>
      viewer.socket!.once("close", () => resolve()),
    );
    await gateway!.close();
    await ended;
    expect(gateway!.failed()).toBe(true);
  });

  it("caps cryptographic authentication work at 256 requests per lease", async () => {
    await start();
    const service = await token({ sub: "", common_name: probeClientId });
    for (let index = 0; index < 256; index++)
      expect((await get(service, `/_keel/ready/${nonce}`)).status).toBe(200);
    expect((await get(service, `/_keel/ready/${nonce}`)).status).toBe(403);
    expect(delivered).not.toHaveBeenCalled();
  });

  it("refuses an expired or overlong lease before listening", async () => {
    for (const duration of [-1, 960000]) {
      await expect(
        startReconnectAccessGateway({
          config,
          probeClientId,
          probeNonce: nonce,
          viewerSubject: "synthetic-viewer",
          expiresAt: new Date(Date.now() + duration).toISOString(),
          accessToken,
          scriptNonce: "f".repeat(43),
          backendPort: 1234,
          keys: jwks,
        }),
      ).rejects.toThrow("lease");
    }
  });
});

describe("private named reconnect configuration", () => {
  it("reports every provider and fails on deployed API origin drift", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "keel-access-synthetic-"));
    vi.stubEnv("XDG_CONFIG_HOME", temporary);
    const webOrigin = new URL("https://keel.example.com");
    const tunnelTokenFile = path.join(temporary, "token");
    const probeCredentialsFile = path.join(temporary, "probe.json");
    const configFile = path.join(temporary, "access.json");
    await writeFile(tunnelTokenFile, "synthetic-token-".repeat(4), {
      mode: 0o600,
    });
    await writeFile(
      probeCredentialsFile,
      JSON.stringify({
        clientId: probeClientId,
        clientSecret: "synthetic-secret-".repeat(4),
      }),
      { mode: 0o600 },
    );
    vi.stubEnv("KEEL_RECONNECT_CONFIG_FILE", configFile);
    for (const target of MacAgentTargetSchema.options) {
      storeMacAgentAuthorization(
        webOrigin,
        {
          version: 1,
          apiOrigin: config.apiOrigin,
          target,
          token: "keel_agent_v1_" + "s".repeat(43),
        },
        { platform: "linux" },
      );
    }

    async function runCheck(includeDrift: boolean) {
      const report = vi.fn();
      const result = await checkProviderReconnectConfigs(
        webOrigin,
        async (origin, provider) => {
          await writeFile(
            configFile,
            JSON.stringify({
              ...config,
              provider,
              apiOrigin:
                includeDrift && provider === "angellist"
                  ? webOrigin.origin
                  : config.apiOrigin,
              publicOrigin: providerBrowserOrigin(config.apiOrigin, provider),
              listenPort: 16001,
              tunnelTokenFile,
              probeCredentialsFile,
            }),
            { mode: 0o600 },
          );
          return validateProviderReconnectConfig(origin, provider);
        },
        report,
      );
      return { result, lines: report.mock.calls.flat() };
    }

    await expect(runCheck(true)).resolves.toEqual({
      result: 1,
      lines: ["angellist: FAIL", "tokenfolio: PASS", "sydecar: PASS"],
    });
    await expect(runCheck(false)).resolves.toEqual({
      result: 0,
      lines: ["angellist: PASS", "tokenfolio: PASS", "sydecar: PASS"],
    });
  });

  it("fails closed without configuration and rejects permissive files or symlinks", async () => {
    vi.stubEnv("KEEL_RECONNECT_CONFIG_FILE", undefined);
    await expect(
      loadReconnectAccess(config.apiOrigin, config.provider),
    ).rejects.toThrow("not configured");
    temporary = await mkdtemp(path.join(os.tmpdir(), "keel-access-synthetic-"));
    const tokenFile = path.join(temporary, "token");
    const probeFile = path.join(temporary, "probe.json");
    const configuration = path.join(temporary, "config.json");
    await writeFile(tokenFile, "synthetic-token-".repeat(4), { mode: 0o600 });
    await writeFile(
      probeFile,
      JSON.stringify({
        clientId: probeClientId,
        clientSecret: "synthetic-secret-".repeat(4),
      }),
      { mode: 0o600 },
    );
    const privateConfig = {
      ...config,
      listenPort: 16002,
      tunnelTokenFile: tokenFile,
      probeCredentialsFile: probeFile,
    };
    await writeFile(configuration, JSON.stringify(privateConfig), {
      mode: 0o600,
    });
    vi.stubEnv("KEEL_RECONNECT_CONFIG_FILE", configuration);
    expect(
      (await loadReconnectAccess(config.apiOrigin, config.provider)).config,
    ).toEqual(privateConfig);
    await expect(
      loadReconnectAccess(config.apiOrigin, "sydecar"),
    ).rejects.toThrow("scope");
    // A matching reconnect hostname does not authorize another API origin.
    await expect(
      loadReconnectAccess("https://keel.example.com", config.provider),
    ).rejects.toThrow("scope");
    await chmod(tokenFile, 0o640);
    await expect(
      loadReconnectAccess(config.apiOrigin, config.provider),
    ).rejects.toThrow("0600");
    await chmod(tokenFile, 0o400);
    await expect(
      loadReconnectAccess(config.apiOrigin, config.provider),
    ).resolves.toMatchObject({ config: privateConfig });
    const link = path.join(temporary, "linked-config.json");
    await symlink(configuration, link);
    vi.stubEnv("KEEL_RECONNECT_CONFIG_FILE", link);
    await expect(
      loadReconnectAccess(config.apiOrigin, config.provider),
    ).rejects.toThrow();
  });
});
