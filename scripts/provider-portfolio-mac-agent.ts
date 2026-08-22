import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES,
  MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS,
  PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS,
  PROVIDER_HOLDINGS_TEMPLATE_CSV_PREAMBLES,
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
  chromium,
  type Browser,
  type BrowserContext,
  type ConnectOverCDPOptions,
  type Page,
} from "@playwright/test";
import { z } from "zod";

const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SETUP_TIMEOUT_MS = 30 * 60 * 1_000;
const DAILY_CHECK_INTERVAL_SECONDS = 24 * 60 * 60;
const PAGE_TIMEOUT_MS = 45_000;
const LOG_DIRECTORY = path.join(os.homedir(), "Library", "Logs", "Keel");

type Command = "once" | "run" | "setup";

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
    command: z.enum(["once", "run", "setup"]),
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

const SydecarDetailSchema = z
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

type CaptureRow = {
  investment: string;
  legalPosition: string;
  positionType: "SPV";
  heldThrough: string;
  status: "Live";
  investmentDate: string;
  asOfDate: string;
  investedMinor: bigint;
  committedMinor: bigint;
  currentValueMinor: bigint | null;
  realizedValueMinor: bigint;
  instrument: string;
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
    throw new Error(
      "Pass --keel-url with the Keel preview or production origin.",
    );
  }
  return CliOptionsSchema.parse({ command, provider, keelOrigin });
}

function providerPaths(provider: ProviderPortfolioAgentProvider) {
  const config = PROVIDERS[provider];
  const appDirectory = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Keel",
    config.profileName,
  );
  const profileDirectory = path.join(appDirectory, "Chrome");
  const launchAgentLabel = `com.keel.${provider}-agent`;
  return {
    appDirectory,
    profileDirectory,
    devToolsActivePort: path.join(profileDirectory, "DevToolsActivePort"),
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
): Promise<number | null> {
  try {
    const [line = ""] = (
      await readFile(providerPaths(provider).devToolsActivePort, "utf8")
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
): Promise<number> {
  const paths = providerPaths(provider);
  await mkdir(paths.profileDirectory, { mode: 0o700, recursive: true });
  await chmod(paths.appDirectory, 0o700);
  await chmod(paths.profileDirectory, 0o700);
  const active = await activeDevToolsPort(provider);
  if (active !== null) {
    return active;
  }
  await rm(paths.devToolsActivePort, { force: true });
  if (!(await fileExists(CHROME_PATH))) {
    throw new Error("Google Chrome is required in /Applications.");
  }

  const chrome = spawn(
    CHROME_PATH,
    [
      `--user-data-dir=${paths.profileDirectory}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { detached: true, stdio: "ignore" },
  );
  chrome.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const port = await activeDevToolsPort(provider);
    if (port !== null) {
      return port;
    }
    await sleep(250);
  }
  throw new Error("Keel could not start the dedicated Chrome profile.");
}

type ConnectOverCDP = (
  endpointUrl: string,
  options?: ConnectOverCDPOptions,
) => Promise<Browser>;

async function connectContext(
  provider: ProviderPortfolioAgentProvider,
  getPort: (
    provider: ProviderPortfolioAgentProvider,
  ) => Promise<number> = ensureChrome,
  connectOverCDP: ConnectOverCDP = (endpointUrl, options) =>
    chromium.connectOverCDP(endpointUrl, options),
): Promise<BrowserContext> {
  const port = await getPort(provider);
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

async function waitForProviderSignIn(
  page: Page,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await providerPageReady(page, provider)) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(
    `${PROVIDERS[provider].label} sign-in was not completed within 30 minutes.`,
  );
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
  const lines = rows.map((row) =>
    [
      row.investment,
      row.legalPosition,
      row.positionType,
      row.heldThrough,
      row.status,
      row.investmentDate,
      row.asOfDate,
      formatUsdMinor(row.investedMinor),
      formatUsdMinor(row.committedMinor),
      row.currentValueMinor === null
        ? ""
        : formatUsdMinor(row.currentValueMinor),
      formatUsdMinor(row.realizedValueMinor),
      row.instrument,
    ]
      .map(csvCell)
      .join(","),
  );
  const document = `${PROVIDER_HOLDINGS_TEMPLATE_CSV_PREAMBLES[provider]}\n${PROVIDER_HOLDINGS_TEMPLATE_CSV_HEADERS.join(",")}\n${lines.join("\n")}\n`;
  const bytes = new TextEncoder().encode(document);
  if (bytes.byteLength > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_BYTES) {
    throw new AgentFailure("incomplete_snapshot");
  }
  return bytes;
}

function tokenfolioTabCount(value: string): number {
  const match = /(\d[\d,]*)\s*$/u.exec(normalizedText(value));
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

async function readTokenfolioDetail(page: Page) {
  const raw = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null) {
      return null;
    }
    const exactText = (selector: string, label: string) =>
      [...dialog.querySelectorAll<HTMLElement>(selector)].find(
        (element) => element.textContent?.trim() === label,
      );
    const detailValue = (label: string) =>
      exactText("dt", label)?.nextElementSibling?.textContent?.trim() ?? "";
    const summaryValue = (label: string) => {
      const labelElement = exactText(
        ".text-xs.text-gray-400.mb-1.truncate",
        label,
      );
      return labelElement?.nextElementSibling?.textContent?.trim() ?? "";
    };
    return {
      company:
        dialog.querySelector<HTMLElement>("h1, h2, h3")?.textContent?.trim() ??
        "",
      entity: detailValue("Entity"),
      committedOn: detailValue("Committed On"),
      committed: summaryValue("Committed"),
      currentValue: summaryValue("Current Value"),
    };
  });
  const parsed = TokenfolioDetailSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentFailure("page_not_supported");
  }
  return parsed.data;
}

async function captureTokenfolio(page: Page, asOfDate: string) {
  const activeTab = page.getByRole("tab", { name: /^Active Holdings/u });
  const tabReady = await activeTab
    .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!tabReady) {
    await page.bringToFront();
    throw new AgentFailure("provider_sign_in_required");
  }
  await activeTab.click();
  const expectedCount = tokenfolioTabCount(await activeTab.innerText());
  const rowSelector = 'div[role="button"].relative.cursor-pointer';
  const rows = page.locator(rowSelector);
  await rows.first().waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  if ((await rows.count()) !== expectedCount) {
    throw new AgentFailure("incomplete_snapshot");
  }

  const captured: CaptureRow[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const row = page.locator(rowSelector).nth(index);
    const cells = row.locator(":scope > div").first().locator(":scope > div");
    if ((await cells.count()) !== 7) {
      throw new AgentFailure("page_not_supported");
    }
    const company = requiredText(
      await cells.nth(0).locator("span").last().innerText(),
    );
    const listCommitted = parseUsdMinor(
      await cells.nth(3).locator(":scope > span").last().innerText(),
    );
    const listCurrentText = await cells
      .nth(5)
      .locator(":scope > span")
      .last()
      .evaluate((element) =>
        [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim(),
      );
    const listCurrent = parseOptionalUsdMinor(listCurrentText);
    const status = normalizedText(
      await cells.nth(6).locator(":scope > span").last().innerText(),
    ).toLowerCase();
    if (status !== "active") {
      throw new AgentFailure("page_not_supported");
    }

    await row.click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
    const detail = await readTokenfolioDetail(page);
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
    const heldThrough = requiredText(detail.entity);
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
      identityKey: [company, heldThrough, investmentDate]
        .map((part) => normalizedText(part).toLowerCase())
        .join("\u0000"),
    });
    const close = page.getByRole("button", { name: "Close drawer" });
    await close.click();
    await dialog.waitFor({ state: "hidden", timeout: PAGE_TIMEOUT_MS });
  }

  if (
    tokenfolioTabCount(await activeTab.innerText()) !== expectedCount ||
    (await page.locator(rowSelector).count()) !== expectedCount
  ) {
    throw new AgentFailure("incomplete_snapshot");
  }
  return rowsToCsv("tokenfolio", captured);
}

type SydecarListRow = {
  investment: string;
  heldThrough: string;
  status: string;
  commitment: string;
  funded: string;
};

async function readSydecarList(page: Page): Promise<SydecarListRow[]> {
  const table = page.locator('[data-testid="investments-table"]:visible');
  const rows = table.locator('tbody tr[data-testid="investment-row"]');
  const count = await rows.count();
  if (count < 1 || count > MAX_PROVIDER_HOLDINGS_TEMPLATE_CSV_ROWS) {
    throw new AgentFailure("incomplete_snapshot");
  }
  const result: SydecarListRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const cells = row.locator(":scope > td");
    if ((await cells.count()) !== 10) {
      throw new AgentFailure("page_not_supported");
    }
    result.push({
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
    });
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
  const raw = await page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 || box.height > 0;
    };
    const text = (testId: string) =>
      [...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)]
        .find(visible)
        ?.textContent?.trim() ?? "";
    const history = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="investor-activity-log"]',
      ),
    ].find(visible);
    const activities = history
      ? [
          ...history.querySelectorAll<HTMLElement>(
            '[data-testid="investor-activity-log.label"]',
          ),
        ].map((label) => ({
          label: label.textContent?.trim() ?? "",
          date:
            label.parentElement
              ?.querySelector<HTMLElement>(
                '[data-testid="investor-activity-log.date"]',
              )
              ?.textContent?.trim() ?? "",
        }))
      : [];
    return {
      title: text("invest-deal-card.title"),
      commitment: text("invest-deal-card.commitment-amount-fixed"),
      funded: text("amount-funded-value.currently-funded"),
      activities,
    };
  });
  const parsed = SydecarDetailSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentFailure("page_not_supported");
  }
  return parsed.data;
}

async function captureSydecar(page: Page, asOfDate: string) {
  const tableReady = await page
    .locator('[data-testid="investments-table"]:visible')
    .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!tableReady) {
    await page.bringToFront();
    throw new AgentFailure("provider_sign_in_required");
  }
  const initial = await stableSydecarList(page);
  const captured: CaptureRow[] = [];
  const providerIds = new Set<string>();

  for (let index = 0; index < initial.length; index += 1) {
    const listRow = initial[index];
    if (listRow === undefined) {
      throw new AgentFailure("incomplete_snapshot");
    }
    const commitment = parseUsdMinor(listRow.commitment);
    const funded = parseUsdMinor(listRow.funded);
    if (funded === 0n) {
      continue;
    }
    if (
      commitment < funded ||
      !["closed", "participating in", "participating"].includes(listRow.status)
    ) {
      throw new AgentFailure("page_not_supported");
    }

    const rows = page
      .locator('[data-testid="investments-table"]:visible')
      .locator('tbody tr[data-testid="investment-row"]');
    if ((await rows.count()) !== initial.length) {
      throw new AgentFailure("incomplete_snapshot");
    }
    await rows.nth(index).click();
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
    const detail = await readSydecarDetail(page);
    const detailCommitment = parseUsdMinor(detail.commitment);
    const detailFunded = parseUsdMinor(detail.funded);
    if (
      normalizedText(detail.title).toLowerCase() !==
        listRow.investment.toLowerCase() ||
      detailCommitment !== commitment ||
      detailFunded !== funded
    ) {
      throw new AgentFailure("incomplete_snapshot");
    }
    const initialActivity = detail.activities.find(
      (activity) =>
        normalizedText(activity.label).toLowerCase() === "initial investment",
    );
    if (initialActivity === undefined) {
      throw new AgentFailure("page_not_supported");
    }
    const investmentDate = parseProviderDate(initialActivity.date);
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
      identityKey: providerId,
    });
    await page.goto(PROVIDERS.sydecar.portfolioUrl, {
      timeout: PAGE_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="investments-table"]:visible')
      .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  }

  const finalRows = await stableSydecarList(page);
  if (finalRows.length !== initial.length) {
    throw new AgentFailure("incomplete_snapshot");
  }
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
  try {
    const page = await portfolioPage(context, provider);
    const asOfDate = new Date().toISOString().slice(0, 10);
    const bytes =
      provider === "tokenfolio"
        ? await captureTokenfolio(page, asOfDate)
        : await captureSydecar(page, asOfDate);
    await uploadCompletion(authorization, provider, run, asOfDate, bytes);
  } catch (error) {
    if (error instanceof MacAgentAccessError) {
      throw error;
    }
    const code =
      error instanceof AgentFailure ? error.code : "unexpected_failure";
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
  const paths = providerPaths(options.provider);
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
    <string>${xml(path.join(options.logDirectory, `${options.provider}-agent.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(options.logDirectory, `${options.provider}-agent.error.log`))}</string>
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
  const paths = providerPaths(provider);
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  await mkdir(path.dirname(paths.launchAgentPath), { recursive: true });
  await mkdir(LOG_DIRECTORY, { mode: 0o700, recursive: true });
  const plist = buildLaunchAgentPlist({
    keelOrigin,
    logDirectory: LOG_DIRECTORY,
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
}

async function setup(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  const context = await connectContext(provider);
  const portfolio = await portfolioPage(context, provider);
  await portfolio.bringToFront();
  console.info(
    `Finish signing in to ${PROVIDERS[provider].label}, including 2FA if requested. Setup continues when the portfolio is visible.`,
  );
  await waitForProviderSignIn(portfolio, provider);

  const keel = await keelPage(context, keelOrigin);
  await keel.bringToFront();
  console.info(
    "Sign in to Keel once to approve secure access for this Mac. Daily updates will not use your Keel browser session.",
  );
  await waitForKeelSignIn(keel, keelOrigin);
  const authorization = await authorize(keel, provider);
  storeMacAgentAuthorization(keelOrigin, authorization);
  await installLaunchAgent(keelOrigin, provider);
  console.info(
    `${PROVIDERS[provider].label} updates are ready. The credential is in macOS Keychain, and Keel will check once daily without another Keel sign-in. Run make provider-agent-run PROVIDER=${provider} KEEL_URL=${keelOrigin.origin} for an immediate local update.`,
  );
}

async function runLocally(
  keelOrigin: URL,
  provider: ProviderPortfolioAgentProvider,
): Promise<void> {
  const context = await connectContext(provider);
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
  const context = await connectContext(options.provider);
  await pollOnce(context, options.keelOrigin, options.provider);
}

export const __providerPortfolioMacAgentTest = {
  buildLaunchAgentPlist,
  captureSydecar,
  captureTokenfolio,
  formatUsdMinor,
  parseOptions,
  parseProviderDate,
  parseUsdMinor,
  providerPaths,
  rowsToCsv,
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
