import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createConnection, type Socket } from "node:net";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import {
  MacAgentTargetSchema,
  providerBrowserOrigin,
  type MacAgentTarget,
} from "../packages/domain/src/index";

const privatePath = z.string().refine((value) => path.isAbsolute(value));
const credentialsSchema = z
  .object({
    clientId: z.string().regex(/^[a-f0-9]{32}\.access$/u),
    clientSecret: z.string().min(32).max(512),
  })
  .strict();
export const reconnectAccessConfigSchema = z
  .object({
    version: z.literal(1),
    apiOrigin: z.url(),
    provider: MacAgentTargetSchema,
    publicOrigin: z.url(),
    teamDomain: z.string().regex(/^[a-z0-9-]+\.cloudflareaccess\.com$/u),
    audience: z.string().regex(/^[a-f0-9]{64}$/u),
    listenPort: z.number().int().min(1024).max(65535),
    tunnelTokenFile: privatePath,
    probeCredentialsFile: privatePath,
  })
  .strict();
export type ReconnectAccessConfig = z.infer<typeof reconnectAccessConfigSchema>;
type ProbeCredentials = z.infer<typeof credentialsSchema>;

async function privateFile(file: string): Promise<string> {
  if (!path.isAbsolute(file))
    throw new Error("Reconnect configuration needs an absolute private path.");
  const parent = await lstat(path.dirname(file));
  if (
    !parent.isDirectory() ||
    (parent.mode & 0o777) !== 0o700 ||
    parent.uid !== process.getuid?.()
  ) {
    throw new Error(
      "Reconnect parent directories must be worker-owned and mode 0700.",
    );
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      ![0o400, 0o600].includes(metadata.mode & 0o777) ||
      metadata.uid !== process.getuid?.() ||
      metadata.size > 16384
    ) {
      throw new Error(
        "Reconnect files must be owned by the worker and mode 0400 or 0600.",
      );
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function loadReconnectAccess(
  apiOrigin: string,
  provider: MacAgentTarget,
): Promise<{ config: ReconnectAccessConfig; probe: ProbeCredentials }> {
  const file = process.env.KEEL_RECONNECT_CONFIG_FILE;
  if (file === undefined)
    throw new Error("Authenticated named reconnect access is not configured.");
  const config = reconnectAccessConfigSchema.parse(
    JSON.parse(await privateFile(file)),
  );
  if (
    config.provider !== provider ||
    config.apiOrigin !== apiOrigin ||
    config.publicOrigin !== providerBrowserOrigin(apiOrigin, provider)
  )
    throw new Error(
      "Reconnect configuration has the wrong deployment or provider scope.",
    );
  // Validate ownership without putting the tunnel credential in argv or logs.
  const tunnelToken = (await privateFile(config.tunnelTokenFile)).trim();
  if (tunnelToken.length < 32 || /\s/u.test(tunnelToken))
    throw new Error("Invalid named tunnel credential.");
  const probe = credentialsSchema.parse(
    JSON.parse(await privateFile(config.probeCredentialsFile)),
  );
  return { config, probe };
}

export function reconnectAccessKeys(
  config: ReconnectAccessConfig,
): JWTVerifyGetKey {
  return createRemoteJWKSet(
    new URL(`https://${config.teamDomain}/cdn-cgi/access/certs`),
    {
      timeoutDuration: 3000,
      cooldownDuration: 30000,
      cacheMaxAge: 300000,
    },
  );
}

export type ReconnectAccessGateway = {
  close: () => Promise<void>;
  failed: () => boolean;
  port: number;
};

// One gateway exists only for the current lease. It owns admission and teardown;
// VNC and websockify never listen on a public interface.
export async function startReconnectAccessGateway(options: {
  config: ReconnectAccessConfig;
  probeClientId: string;
  probeNonce: string;
  viewerSubject: string;
  expiresAt: string;
  accessToken: string;
  scriptNonce: string;
  backendPort: number;
  keys?: JWTVerifyGetKey;
}): Promise<ReconnectAccessGateway> {
  const expires = Date.parse(options.expiresAt);
  if (
    !Number.isFinite(expires) ||
    expires <= Date.now() ||
    expires - Date.now() > 900000
  ) {
    throw new Error("Reconnect lease is expired or exceeds fifteen minutes.");
  }
  if (
    !/^[A-Za-z0-9_-]{43}$/u.test(options.accessToken) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(options.scriptNonce) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(options.probeNonce)
  ) {
    throw new Error("Reconnect session identifiers are invalid.");
  }
  const keys = options.keys ?? reconnectAccessKeys(options.config);
  const origin = new URL(options.config.publicOrigin);
  const entryPath = `/${options.accessToken}.html`;
  const socketPath = `/${options.accessToken}/websockify`;
  const probePath = `/_keel/ready/${options.probeNonce}`;
  let closed = false;
  let viewerAdmitted = false;
  let viewerEnded = false;
  let requests = 0;
  let verifying = 0;
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const authenticate = async (
    incoming: IncomingMessage,
    probe: boolean,
  ): Promise<number | null> => {
    if (++requests > 256 || verifying >= 8 || closed || Date.now() >= expires)
      return null;
    if (incoming.headers.host !== origin.host) return null;
    const token = incoming.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || token.length > 16384) return null;
    verifying++;
    try {
      const { payload } = await jwtVerify(token, keys, {
        algorithms: ["RS256"],
        issuer: `https://${options.config.teamDomain}`,
        audience: options.config.audience,
        requiredClaims: ["exp", "iat"],
        clockTolerance: 0,
      });
      if (
        typeof payload.iat !== "number" ||
        payload.iat > Math.floor(Date.now() / 1000)
      )
        return null;
      if (closed || Date.now() >= expires) return null;
      const allowed = probe
        ? (payload.sub === "" || payload.sub === undefined) &&
          payload.common_name === options.probeClientId
        : payload.sub === options.viewerSubject &&
          payload.sub !== "" &&
          payload.common_name === undefined;
      return allowed &&
        payload.type === "app" &&
        typeof payload.exp === "number"
        ? Math.min(expires, payload.exp * 1000)
        : null;
    } catch {
      return null;
    } finally {
      verifying--;
    }
  };
  const rejectHttp = (response: ServerResponse, status = 403) => {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    response.end();
  };
  const server = createServer((incoming, response) => {
    void (async () => {
      const route = incoming.url ?? "";
      const probe = route === probePath;
      // Deliberately narrow file routes; never proxy query strings, traversal,
      // directory listings, a previous lease's page, or an arbitrary backend URL.
      const asset =
        /^\/(?:core|vendor)\/[A-Za-z0-9_./-]+\.(?:js|css|json)$/u.test(route) &&
        !route.includes("..") &&
        !route.includes("//");
      if (
        !["GET", "HEAD"].includes(incoming.method ?? "") ||
        (!probe && route !== entryPath && !asset) ||
        (!probe && route === entryPath && viewerAdmitted) ||
        (await authenticate(incoming, probe)) === null
      ) {
        rejectHttp(response);
        return;
      }
      if (probe) {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain",
          "Referrer-Policy": "no-referrer",
        });
        response.end(options.probeNonce);
        return;
      }
      const upstream = request(
        {
          hostname: "127.0.0.1",
          port: options.backendPort,
          path: route,
          method: incoming.method,
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, {
            "Content-Type":
              result.headers["content-type"] ?? "application/octet-stream",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${options.scriptNonce}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${origin.origin.replace("https:", "wss:")}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
          });
          result.pipe(response);
        },
      );
      upstream.setTimeout(3000, () => upstream.destroy());
      upstream.once("error", () => {
        if (!response.headersSent) rejectHttp(response, 502);
        else response.destroy();
      });
      response.once("close", () => upstream.destroy());
      upstream.end();
    })().catch(() => {
      if (response.headersSent) response.destroy();
      else rejectHttp(response);
    });
  });
  server.on("connection", track);
  server.on("upgrade", (incoming, client, head) => {
    const viewer = client as Socket;
    void (async () => {
      const validHandshake =
        incoming.method === "GET" &&
        incoming.url === socketPath &&
        incoming.headers.origin === origin.origin &&
        incoming.headers.upgrade?.toLowerCase() === "websocket" &&
        incoming.headers["sec-websocket-version"] === "13" &&
        typeof incoming.headers["sec-websocket-key"] === "string" &&
        /^[A-Za-z0-9+/]{22}==$/u.test(incoming.headers["sec-websocket-key"]);
      const until = validHandshake ? await authenticate(incoming, false) : null;
      if (until === null || viewerAdmitted || viewer.destroyed) {
        viewer.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      viewerAdmitted = true; // Remains consumed after disconnect; no second viewer or replay.
      const backend = createConnection({
        host: "127.0.0.1",
        port: options.backendPort,
      });
      track(backend);
      const timer = setTimeout(
        () => {
          viewerEnded = true;
          viewer.destroy();
          backend.destroy();
        },
        Math.max(0, until - Date.now()),
      );
      timer.unref();
      timers.add(timer);
      viewer.once("close", () => {
        viewerEnded = true;
        clearTimeout(timer);
        timers.delete(timer);
        backend.destroy();
      });
      backend.once("error", () => viewer.destroy());
      viewer.once("error", () => backend.destroy());
      backend.once("close", () => viewer.destroy());
      backend.once("connect", () => {
        const key = incoming.headers["sec-websocket-key"] as string;
        backend.write(
          `GET /websockify HTTP/1.1\r\nHost: 127.0.0.1:${options.backendPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`,
        );
        if (head.length > 0) backend.write(head);
        viewer.pipe(backend);
        backend.pipe(viewer);
      });
    })().catch(() => viewer.destroy());
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  server.maxConnections = 16;
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.config.listenPort, "127.0.0.1", resolve);
  });
  server.on("error", () => {
    viewerEnded = true;
  });
  server.unref();
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Reconnect gateway failed to listen.");
  const close = async () => {
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  const expiry = setTimeout(
    () => {
      void close();
    },
    Math.max(0, expires - Date.now()),
  );
  expiry.unref();
  timers.add(expiry);
  return { close, failed: () => closed || viewerEnded, port: address.port };
}
