import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES,
  MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS,
  PROVIDER_HOLDINGS_TEMPLATE_CSV_PREAMBLES,
  providerHoldingsTemplateCsvHeaders,
} from "../packages/connectors/src/index";
import {
  MacAgentAuthorizationSchema,
  ProviderPortfolioAgentLeaseSchema,
  ProviderPortfolioAgentOverviewSchema,
  ProviderPortfolioAgentProviderSchema,
  ProviderPortfolioAgentRunRequestSchema,
  type MacAgentAuthorization,
  type ProviderPortfolioAgentErrorCode,
  type ProviderPortfolioAgentLease,
  type ProviderPortfolioAgentProvider,
} from "../packages/domain/src/index";
import {
  MacAgentAccessError,
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
  controlledChromeArguments,
  installSystemdAgentService,
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
  type ConnectOverCDPOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import { z } from "zod";

const SETUP_SESSION_CHECK_TIMEOUT_MS = 30_000;
const DAILY_CHECK_INTERVAL_SECONDS = 24 * 60 * 60;
const POLL_INTERVAL_MS = DAILY_CHECK_INTERVAL_SECONDS * 1_000;
const RECONNECT_POLL_INTERVAL_MS = 5_000;
const FAILURE_RETRY_INTERVAL_MS = 15 * 60 * 1_000;
const PAGE_TIMEOUT_MS = 45_000;

type Command = "once" | "run" | "serve" | "setup";

type ProviderConfig = {
  label: string;
  origin: string;
  portfolioUrl: string;
  profileName: string;
};

const PROVIDERS: Record<ProviderPortfolioAgentProvider, ProviderConfig> = {
  tokenfolio: {
    label: "Tokenfolio",
    origin: "https://app.tokenfolio.co",
    portfolioUrl: "https://app.tokenfolio.co/portfolio?tab=active",
    profileName: "Tokenfolio Agent",
  },
  sydecar: {
    label: "Sydecar",
    origin: "https://app.sydecar.io",
    portfolioUrl: "https://app.sydecar.io/investments",
    profileName: "Sydecar Agent",
  },
};

class AgentFailure extends Error {
  public constructor(public readonly code: ProviderPortfolioAgentErrorCode) {
    super(code);
    this.name = "AgentFailure";
  }
}

const CliOptionsSchema = z
  .object({
    command: z.enum(["once", "run", "serve", "setup"]),
    provider: ProviderPortfolioAgentProviderSchema,
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

const TokenfolioDetailSchema = z
  .object({
    company: z.string().trim().min(1).max(1_000),
    entity: z.string().trim().min(1).max(1_000),
    committedOn: z.string().trim().min(1).max(100),
    committed: z.string().trim().min(1).max(100),
    currentValue: z.string().trim().min(1).max(100),
  })
  .strict();

const SydecarReportedDetailSchema = z
  .object({
    title: z.string().trim().min(1).max(1_000),
    commitment: z.string().trim().min(1).max(100),
    funded: z.string().trim().min(1).max(100),
    activities: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(200),
            date: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

const SydecarUndatedDetailSchema = z
  .object({
    title: z.string().trim().min(1).max(1_000),
    commitment: z.string().trim().min(1).max(100),
    funded: z.null(),
    activities: z.tuple([]),
  })
  .strict();

type CaptureRow = {
  investment: string;
  legalPosition: string;
  positionType: "SPV";
  heldThrough: string;
  status: "Live";
  investmentDate: string | null;
  asOfDate: string;
  investedMinor: bigint;
  committedMinor: bigint;
  currentValueMinor: bigint | null;
  realizedValueMinor: bigint;
  instrument: string;
  managementFeePpm: number | null;
  carryPpm: number | null;
  identityKey: string;
};

function parseOptions(argv: readonly string[]) {
  const args = argv.filter((argument) => argument !== "--");
  const command = (args[0] ?? "setup") as Command;
  const providerIndex = args.indexOf("--provider");
  const provider =
    providerIndex < 0 ? undefined : args[providerIndex + 1]?.trim();
  const keelUrlIndex = args.indexOf("--keel-url");
  const keelOrigin =
    keelUrlIndex < 0 ? undefined : args[keelUrlIndex + 1]?.trim();
  if (provider === undefined || provider.length === 0) {
    throw new Error("Pass --provider tokenfolio or --provider sydecar.");
  }
  if (keelOrigin === undefined || keelOrigin.length === 0) {
    throw new Error("Pass --keel-url with the target Keel origin.");
  }
  return CliOptionsSchema.parse({ command, provider, keelOrigin });
}

function providerPaths(
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
  platform: NodeJS.Platform = process.platform,
) {
  const config = PROVIDERS[provider];
  const legacyAppDirectory = agentApplicationDirectory(config.profileName, {
    platform,
  });
  const instanceId = macAgentInstanceId(keelOrigin);
  const appDirectory = path.join(legacyAppDirectory, "Instances", instanceId);
  const profileDirectory = path.join(appDirectory, "Chrome");
  const legacyLaunchAgentLabel = `com.keel.${provider}-agent`;
  const launchAgentLabel = `${legacyLaunchAgentLabel}.${instanceId}`;
  return {
    appDirectory,
    profileDirectory,
    devToolsActivePort: path.join(profileDirectory, "DevToolsActivePort"),
    instanceId,
    legacyLaunchAgentPath: path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      `${legacyLaunchAgentLabel}.plist`,
    ),
    launchAgentLabel,
    launchAgentPath: path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      `${launchAgentLabel}.plist`,
    ),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fileExists(file: string): Promise<boolean> {
  return stat(file)
    .then(() => true)
    .catch(() => false);
}

async function activeDevToolsPort(
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
): Promise<number | null> {
  try {
    const [line = ""] = (
      await readFile(
        providerPaths(provider, keelOrigin).devToolsActivePort,
        "utf8",
      )
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

async function ensureChrome(
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
): Promise<number> {
  const paths = providerPaths(provider, keelOrigin);
  await mkdir(paths.profileDirectory, { mode: 0o700, recursive: true });
  await chmod(paths.appDirectory, 0o700);
  await chmod(paths.profileDirectory, 0o700);
  const active = await activeDevToolsPort(provider, keelOrigin);
  if (active !== null) {
    return active;
  }
  await rm(paths.devToolsActivePort, { force: true });
  const chromePath = await chromeExecutable();

  const chrome = spawn(
    chromePath,
    controlledChromeArguments(paths.profileDirectory),
    { detached: true, stdio: "ignore" },
  );
  chrome.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const port = await activeDevToolsPort(provider, keelOrigin);
    if (port !== null) {
      return port;
    }
    await sleep(250);
  }
  throw new Error("Keel could not start the dedicated Chrome profile.");
}

function manualSetupChromeArguments(
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
): string[] {
  const paths = providerPaths(provider, keelOrigin);
  return [
    `--user-data-dir=${paths.profileDirectory}`,
    "--disable-background-mode",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    PROVIDERS[provider].portfolioUrl,
    new URL("/holdings", keelOrigin).toString(),
  ];
}

function chromeProcessIdsForProfile(
  processList: string,
  profileDirectory: string,
  chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
): number[] {
  const userDataArgument = `--user-data-dir=${profileDirectory}`;
  return processList.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (match === null) {
      return [];
    }
    const rawPid = match[1];
    const command = match[2];
    if (rawPid === undefined || command === undefined) {
      return [];
    }
    if (command !== chromePath && !command.startsWith(`${chromePath} `)) {
      return [];
    }
    if (
      command !== `${chromePath} ${userDataArgument}` &&
      !command.includes(`${userDataArgument} `) &&
      !command.endsWith(` ${userDataArgument}`)
    ) {
      return [];
    }
    const pid = Number(rawPid);
    return Number.isSafeInteger(pid) && pid > 0 ? [pid] : [];
  });
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
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
  chromePath: string,
): Promise<void> {
  const paths = providerPaths(provider, keelOrigin);
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
      `Quit the dedicated ${PROVIDERS[provider].label} Chrome window, then rerun setup.`,
    );
  }
}

async function closeControlledChrome(
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
): Promise<void> {
  const port = await activeDevToolsPort(provider, keelOrigin);
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
  await stopProfileChrome(provider, keelOrigin, await chromeExecutable());
}

async function waitForProviderSignInConfirmation(
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  const providerLabel = PROVIDERS[provider].label;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `${providerLabel} setup needs an interactive Terminal. Run the copied setup command directly in Terminal.`,
    );
  }
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await terminal.question(
      "When both pages are ready, return to Terminal and press Enter. Keel will close the setup window and continue. ",
    );
  } finally {
    terminal.close();
  }
}

async function completeProviderSignIn(
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
): Promise<void> {
  validateInteractiveSetupEnvironment();
  await closeControlledChrome(provider, keelOrigin);
  const paths = providerPaths(provider, keelOrigin);
  await mkdir(paths.profileDirectory, { mode: 0o700, recursive: true });
  await chmod(paths.appDirectory, 0o700);
  await chmod(paths.profileDirectory, 0o700);
  const chromePath = await chromeExecutable();

  console.info(
    `Sign in to ${PROVIDERS[provider].label} and Keel in the normal Chrome window. Keep it open while you sign in.`,
  );
  const chrome = spawn(
    chromePath,
    manualSetupChromeArguments(provider, keelOrigin),
    { stdio: "ignore" },
  );
  await new Promise<void>((resolve, reject) => {
    chrome.once("spawn", resolve);
    chrome.once("error", reject);
  });
  await waitForProviderSignInConfirmation(provider);
  await stopProfileChrome(provider, keelOrigin, chromePath);
}

type ConnectOverCDP = (
  endpointUrl: string,
  options?: ConnectOverCDPOptions,
) => Promise<Browser>;

async function connectContext(
  provider: ProviderPortfolioAgentProvider,
  keelOrigin: URL,
  getPort: (
    provider: ProviderPortfolioAgentProvider,
    keelOrigin: URL,
  ) => Promise<number> = ensureChrome,
  connectOverCDP: ConnectOverCDP = (endpointUrl, options) =>
    chromium.connectOverCDP(endpointUrl, options),
): Promise<BrowserContext> {
  const port = await getPort(provider, keelOrigin);
  const browser = await connectOverCDP(`http://127.0.0.1:${port.toString()}`, {
    noDefaults: true,
  });
  const context = browser.contexts()[0];
  if (context === undefined) {
    throw new Error("The dedicated Chrome profile is unavailable.");
  }
  return context;
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

async function portfolioPage(
  context: BrowserContext,
  provider: ProviderPortfolioAgentProvider,
): Promise<Page> {
  const config = PROVIDERS[provider];
  const page =
    pageAtOrigin(context, config.origin) ?? (await context.newPage());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(config.portfolioUrl, {
    timeout: PAGE_TIMEOUT_MS,
    waitUntil: "domcontentloaded",
  });
  return page;
}

async function waitForKeelSession(
  page: Page,
  keelOrigin: URL,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
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
        return true;
      }
    }
    await sleep(1_000);
  }
  return false;
}

async function providerPageReady(
  page: Page,
  provider: ProviderPortfolioAgentProvider,
): Promise<boolean> {
  if (provider === "tokenfolio") {
    return page
      .locator('div[role="button"].relative.cursor-pointer')
      .first()
      .waitFor({ state: "visible", timeout: 1_000 })
      .then(() => true)
      .catch(() => false);
  }
  return page
    .locator(
      '[data-testid="investments-table"] tbody tr[data-testid="investment-row"]',
    )
    .first()
    .waitFor({ state: "visible", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
}

async function validateSetupSessions(
  portfolio: Page,
  keel: Page,
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  const deadline = Date.now() + SETUP_SESSION_CHECK_TIMEOUT_MS;
  let providerReady = false;
  while (Date.now() < deadline) {
    if (await providerPageReady(portfolio, provider)) {
      providerReady = true;
      break;
    }
    await sleep(1_000);
  }
  if (!providerReady) {
    throw new Error(
      `${PROVIDERS[provider].label} sign-in was not completed in the first Chrome window. Rerun setup and finish both sign-ins before closing it.`,
    );
  }
  if (
    !(await waitForKeelSession(
      keel,
      keelOrigin,
      SETUP_SESSION_CHECK_TIMEOUT_MS,
    ))
  ) {
    throw new Error(
      "Keel sign-in was not completed in the first Chrome window. Rerun setup and finish both sign-ins before closing it.",
    );
  }
}

type PageApiResult = { body: unknown; status: number };

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

function agentPath(
  provider: ProviderPortfolioAgentProvider,
  suffix: string,
): string {
  return `/api/automation/provider-holdings/${provider}${suffix}`;
}

async function authorize(
  page: Page,
  provider: ProviderPortfolioAgentProvider,
): Promise<MacAgentAuthorization> {
  const response = await pageApi(
    page,
    agentPath(provider, "/mac-agent/authorize"),
  );
  if (response.status !== 200) {
    throw new AgentFailure("keel_sign_in_required");
  }
  const authorization = MacAgentAuthorizationSchema.parse(response.body);
  if (authorization.target !== provider) {
    throw new AgentFailure("unexpected_failure");
  }
  return authorization;
}

async function lease(
  authorization: MacAgentAuthorization,
  provider: ProviderPortfolioAgentProvider,
): Promise<ProviderPortfolioAgentLease> {
  const response = await macAgentApi(
    authorization,
    agentPath(provider, "/mac-agent/lease"),
    { method: "POST" },
  );
  if (response.status !== 200) {
    throw new AgentFailure("upload_failed");
  }
  return ProviderPortfolioAgentLeaseSchema.parse(response.body);
}

async function requestRun(
  authorization: MacAgentAuthorization,
  provider: ProviderPortfolioAgentProvider,
) {
  const response = await macAgentApi(
    authorization,
    agentPath(provider, "/mac-agent/run"),
    { method: "POST" },
  );
  if (response.status !== 202) {
    throw new AgentFailure("upload_failed");
  }
  return ProviderPortfolioAgentRunRequestSchema.parse(response.body);
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function requiredText(value: string): string {
  const normalized = normalizedText(value);
  const first = normalized[0];
  const containsControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (
    normalized.length === 0 ||
    normalized.length > 1_000 ||
    containsControlCharacter ||
    first === "=" ||
    first === "+" ||
    first === "-" ||
    first === "@"
  ) {
    throw new AgentFailure("identity_ambiguous");
  }
  return normalized;
}

function parseUsdMinor(value: string): bigint {
  const normalized = normalizedText(value).replaceAll("\u00a0", " ");
  const match =
    /^(?:(?:US)?\$|USD\s*)?\s*([0-9]+(?:,[0-9]{3})*)(?:\.([0-9]{1,2}))?$/iu.exec(
      normalized,
    );
  if (match === null) {
    throw new AgentFailure("page_not_supported");
  }
  const whole = BigInt((match[1] ?? "").replaceAll(",", ""));
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const minor = whole * 100n + BigInt(fraction === "" ? "0" : fraction);
  if (minor < 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AgentFailure("page_not_supported");
  }
  return minor;
}

function parseOptionalUsdMinor(value: string): bigint | null {
  const normalized = normalizedText(value).toLowerCase();
  return ["", "-", "—", "n/a", "not available"].includes(normalized)
    ? null
    : parseUsdMinor(value);
}

function formatUsdMinor(value: bigint): string {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AgentFailure("page_not_supported");
  }
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `$${whole.toString()}.${fraction}`;
}

function parsePercentagePpm(value: string): number {
  const normalized = normalizedText(value);
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?%$/u.exec(normalized);
  if (match === null) {
    throw new AgentFailure("page_not_supported");
  }
  const ppm =
    Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0"));
  if (!Number.isSafeInteger(ppm) || ppm > 1_000_000) {
    throw new AgentFailure("page_not_supported");
  }
  return ppm;
}

function formatPercentagePpm(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new AgentFailure("page_not_supported");
  }
  const whole = Math.floor(value / 10_000);
  const fractional = (value % 10_000)
    .toString()
    .padStart(4, "0")
    .replace(/0+$/u, "");
  return `${whole.toString()}${fractional === "" ? "" : `.${fractional}`}%`;
}

function parseProviderDate(value: string): string {
  const normalized = normalizedText(value).replace(
    /\b(\d{1,2})(?:st|nd|rd|th)\b/giu,
    "$1",
  );
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    const exact = new Date(`${normalized}T00:00:00.000Z`);
    if (
      !Number.isNaN(exact.getTime()) &&
      exact.toISOString().slice(0, 10) === normalized
    ) {
      return normalized;
    }
  }
  const parsed = new Date(`${normalized} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AgentFailure("page_not_supported");
  }
  return parsed.toISOString().slice(0, 10);
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function rowsToCsv(
  provider: ProviderPortfolioAgentProvider,
  rows: readonly CaptureRow[],
): Uint8Array {
  if (
    rows.length === 0 ||
    rows.length > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS
  ) {
    throw new AgentFailure("incomplete_snapshot");
  }
  const identityKeys = rows.map((row) => row.identityKey);
  if (new Set(identityKeys).size !== identityKeys.length) {
    throw new AgentFailure("identity_ambiguous");
  }
  const lines = rows.map((row) => {
    let providerTerms: string[] = [];
    if (provider === "sydecar") {
      const { carryPpm, managementFeePpm } = row;
      if (managementFeePpm === null || carryPpm === null) {
        throw new AgentFailure("incomplete_snapshot");
      }
      providerTerms = [
        formatPercentagePpm(managementFeePpm),
        formatPercentagePpm(carryPpm),
      ];
    }
    return [
      row.investment,
      row.legalPosition,
      row.positionType,
      row.heldThrough,
      row.status,
      row.investmentDate ?? "",
      row.asOfDate,
      formatUsdMinor(row.investedMinor),
      formatUsdMinor(row.committedMinor),
      row.currentValueMinor === null
        ? ""
        : formatUsdMinor(row.currentValueMinor),
      formatUsdMinor(row.realizedValueMinor),
      row.instrument,
      ...providerTerms,
    ]
      .map(csvCell)
      .join(",");
  });
  const document = `${PROVIDER_HOLDINGS_TEMPLATE_CSV_PREAMBLES[provider]}\n${providerHoldingsTemplateCsvHeaders(provider).join(",")}\n${lines.join("\n")}\n`;
  const bytes = new TextEncoder().encode(document);
  if (bytes.byteLength > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES) {
    throw new AgentFailure("incomplete_snapshot");
  }
  return bytes;
}

function tokenfolioTabCount(value: string): number {
  const match = /^Active Holdings\s*(\d[\d,]*)$/u.exec(normalizedText(value));
  if (match === null) {
    throw new AgentFailure("page_not_supported");
  }
  const count = Number((match[1] ?? "").replaceAll(",", ""));
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS
  ) {
    throw new AgentFailure("incomplete_snapshot");
  }
  return count;
}

async function waitForTokenfolioTabCount(activeTab: Locator): Promise<number> {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      return tokenfolioTabCount(await activeTab.innerText());
    } catch (error) {
      if (
        !(error instanceof AgentFailure) ||
        error.code !== "page_not_supported"
      ) {
        throw error;
      }
    }
    await sleep(250);
  }
  throw new AgentFailure("page_not_supported");
}

function tokenfolioActiveHoldingStatus(value: string): boolean {
  return ["active", "completed", "funds received"].includes(
    normalizedText(value).toLowerCase(),
  );
}

type TokenfolioCaptureStage =
  | "active_tab"
  | "company"
  | "committed"
  | "current_value"
  | "csv"
  | "detail_reconcile"
  | "drawer_close"
  | "drawer_open"
  | "entity"
  | "final_reconcile"
  | "investment_date"
  | "row_count"
  | "row_shape"
  | "stale_drawer"
  | "status"
  | "tab_count"
  | "tab_selection";

type TokenfolioCaptureStageObserver = (stage: TokenfolioCaptureStage) => void;

async function readTokenfolioDetail(
  closeDrawer: Locator,
  expected: {
    committed: bigint;
    company: string;
    currentValue: bigint | null;
  },
) {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const dialog = closeDrawer.locator('xpath=ancestor::*[@role="dialog"][1]');
    const siblingText = async (label: Locator) => {
      if ((await label.count()) !== 1) {
        return "";
      }
      return label
        .locator("xpath=following-sibling::*[1]")
        .innerText({ timeout: 1_000 })
        .catch(() => "");
    };
    const raw = {
      company: await dialog
        .locator("h1, h2, h3")
        .first()
        .innerText({ timeout: 1_000 })
        .catch(() => ""),
      entity: await siblingText(
        dialog.locator("dt").filter({ hasText: /^Entity$/u }),
      ),
      committedOn: await siblingText(
        dialog.locator("dt").filter({ hasText: /^Committed On$/u }),
      ),
      committed: await siblingText(
        dialog
          .locator(".text-xs.text-gray-400.mb-1.truncate")
          .filter({ hasText: /^Committed$/u }),
      ),
      currentValue: await siblingText(
        dialog
          .locator(".text-xs.text-gray-400.mb-1.truncate")
          .filter({ hasText: /^Current Value$/u }),
      ),
    };
    const parsed = TokenfolioDetailSchema.safeParse(raw);
    if (parsed.success) {
      try {
        const committed = parseUsdMinor(parsed.data.committed);
        const currentValue = parseOptionalUsdMinor(parsed.data.currentValue);
        if (
          normalizedText(parsed.data.company).toLowerCase() ===
            expected.company.toLowerCase() &&
          committed === expected.committed &&
          currentValue === expected.currentValue &&
          committed !== 0n
        ) {
          return parsed.data;
        }
      } catch (error) {
        if (!(error instanceof AgentFailure)) {
          throw error;
        }
      }
    }
    await sleep(250);
  }
  throw new AgentFailure("page_not_supported");
}

async function activateHtmlElement(element: Locator): Promise<void> {
  await element.dispatchEvent("click");
}

async function captureTokenfolio(
  page: Page,
  asOfDate: string,
  onStage: TokenfolioCaptureStageObserver = () => undefined,
) {
  onStage("stale_drawer");
  const staleClose = page.getByRole("button", { name: "Close drawer" });
  if (await staleClose.isVisible().catch(() => false)) {
    await activateHtmlElement(staleClose);
    await staleClose.waitFor({ state: "hidden", timeout: PAGE_TIMEOUT_MS });
  }
  onStage("active_tab");
  const activeTab = page.locator('button#portfolio-tab-active[role="tab"]');
  const tabReady = await activeTab
    .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!tabReady) {
    await page.bringToFront();
    throw new AgentFailure("provider_sign_in_required");
  }
  onStage("tab_selection");
  if ((await activeTab.getAttribute("aria-selected")) !== "true") {
    await activeTab.click();
    if ((await activeTab.getAttribute("aria-selected")) !== "true") {
      throw new AgentFailure("page_not_supported");
    }
  }
  onStage("tab_count");
  const expectedCount = await waitForTokenfolioTabCount(activeTab);
  const rowSelector = 'div[role="button"].relative.cursor-pointer';
  const rows = page.locator(rowSelector);
  onStage("row_count");
  await rows.first().waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  if ((await rows.count()) !== expectedCount) {
    throw new AgentFailure("incomplete_snapshot");
  }

  const captured: CaptureRow[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const row = page.locator(rowSelector).nth(index);
    const cells = row.locator(":scope > div").first().locator(":scope > div");
    onStage("row_shape");
    if ((await cells.count()) !== 7) {
      throw new AgentFailure("page_not_supported");
    }
    onStage("company");
    const company = requiredText(
      await cells.nth(0).locator("span").last().innerText(),
    );
    onStage("committed");
    const listCommitted = parseUsdMinor(
      await cells.nth(3).locator(":scope > span").last().innerText(),
    );
    onStage("current_value");
    const currentValueCell = cells.nth(5).locator(":scope > span").last();
    let listCurrentText = await currentValueCell.innerText();
    for (const suffix of await currentValueCell
      .locator(":scope > span")
      .allInnerTexts()) {
      listCurrentText = listCurrentText.replace(suffix, "");
    }
    listCurrentText = listCurrentText.trim();
    const listCurrent = parseOptionalUsdMinor(listCurrentText);
    onStage("status");
    const status = await cells
      .nth(6)
      .locator(":scope > span")
      .last()
      .innerText();
    if (!tokenfolioActiveHoldingStatus(status)) {
      throw new AgentFailure("page_not_supported");
    }

    onStage("drawer_open");
    await activateHtmlElement(row);
    const close = page.getByRole("button", { name: "Close drawer" });
    await close.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
    onStage("detail_reconcile");
    const detail = await readTokenfolioDetail(close, {
      committed: listCommitted,
      company,
      currentValue: listCurrent,
    });
    const committed = parseUsdMinor(detail.committed);
    const currentValue = parseOptionalUsdMinor(detail.currentValue);
    if (
      normalizedText(detail.company).toLowerCase() !== company.toLowerCase() ||
      committed !== listCommitted ||
      currentValue !== listCurrent ||
      committed === 0n
    ) {
      throw new AgentFailure("incomplete_snapshot");
    }
    onStage("entity");
    const heldThrough = requiredText(detail.entity);
    onStage("investment_date");
    const investmentDate = parseProviderDate(detail.committedOn);
    captured.push({
      investment: company,
      legalPosition: requiredText(`Tokenfolio position in ${company}`),
      positionType: "SPV",
      heldThrough,
      status: "Live",
      investmentDate,
      asOfDate,
      investedMinor: committed,
      committedMinor: committed,
      currentValueMinor: currentValue,
      realizedValueMinor: 0n,
      instrument: "Tokenfolio private position",
      managementFeePpm: null,
      carryPpm: null,
      identityKey: [company, heldThrough, investmentDate]
        .map((part) => normalizedText(part).toLowerCase())
        .join("\u0000"),
    });
    onStage("drawer_close");
    await activateHtmlElement(close);
    await close.waitFor({ state: "hidden", timeout: PAGE_TIMEOUT_MS });
  }

  onStage("final_reconcile");
  if (
    tokenfolioTabCount(await activeTab.innerText()) !== expectedCount ||
    (await page.locator(rowSelector).count()) !== expectedCount
  ) {
    throw new AgentFailure("incomplete_snapshot");
  }
  onStage("csv");
  return rowsToCsv("tokenfolio", captured);
}

type SydecarListRow = {
  investment: string;
  heldThrough: string;
  status: string;
  commitment: string;
  funded: string;
  managementFee: string;
  carry: string;
};

type SydecarCaptureStage =
  | "amounts"
  | "activity"
  | "csv"
  | "date"
  | "detail"
  | "detail_commitment"
  | "detail_funded"
  | "detail_read"
  | "detail_reconcile"
  | "final_list"
  | "initial_list"
  | "return_list"
  | "row_open"
  | "row_reconcile"
  | "status"
  | "table";

type SydecarCaptureStageObserver = (stage: SydecarCaptureStage) => void;

async function openSydecarRow(row: Locator): Promise<void> {
  // Sydecar continuously animates its investment rows, so Playwright never
  // considers them stable. The row was reconciled immediately before this
  // click; force only bypasses that animation check.
  await row.click({ force: true, noWaitAfter: true });
}

async function readSydecarListRow(row: Locator): Promise<SydecarListRow> {
  const cells = row.locator(":scope > td");
  if ((await cells.count()) !== 10) {
    throw new AgentFailure("page_not_supported");
  }
  return {
    investment: requiredText(
      await row.getByTestId("investment-name").innerText(),
    ),
    heldThrough: requiredText(
      await row.getByTestId("investment-investing-as").innerText(),
    ),
    status: normalizedText(
      await row.locator('[data-testid^="investment-status-"]').innerText(),
    ).toLowerCase(),
    commitment: await cells.nth(3).innerText(),
    funded: await cells.nth(4).innerText(),
    managementFee: await row.getByTestId("investment-mgmt-fee").innerText(),
    carry: await row.getByTestId("investment-carry").innerText(),
  };
}

function sydecarListRowsMatch(
  expected: SydecarListRow,
  actual: SydecarListRow,
): boolean {
  return (
    normalizedText(expected.investment).toLowerCase() ===
      normalizedText(actual.investment).toLowerCase() &&
    normalizedText(expected.heldThrough).toLowerCase() ===
      normalizedText(actual.heldThrough).toLowerCase() &&
    normalizedText(expected.status).toLowerCase() ===
      normalizedText(actual.status).toLowerCase() &&
    parseUsdMinor(expected.commitment) === parseUsdMinor(actual.commitment) &&
    parseUsdMinor(expected.funded) === parseUsdMinor(actual.funded) &&
    parsePercentagePpm(expected.managementFee) ===
      parsePercentagePpm(actual.managementFee) &&
    parsePercentagePpm(expected.carry) === parsePercentagePpm(actual.carry)
  );
}

async function readSydecarList(page: Page): Promise<SydecarListRow[]> {
  const table = page.locator('[data-testid="investments-table"]:visible');
  const rows = table.locator('tbody tr[data-testid="investment-row"]');
  const count = await rows.count();
  if (count < 1 || count > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS) {
    throw new AgentFailure("incomplete_snapshot");
  }
  const result: SydecarListRow[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(await readSydecarListRow(rows.nth(index)));
  }
  return result;
}

async function stableSydecarList(page: Page): Promise<SydecarListRow[]> {
  let previousCount = -1;
  let stablePasses = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(500);
    const rows = await readSydecarList(page);
    if (rows.length === previousCount) {
      stablePasses += 1;
      if (stablePasses >= 2) {
        return rows;
      }
    } else {
      previousCount = rows.length;
      stablePasses = 0;
    }
  }
  throw new AgentFailure("incomplete_snapshot");
}

async function readSydecarDetail(page: Page) {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  let undatedStablePasses = 0;
  while (Date.now() < deadline) {
    const visibleText = async (testId: string) => {
      const field = page.locator(`[data-testid="${testId}"]:visible`);
      if ((await field.count()) !== 1) {
        return "";
      }
      return field.innerText({ timeout: 1_000 }).catch(() => "");
    };
    const history = page.locator(
      '[data-testid="investor-activity-log"]:visible',
    );
    const activities: Array<{ date: string; label: string }> = [];
    if ((await history.count()) === 1) {
      const labels = history.getByTestId("investor-activity-log.label");
      for (let index = 0; index < (await labels.count()); index += 1) {
        const label = labels.nth(index);
        const date = label
          .locator("xpath=..")
          .getByTestId("investor-activity-log.date");
        activities.push({
          label: await label.innerText({ timeout: 1_000 }).catch(() => ""),
          date:
            (await date.count()) === 1
              ? await date.innerText({ timeout: 1_000 }).catch(() => "")
              : "",
        });
      }
    }
    const title = await visibleText("invest-deal-card.title");
    const commitment = await visibleText(
      "invest-deal-card.commitment-amount-fixed",
    );
    const funded = await visibleText("amount-funded-value.currently-funded");
    const reported = SydecarReportedDetailSchema.safeParse({
      title,
      commitment,
      funded,
      activities,
    });
    if (reported.success) {
      return reported.data;
    }
    const undated = SydecarUndatedDetailSchema.safeParse({
      title,
      commitment,
      funded: funded === "" ? null : funded,
      activities,
    });
    const alternateLayout = await page
      .getByTestId("investment-docs-heading")
      .isVisible()
      .catch(() => false);
    if (undated.success && alternateLayout) {
      undatedStablePasses += 1;
      if (undatedStablePasses >= 12) {
        return undated.data;
      }
    } else {
      undatedStablePasses = 0;
    }
    await sleep(250);
  }
  throw new AgentFailure("page_not_supported");
}

async function captureSydecar(
  page: Page,
  asOfDate: string,
  onStage: SydecarCaptureStageObserver = () => undefined,
) {
  onStage("table");
  const tableReady = await page
    .locator('[data-testid="investments-table"]:visible')
    .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!tableReady) {
    await page.bringToFront();
    throw new AgentFailure("provider_sign_in_required");
  }
  onStage("initial_list");
  const initial = await stableSydecarList(page);
  const captured: CaptureRow[] = [];
  const providerIds = new Set<string>();

  for (let index = 0; index < initial.length; index += 1) {
    const listRow = initial[index];
    if (listRow === undefined) {
      throw new AgentFailure("incomplete_snapshot");
    }
    onStage("amounts");
    const commitment = parseUsdMinor(listRow.commitment);
    const funded = parseUsdMinor(listRow.funded);
    const managementFeePpm = parsePercentagePpm(listRow.managementFee);
    const carryPpm = parsePercentagePpm(listRow.carry);
    if (funded === 0n) {
      continue;
    }
    onStage("status");
    if (
      commitment < funded ||
      !["closed", "participating in", "participating"].includes(listRow.status)
    ) {
      throw new AgentFailure("page_not_supported");
    }

    onStage("row_reconcile");
    const rows = page
      .locator('[data-testid="investments-table"]:visible')
      .locator('tbody tr[data-testid="investment-row"]');
    if ((await rows.count()) !== initial.length) {
      throw new AgentFailure("incomplete_snapshot");
    }
    const currentListRow = await readSydecarListRow(rows.nth(index));
    if (!sydecarListRowsMatch(listRow, currentListRow)) {
      throw new AgentFailure("incomplete_snapshot");
    }
    onStage("row_open");
    await openSydecarRow(rows.nth(index));
    await page.waitForURL(
      (url) =>
        url.origin === PROVIDERS.sydecar.origin &&
        /^\/investments\/[A-Za-z0-9_-]{8,128}$/u.test(url.pathname),
      { timeout: PAGE_TIMEOUT_MS },
    );
    const providerId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    if (providerIds.has(providerId)) {
      throw new AgentFailure("identity_ambiguous");
    }
    providerIds.add(providerId);
    onStage("detail");
    const detail = await readSydecarDetail(page);
    onStage("detail_read");
    const detailCommitment = parseUsdMinor(detail.commitment);
    onStage("detail_commitment");
    const detailFunded =
      detail.funded === null ? funded : parseUsdMinor(detail.funded);
    onStage("detail_funded");
    onStage("detail_reconcile");
    if (detailCommitment !== commitment || detailFunded !== funded) {
      throw new AgentFailure("incomplete_snapshot");
    }
    onStage("activity");
    const initialActivity = detail.activities.find(
      (activity) =>
        normalizedText(activity.label).toLowerCase() === "initial investment",
    );
    if (initialActivity === undefined && detail.funded !== null) {
      throw new AgentFailure("page_not_supported");
    }
    onStage("date");
    const investmentDate =
      initialActivity === undefined
        ? null
        : parseProviderDate(initialActivity.date);
    captured.push({
      investment: listRow.investment,
      legalPosition: requiredText(`Sydecar SPV in ${listRow.investment}`),
      positionType: "SPV",
      heldThrough: listRow.heldThrough,
      status: "Live",
      investmentDate,
      asOfDate,
      investedMinor: funded,
      committedMinor: commitment,
      currentValueMinor: null,
      realizedValueMinor: 0n,
      instrument: "Sydecar SPV interest",
      managementFeePpm,
      carryPpm,
      identityKey: providerId,
    });
    onStage("return_list");
    await page.goto(PROVIDERS.sydecar.portfolioUrl, {
      timeout: PAGE_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="investments-table"]:visible')
      .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  }

  onStage("final_list");
  const finalRows = await stableSydecarList(page);
  if (
    finalRows.length !== initial.length ||
    finalRows.some(
      (row, index) =>
        initial[index] === undefined ||
        !sydecarListRowsMatch(initial[index], row),
    )
  ) {
    throw new AgentFailure("incomplete_snapshot");
  }
  onStage("csv");
  return rowsToCsv("sydecar", captured);
}

async function uploadCompletion(
  authorization: MacAgentAuthorization,
  provider: ProviderPortfolioAgentProvider,
  run: NonNullable<ProviderPortfolioAgentLease["run"]>,
  asOfDate: string,
  bytes: Uint8Array,
): Promise<void> {
  const body = new FormData();
  body.append(
    "file",
    new Blob([Uint8Array.from(bytes)], { type: "text/csv" }),
    `keel-${provider}-capture-${asOfDate}.csv`,
  );
  const result = await macAgentApi(
    authorization,
    agentPath(
      provider,
      `/mac-agent/runs/${encodeURIComponent(run.id)}/complete`,
    ),
    {
      method: "POST",
      headers: { "X-Keel-Agent-Lease": run.leaseToken },
      body,
    },
  );
  if (result.status !== 200) {
    const serverError = z
      .object({
        error: z.string(),
        reason: z
          .enum([
            "canonical_scope",
            "document_store",
            "review_staging",
            "validation",
            "unexpected",
          ])
          .optional(),
      })
      .safeParse(result.body);
    const category = serverError.success
      ? (serverError.data.reason ?? "rejected")
      : "rejected";
    console.error(
      JSON.stringify({
        category,
        event: "provider_portfolio_upload_rejected",
        provider,
        status: result.status,
      }),
    );
    throw new AgentFailure("upload_failed");
  }
  ProviderPortfolioAgentOverviewSchema.parse(result.body);
}

async function reportFailure(
  authorization: MacAgentAuthorization,
  provider: ProviderPortfolioAgentProvider,
  run: NonNullable<ProviderPortfolioAgentLease["run"]>,
  code: ProviderPortfolioAgentErrorCode,
): Promise<void> {
  await macAgentApi(
    authorization,
    agentPath(provider, `/mac-agent/runs/${encodeURIComponent(run.id)}/fail`),
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
  authorization: MacAgentAuthorization,
  provider: ProviderPortfolioAgentProvider,
  run: NonNullable<ProviderPortfolioAgentLease["run"]>,
): Promise<void> {
  let captureStage: SydecarCaptureStage | TokenfolioCaptureStage | null = null;
  let captureComplete = false;
  try {
    const page = await portfolioPage(context, provider);
    const asOfDate = new Date().toISOString().slice(0, 10);
    const bytes =
      provider === "tokenfolio"
        ? await captureTokenfolio(page, asOfDate, (stage) => {
            captureStage = stage;
          })
        : await captureSydecar(page, asOfDate, (stage) => {
            captureStage = stage;
          });
    captureComplete = true;
    await uploadCompletion(authorization, provider, run, asOfDate, bytes);
  } catch (error) {
    if (error instanceof MacAgentAccessError) {
      throw error;
    }
    const code =
      error instanceof AgentFailure ? error.code : "unexpected_failure";
    if (captureStage !== null && !captureComplete) {
      console.error(
        JSON.stringify({
          event: "provider_portfolio_capture_failed",
          provider,
          stage: captureStage,
        }),
      );
    }
    await reportFailure(authorization, provider, run, code);
    throw error instanceof AgentFailure ? error : new AgentFailure(code);
  }
}

async function pollOnce(
  context: BrowserContext,
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<boolean> {
  const authorization = readMacAgentAuthorization(keelOrigin, provider);
  const work = await lease(authorization, provider);
  if (work.run === null) {
    return false;
  }
  await executeRun(context, authorization, provider, work.run);
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
  provider: ProviderPortfolioAgentProvider;
  repositoryRoot: string;
  scriptPath: string;
};

function buildLaunchAgentPlist(options: LaunchAgentPlistOptions): string {
  const paths = providerPaths(options.provider, options.keelOrigin);
  const arguments_ = [
    options.nodeExecutable,
    options.pnpmCli,
    "exec",
    "tsx",
    options.scriptPath,
    "once",
    "--provider",
    options.provider,
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
    <string>${xml(path.join(options.logDirectory, `${options.provider}-agent-${paths.instanceId}.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(options.logDirectory, `${options.provider}-agent-${paths.instanceId}.error.log`))}</string>
  </dict>
</plist>
`;
}

async function installLaunchAgent(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("The background agent installer currently supports macOS.");
  }
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined || !(await fileExists(pnpmCli))) {
    throw new Error(
      "Run setup through pnpm so Keel can install the background agent.",
    );
  }
  const paths = providerPaths(provider, keelOrigin);
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  await mkdir(path.dirname(paths.launchAgentPath), { recursive: true });
  const logDirectory = agentLogDirectory({ platform: "darwin" });
  await mkdir(logDirectory, { mode: 0o700, recursive: true });
  const plist = buildLaunchAgentPlist({
    keelOrigin,
    logDirectory,
    nodeExecutable: process.execPath,
    pnpmCli,
    provider,
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
    paths.legacyLaunchAgentPath,
    keelOrigin,
  );
}

async function installLinuxService(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<string> {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  if (!(await fileExists(tsxCli))) {
    throw new Error(
      "Run make bootstrap so Keel can install the background agent.",
    );
  }
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  const paths = providerPaths(provider, keelOrigin, "linux");
  const chromePath = process.env.KEEL_CHROME_PATH?.trim();
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const xdgStateHome = process.env.XDG_STATE_HOME?.trim();
  return installSystemdAgentService({
    appDirectory: paths.appDirectory,
    ...(chromePath ? { chromePath } : {}),
    instanceId: paths.instanceId,
    keelOrigin,
    label: PROVIDERS[provider].label,
    nodeExecutable: process.execPath,
    platform: "linux",
    providerArgument: provider,
    repositoryRoot,
    scriptPath,
    target: provider,
    tsxCli,
    ...(xdgConfigHome ? { xdgConfigHome } : {}),
    ...(xdgStateHome ? { xdgStateHome } : {}),
  });
}

async function installBackgroundAgent(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<string | null> {
  if (process.platform === "darwin") {
    await installLaunchAgent(keelOrigin, provider);
    return null;
  }
  if (process.platform === "linux") {
    return installLinuxService(keelOrigin, provider);
  }
  throw new Error("Keel portfolio agents support macOS and Linux only.");
}

async function setup(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  if (process.platform === "linux") {
    validateLinuxSystemdUser();
    await validateProviderBrowserRuntime();
  }
  await completeProviderSignIn(provider, keelOrigin);
  const context = await connectContext(provider, keelOrigin);
  const portfolio = await portfolioPage(context, provider);
  await portfolio.bringToFront();
  console.info(
    `Checking the ${PROVIDERS[provider].label} session from the first Chrome window.`,
  );

  const keel = await keelPage(context, keelOrigin);
  await keel.bringToFront();
  console.info("Checking the Keel session from the first Chrome window.");
  await validateSetupSessions(portfolio, keel, keelOrigin, provider);
  const authorization = await authorize(keel, provider);
  storeMacAgentAuthorization(keelOrigin, authorization);
  const linuxUnit = await installBackgroundAgent(keelOrigin, provider);
  if (linuxUnit === null) {
    console.info(
      `${PROVIDERS[provider].label} updates are ready for ${keelOrigin.origin}. The credential is in macOS Keychain, and Keel will check once daily without another Keel sign-in. Run make provider-agent-run PROVIDER=${provider} KEEL_URL=${keelOrigin.origin} for an immediate update.`,
    );
  } else {
    console.info(
      `${PROVIDERS[provider].label} updates are ready for ${keelOrigin.origin}. The credential is stored for this Linux user, and ${linuxUnit} will stay available for reconnects and check for updates once daily. Run make provider-agent-run PROVIDER=${provider} KEEL_URL=${keelOrigin.origin} for an immediate update.`,
    );
  }
}

async function runLocally(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  const context = await connectContext(provider, keelOrigin);
  const authorization = readMacAgentAuthorization(keelOrigin, provider);
  const requested = await requestRun(authorization, provider);
  if (requested.status === "running") {
    console.info(`${PROVIDERS[provider].label} update is already in progress.`);
    return;
  }
  const work = await lease(authorization, provider);
  if (work.run === null) {
    console.info(
      `${PROVIDERS[provider].label} update is queued for another agent check.`,
    );
    return;
  }
  await executeRun(context, authorization, provider, work.run);
  console.info(
    `${PROVIDERS[provider].label} update is in Keel and ready for review.`,
  );
}

async function handleManagedReconnect(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
  authorization: MacAgentAuthorization,
  session: NonNullable<
    Awaited<ReturnType<typeof leaseProviderBrowserSession>>["session"]
  >,
): Promise<boolean> {
  await closeControlledChrome(provider, keelOrigin);
  const paths = providerPaths(provider, keelOrigin, "linux");
  const config = PROVIDERS[provider];
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
        pageAtOrigin(context, config.origin) ?? context.pages()[0] ?? null;
      return page === null ? false : providerPageReady(page, provider);
    },
    label: config.label,
    lease: session,
    profileDirectory: paths.profileDirectory,
    provider,
    startUrl: config.portfolioUrl,
  });
  if (result === "connected") {
    let updateAuthorization = authorization;
    try {
      const replacement = await rotateProviderAgentAuthorization(
        authorization,
        provider,
      );
      storeMacAgentAuthorization(keelOrigin, replacement);
      updateAuthorization = replacement;
    } catch {
      console.error(
        JSON.stringify({
          event: "provider_portfolio_agent_rotation_deferred",
          provider,
        }),
      );
    }
    await requestRun(updateAuthorization, provider).catch(() => undefined);
    return true;
  }
  return false;
}

async function serve(
  command: "once" | "serve",
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  if (command === "once") {
    const context = await connectContext(provider, keelOrigin);
    await pollOnce(context, keelOrigin, provider);
    return;
  }
  let context: BrowserContext | null = null;
  let nextUpdateCheckAt = 0;
  while (true) {
    try {
      const authorization = readMacAgentAuthorization(keelOrigin, provider);
      const reconnect = await leaseProviderBrowserSession(
        authorization,
        provider,
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
            provider,
            authorization,
            reconnect.session,
          )
        ) {
          nextUpdateCheckAt = 0;
        }
      } else if (Date.now() >= nextUpdateCheckAt) {
        if (context?.browser()?.isConnected() !== true) {
          context = await connectContext(provider, keelOrigin);
        }
        await pollOnce(context, keelOrigin, provider);
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
        JSON.stringify({
          event: "provider_portfolio_agent_poll_failed",
          provider,
          code,
        }),
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
    await setup(options.keelOrigin, options.provider);
    return;
  }
  if (options.command === "run") {
    await runLocally(options.keelOrigin, options.provider);
    return;
  }
  await serve(options.command, options.keelOrigin, options.provider);
}

export const __providerPortfolioMacAgentTest = {
  buildLaunchAgentPlist,
  captureSydecar,
  captureTokenfolio,
  chromeProcessIdsForProfile,
  formatUsdMinor,
  formatPercentagePpm,
  manualSetupChromeArguments,
  openSydecarRow,
  parseOptions,
  parseProviderDate,
  parsePercentagePpm,
  parseUsdMinor,
  providerPaths,
  rowsToCsv,
  tokenfolioActiveHoldingStatus,
  tokenfolioTabCount,
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entrypoint)).href
) {
  void main().then(
    () => process.exit(0),
    (error: unknown) => {
      const code =
        error instanceof MacAgentAccessError
          ? "mac_access_required"
          : error instanceof AgentFailure
            ? error.code
            : "unexpected_failure";
      console.error(
        JSON.stringify({ event: "provider_portfolio_agent_failed", code }),
      );
      process.exit(1);
    },
  );
}
