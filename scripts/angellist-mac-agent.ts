import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MAX_ANGELLIST_CSV_BYTES } from "../packages/connectors/src/index";
import {
  AngelListMacAgentLeaseSchema,
  AngelListMacAgentOverviewSchema,
  AngelListMacAgentRunRequestSchema,
  MacAgentAuthorizationSchema,
  type AngelListMacAgentErrorCode,
  type AngelListMacAgentLease,
  type MacAgentAuthorization,
} from "../packages/domain/src/index";
import {
  MacAgentAccessError,
  linuxAgentAuthorizationPath,
  linuxAgentSiblingAuthorizationDirectories,
  macAgentApi,
  readMacAgentAuthorization,
  storeMacAgentAuthorization,
} from "./mac-agent-auth";
import {
  macAgentInstanceId,
  retireMatchingLegacyLaunchAgent,
} from "./mac-agent-instance";
import {
  agentApplicationDirectory,
  agentLogDirectory,
  chromeExecutable,
  chromeProcessIdsForProfile,
  controlledChromeArguments,
  installSystemdAgentService,
  removeStaleChromeProfileLocks,
  validateInteractiveSetupEnvironment,
  validateLinuxSystemdUser,
  waitForProfileChromeExit,
} from "./browser-agent-runtime";
import {
  leaseProviderBrowserSession,
  ProviderBrowserRuntimeError,
  rotateProviderAgentAuthorization,
  runProviderBrowserSession,
  validateProviderBrowserRuntime,
} from "./provider-browser-reconnect";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type ConnectOverCDPOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import { z } from "zod";

const ANGELLIST_ORIGIN = "https://venture.angellist.com";
const LEGACY_APP_DIRECTORY = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Keel",
  "AngelList Agent",
);
const LEGACY_LAUNCH_AGENT_LABEL = "com.keel.angellist-agent";
const LEGACY_LAUNCH_AGENT_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${LEGACY_LAUNCH_AGENT_LABEL}.plist`,
);
const SETUP_TIMEOUT_MS = 30 * 60 * 1_000;
const DAILY_CHECK_INTERVAL_SECONDS = 24 * 60 * 60;
const POLL_INTERVAL_MS = DAILY_CHECK_INTERVAL_SECONDS * 1_000;
const RECONNECT_POLL_INTERVAL_MS = 5_000;
const FAILURE_RETRY_INTERVAL_MS = 15 * 60 * 1_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const ANGELLIST_PORTFOLIO_PATH =
  /^\/v\/[a-z0-9-]{1,128}\/i\/[a-z0-9-]{1,128}\/portfolio(?:\/dashboard)?\/?$/iu;

const AngelListPortfolioUrlSchema = z.url().transform((value, context) => {
  const url = new URL(value);
  if (
    url.origin !== ANGELLIST_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "/" && !ANGELLIST_PORTFOLIO_PATH.test(url.pathname))
  ) {
    context.addIssue({
      code: "custom",
      message: "AngelList portfolio URL is not supported.",
    });
    return z.NEVER;
  }
  url.search = "";
  url.hash = "";
  return url.href;
});

const AngelListLocalConfigSchema = z
  .object({
    version: z.literal(1),
    portfolioUrl: AngelListPortfolioUrlSchema,
  })
  .strict();

type Command = "once" | "run" | "serve" | "setup";

function agentPaths(
  keelOrigin: URL,
  platform: NodeJS.Platform = process.platform,
) {
  const instanceId = macAgentInstanceId(keelOrigin);
  const baseDirectory =
    platform === "darwin"
      ? LEGACY_APP_DIRECTORY
      : agentApplicationDirectory("AngelList Agent", { platform });
  const appDirectory = path.join(baseDirectory, "Instances", instanceId);
  const profileDirectory = path.join(appDirectory, "Chrome");
  const launchAgentLabel = `${LEGACY_LAUNCH_AGENT_LABEL}.${instanceId}`;
  return {
    appDirectory,
    configPath: path.join(appDirectory, "config.json"),
    devToolsActivePort: path.join(profileDirectory, "DevToolsActivePort"),
    downloadDirectoryPrefix: path.join(appDirectory, "Downloads-"),
    instanceId,
    launchAgentLabel,
    launchAgentPath: path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      `${launchAgentLabel}.plist`,
    ),
    profileDirectory,
  };
}

class AgentFailure extends Error {
  public constructor(public readonly code: AngelListMacAgentErrorCode) {
    super(code);
    this.name = "AgentFailure";
  }
}

const CliOptionsSchema = z
  .object({
    command: z.enum(["once", "run", "serve", "setup"]),
    keelOrigin: z
      .url()
      .transform((value) => new URL(value))
      .refine(
        (url) =>
          ["http:", "https:"].includes(url.protocol) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === "",
        "Keel URL must be an HTTP(S) origin.",
      ),
  })
  .strict();

function parseOptions(argv: readonly string[]) {
  const args = argv.filter((argument) => argument !== "--");
  const command = (args[0] ?? "setup") as Command;
  const keelUrlIndex = args.indexOf("--keel-url");
  const keelOrigin =
    keelUrlIndex < 0 ? undefined : args[keelUrlIndex + 1]?.trim();
  if (keelOrigin === undefined || keelOrigin.length === 0) {
    throw new Error("Pass --keel-url with the target Keel origin.");
  }
  return CliOptionsSchema.parse({ command, keelOrigin });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fileExists(file: string): Promise<boolean> {
  return stat(file)
    .then(() => true)
    .catch(() => false);
}

async function activeDevToolsPort(keelOrigin: URL): Promise<number | null> {
  const paths = agentPaths(keelOrigin);
  try {
    const [line = ""] = (
      await readFile(paths.devToolsActivePort, "utf8")
    ).split(/\r?\n/u);
    if (!/^\d{1,5}$/u.test(line)) {
      return null;
    }
    const port = Number(line);
    if (port < 1 || port > 65_535) {
      return null;
    }
    const response = await fetch(
      `http://127.0.0.1:${port.toString()}/json/version`,
    );
    return response.ok ? port : null;
  } catch {
    return null;
  }
}

async function ensureChrome(keelOrigin: URL): Promise<number> {
  const paths = agentPaths(keelOrigin);
  await mkdir(paths.profileDirectory, { mode: 0o700, recursive: true });
  await chmod(paths.appDirectory, 0o700);
  await chmod(paths.profileDirectory, 0o700);
  const active = await activeDevToolsPort(keelOrigin);
  if (active !== null) {
    return active;
  }
  const chromePath = await chromeExecutable();
  await stopProfileChrome(keelOrigin, chromePath);
  await rm(paths.devToolsActivePort, { force: true });

  const chrome = spawn(
    chromePath,
    controlledChromeArguments(paths.profileDirectory),
    { detached: true, stdio: "ignore" },
  );
  chrome.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const port = await activeDevToolsPort(keelOrigin);
    if (port !== null) {
      return port;
    }
    await sleep(250);
  }
  throw new Error("Keel could not start the dedicated Chrome profile.");
}

function manualSetupChromeArguments(keelOrigin: URL): string[] {
  const paths = agentPaths(keelOrigin);
  return [
    `--user-data-dir=${paths.profileDirectory}`,
    "--disable-background-mode",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    ANGELLIST_ORIGIN,
    new URL("/holdings", keelOrigin).toString(),
  ];
}

function profileChromeProcessIds(
  profileDirectory: string,
  chromePath: string,
): number[] {
  const result = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.error?.message ||
        "Keel could not inspect the dedicated Chrome process.",
    );
  }
  return chromeProcessIdsForProfile(
    result.stdout,
    profileDirectory,
    chromePath,
  );
}

async function stopProfileChrome(
  keelOrigin: URL,
  chromePath: string,
): Promise<void> {
  const paths = agentPaths(keelOrigin);
  for (const pid of profileChromeProcessIds(
    paths.profileDirectory,
    chromePath,
  )) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }
  const stopped = await waitForProfileChromeExit(
    () => profileChromeProcessIds(paths.profileDirectory, chromePath),
    sleep,
  );
  if (!stopped) {
    throw new Error(
      "Quit the dedicated AngelList Chrome window, then rerun setup.",
    );
  }
  await removeStaleChromeProfileLocks(paths.profileDirectory);
}

async function closeControlledChrome(keelOrigin: URL): Promise<void> {
  const port = await activeDevToolsPort(keelOrigin);
  if (port !== null) {
    const browser = await chromium
      .connectOverCDP(`http://127.0.0.1:${port.toString()}`, {
        noDefaults: true,
      })
      .catch(() => null);
    const session = await browser?.newBrowserCDPSession().catch(() => null);
    await session?.send("Browser.close").catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
  await stopProfileChrome(keelOrigin, await chromeExecutable());
}

async function waitForSignInConfirmation(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "AngelList setup needs an interactive Terminal. Run the setup command directly in Terminal.",
    );
  }
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await terminal.question(
      "When AngelList and Keel are ready, return to Terminal and press Enter. ",
    );
  } finally {
    terminal.close();
  }
}

async function completeLinuxSignIn(keelOrigin: URL): Promise<void> {
  validateInteractiveSetupEnvironment();
  await closeControlledChrome(keelOrigin);
  const paths = agentPaths(keelOrigin, "linux");
  await mkdir(paths.profileDirectory, { mode: 0o700, recursive: true });
  await chmod(paths.appDirectory, 0o700);
  await chmod(paths.profileDirectory, 0o700);
  const chromePath = await chromeExecutable();
  console.info(
    "Sign in to AngelList and Keel in the private desktop window. Keep it open while you sign in.",
  );
  const chrome = spawn(chromePath, manualSetupChromeArguments(keelOrigin), {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    chrome.once("spawn", resolve);
    chrome.once("error", reject);
  });
  await waitForSignInConfirmation();
  await stopProfileChrome(keelOrigin, chromePath);
}

type ConnectOverCDP = (
  endpointUrl: string,
  options?: ConnectOverCDPOptions,
) => Promise<Browser>;

type CapturedDownload = {
  guid: string;
  suggestedFilename: string;
};

type DownloadCapture = {
  cancel: () => void;
  result: Promise<CapturedDownload>;
};

async function connectContext(
  keelOrigin: URL,
  getPort: (keelOrigin: URL) => Promise<number> = ensureChrome,
  connectOverCDP: ConnectOverCDP = (endpointUrl, options) =>
    chromium.connectOverCDP(endpointUrl, options),
): Promise<BrowserContext> {
  const port = await getPort(keelOrigin);
  const browser = await connectOverCDP(`http://127.0.0.1:${port.toString()}`, {
    noDefaults: true,
  });
  const context = browser.contexts()[0];
  if (context === undefined) {
    throw new Error("The dedicated Chrome profile is unavailable.");
  }
  return context;
}

async function configureDownloads(
  session: CDPSession,
  downloadDirectory: string,
): Promise<void> {
  await session.send("Browser.setDownloadBehavior", {
    behavior: "allowAndName",
    downloadPath: downloadDirectory,
    eventsEnabled: true,
  });
}

async function resetDownloads(session: CDPSession): Promise<void> {
  await session.send("Browser.setDownloadBehavior", {
    behavior: "default",
    eventsEnabled: false,
  });
}

async function clickAngelListExport(exportButton: Locator): Promise<void> {
  // AngelList continuously animates this control, so Playwright never marks
  // it stable. Visibility is checked immediately before this click.
  await exportButton.click({ force: true, noWaitAfter: true });
}

function captureNextDownload(
  session: CDPSession,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
): DownloadCapture {
  let settled = false;
  let current: CapturedDownload | null = null;
  let cancel: () => void = () => undefined;
  const result = new Promise<CapturedDownload>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      session.off("Browser.downloadWillBegin", onDownloadWillBegin);
      session.off("Browser.downloadProgress", onDownloadProgress);
    };
    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      action();
    };
    const onDownloadWillBegin = (event: {
      guid: string;
      suggestedFilename: string;
    }) => {
      if (current !== null) {
        return;
      }
      const guid = z.uuid().safeParse(event.guid);
      if (!guid.success) {
        finish(() => reject(new AgentFailure("download_failed")));
        return;
      }
      current = {
        guid: guid.data,
        suggestedFilename: event.suggestedFilename,
      };
    };
    const onDownloadProgress = (event: {
      guid: string;
      state: "canceled" | "completed" | "inProgress";
    }) => {
      const download = current;
      if (download === null || event.guid !== download.guid) {
        return;
      }
      if (event.state === "canceled") {
        finish(() => reject(new AgentFailure("download_failed")));
      } else if (event.state === "completed") {
        finish(() => resolve(download));
      }
    };
    const timeout = setTimeout(
      () => finish(() => reject(new AgentFailure("download_failed"))),
      timeoutMs,
    );
    session.on("Browser.downloadWillBegin", onDownloadWillBegin);
    session.on("Browser.downloadProgress", onDownloadProgress);
    cancel = () => finish(() => reject(new AgentFailure("download_failed")));
  });
  return { cancel, result };
}

function pageAtOrigin(context: BrowserContext, origin: string): Page | null {
  return (
    context.pages().find((page) => {
      try {
        return new URL(page.url()).origin === origin;
      } catch {
        return false;
      }
    }) ?? null
  );
}

function parseAngelListPortfolioUrl(value: string): URL {
  return new URL(AngelListPortfolioUrlSchema.parse(value));
}

async function readAngelListPortfolioUrl(keelOrigin: URL): Promise<URL | null> {
  const paths = agentPaths(keelOrigin);
  try {
    const config = AngelListLocalConfigSchema.parse(
      JSON.parse(await readFile(paths.configPath, "utf8")) as unknown,
    );
    return new URL(config.portfolioUrl);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw new AgentFailure("unexpected_failure");
  }
}

async function writeAngelListPortfolioUrl(
  keelOrigin: URL,
  rawUrl: string,
): Promise<URL> {
  const paths = agentPaths(keelOrigin);
  const portfolioUrl = parseAngelListPortfolioUrl(rawUrl);
  const config = AngelListLocalConfigSchema.parse({
    version: 1,
    portfolioUrl: portfolioUrl.href,
  });
  const temporaryPath = `${paths.configPath}.${process.pid.toString()}.tmp`;
  await mkdir(paths.appDirectory, { mode: 0o700, recursive: true });
  await chmod(paths.appDirectory, 0o700);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, {
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, paths.configPath);
    await chmod(paths.configPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return portfolioUrl;
}

async function keelPage(
  context: BrowserContext,
  keelOrigin: URL,
): Promise<Page> {
  const page =
    pageAtOrigin(context, keelOrigin.origin) ?? (await context.newPage());
  if (new URL(page.url()).origin !== keelOrigin.origin) {
    await page.goto(new URL("/holdings", keelOrigin).toString(), {
      waitUntil: "domcontentloaded",
    });
  }
  return page;
}

async function angelListPage(
  context: BrowserContext,
  portfolioUrl: URL | null = null,
): Promise<Page> {
  const existing = pageAtOrigin(context, ANGELLIST_ORIGIN);
  const page = existing ?? (await context.newPage());
  const targetUrl = portfolioUrl?.href ?? ANGELLIST_ORIGIN;
  if (
    existing === null ||
    (portfolioUrl !== null && page.url() !== targetUrl)
  ) {
    await page.goto(targetUrl, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
  }
  return page;
}

async function waitForKeelSignIn(page: Page, keelOrigin: URL): Promise<void> {
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (new URL(page.url()).origin === keelOrigin.origin) {
      const ready = await page
        .evaluate(async () => {
          const response = await fetch("/api/alpha", {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
          return (
            response.ok &&
            (response.headers.get("Content-Type") ?? "").includes(
              "application/json",
            )
          );
        })
        .catch(() => false);
      if (ready) {
        return;
      }
    }
    await sleep(1_000);
  }
  throw new Error("Keel sign-in was not completed within 30 minutes.");
}

async function waitForAngelListSignIn(
  page: Page,
  keelOrigin: URL,
): Promise<URL> {
  await page
    .getByRole("button", { exact: true, name: "Export CSV" })
    .waitFor({ state: "visible", timeout: SETUP_TIMEOUT_MS });
  return writeAngelListPortfolioUrl(keelOrigin, page.url());
}

type PageApiResult = {
  body: unknown;
  status: number;
};

async function pageApi(page: Page, pathName: string): Promise<PageApiResult> {
  return page.evaluate(async (apiPath) => {
    const response = await fetch(apiPath, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-Keel-Mac-Setup": "1",
      },
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }, pathName);
}

async function authorize(page: Page): Promise<MacAgentAuthorization> {
  const response = await pageApi(
    page,
    "/api/automation/angellist/mac-agent/authorize",
  );
  if (response.status !== 200) {
    throw new AgentFailure("keel_sign_in_required");
  }
  const authorization = MacAgentAuthorizationSchema.parse(response.body);
  if (authorization.target !== "angellist") {
    throw new AgentFailure("unexpected_failure");
  }
  return authorization;
}

async function lease(
  authorization: MacAgentAuthorization,
): Promise<AngelListMacAgentLease> {
  const response = await macAgentApi(
    authorization,
    "/api/automation/angellist/mac-agent/lease",
    { method: "POST" },
  );
  if (response.status !== 200) {
    throw new AgentFailure("upload_failed");
  }
  return AngelListMacAgentLeaseSchema.parse(response.body);
}

async function requestRun(authorization: MacAgentAuthorization) {
  const response = await macAgentApi(
    authorization,
    "/api/automation/angellist/mac-agent/run",
    { method: "POST" },
  );
  if (response.status !== 202) {
    throw new AgentFailure("upload_failed");
  }
  return AngelListMacAgentRunRequestSchema.parse(response.body);
}

function validateFilename(filename: string): string {
  const containsControlCharacter = [...filename].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (
    filename.length < 5 ||
    filename.length > 255 ||
    !filename.toLowerCase().endsWith(".csv") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    containsControlCharacter
  ) {
    throw new AgentFailure("download_failed");
  }
  return filename;
}

async function readDownload(download: {
  createReadStream(): Promise<unknown>;
  failure(): Promise<string | null>;
}): Promise<Uint8Array> {
  if ((await download.failure()) !== null) {
    throw new AgentFailure("download_failed");
  }
  const stream = await download.createReadStream();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  try {
    for await (const rawChunk of stream as AsyncIterable<unknown>) {
      const chunk =
        typeof rawChunk === "string"
          ? new TextEncoder().encode(rawChunk)
          : rawChunk instanceof Uint8Array
            ? rawChunk
            : null;
      if (chunk === null) {
        throw new AgentFailure("download_failed");
      }
      byteSize += chunk.byteLength;
      if (byteSize > MAX_ANGELLIST_CSV_BYTES) {
        throw new AgentFailure("download_failed");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    throw error instanceof AgentFailure
      ? error
      : new AgentFailure("download_failed");
  }
  if (byteSize === 0) {
    throw new AgentFailure("download_failed");
  }
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

async function readCapturedDownload(
  downloadDirectory: string,
  guid: string,
): Promise<Uint8Array> {
  return readDownload({
    failure: () => Promise.resolve(null),
    createReadStream: () =>
      Promise.resolve(createReadStream(path.join(downloadDirectory, guid))),
  });
}

async function uploadCompletion(
  authorization: MacAgentAuthorization,
  run: NonNullable<AngelListMacAgentLease["run"]>,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  const body = new FormData();
  body.append(
    "file",
    new Blob([Uint8Array.from(bytes)], { type: "text/csv" }),
    filename,
  );
  const result = await macAgentApi(
    authorization,
    `/api/automation/angellist/mac-agent/runs/${encodeURIComponent(run.id)}/complete`,
    {
      method: "POST",
      headers: { "X-Keel-Agent-Lease": run.leaseToken },
      body,
    },
  );
  if (result.status !== 200) {
    throw new AgentFailure("upload_failed");
  }
  AngelListMacAgentOverviewSchema.parse(result.body);
}

async function reportFailure(
  authorization: MacAgentAuthorization,
  run: NonNullable<AngelListMacAgentLease["run"]>,
  code: AngelListMacAgentErrorCode,
): Promise<void> {
  await macAgentApi(
    authorization,
    `/api/automation/angellist/mac-agent/runs/${encodeURIComponent(run.id)}/fail`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Keel-Agent-Lease": run.leaseToken,
      },
      body: JSON.stringify({ errorCode: code }),
    },
  ).catch(() => undefined);
}

async function executeRun(
  context: BrowserContext,
  keelOrigin: URL,
  authorization: MacAgentAuthorization,
  run: NonNullable<AngelListMacAgentLease["run"]>,
): Promise<void> {
  const paths = agentPaths(keelOrigin);
  let downloadDirectory: string | null = null;
  let downloadSession: CDPSession | null = null;
  try {
    const portfolioUrl = await readAngelListPortfolioUrl(keelOrigin);
    const target = await angelListPage(context, portfolioUrl);
    const exportButton = target.getByRole("button", {
      exact: true,
      name: "Export CSV",
    });
    const exportReady = await exportButton
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!exportReady) {
      await target.bringToFront();
      throw new AgentFailure("angellist_sign_in_required");
    }
    await writeAngelListPortfolioUrl(keelOrigin, target.url());
    const browser = context.browser();
    if (browser === null) {
      throw new AgentFailure("download_failed");
    }
    downloadDirectory = await mkdtemp(paths.downloadDirectoryPrefix);
    await chmod(downloadDirectory, 0o700);
    downloadSession = await browser.newBrowserCDPSession();
    try {
      await configureDownloads(downloadSession, downloadDirectory);
    } catch {
      throw new AgentFailure("download_failed");
    }
    const capture = captureNextDownload(downloadSession);
    let download: CapturedDownload;
    try {
      await clickAngelListExport(exportButton);
      download = await capture.result;
    } finally {
      capture.cancel();
      await capture.result.catch(() => undefined);
    }
    const filename = validateFilename(download.suggestedFilename);
    const bytes = await readCapturedDownload(downloadDirectory, download.guid);
    await uploadCompletion(authorization, run, filename, bytes);
  } catch (error) {
    if (error instanceof MacAgentAccessError) {
      throw error;
    }
    const code =
      error instanceof AgentFailure ? error.code : "unexpected_failure";
    await reportFailure(authorization, run, code);
    throw error instanceof AgentFailure ? error : new AgentFailure(code);
  } finally {
    if (downloadSession !== null) {
      await resetDownloads(downloadSession).catch(() => undefined);
      await downloadSession.detach().catch(() => undefined);
    }
    if (downloadDirectory !== null) {
      await rm(downloadDirectory, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}

async function pollOnce(
  context: BrowserContext,
  origin: URL,
): Promise<boolean> {
  const authorization = readMacAgentAuthorization(origin, "angellist");
  const work = await lease(authorization);
  if (work.run === null) {
    return false;
  }
  await executeRun(context, origin, authorization, work.run);
  return true;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

type LaunchAgentPlistOptions = {
  keelOrigin: URL;
  logDirectory: string;
  nodeExecutable: string;
  pnpmCli: string;
  repositoryRoot: string;
  scriptPath: string;
};

function buildLaunchAgentPlist(options: LaunchAgentPlistOptions): string {
  const paths = agentPaths(options.keelOrigin);
  const arguments_ = [
    options.nodeExecutable,
    options.pnpmCli,
    "exec",
    "tsx",
    options.scriptPath,
    "once",
    "--keel-url",
    options.keelOrigin.origin,
  ];
  const argumentXml = arguments_
    .map((argument) => `      <string>${xml(argument)}</string>`)
    .join("\n");
  const environmentPath = [
    path.dirname(options.nodeExecutable),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(path.delimiter);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${paths.launchAgentLabel}</string>
    <key>ProgramArguments</key>
    <array>
${argumentXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${xml(environmentPath)}</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${xml(options.repositoryRoot)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>${DAILY_CHECK_INTERVAL_SECONDS.toString()}</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xml(path.join(options.logDirectory, `angellist-agent-${paths.instanceId}.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(options.logDirectory, `angellist-agent-${paths.instanceId}.error.log`))}</string>
  </dict>
</plist>
`;
}

async function installLaunchAgent(keelOrigin: URL): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("The background agent installer currently supports macOS.");
  }
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined || !(await fileExists(pnpmCli))) {
    throw new Error(
      "Run setup through pnpm so Keel can install the background agent.",
    );
  }
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  const paths = agentPaths(keelOrigin);
  await mkdir(path.dirname(paths.launchAgentPath), { recursive: true });
  const logDirectory = agentLogDirectory({ platform: "darwin" });
  await mkdir(logDirectory, { mode: 0o700, recursive: true });
  const plist = buildLaunchAgentPlist({
    keelOrigin,
    logDirectory,
    nodeExecutable: process.execPath,
    pnpmCli,
    repositoryRoot,
    scriptPath,
  });
  await writeFile(paths.launchAgentPath, plist, { mode: 0o600 });
  await chmod(paths.launchAgentPath, 0o600);

  const getuid = process.getuid;
  if (getuid === undefined) {
    throw new Error("macOS user identity is unavailable.");
  }
  const domain = `gui/${getuid().toString()}`;
  spawnSync("launchctl", ["bootout", domain, paths.launchAgentPath], {
    stdio: "ignore",
  });
  const bootstrap = spawnSync(
    "launchctl",
    ["bootstrap", domain, paths.launchAgentPath],
    { encoding: "utf8" },
  );
  if (bootstrap.status !== 0) {
    throw new Error(
      bootstrap.stderr.trim() ||
        "macOS could not install the background agent.",
    );
  }
  await retireMatchingLegacyLaunchAgent(
    domain,
    LEGACY_LAUNCH_AGENT_PATH,
    keelOrigin,
  );
}

async function installLinuxService(keelOrigin: URL): Promise<string> {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  if (!(await fileExists(tsxCli))) {
    throw new Error(
      "Run make bootstrap so Keel can install the background agent.",
    );
  }
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  const paths = agentPaths(keelOrigin, "linux");
  const chromePath = await chromeExecutable();
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const xdgStateHome = process.env.XDG_STATE_HOME?.trim();
  return installSystemdAgentService({
    appDirectory: paths.appDirectory,
    chromePath,
    credentialDirectory: path.dirname(
      linuxAgentAuthorizationPath(keelOrigin, "angellist"),
    ),
    inaccessibleCredentialDirectories:
      linuxAgentSiblingAuthorizationDirectories(keelOrigin, "angellist"),
    instanceId: paths.instanceId,
    keelOrigin,
    label: "AngelList",
    nodeExecutable: process.execPath,
    platform: "linux",
    repositoryRoot,
    scriptPath,
    target: "angellist",
    tsxCli,
    ...(xdgConfigHome ? { xdgConfigHome } : {}),
    ...(xdgStateHome ? { xdgStateHome } : {}),
  });
}

async function installBackgroundAgent(keelOrigin: URL): Promise<string | null> {
  if (process.platform === "darwin") {
    await installLaunchAgent(keelOrigin);
    return null;
  }
  if (process.platform === "linux") {
    return installLinuxService(keelOrigin);
  }
  throw new Error("Keel portfolio agents support macOS and Linux only.");
}

async function setup(keelOrigin: URL): Promise<void> {
  if (process.platform === "linux") {
    validateLinuxSystemdUser();
    await validateProviderBrowserRuntime();
    await completeLinuxSignIn(keelOrigin);
  }
  const context = await connectContext(keelOrigin);
  const angellist = await angelListPage(context);
  await angellist.bringToFront();
  console.info(
    process.platform === "linux"
      ? "Checking the AngelList session from the private desktop window."
      : "Finish signing in to AngelList, including 2FA if requested. Setup will continue when Export CSV is visible.",
  );
  await waitForAngelListSignIn(angellist, keelOrigin);

  const keel = await keelPage(context, keelOrigin);
  await keel.bringToFront();
  console.info(
    process.platform === "linux"
      ? "Checking the Keel session from the private desktop window."
      : "Sign in to Keel once to approve secure access for this Mac. Daily checks will not use your Keel browser session.",
  );
  await waitForKeelSignIn(keel, keelOrigin);
  const authorization = await authorize(keel);
  storeMacAgentAuthorization(keelOrigin, authorization);
  const linuxUnit = await installBackgroundAgent(keelOrigin);
  if (linuxUnit === null) {
    console.info(
      `AngelList updates are ready for ${keelOrigin.origin}. The credential is in macOS Keychain, and Keel will check once daily without another Keel sign-in. Run make provider-agent-run PROVIDER=angellist KEEL_URL=${keelOrigin.origin} for an immediate update.`,
    );
  } else {
    console.info(
      `AngelList updates are ready for ${keelOrigin.origin}. The credential is stored for this Linux user, and ${linuxUnit} will stay available for reconnects and check for updates once daily. Run make provider-agent-run PROVIDER=angellist KEEL_URL=${keelOrigin.origin} for an immediate update.`,
    );
  }
}

async function runLocally(keelOrigin: URL): Promise<void> {
  const context = await connectContext(keelOrigin);
  const authorization = readMacAgentAuthorization(keelOrigin, "angellist");
  const requested = await requestRun(authorization);
  if (requested.status === "running") {
    console.info("An AngelList update is already in progress.");
    return;
  }
  const work = await lease(authorization);
  if (work.run === null) {
    console.info("The AngelList update is queued for another agent check.");
    return;
  }
  await executeRun(context, keelOrigin, authorization, work.run);
  console.info("AngelList CSV uploaded to Keel and ready for review.");
}

async function handleManagedReconnect(
  keelOrigin: URL,
  authorization: MacAgentAuthorization,
  session: NonNullable<
    Awaited<ReturnType<typeof leaseProviderBrowserSession>>["session"]
  >,
): Promise<boolean> {
  await closeControlledChrome(keelOrigin);
  const paths = agentPaths(keelOrigin, "linux");
  const portfolioUrl = await readAngelListPortfolioUrl(keelOrigin);
  let remoteContext: BrowserContext | null = null;
  const result = await runProviderBrowserSession({
    appDirectory: paths.appDirectory,
    authorization,
    chromePath: await chromeExecutable({ platform: "linux" }),
    isProviderReady: async (endpointUrl) => {
      if (remoteContext?.browser()?.isConnected() !== true) {
        const browser = await chromium.connectOverCDP(endpointUrl, {
          noDefaults: true,
        });
        remoteContext = browser.contexts()[0] ?? null;
      }
      const context = remoteContext;
      if (context === null) {
        return false;
      }
      const page =
        pageAtOrigin(context, ANGELLIST_ORIGIN) ?? context.pages()[0] ?? null;
      if (page === null) {
        return false;
      }
      const ready = await page
        .getByRole("button", { exact: true, name: "Export CSV" })
        .isVisible()
        .catch(() => false);
      if (ready) {
        await writeAngelListPortfolioUrl(keelOrigin, page.url());
      }
      return ready;
    },
    label: "AngelList",
    lease: session,
    profileDirectory: paths.profileDirectory,
    provider: "angellist",
    startUrl: portfolioUrl?.href ?? ANGELLIST_ORIGIN,
  });
  if (result === "connected") {
    let updateAuthorization = authorization;
    try {
      const replacement = await rotateProviderAgentAuthorization(
        authorization,
        "angellist",
      );
      storeMacAgentAuthorization(keelOrigin, replacement);
      updateAuthorization = replacement;
    } catch {
      console.error(
        JSON.stringify({ event: "angellist_agent_rotation_deferred" }),
      );
    }
    await requestRun(updateAuthorization).catch(() => undefined);
    return true;
  }
  return false;
}

async function serve(
  command: "once" | "serve",
  keelOrigin: URL,
): Promise<void> {
  if (command === "once") {
    const context = await connectContext(keelOrigin);
    await pollOnce(context, keelOrigin);
    return;
  }
  let context: BrowserContext | null = null;
  let nextUpdateCheckAt = 0;
  while (true) {
    try {
      const authorization = readMacAgentAuthorization(keelOrigin, "angellist");
      const reconnect = await leaseProviderBrowserSession(
        authorization,
        "angellist",
      );
      if (reconnect.session !== null) {
        await context
          ?.browser()
          ?.close()
          .catch(() => undefined);
        context = null;
        if (
          await handleManagedReconnect(
            keelOrigin,
            authorization,
            reconnect.session,
          )
        ) {
          nextUpdateCheckAt = 0;
        }
      } else if (Date.now() >= nextUpdateCheckAt) {
        if (context?.browser()?.isConnected() !== true) {
          context = await connectContext(keelOrigin);
        }
        await pollOnce(context, keelOrigin);
        nextUpdateCheckAt = Date.now() + POLL_INTERVAL_MS;
      }
    } catch (error) {
      const code =
        error instanceof MacAgentAccessError
          ? "mac_access_required"
          : error instanceof ProviderBrowserRuntimeError
            ? error.code
            : error instanceof AgentFailure
              ? error.code
              : "unexpected_failure";
      console.error(
        JSON.stringify({ event: "angellist_agent_poll_failed", code }),
      );
      if (context?.browser()?.isConnected() !== true) {
        context = null;
      }
      if (error instanceof MacAgentAccessError) {
        await sleep(FAILURE_RETRY_INTERVAL_MS);
        continue;
      }
      if (!(error instanceof ProviderBrowserRuntimeError)) {
        nextUpdateCheckAt = Date.now() + FAILURE_RETRY_INTERVAL_MS;
      }
    }
    await sleep(RECONNECT_POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === "setup") {
    await setup(options.keelOrigin);
    return;
  }
  if (options.command === "run") {
    await runLocally(options.keelOrigin);
    return;
  }
  await serve(options.command, options.keelOrigin);
}

export const __angellistMacAgentTest = {
  agentPaths,
  angelListPage,
  buildLaunchAgentPlist,
  captureNextDownload,
  clickAngelListExport,
  chromeProcessIdsForProfile,
  configureDownloads,
  connectContext,
  manualSetupChromeArguments,
  parseOptions,
  parseAngelListPortfolioUrl,
  readDownload,
  resetDownloads,
  validateFilename,
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entrypoint)).href
) {
  // connectOverCDP keeps a WebSocket active after setup or a one-shot poll.
  // Exit completed commands so the LaunchAgent is the only long-lived owner.
  void main().then(
    () => process.exit(0),
    (error: unknown) => {
      const code =
        error instanceof MacAgentAccessError
          ? "mac_access_required"
          : error instanceof AgentFailure
            ? error.code
            : "unexpected_failure";
      console.error(JSON.stringify({ event: "angellist_agent_failed", code }));
      process.exit(1);
    },
  );
}
