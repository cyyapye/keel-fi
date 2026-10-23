import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import path from "node:path";
import { chromium } from "@playwright/test";

import {
  MacAgentAuthorizationSchema,
  ProviderBrowserSessionLeaseSchema,
  ProviderBrowserSessionSchema,
  type MacAgentAuthorization,
  type MacAgentTarget,
  type ProviderBrowserSession,
  type ProviderBrowserSessionErrorCode,
  type ProviderBrowserSessionLease,
} from "../packages/domain/src/index";
import { macAgentApi } from "./mac-agent-auth";
import {
  loadReconnectAccess,
  startReconnectAccessGateway,
  type ReconnectAccessGateway,
} from "./provider-reconnect-access";

const DISPLAY_CANDIDATES = Array.from(
  { length: 40 },
  (_, index) => 120 + index,
);
const SESSION_POLL_INTERVAL_MS = 5_000;
const PROCESS_STOP_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 30_000;
const PUBLIC_TUNNEL_REQUEST_TIMEOUT_MS = 3_000;
const PUBLIC_TUNNEL_RETRY_INTERVAL_MS = 250;
const REMOTE_BROWSER_READY_MARKER =
  '<meta name="keel-provider-browser" content="ready">';

type ReconnectLease = NonNullable<ProviderBrowserSessionLease["session"]>;

type ViewerProxy = {
  close: () => Promise<void>;
  connected: () => boolean;
  failed: () => boolean;
  port: number;
};

type ViewerProxyNetwork = {
  createConnection: (options: { host: string; port: number }) => Socket;
  createServer: (listener: (socket: Socket) => void) => Server;
};

export type ProviderBrowserRuntimeOptions = {
  appDirectory: string;
  authorization: MacAgentAuthorization;
  chromePath: string;
  isProviderReady: (endpointUrl: string) => Promise<boolean>;
  label: string;
  lease: ReconnectLease;
  profileDirectory: string;
  startUrl: string;
} & (
  | { provider: "angellist"; verifySavedSession?: never }
  | {
      provider: "tokenfolio" | "sydecar";
      verifySavedSession: () => Promise<void>;
    }
);

type ProviderBrowserRuntimeStage =
  | "private_storage"
  | "private_display"
  | "private_vnc"
  | "browser_stream"
  | "secure_tunnel"
  | "public_tunnel"
  | "provider_browser"
  | "session_ready"
  | "provider_sign_in"
  | "session_verification";

export class ProviderBrowserRuntimeError extends Error {
  public constructor(
    public readonly code: ProviderBrowserSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderBrowserRuntimeError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredExecutable(name: string): string {
  const result = spawnSync("/usr/bin/env", ["which", name], {
    encoding: "utf8",
  });
  const executable = result.stdout.trim();
  if (result.status !== 0 || !path.isAbsolute(executable)) {
    throw new ProviderBrowserRuntimeError(
      "browser_unavailable",
      `${name} is required for managed provider reconnects.`,
    );
  }
  return executable;
}

async function noVncRoot(): Promise<string> {
  const configured = process.env.KEEL_NOVNC_WEB_ROOT?.trim();
  const candidates = [
    ...(configured === undefined || configured.length === 0
      ? []
      : [configured]),
    "/usr/share/novnc",
    "/usr/share/noVNC",
  ];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }
    const valid = await stat(path.join(candidate, "core", "rfb.js"))
      .then((metadata) => metadata.isFile())
      .catch(() => false);
    if (valid) {
      return candidate;
    }
  }
  throw new ProviderBrowserRuntimeError(
    "browser_unavailable",
    "noVNC is required for managed provider reconnects.",
  );
}

async function availableDisplay(): Promise<number> {
  for (const display of DISPLAY_CANDIDATES) {
    const socket = `/tmp/.X11-unix/X${display.toString()}`;
    const used = await access(socket)
      .then(() => true)
      .catch(() => false);
    if (!used) {
      return display;
    }
  }
  throw new ProviderBrowserRuntimeError(
    "browser_unavailable",
    "No private display is available for provider reconnects.",
  );
}

async function availableLoopbackPorts(): Promise<
  readonly [number, number, number]
> {
  const servers = [createServer(), createServer(), createServer()];
  try {
    const ports: number[] = [];
    for (const server of servers) {
      server.unref();
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(new Error("Loopback port is unavailable."));
            return;
          }
          resolve(address.port);
        });
      });
      ports.push(port);
    }
    return [ports[0]!, ports[1]!, ports[2]!];
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            if (!server.listening) {
              resolve();
              return;
            }
            server.close(() => resolve());
          }),
      ),
    );
  }
}

async function waitForFile(file: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error("Private display stopped during startup.");
    }
    const exists = await access(file)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Private display did not start.");
}

async function waitForPort(port: number, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error("Remote browser service stopped during startup.");
    }
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Remote browser service did not start.");
}

async function startViewerProxy(
  vncPort: number,
  network: ViewerProxyNetwork = {
    createConnection: (options) => createConnection(options),
    createServer: (listener) => createServer(listener),
  },
): Promise<ViewerProxy> {
  let connected = false;
  let failed = false;
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const server: Server = network.createServer((viewer) => {
    const vnc = network.createConnection({
      host: "127.0.0.1",
      port: vncPort,
    });
    track(viewer);
    track(vnc);
    vnc.once("connect", () => {
      connected = true;
    });
    viewer.once("error", () => vnc.destroy());
    vnc.once("error", () => viewer.destroy());
    viewer.pipe(vnc);
    vnc.pipe(viewer);
  });
  server.unref();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  server.on("error", () => {
    failed = true;
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Private browser viewer proxy did not start.");
  }
  return {
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    connected: () => connected,
    failed: () => failed,
    port: address.port,
  };
}

async function waitForDevTools(
  port: number,
  process: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error("Provider Chrome stopped during startup.");
    }
    const ready = await fetch(
      `http://127.0.0.1:${port.toString()}/json/version`,
    )
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) {
      return;
    }
    await sleep(100);
  }
  throw new Error("Provider Chrome did not start.");
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode != null;
}

function waitForChildExit(child: ChildProcess): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(
      () => finish(childExited(child)),
      PROCESS_STOP_TIMEOUT_MS,
    );
    child.once("exit", onExit);
    if (childExited(child)) {
      finish(true);
    }
  });
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (child === null || childExited(child)) {
    return;
  }
  const terminated = waitForChildExit(child);
  child.kill("SIGTERM");
  if (!(await terminated) && !childExited(child)) {
    const killed = waitForChildExit(child);
    child.kill("SIGKILL");
    await killed;
  }
}

async function closeChromeGracefully(
  child: ChildProcess,
  endpointUrl: string,
): Promise<void> {
  const browser = await chromium.connectOverCDP(endpointUrl, {
    noDefaults: true,
    timeout: PROCESS_STOP_TIMEOUT_MS,
  });
  try {
    const session = await browser.newBrowserCDPSession();
    const exited = waitForChildExit(child);
    // Browser.close lets Chrome flush its profile. A signal/timeout is cleanup,
    // not proof that a sign-in was saved, so it must never lead to success.
    await Promise.race([
      session.send("Browser.close").catch(() => undefined),
      exited,
    ]);
    if (!(await exited) || child.exitCode !== 0) {
      throw new ProviderBrowserRuntimeError(
        "browser_unavailable",
        "The provider browser could not finish saving its session.",
      );
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function pollActiveBrowserSession(options: {
  expiresAt: string;
  isAlive: () => boolean;
  readStatus: () => Promise<ProviderBrowserSession["status"]>;
  onOpened: () => Promise<boolean>;
  complete: () => Promise<"connected" | "terminated">;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<"connected" | "terminated"> {
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const deadline = new Date(options.expiresAt).getTime();
  while (now() < deadline) {
    if (!options.isAlive()) {
      throw new ProviderBrowserRuntimeError(
        "browser_unavailable",
        "The private provider browser stopped unexpectedly.",
      );
    }
    const status = await options.readStatus();
    if (
      now() >= deadline ||
      ["cancelled", "expired", "failed", "connected"].includes(status)
    ) {
      return "terminated";
    }
    if (status === "opened" && (await options.onOpened())) {
      return options.complete();
    }
    await wait(
      Math.max(0, Math.min(SESSION_POLL_INTERVAL_MS, deadline - now())),
    );
  }
  return "terminated";
}

async function completeBrowserSession(
  options: ProviderBrowserRuntimeOptions,
  closeBrowser: () => Promise<void>,
  complete: () => Promise<ProviderBrowserSession["status"]> = async () =>
    (
      await sessionApi(
        options.authorization,
        options.provider,
        options.lease.id,
        "complete",
        { leaseToken: options.lease.leaseToken },
      )
    ).status,
): Promise<"connected" | "terminated"> {
  if (options.verifySavedSession !== undefined) {
    await closeBrowser();
    await options.verifySavedSession();
  }
  // The server still owns cancellation, expiry and the scoped lease. A stale
  // completion must not rotate credentials or queue an update locally.
  return (await complete()) === "connected" ? "connected" : "terminated";
}

function x11VncArguments(
  display: number,
  xauthority: string,
  passwordFile: string,
  port: number,
): string[] {
  return [
    "-display",
    `:${display.toString()}`,
    "-auth",
    xauthority,
    "-rfbport",
    port.toString(),
    "-localhost",
    "-forever",
    "-shared",
    "-passwdfile",
    passwordFile,
    "-noxrecord",
    "-noxfixes",
    "-noxdamage",
  ];
}

function remoteChromeArguments(
  profileDirectory: string,
  debuggingPort: number,
  startUrl: string,
): string[] {
  return [
    `--user-data-dir=${profileDirectory}`,
    "--disable-background-mode",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "--window-size=1440,1000",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debuggingPort.toString()}`,
    startUrl,
  ];
}

function remoteBrowserHtml(
  label: string,
  password: string,
  accessToken: string,
  scriptNonce: string,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    ${REMOTE_BROWSER_READY_MARKER}
    <title>Reconnect ${label}</title>
    <style>
      html, body, #screen { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #f7f4ee; }
      #status { position: fixed; inset: 0; display: grid; place-items: center; color: #262139; font: 600 16px system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="screen"></div>
    <div id="status" role="status">Opening ${label}…</div>
    <script type="module" nonce="${scriptNonce}">
      import RFB from "./core/rfb.js";
      const screen = document.querySelector("#screen");
      const status = document.querySelector("#status");
      const rfb = new RFB(screen, "wss://" + location.host + "/${accessToken}/websockify", {
        credentials: { password: ${JSON.stringify(password)} },
        wsProtocols: ["binary"],
      });
      rfb.scaleViewport = true;
      rfb.resizeSession = true;
      rfb.viewOnly = false;
      rfb.addEventListener("connect", () => status.remove());
      rfb.addEventListener("credentialsrequired", () => {
        rfb.sendCredentials({ password: ${JSON.stringify(password)} });
      });
      rfb.addEventListener("disconnect", () => {
        status.textContent = "This reconnect session has ended. You can close this window.";
      });
    </script>
  </body>
</html>
`;
}

async function prepareWebRoot(
  temporaryDirectory: string,
  noVncDirectory: string,
  label: string,
  password: string,
): Promise<{ accessToken: string; webRoot: string; scriptNonce: string }> {
  const webRoot = path.join(temporaryDirectory, "web");
  await mkdir(webRoot, { mode: 0o700 });
  await symlink(path.join(noVncDirectory, "core"), path.join(webRoot, "core"));
  await symlink(
    path.join(noVncDirectory, "vendor"),
    path.join(webRoot, "vendor"),
  );
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><meta name=robots content=noindex><title>Not found</title>",
    { mode: 0o600 },
  );
  const accessToken = randomBytes(32).toString("base64url");
  const scriptNonce = randomBytes(32).toString("base64url");
  await writeFile(
    path.join(webRoot, `${accessToken}.html`),
    remoteBrowserHtml(label, password, accessToken, scriptNonce),
    { mode: 0o600 },
  );
  return { accessToken, webRoot, scriptNonce };
}

async function publicTunnelResponds(
  liveUrl: URL,
  probe: { clientId: string; clientSecret: string; nonce: string },
  request: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await request(liveUrl, {
      headers: {
        Accept: "text/plain",
        "CF-Access-Client-Id": probe.clientId,
        "CF-Access-Client-Secret": probe.clientSecret,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(PUBLIC_TUNNEL_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    return (await response.text()) === probe.nonce;
  } catch {
    return false;
  }
}

async function waitForPublicTunnel(
  liveUrl: URL,
  child: ChildProcess,
  probe: { clientId: string; clientSecret: string; nonce: string },
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Secure browser tunnel stopped during startup.");
    }
    if (await publicTunnelResponds(liveUrl, probe)) {
      return;
    }
    await sleep(PUBLIC_TUNNEL_RETRY_INTERVAL_MS);
  }
  throw new Error("Secure browser tunnel was not reachable.");
}

function browserSessionPath(provider: MacAgentTarget, suffix: string): string {
  return `/api/automation/provider-browser/${provider}/mac-agent${suffix}`;
}

export async function leaseProviderBrowserSession(
  authorization: MacAgentAuthorization,
  provider: MacAgentTarget,
): Promise<ProviderBrowserSessionLease> {
  const response = await macAgentApi(
    authorization,
    browserSessionPath(provider, "/lease"),
    { method: "POST" },
  );
  if (response.status !== 200) {
    throw new ProviderBrowserRuntimeError(
      "agent_unavailable",
      "Keel could not check for provider reconnect work.",
    );
  }
  return ProviderBrowserSessionLeaseSchema.parse(response.body);
}

export async function rotateProviderAgentAuthorization(
  authorization: MacAgentAuthorization,
  provider: MacAgentTarget,
): Promise<MacAgentAuthorization> {
  const response = await macAgentApi(
    authorization,
    browserSessionPath(provider, "/rotate"),
    { method: "POST" },
  );
  if (response.status !== 200) {
    throw new ProviderBrowserRuntimeError(
      "agent_unavailable",
      "Keel could not rotate provider-agent access.",
    );
  }
  const replacement = MacAgentAuthorizationSchema.parse(response.body);
  if (replacement.target !== provider) {
    throw new ProviderBrowserRuntimeError(
      "agent_unavailable",
      "Keel returned the wrong provider-agent scope.",
    );
  }
  return replacement;
}

export async function validateProviderBrowserRuntime(): Promise<void> {
  if (process.platform !== "linux") {
    throw new ProviderBrowserRuntimeError(
      "browser_unavailable",
      "Managed provider reconnects require the Linux worker.",
    );
  }
  requiredExecutable("Xvfb");
  requiredExecutable("x11vnc");
  requiredExecutable("xauth");
  requiredExecutable("websockify");
  requiredExecutable("cloudflared");
  await noVncRoot();
}

async function sessionApi(
  authorization: MacAgentAuthorization,
  provider: MacAgentTarget,
  sessionId: string,
  action: "status" | "ready" | "complete" | "fail",
  body?: unknown,
): Promise<ProviderBrowserSession> {
  const response = await macAgentApi(
    authorization,
    browserSessionPath(provider, `/sessions/${sessionId}/${action}`),
    {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }),
    },
  );
  if (response.status !== 200) {
    throw new ProviderBrowserRuntimeError(
      "agent_unavailable",
      "The provider reconnect session is no longer available.",
    );
  }
  return ProviderBrowserSessionSchema.parse(response.body);
}

async function reportFailure(
  options: ProviderBrowserRuntimeOptions,
  errorCode: ProviderBrowserSessionErrorCode,
): Promise<void> {
  await sessionApi(
    options.authorization,
    options.provider,
    options.lease.id,
    "fail",
    { leaseToken: options.lease.leaseToken, errorCode },
  ).catch(() => undefined);
}

export async function runProviderBrowserSession(
  options: ProviderBrowserRuntimeOptions,
): Promise<"connected" | "terminated"> {
  if (process.platform !== "linux") {
    await reportFailure(options, "browser_unavailable");
    return "terminated";
  }

  let temporaryDirectory: string | null = null;
  let xvfb: ChildProcess | null = null;
  let x11vnc: ChildProcess | null = null;
  let viewerProxy: ViewerProxy | null = null;
  let websockify: ChildProcess | null = null;
  let cloudflared: ChildProcess | null = null;
  let chrome: ChildProcess | null = null;
  let gateway: ReconnectAccessGateway | null = null;
  let stage: ProviderBrowserRuntimeStage = "private_storage";
  try {
    const access = await loadReconnectAccess(
      options.authorization.apiOrigin,
      options.provider,
    );
    await mkdir(options.appDirectory, { mode: 0o700, recursive: true });
    await chmod(options.appDirectory, 0o700);
    temporaryDirectory = await mkdtemp(
      path.join(options.appDirectory, ".reconnect-"),
    );
    await chmod(temporaryDirectory, 0o700);
    const [
      xvfbPath,
      x11vncPath,
      xauthPath,
      websockifyPath,
      cloudflaredPath,
      noVncDirectory,
      display,
      loopbackPorts,
    ] = await Promise.all([
      Promise.resolve(requiredExecutable("Xvfb")),
      Promise.resolve(requiredExecutable("x11vnc")),
      Promise.resolve(requiredExecutable("xauth")),
      Promise.resolve(requiredExecutable("websockify")),
      Promise.resolve(requiredExecutable("cloudflared")),
      noVncRoot(),
      availableDisplay(),
      availableLoopbackPorts(),
    ]);
    const [vncPort, webPort, debuggingPort] = loopbackPorts;
    const xauthority = path.join(temporaryDirectory, "Xauthority");
    const passwordFile = path.join(temporaryDirectory, "vnc-password");
    const vncPassword = randomBytes(18).toString("base64url");
    const xCookie = randomBytes(16).toString("hex");
    await writeFile(passwordFile, `${vncPassword}\n`, { mode: 0o600 });
    const xauth = spawnSync(xauthPath, [
      "-f",
      xauthority,
      "add",
      `:${display.toString()}`,
      ".",
      xCookie,
    ]);
    if (xauth.status !== 0) {
      throw new Error("Private browser display could not be secured.");
    }
    await chmod(xauthority, 0o600);

    stage = "private_display";
    xvfb = spawn(
      xvfbPath,
      [
        `:${display.toString()}`,
        "-screen",
        "0",
        "1440x1000x24",
        "-nolisten",
        "tcp",
        "-auth",
        xauthority,
      ],
      { stdio: "ignore" },
    );
    await waitForFile(`/tmp/.X11-unix/X${display.toString()}`, xvfb);

    stage = "private_vnc";
    x11vnc = spawn(
      x11vncPath,
      x11VncArguments(display, xauthority, passwordFile, vncPort),
      { stdio: "ignore" },
    );
    await waitForPort(vncPort, x11vnc);
    viewerProxy = await startViewerProxy(vncPort);

    stage = "browser_stream";
    const web = await prepareWebRoot(
      temporaryDirectory,
      noVncDirectory,
      options.label,
      vncPassword,
    );
    websockify = spawn(
      websockifyPath,
      [
        "--web",
        web.webRoot,
        `127.0.0.1:${webPort.toString()}`,
        `127.0.0.1:${viewerProxy.port.toString()}`,
      ],
      { stdio: "ignore" },
    );
    await waitForPort(webPort, websockify);

    stage = "secure_tunnel";
    const nonce = randomBytes(32).toString("base64url");
    gateway = await startReconnectAccessGateway({
      config: access.config,
      probeClientId: access.probe.clientId,
      probeNonce: nonce,
      viewerSubject: options.lease.viewerSubject,
      expiresAt: options.lease.expiresAt,
      accessToken: web.accessToken,
      scriptNonce: web.scriptNonce,
      backendPort: webPort,
    });
    cloudflared = spawn(
      cloudflaredPath,
      [
        "tunnel",
        "--no-autoupdate",
        "run",
        "--token-file",
        access.config.tunnelTokenFile,
      ],
      { stdio: "ignore" },
    );
    const liveUrl = new URL(
      `${web.accessToken}.html`,
      access.config.publicOrigin,
    );
    stage = "public_tunnel";
    await waitForPublicTunnel(
      new URL(`/_keel/ready/${nonce}`, access.config.publicOrigin),
      cloudflared,
      { ...access.probe, nonce },
    );

    stage = "provider_browser";
    chrome = spawn(
      options.chromePath,
      remoteChromeArguments(
        options.profileDirectory,
        debuggingPort,
        options.startUrl,
      ),
      {
        env: {
          ...process.env,
          DISPLAY: `:${display.toString()}`,
          XAUTHORITY: xauthority,
        },
        stdio: "ignore",
      },
    );
    await waitForDevTools(debuggingPort, chrome);

    stage = "session_ready";
    await sessionApi(
      options.authorization,
      options.provider,
      options.lease.id,
      "ready",
      { leaseToken: options.lease.leaseToken, liveUrl: liveUrl.toString() },
    );

    let entryPageRemoved = false;
    const activeViewer = viewerProxy;
    const activeGateway = gateway;
    return await pollActiveBrowserSession({
      expiresAt: options.lease.expiresAt,
      isAlive: () =>
        [xvfb, x11vnc, websockify, cloudflared, chrome].every(
          (child) => child !== null && child.exitCode === null,
        ) &&
        !activeViewer.failed() &&
        !activeGateway.failed(),
      readStatus: async () =>
        (
          await sessionApi(
            options.authorization,
            options.provider,
            options.lease.id,
            "status",
          )
        ).status,
      onOpened: async () => {
        if (!activeViewer.connected()) return false;
        stage = "provider_sign_in";
        if (!entryPageRemoved) {
          await unlink(path.join(web.webRoot, `${web.accessToken}.html`)).catch(
            () => undefined,
          );
          entryPageRemoved = true;
        }
        return options.isProviderReady(
          `http://127.0.0.1:${debuggingPort.toString()}`,
        );
      },
      complete: () => {
        stage = "session_verification";
        return completeBrowserSession(options, () =>
          closeChromeGracefully(
            chrome!,
            `http://127.0.0.1:${debuggingPort.toString()}`,
          ),
        );
      },
    });
  } catch (error) {
    const errorCode =
      error instanceof ProviderBrowserRuntimeError
        ? error.code
        : "browser_unavailable";
    console.error(
      JSON.stringify({
        event: "provider_browser_reconnect_failed",
        provider: options.provider,
        stage,
        code: errorCode,
      }),
    );
    await reportFailure(options, errorCode);
    throw error instanceof ProviderBrowserRuntimeError
      ? error
      : new ProviderBrowserRuntimeError(
          errorCode,
          "Managed provider reconnect could not start.",
        );
  } finally {
    await gateway?.close();
    await stopChild(chrome);
    await stopChild(cloudflared);
    await stopChild(websockify);
    await viewerProxy?.close();
    await stopChild(x11vnc);
    await stopChild(xvfb);
    if (temporaryDirectory !== null) {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
}

export const __providerBrowserReconnectTest = {
  pollActiveBrowserSession,
  closeChromeGracefully,
  completeBrowserSession,
  publicTunnelResponds,
  remoteBrowserHtml,
  remoteChromeArguments,
  startViewerProxy,
  stopChild,
  x11VncArguments,
};
