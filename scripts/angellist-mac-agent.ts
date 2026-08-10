import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MAX_ANGELLIST_CSV_BYTES } from "../packages/connectors/src/index";
import {
  AngelListMacAgentLeaseSchema,
  AngelListMacAgentOverviewSchema,
  type AngelListMacAgentErrorCode,
  type AngelListMacAgentLease,
} from "../packages/domain/src/index";
import {
  chromium,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";
import { z } from "zod";

const ANGELLIST_ORIGIN = "https://venture.angellist.com";
const APP_DIRECTORY = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Keel",
  "AngelList Agent",
);
const PROFILE_DIRECTORY = path.join(APP_DIRECTORY, "Chrome");
const DEVTOOLS_ACTIVE_PORT = path.join(PROFILE_DIRECTORY, "DevToolsActivePort");
const LAUNCH_AGENT_LABEL = "com.keel.angellist-agent";
const LAUNCH_AGENT_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${LAUNCH_AGENT_LABEL}.plist`,
);
const LOG_DIRECTORY = path.join(os.homedir(), "Library", "Logs", "Keel");
const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SETUP_TIMEOUT_MS = 30 * 60 * 1_000;
const POLL_INTERVAL_MS = 30 * 1_000;

type Command = "once" | "serve" | "setup";

class AgentFailure extends Error {
  public constructor(public readonly code: AngelListMacAgentErrorCode) {
    super(code);
    this.name = "AgentFailure";
  }
}

const CliOptionsSchema = z
  .object({
    command: z.enum(["once", "serve", "setup"]),
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
    throw new Error(
      "Pass --keel-url with the Keel preview or production origin.",
    );
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

async function activeDevToolsPort(): Promise<number | null> {
  try {
    const [line = ""] = (await readFile(DEVTOOLS_ACTIVE_PORT, "utf8")).split(
      /\r?\n/u,
    );
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

async function ensureChrome(): Promise<number> {
  await mkdir(PROFILE_DIRECTORY, { mode: 0o700, recursive: true });
  await chmod(APP_DIRECTORY, 0o700);
  await chmod(PROFILE_DIRECTORY, 0o700);
  const active = await activeDevToolsPort();
  if (active !== null) {
    return active;
  }
  await rm(DEVTOOLS_ACTIVE_PORT, { force: true });
  if (!(await fileExists(CHROME_PATH))) {
    throw new Error("Google Chrome is required in /Applications.");
  }

  const chrome = spawn(
    CHROME_PATH,
    [
      `--user-data-dir=${PROFILE_DIRECTORY}`,
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
    const port = await activeDevToolsPort();
    if (port !== null) {
      return port;
    }
    await sleep(250);
  }
  throw new Error("Keel could not start the dedicated Chrome profile.");
}

async function connectContext(): Promise<BrowserContext> {
  const port = await ensureChrome();
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${port.toString()}`,
  );
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

async function angelListPage(context: BrowserContext): Promise<Page> {
  const page =
    pageAtOrigin(context, ANGELLIST_ORIGIN) ?? (await context.newPage());
  await page.goto(ANGELLIST_ORIGIN, {
    timeout: 30_000,
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

async function waitForAngelListSignIn(page: Page): Promise<void> {
  await page
    .getByRole("button", { exact: true, name: "Export CSV" })
    .waitFor({ state: "visible", timeout: SETUP_TIMEOUT_MS });
}

type PageApiResult = {
  body: unknown;
  status: number;
};

async function pageApi(
  page: Page,
  pathName: string,
  method: "POST" | "PUT" = "POST",
  body?: unknown,
  leaseToken?: string,
): Promise<PageApiResult> {
  return page.evaluate(
    async ({ apiPath, apiMethod, apiBody, token }) => {
      const request: RequestInit = {
        method: apiMethod,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(apiBody === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(token === undefined ? {} : { "X-Keel-Agent-Lease": token }),
        },
      };
      if (apiBody !== undefined) {
        request.body = JSON.stringify(apiBody);
      }
      const response = await fetch(apiPath, request);
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    {
      apiPath: pathName,
      apiMethod: method,
      apiBody: body,
      token: leaseToken,
    },
  );
}

async function register(page: Page): Promise<void> {
  const response = await pageApi(
    page,
    "/api/automation/angellist/mac-agent/register",
  );
  if (response.status !== 200) {
    throw new AgentFailure("keel_sign_in_required");
  }
  AngelListMacAgentOverviewSchema.parse(response.body);
}

async function lease(page: Page): Promise<AngelListMacAgentLease> {
  const response = await pageApi(
    page,
    "/api/automation/angellist/mac-agent/lease",
  );
  if (response.status !== 200) {
    throw new AgentFailure("keel_sign_in_required");
  }
  return AngelListMacAgentLeaseSchema.parse(response.body);
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

function base64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function uploadCompletion(
  page: Page,
  run: NonNullable<AngelListMacAgentLease["run"]>,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  const result = await page.evaluate(
    async ({ runId, token, fileName, contents }) => {
      const binary = atob(contents);
      const fileBytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        fileBytes[index] = binary.charCodeAt(index);
      }
      const body = new FormData();
      body.append(
        "file",
        new File([fileBytes], fileName, { type: "text/csv" }),
      );
      const response = await fetch(
        `/api/automation/angellist/mac-agent/runs/${encodeURIComponent(runId)}/complete`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "X-Keel-Agent-Lease": token,
          },
          body,
        },
      );
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    },
    {
      runId: run.id,
      token: run.leaseToken,
      fileName: filename,
      contents: base64(bytes),
    },
  );
  if (result.status !== 200) {
    throw new AgentFailure(
      result.status === 401 || result.status === 403
        ? "keel_sign_in_required"
        : "upload_failed",
    );
  }
  AngelListMacAgentOverviewSchema.parse(result.body);
}

async function reportFailure(
  page: Page,
  run: NonNullable<AngelListMacAgentLease["run"]>,
  code: AngelListMacAgentErrorCode,
): Promise<void> {
  await pageApi(
    page,
    `/api/automation/angellist/mac-agent/runs/${encodeURIComponent(run.id)}/fail`,
    "POST",
    { errorCode: code },
    run.leaseToken,
  ).catch(() => undefined);
}

async function executeRun(
  context: BrowserContext,
  page: Page,
  run: NonNullable<AngelListMacAgentLease["run"]>,
): Promise<void> {
  let download: Download | null = null;
  try {
    const target = await angelListPage(context);
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
    const downloadPromise = target.waitForEvent("download", {
      timeout: 60_000,
    });
    await exportButton.click({ timeout: 15_000 });
    download = await downloadPromise;
    const filename = validateFilename(download.suggestedFilename());
    const bytes = await readDownload(download);
    await uploadCompletion(page, run, filename, bytes);
    await download.delete().catch(() => undefined);
  } catch (error) {
    await download?.delete().catch(() => undefined);
    const code =
      error instanceof AgentFailure ? error.code : "unexpected_failure";
    await reportFailure(page, run, code);
    throw error instanceof AgentFailure ? error : new AgentFailure(code);
  }
}

async function pollOnce(
  context: BrowserContext,
  origin: URL,
): Promise<boolean> {
  const page = await keelPage(context, origin);
  await register(page);
  const work = await lease(page);
  if (work.run === null) {
    return false;
  }
  await executeRun(context, page, work.run);
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
  await mkdir(path.dirname(LAUNCH_AGENT_PATH), { recursive: true });
  await mkdir(LOG_DIRECTORY, { mode: 0o700, recursive: true });
  const arguments_ = [
    process.execPath,
    pnpmCli,
    "exec",
    "tsx",
    scriptPath,
    "serve",
    "--keel-url",
    keelOrigin.origin,
  ];
  const argumentXml = arguments_
    .map((argument) => `      <string>${xml(argument)}</string>`)
    .join("\n");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argumentXml}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(repositoryRoot)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${xml(path.join(LOG_DIRECTORY, "angellist-agent.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(LOG_DIRECTORY, "angellist-agent.error.log"))}</string>
  </dict>
</plist>
`;
  await writeFile(LAUNCH_AGENT_PATH, plist, { mode: 0o600 });
  await chmod(LAUNCH_AGENT_PATH, 0o600);

  const getuid = process.getuid;
  if (getuid === undefined) {
    throw new Error("macOS user identity is unavailable.");
  }
  const domain = `gui/${getuid().toString()}`;
  spawnSync("launchctl", ["bootout", domain, LAUNCH_AGENT_PATH], {
    stdio: "ignore",
  });
  const bootstrap = spawnSync(
    "launchctl",
    ["bootstrap", domain, LAUNCH_AGENT_PATH],
    { encoding: "utf8" },
  );
  if (bootstrap.status !== 0) {
    throw new Error(
      bootstrap.stderr.trim() ||
        "macOS could not install the background agent.",
    );
  }
}

async function setup(keelOrigin: URL): Promise<void> {
  const context = await connectContext();
  const keel = await keelPage(context, keelOrigin);
  await keel.bringToFront();
  console.info(
    "Finish signing in to Keel in the dedicated Chrome window. Setup will continue automatically.",
  );
  await waitForKeelSignIn(keel, keelOrigin);

  const angellist = await angelListPage(context);
  await angellist.bringToFront();
  console.info(
    "Finish signing in to AngelList, including 2FA if requested. Setup will continue when Export CSV is visible.",
  );
  await waitForAngelListSignIn(angellist);
  await register(keel);
  await installLaunchAgent(keelOrigin);
  console.info(
    "AngelList updates are ready. Keep the dedicated Chrome window available; you can now use Run now from your phone.",
  );
}

async function serve(
  command: "once" | "serve",
  keelOrigin: URL,
): Promise<void> {
  if (command === "once") {
    const context = await connectContext();
    await pollOnce(context, keelOrigin);
    return;
  }
  let context: BrowserContext | null = null;
  while (true) {
    try {
      if (context?.browser()?.isConnected() !== true) {
        context = await connectContext();
      }
      await pollOnce(context, keelOrigin);
    } catch (error) {
      const code =
        error instanceof AgentFailure ? error.code : "unexpected_failure";
      console.error(
        JSON.stringify({ event: "angellist_agent_poll_failed", code }),
      );
      if (context?.browser()?.isConnected() !== true) {
        context = null;
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === "setup") {
    await setup(options.keelOrigin);
    return;
  }
  await serve(options.command, options.keelOrigin);
}

export const __angellistMacAgentTest = {
  parseOptions,
  readDownload,
  validateFilename,
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entrypoint)).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "AngelList Mac setup could not complete.",
    );
    process.exitCode = 1;
  });
}
