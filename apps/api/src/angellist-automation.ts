import {
  MAX_ANGELLIST_CSV_BYTES,
  parseAngelListInvestmentsCsv,
} from "@keel/connectors";
import { D1AlphaRepository } from "@keel/database";
import {
  AngelListAutomationOverviewSchema,
  AngelListAutomationStatusSchema,
  AngelListBrowserStorageStateSchema,
  AngelListSignInRefreshSchema,
  CloudflareLiveViewUrlSchema,
  type AngelListAutomationErrorCode,
  type AngelListAutomationOverview,
  type AngelListAutomationStatus,
  type AngelListBrowserStorageState,
  type AngelListSignInRefresh,
} from "@keel/domain";
import type {
  Browser,
  BrowserContext,
  BrowserWorker,
  Page,
} from "@cloudflare/playwright";
import { z } from "zod";

import { angelListExportDate } from "./holding-import-upload";
import type { Env } from "./types";

const ANGELLIST_ORIGIN = "https://venture.angellist.com";
const SESSION_KEY = "angellist/session/v1";
const STATUS_KEY = "angellist/status/v1";
const ACTIVE_REFRESH_KEY = "angellist/sign-in-refresh/active/v1";
const REFRESH_KEY_PREFIX = "angellist/sign-in-refresh/v1/";
const MAX_HANDOFF_INPUT_BYTES = 512;
const MAX_SESSION_BYTES = 262_144;
const MAX_MAGIC_LINK_BYTES = 8_192;
const REFRESH_BROWSER_KEEP_ALIVE_MS = 600_000;
const LIVE_VIEW_UNOPENED_TTL_MS = 300_000;
const REFRESH_RECORD_TTL_SECONDS = 900;
const TERMINAL_REFRESH_TTL_SECONDS = 300;

export class AngelListAutomationError extends Error {
  public constructor(public readonly code: AngelListAutomationErrorCode) {
    super(code);
    this.name = "AngelListAutomationError";
  }
}

const EncryptedSessionSchema = z
  .object({
    version: z.literal(1),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
    ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict();

const SignInRefreshRecordSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    subject: z.string().min(1).max(512),
    status: z.enum([
      "waiting_for_sign_in",
      "connected",
      "expired",
      "cancelled",
    ]),
    sessionId: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const waiting = value.status === "waiting_for_sign_in";
    if (waiting !== (value.sessionId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "Only active refreshes may retain a browser session ID.",
      });
    }
  });

const BrowserRunTargetSchema = z
  .object({
    id: z.string().min(1).max(512),
    type: z.string().min(1).max(64),
    url: z.string().max(8_192),
    title: z.string().max(4_096).optional(),
    description: z.string().max(4_096).optional(),
    devtoolsFrontendUrl: z.string().max(16_384).optional(),
    webSocketDebuggerUrl: z.string().max(16_384).optional(),
  })
  .strict();

const BrowserRunTargetListSchema = z.array(BrowserRunTargetSchema).max(32);

const HandoffFieldMetadataSchema = z
  .object({
    tagName: z.enum(["input", "textarea"]),
    type: z.string().max(64),
    autocomplete: z.string().max(128),
    inputMode: z.string().max(64),
    name: z.string().max(512),
    id: z.string().max(512),
    ariaLabel: z.string().max(512),
    placeholder: z.string().max(512),
  })
  .strict();

type SignInRefreshRecord = z.infer<typeof SignInRefreshRecordSchema>;

type AutomationEnv = Env & {
  ANGELLIST_ACCESS_SUBJECT?: string;
  ANGELLIST_AUTOMATION?: KVNamespace;
  ANGELLIST_AUTOMATION_ENABLED?: string;
  ANGELLIST_BROWSER?: BrowserWorker;
  ANGELLIST_SESSION_KEY?: string;
};

type BrowserLauncher = (
  worker: BrowserWorker,
  options: { keep_alive: number; recording: boolean },
) => Promise<Browser>;

type BrowserAcquirer = (
  worker: BrowserWorker,
  options: { keep_alive: number; recording: boolean },
) => Promise<{ sessionId: string }>;

// The default CDP context survives after Playwright disconnects. A temporary
// context would remove its page and leave Live View pointing at a dead target.
type BrowserConnector = (
  worker: BrowserWorker,
  options: { sessionId: string; persistent: true },
) => Promise<Browser>;

type SignInRefreshOptions = {
  acquirer?: BrowserAcquirer;
  connector?: BrowserConnector;
  now?: Date;
};

const defaultBrowserLauncher: BrowserLauncher = async (worker, options) => {
  const { launch } = await import("@cloudflare/playwright");
  return launch(worker, options);
};

const defaultBrowserAcquirer: BrowserAcquirer = async (worker, options) => {
  const { acquire } = await import("@cloudflare/playwright");
  return acquire(worker, options);
};

const defaultBrowserConnector: BrowserConnector = async (worker, options) => {
  const { connect } = await import("@cloudflare/playwright");
  return connect(worker, options);
};

function safeErrorCode(error: unknown): AngelListAutomationErrorCode {
  return error instanceof AngelListAutomationError
    ? error.code
    : "unexpected_failure";
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new AngelListAutomationError("configuration_invalid");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(`${padded}${padding}`), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    throw new AngelListAutomationError("configuration_invalid");
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function encryptionKey(secret: string | undefined): Promise<CryptoKey> {
  if (secret === undefined) {
    throw new AngelListAutomationError("configuration_invalid");
  }
  const bytes = base64UrlDecode(secret);
  if (bytes.byteLength !== 32) {
    throw new AngelListAutomationError("configuration_invalid");
  }
  return crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(bytes),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptStorageState(
  state: AngelListBrowserStorageState,
  secret: string | undefined,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedArrayBuffer(iv) },
    await encryptionKey(secret),
    ownedArrayBuffer(plaintext),
  );
  return JSON.stringify({
    version: 1,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  });
}

async function decryptStorageState(
  encrypted: string,
  secret: string | undefined,
): Promise<AngelListBrowserStorageState> {
  try {
    const envelope = EncryptedSessionSchema.parse(JSON.parse(encrypted));
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedArrayBuffer(base64UrlDecode(envelope.iv)),
      },
      await encryptionKey(secret),
      ownedArrayBuffer(base64UrlDecode(envelope.ciphertext)),
    );
    return AngelListBrowserStorageStateSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
  } catch (error) {
    if (
      error instanceof AngelListAutomationError &&
      error.code === "configuration_invalid"
    ) {
      throw error;
    }
    throw new AngelListAutomationError("session_invalid");
  }
}

function automationStore(env: AutomationEnv): KVNamespace {
  if (env.ANGELLIST_AUTOMATION === undefined) {
    throw new AngelListAutomationError("configuration_invalid");
  }
  return env.ANGELLIST_AUTOMATION;
}

function configuredSubject(env: AutomationEnv): string {
  const subject = env.ANGELLIST_ACCESS_SUBJECT?.trim();
  if (subject === undefined || subject.length === 0 || subject.length > 512) {
    throw new AngelListAutomationError("configuration_invalid");
  }
  return subject;
}

function assertConfiguredCaller(env: AutomationEnv, callerSubject: string) {
  if (configuredSubject(env) !== callerSubject) {
    throw new AngelListAutomationError("forbidden");
  }
}

function isAngelListHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "angellist.com" || normalized.endsWith(".angellist.com")
  );
}

function isAngelListCookieDomain(domain: string): boolean {
  return isAngelListHostname(domain.startsWith(".") ? domain.slice(1) : domain);
}

function filterRefreshedStorageState(
  state: Awaited<ReturnType<BrowserContext["storageState"]>>,
): AngelListBrowserStorageState {
  try {
    return AngelListBrowserStorageStateSchema.parse({
      cookies: state.cookies.filter(
        (cookie) => cookie.secure && isAngelListCookieDomain(cookie.domain),
      ),
      origins: state.origins.filter((origin) => {
        try {
          const url = new URL(origin.origin);
          return url.protocol === "https:" && isAngelListHostname(url.hostname);
        } catch {
          return false;
        }
      }),
    });
  } catch {
    throw new AngelListAutomationError("session_invalid");
  }
}

export function parseAngelListSessionPayload(
  rawBody: string,
): AngelListBrowserStorageState {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_SESSION_BYTES) {
    throw new AngelListAutomationError("session_invalid");
  }
  try {
    return AngelListBrowserStorageStateSchema.parse(JSON.parse(rawBody));
  } catch {
    throw new AngelListAutomationError("session_invalid");
  }
}

async function readBoundedUtf8Body(
  request: Request,
  maximumBytes: number,
  errorCode: AngelListAutomationErrorCode,
): Promise<string> {
  const contentLength = request.headers.get("Content-Length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    throw new AngelListAutomationError(errorCode);
  }
  if (request.body === null) {
    throw new AngelListAutomationError(errorCode);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    byteSize += chunk.value.byteLength;
    if (byteSize > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AngelListAutomationError(errorCode);
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new AngelListAutomationError(errorCode);
  }
}

export async function readAngelListSessionPayload(
  request: Request,
): Promise<AngelListBrowserStorageState> {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    throw new AngelListAutomationError("session_invalid");
  }
  try {
    return parseAngelListSessionPayload(
      await readBoundedUtf8Body(request, MAX_SESSION_BYTES, "session_invalid"),
    );
  } catch {
    throw new AngelListAutomationError("session_invalid");
  }
}

export function parseAngelListMagicLink(value: string): string {
  if (new TextEncoder().encode(value).byteLength > MAX_MAGIC_LINK_BYTES) {
    throw new AngelListAutomationError("magic_link_invalid");
  }
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !isAngelListHostname(url.hostname)
    ) {
      throw new AngelListAutomationError("magic_link_invalid");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof AngelListAutomationError) {
      throw error;
    }
    throw new AngelListAutomationError("magic_link_invalid");
  }
}

export function parseAngelListHandoffInput(value: string): string {
  const normalized = value.trim();
  const bytes = new TextEncoder().encode(normalized);
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_HANDOFF_INPUT_BYTES ||
    hasControlCharacter
  ) {
    throw new AngelListAutomationError("handoff_input_invalid");
  }
  return normalized;
}

export async function readAngelListHandoffInputPayload(
  request: Request,
): Promise<string> {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    throw new AngelListAutomationError("handoff_input_invalid");
  }
  try {
    const body: unknown = JSON.parse(
      await readBoundedUtf8Body(
        request,
        MAX_HANDOFF_INPUT_BYTES,
        "handoff_input_invalid",
      ),
    ) as unknown;
    const payload = z
      .object({ text: z.string().min(1).max(MAX_HANDOFF_INPUT_BYTES) })
      .strict()
      .parse(body);
    return parseAngelListHandoffInput(payload.text);
  } catch (error) {
    if (error instanceof AngelListAutomationError) {
      throw error;
    }
    throw new AngelListAutomationError("handoff_input_invalid");
  }
}

export async function readAngelListMagicLinkPayload(
  request: Request,
): Promise<string> {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    throw new AngelListAutomationError("magic_link_invalid");
  }
  try {
    const body: unknown = JSON.parse(
      await readBoundedUtf8Body(
        request,
        MAX_MAGIC_LINK_BYTES,
        "magic_link_invalid",
      ),
    ) as unknown;
    const payload = z
      .object({ magicLink: z.string().min(1).max(MAX_MAGIC_LINK_BYTES) })
      .strict()
      .parse(body);
    return parseAngelListMagicLink(payload.magicLink);
  } catch (error) {
    if (error instanceof AngelListAutomationError) {
      throw error;
    }
    throw new AngelListAutomationError("magic_link_invalid");
  }
}

export async function storeAngelListSession(
  env: AutomationEnv,
  callerSubject: string,
  rawState: unknown,
): Promise<void> {
  assertConfiguredCaller(env, callerSubject);
  let state: AngelListBrowserStorageState;
  try {
    state = AngelListBrowserStorageStateSchema.parse(rawState);
  } catch {
    throw new AngelListAutomationError("session_invalid");
  }
  await automationStore(env).put(
    SESSION_KEY,
    await encryptStorageState(state, env.ANGELLIST_SESSION_KEY),
  );
}

async function loadAngelListSession(
  env: AutomationEnv,
): Promise<AngelListBrowserStorageState> {
  const encrypted = await automationStore(env).get(SESSION_KEY);
  if (encrypted === null) {
    throw new AngelListAutomationError("auth_required");
  }
  const state = await decryptStorageState(encrypted, env.ANGELLIST_SESSION_KEY);
  const nowSeconds = Date.now() / 1_000;
  if (
    !state.cookies.some(
      (cookie) => cookie.expires === -1 || cookie.expires > nowSeconds,
    )
  ) {
    throw new AngelListAutomationError("auth_required");
  }
  return state;
}

async function writeStatus(
  env: AutomationEnv,
  status: AngelListAutomationStatus,
): Promise<void> {
  await automationStore(env).put(
    STATUS_KEY,
    JSON.stringify(AngelListAutomationStatusSchema.parse(status)),
  );
}

export async function getAngelListAutomationStatus(
  env: AutomationEnv,
  callerSubject: string,
): Promise<AngelListAutomationOverview> {
  assertConfiguredCaller(env, callerSubject);
  const raw = await automationStore(env).get(STATUS_KEY);
  let status: AngelListAutomationStatus;
  if (raw === null) {
    status = {
      version: 1,
      status: "never_run",
      checkedAt: null,
      importId: null,
      errorCode: null,
    };
  } else {
    try {
      status = AngelListAutomationStatusSchema.parse(JSON.parse(raw));
    } catch {
      throw new AngelListAutomationError("configuration_invalid");
    }
  }
  let signInStatus: "connected" | "needs_sign_in";
  try {
    await loadAngelListSession(env);
    signInStatus = "connected";
  } catch (error) {
    if (
      error instanceof AngelListAutomationError &&
      (error.code === "auth_required" || error.code === "session_invalid")
    ) {
      signInStatus = "needs_sign_in";
    } else {
      throw error;
    }
  }
  return AngelListAutomationOverviewSchema.parse({
    ...status,
    signInStatus,
  });
}

function refreshKey(id: string): string {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    throw new AngelListAutomationError("refresh_invalid");
  }
  return `${REFRESH_KEY_PREFIX}${parsed.data}`;
}

function browserWorker(env: AutomationEnv): BrowserWorker {
  if (env.ANGELLIST_BROWSER === undefined) {
    throw new AngelListAutomationError("configuration_invalid");
  }
  return env.ANGELLIST_BROWSER;
}

async function storeRefreshRecord(
  env: AutomationEnv,
  record: SignInRefreshRecord,
  expirationTtl: number,
): Promise<void> {
  const parsed = SignInRefreshRecordSchema.parse(record);
  await automationStore(env).put(
    refreshKey(parsed.id),
    JSON.stringify(parsed),
    {
      expirationTtl,
    },
  );
}

async function loadRefreshRecord(
  env: AutomationEnv,
  callerSubject: string,
  id: string,
): Promise<SignInRefreshRecord> {
  assertConfiguredCaller(env, callerSubject);
  const raw = await automationStore(env).get(refreshKey(id));
  if (raw === null) {
    throw new AngelListAutomationError("refresh_invalid");
  }
  try {
    const record = SignInRefreshRecordSchema.parse(JSON.parse(raw));
    if (record.subject !== callerSubject) {
      throw new AngelListAutomationError("refresh_invalid");
    }
    return record;
  } catch (error) {
    if (error instanceof AngelListAutomationError) {
      throw error;
    }
    throw new AngelListAutomationError("refresh_invalid");
  }
}

async function clearActiveRefresh(
  env: AutomationEnv,
  id: string,
): Promise<void> {
  const store = automationStore(env);
  if ((await store.get(ACTIVE_REFRESH_KEY)) === id) {
    await store.delete(ACTIVE_REFRESH_KEY);
  }
}

function publicRefresh(
  record: SignInRefreshRecord,
  liveViewUrl: string | null = null,
  liveViewExpiresAt: string | null = null,
): AngelListSignInRefresh {
  return AngelListSignInRefreshSchema.parse({
    version: 1,
    id: record.id,
    status: record.status,
    expiresAt: record.expiresAt,
    liveViewUrl,
    liveViewExpiresAt,
  });
}

function isRefreshExpired(record: SignInRefreshRecord, now: Date): boolean {
  return now.getTime() >= new Date(record.expiresAt).getTime();
}

type RawCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<void>;
};

function rawCdpSession(value: unknown): RawCdpSession {
  return value as RawCdpSession;
}

function isAngelListPage(page: Page): boolean {
  try {
    const url = new URL(page.url());
    return url.protocol === "https:" && isAngelListHostname(url.hostname);
  } catch {
    return false;
  }
}

async function browserPage(
  browser: Browser,
  createIfMissing: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  const contexts = browser.contexts();
  for (const context of contexts) {
    const page = context.pages().find(isAngelListPage);
    if (page !== undefined) {
      return { context, page };
    }
  }
  const context = contexts[0];
  if (context !== undefined) {
    const page = context.pages()[0];
    if (page !== undefined) {
      return { context, page };
    }
    if (createIfMissing) {
      return { context, page: await context.newPage() };
    }
  }
  if (!createIfMissing) {
    throw new AngelListAutomationError("browser_unavailable");
  }
  const createdContext = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  return { context: createdContext, page: await createdContext.newPage() };
}

async function ensureAngelListPage(page: Page): Promise<void> {
  if (!isAngelListPage(page)) {
    await page.goto(ANGELLIST_ORIGIN, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
  }
  if (!isAngelListPage(page)) {
    throw new AngelListAutomationError("browser_unavailable");
  }
}

async function liveViewUrl(
  worker: BrowserWorker,
  sessionId: string,
): Promise<string> {
  let response: Response;
  try {
    // Use Browser Run's session target list so the Live View URL remains valid
    // after this short-lived Playwright connection disconnects.
    response = await worker.fetch(
      `http://fake.host/v1/devtools/browser/${encodeURIComponent(sessionId)}/json`,
      { headers: { Accept: "application/json" } },
    );
  } catch {
    throw new AngelListAutomationError("browser_unavailable");
  }
  if (!response.ok) {
    throw new AngelListAutomationError("browser_unavailable");
  }
  let targets: z.infer<typeof BrowserRunTargetListSchema>;
  try {
    targets = BrowserRunTargetListSchema.parse(await response.json());
  } catch {
    throw new AngelListAutomationError("browser_unavailable");
  }
  const matchingTargets = targets.filter((target) => {
    if (target.type !== "page" || target.devtoolsFrontendUrl === undefined) {
      return false;
    }
    try {
      return new URL(target.url).origin === ANGELLIST_ORIGIN;
    } catch {
      return false;
    }
  });
  if (matchingTargets.length !== 1) {
    throw new AngelListAutomationError("browser_unavailable");
  }
  try {
    const url = new URL(matchingTargets[0]?.devtoolsFrontendUrl ?? "");
    url.searchParams.set("mode", "tab");
    return CloudflareLiveViewUrlSchema.parse(url.toString());
  } catch {
    throw new AngelListAutomationError("browser_unavailable");
  }
}

async function terminateBrowser(browser: Browser): Promise<void> {
  try {
    const session = rawCdpSession(await browser.newBrowserCDPSession());
    try {
      await session.send("Browser.close");
    } catch {
      // Browser.close normally tears down the CDP connection before replying.
    } finally {
      await session.detach().catch(() => undefined);
    }
  } catch {
    // The ten-minute Browser Run keep-alive remains the cleanup fallback.
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function connectRefreshBrowser(
  env: AutomationEnv,
  sessionId: string,
  connector: BrowserConnector,
): Promise<Browser> {
  try {
    return await connector(browserWorker(env), {
      sessionId,
      persistent: true,
    });
  } catch {
    throw new AngelListAutomationError("browser_unavailable");
  }
}

async function hasVerifiedAngelListExport(page: Page): Promise<boolean> {
  try {
    if (new URL(page.url()).origin !== ANGELLIST_ORIGIN) {
      return false;
    }
  } catch {
    return false;
  }
  return page
    .getByRole("button", { exact: true, name: "Export CSV" })
    .isVisible()
    .catch(() => false);
}

async function focusedAngelListHandoffField(page: Page) {
  const field = page.locator("input:focus, textarea:focus");
  if ((await field.count().catch(() => 0)) !== 1) {
    throw new AngelListAutomationError("handoff_input_invalid");
  }
  let metadata: z.infer<typeof HandoffFieldMetadataSchema>;
  try {
    metadata = HandoffFieldMetadataSchema.parse(
      await field.evaluate((element) => ({
        tagName: element.tagName.toLowerCase(),
        type: (element.getAttribute("type") ?? "text").toLowerCase(),
        autocomplete: (
          element.getAttribute("autocomplete") ?? ""
        ).toLowerCase(),
        inputMode: (element.getAttribute("inputmode") ?? "").toLowerCase(),
        name: element.getAttribute("name") ?? "",
        id: element.id,
        ariaLabel: element.getAttribute("aria-label") ?? "",
        placeholder: element.getAttribute("placeholder") ?? "",
      })),
    );
  } catch {
    throw new AngelListAutomationError("handoff_input_invalid");
  }
  const description = Object.values(metadata).join(" ").toLowerCase();
  const isPassword =
    metadata.type === "password" ||
    /(?:^|[^a-z])password(?:[^a-z]|$)|current-password|new-password/u.test(
      description,
    );
  const isEmail =
    metadata.type === "email" ||
    metadata.autocomplete === "email" ||
    /(?:^|[^a-z])e-?mail(?:[^a-z]|$)/u.test(description);
  const isOneTimeCode =
    metadata.autocomplete === "one-time-code" ||
    /(?:^|[^a-z0-9])(?:otp|2fa|code)(?:[^a-z0-9]|$)|one[ -]?time|two[ -]?factor|verification|security[ -]?code|auth(?:entication)?[ -]?code/u.test(
      description,
    );
  if (isPassword || (!isEmail && !isOneTimeCode)) {
    throw new AngelListAutomationError("handoff_input_invalid");
  }
  return { field, isEmail, isOneTimeCode };
}

async function completeRefresh(
  env: AutomationEnv,
  record: SignInRefreshRecord,
  state: AngelListBrowserStorageState,
): Promise<AngelListSignInRefresh> {
  await storeAngelListSession(env, record.subject, state);
  const completed = SignInRefreshRecordSchema.parse({
    ...record,
    status: "connected",
    sessionId: null,
  });
  try {
    await storeRefreshRecord(env, completed, TERMINAL_REFRESH_TTL_SECONDS);
    await clearActiveRefresh(env, record.id);
  } catch {
    // The session-key write above is the refresh commit. Bookkeeping expiry is
    // bounded and must not turn a completed replacement into a reported failure.
  }
  return publicRefresh(completed);
}

async function expireRefresh(
  env: AutomationEnv,
  record: SignInRefreshRecord,
  connector: BrowserConnector,
): Promise<AngelListSignInRefresh> {
  if (record.sessionId !== null) {
    try {
      await terminateBrowser(
        await connectRefreshBrowser(env, record.sessionId, connector),
      );
    } catch {
      // Browser Run expires the disconnected session even if reconnection fails.
    }
  }
  const expired = SignInRefreshRecordSchema.parse({
    ...record,
    status: "expired",
    sessionId: null,
  });
  await storeRefreshRecord(env, expired, TERMINAL_REFRESH_TTL_SECONDS);
  await clearActiveRefresh(env, record.id);
  return publicRefresh(expired);
}

async function activeRefreshRecord(
  env: AutomationEnv,
  callerSubject: string,
): Promise<SignInRefreshRecord | null> {
  const store = automationStore(env);
  const id = await store.get(ACTIVE_REFRESH_KEY);
  if (id === null) {
    return null;
  }
  try {
    return await loadRefreshRecord(env, callerSubject, id);
  } catch {
    await store.delete(ACTIVE_REFRESH_KEY);
    return null;
  }
}

export async function startAngelListSignInRefresh(
  env: AutomationEnv,
  callerSubject: string,
  options: SignInRefreshOptions = {},
): Promise<AngelListSignInRefresh> {
  assertConfiguredCaller(env, callerSubject);
  await encryptionKey(env.ANGELLIST_SESSION_KEY);
  const now = options.now ?? new Date();
  const connector = options.connector ?? defaultBrowserConnector;
  const existing = await activeRefreshRecord(env, callerSubject);
  if (existing !== null && existing.status === "waiting_for_sign_in") {
    if (isRefreshExpired(existing, now)) {
      await expireRefresh(env, existing, connector);
    } else if (existing.sessionId !== null) {
      let browser: Browser | undefined;
      let discardExisting = false;
      try {
        browser = await connectRefreshBrowser(
          env,
          existing.sessionId,
          connector,
        );
        const target = await browserPage(browser, true);
        await ensureAngelListPage(target.page);
        return publicRefresh(
          existing,
          await liveViewUrl(browserWorker(env), existing.sessionId),
          new Date(now.getTime() + LIVE_VIEW_UNOPENED_TTL_MS).toISOString(),
        );
      } catch {
        discardExisting = true;
        await clearActiveRefresh(env, existing.id).catch(() => undefined);
      } finally {
        if (browser !== undefined) {
          if (discardExisting) {
            await terminateBrowser(browser);
          } else {
            await browser.close().catch(() => undefined);
          }
        }
      }
    }
  }

  const acquirer = options.acquirer ?? defaultBrowserAcquirer;
  let sessionId: string;
  try {
    sessionId = (
      await acquirer(browserWorker(env), {
        keep_alive: REFRESH_BROWSER_KEEP_ALIVE_MS,
        recording: false,
      })
    ).sessionId;
  } catch {
    throw new AngelListAutomationError("browser_unavailable");
  }

  const browser = await connectRefreshBrowser(env, sessionId, connector);
  let keepSession = false;
  try {
    const target = await browserPage(browser, true);
    await ensureAngelListPage(target.page);
    const url = await liveViewUrl(browserWorker(env), sessionId);
    const record = SignInRefreshRecordSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      subject: callerSubject,
      status: "waiting_for_sign_in",
      sessionId,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + REFRESH_BROWSER_KEEP_ALIVE_MS,
      ).toISOString(),
    });
    await storeRefreshRecord(env, record, REFRESH_RECORD_TTL_SECONDS);
    await automationStore(env).put(ACTIVE_REFRESH_KEY, record.id, {
      expirationTtl: REFRESH_RECORD_TTL_SECONDS,
    });
    keepSession = true;
    return publicRefresh(
      record,
      url,
      new Date(now.getTime() + LIVE_VIEW_UNOPENED_TTL_MS).toISOString(),
    );
  } finally {
    if (keepSession) {
      await browser.close().catch(() => undefined);
    } else {
      await terminateBrowser(browser);
    }
  }
}

export async function getAngelListSignInRefresh(
  env: AutomationEnv,
  callerSubject: string,
  id: string,
  options: SignInRefreshOptions = {},
): Promise<AngelListSignInRefresh> {
  const record = await loadRefreshRecord(env, callerSubject, id);
  if (record.status !== "waiting_for_sign_in") {
    return publicRefresh(record);
  }
  const connector = options.connector ?? defaultBrowserConnector;
  if (isRefreshExpired(record, options.now ?? new Date())) {
    return expireRefresh(env, record, connector);
  }
  if (record.sessionId === null) {
    throw new AngelListAutomationError("refresh_invalid");
  }
  const browser = await connectRefreshBrowser(env, record.sessionId, connector);
  let terminate = false;
  try {
    const target = await browserPage(browser, false);
    if (!(await hasVerifiedAngelListExport(target.page))) {
      return publicRefresh(record);
    }
    terminate = true;
    return completeRefresh(
      env,
      record,
      filterRefreshedStorageState(await target.context.storageState()),
    );
  } finally {
    if (terminate) {
      await terminateBrowser(browser);
    } else {
      await browser.close().catch(() => undefined);
    }
  }
}

export async function submitAngelListMagicLink(
  env: AutomationEnv,
  callerSubject: string,
  id: string,
  magicLink: string,
  options: SignInRefreshOptions = {},
): Promise<AngelListSignInRefresh> {
  const record = await loadRefreshRecord(env, callerSubject, id);
  if (record.status !== "waiting_for_sign_in") {
    return publicRefresh(record);
  }
  const connector = options.connector ?? defaultBrowserConnector;
  if (isRefreshExpired(record, options.now ?? new Date())) {
    return expireRefresh(env, record, connector);
  }
  if (record.sessionId === null) {
    throw new AngelListAutomationError("refresh_invalid");
  }
  const link = parseAngelListMagicLink(magicLink);
  const browser = await connectRefreshBrowser(env, record.sessionId, connector);
  let terminate = false;
  try {
    const target = await browserPage(browser, false);
    try {
      await target.page.goto(link, {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
    } catch {
      throw new AngelListAutomationError("magic_link_invalid");
    }
    if (!isAngelListPage(target.page)) {
      throw new AngelListAutomationError("magic_link_invalid");
    }
    if (!(await hasVerifiedAngelListExport(target.page))) {
      return publicRefresh(record);
    }
    terminate = true;
    return completeRefresh(
      env,
      record,
      filterRefreshedStorageState(await target.context.storageState()),
    );
  } finally {
    if (terminate) {
      await terminateBrowser(browser);
    } else {
      await browser.close().catch(() => undefined);
    }
  }
}

export async function submitAngelListHandoffInput(
  env: AutomationEnv,
  callerSubject: string,
  id: string,
  rawInput: string,
  options: SignInRefreshOptions = {},
): Promise<AngelListSignInRefresh> {
  const record = await loadRefreshRecord(env, callerSubject, id);
  if (record.status !== "waiting_for_sign_in") {
    return publicRefresh(record);
  }
  const connector = options.connector ?? defaultBrowserConnector;
  if (isRefreshExpired(record, options.now ?? new Date())) {
    return expireRefresh(env, record, connector);
  }
  if (record.sessionId === null) {
    throw new AngelListAutomationError("refresh_invalid");
  }
  const input = parseAngelListHandoffInput(rawInput);
  const browser = await connectRefreshBrowser(env, record.sessionId, connector);
  try {
    const target = await browserPage(browser, false);
    if (!isAngelListPage(target.page)) {
      throw new AngelListAutomationError("handoff_input_invalid");
    }
    const handoffField = await focusedAngelListHandoffField(target.page);
    if (
      (handoffField.isEmail && !z.email().safeParse(input).success) ||
      (handoffField.isOneTimeCode && input.length > 128)
    ) {
      throw new AngelListAutomationError("handoff_input_invalid");
    }
    await handoffField.field.fill(input).catch(() => {
      throw new AngelListAutomationError("handoff_input_invalid");
    });
    return publicRefresh(record);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function cancelAngelListSignInRefresh(
  env: AutomationEnv,
  callerSubject: string,
  id: string,
  options: SignInRefreshOptions = {},
): Promise<AngelListSignInRefresh> {
  const record = await loadRefreshRecord(env, callerSubject, id);
  if (record.status !== "waiting_for_sign_in") {
    return publicRefresh(record);
  }
  if (record.sessionId !== null) {
    try {
      await terminateBrowser(
        await connectRefreshBrowser(
          env,
          record.sessionId,
          options.connector ?? defaultBrowserConnector,
        ),
      );
    } catch {
      // The disconnected Browser Run session has a bounded keep-alive.
    }
  }
  const cancelled = SignInRefreshRecordSchema.parse({
    ...record,
    status: "cancelled",
    sessionId: null,
  });
  await storeRefreshRecord(env, cancelled, TERMINAL_REFRESH_TTL_SECONDS);
  await clearActiveRefresh(env, record.id);
  return publicRefresh(cancelled);
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
    throw new AngelListAutomationError("export_invalid");
  }
  return filename;
}

async function readDownload(download: {
  createReadStream(): Promise<unknown>;
  failure(): Promise<string | null>;
}): Promise<Uint8Array> {
  if ((await download.failure()) !== null) {
    throw new AngelListAutomationError("download_failed");
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
        throw new AngelListAutomationError("download_failed");
      }
      byteSize += chunk.byteLength;
      if (byteSize > MAX_ANGELLIST_CSV_BYTES) {
        throw new AngelListAutomationError("export_invalid");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof AngelListAutomationError) {
      throw error;
    }
    throw new AngelListAutomationError("download_failed");
  }
  if (byteSize === 0) {
    throw new AngelListAutomationError("export_invalid");
  }
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Bytes(contents: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    ownedArrayBuffer(contents),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function discardPrivateObject(bucket: R2Bucket, objectKey: string) {
  try {
    await bucket.delete(objectKey);
  } catch {
    // The database does not reference this object. Bucket lifecycle cleanup is
    // the final fallback for an orphaned failed-run object.
  }
}

async function stageExport(input: {
  bytes: Uint8Array;
  env: AutomationEnv;
  filename: string;
  retrievedAt: string;
}): Promise<{ importId: string; status: "review_ready" | "up_to_date" }> {
  let parsed: Awaited<ReturnType<typeof parseAngelListInvestmentsCsv>>;
  try {
    parsed = await parseAngelListInvestmentsCsv(input.bytes);
  } catch {
    throw new AngelListAutomationError("export_invalid");
  }
  const objectKey = `holding-imports/${crypto.randomUUID()}.csv`;
  try {
    await input.env.DOCUMENTS.put(objectKey, input.bytes, {
      httpMetadata: { contentType: "text/csv" },
    });
  } catch {
    throw new AngelListAutomationError("staging_failed");
  }
  try {
    const staged = await new D1AlphaRepository(input.env.DB).stageHoldingImport(
      configuredSubject(input.env),
      {
        objectKey,
        sha256: await sha256Bytes(input.bytes),
        byteSize: input.bytes.byteLength,
        effectiveDate: angelListExportDate(input.filename, input.retrievedAt),
        retrievedAt: input.retrievedAt,
        rows: parsed.rows,
      },
    );
    if (!staged.created) {
      await discardPrivateObject(input.env.DOCUMENTS, objectKey);
    }
    return {
      importId: staged.preview.id,
      status:
        staged.preview.status === "pending_review"
          ? "review_ready"
          : "up_to_date",
    };
  } catch (error) {
    await discardPrivateObject(input.env.DOCUMENTS, objectKey);
    if (error instanceof AngelListAutomationError) {
      throw error;
    }
    throw new AngelListAutomationError("staging_failed");
  }
}

export async function runAngelListImport(
  env: AutomationEnv,
  options: {
    launcher?: BrowserLauncher;
    now?: Date;
    stage?: typeof stageExport;
  } = {},
): Promise<AngelListAutomationStatus> {
  if (env.ANGELLIST_AUTOMATION_ENABLED !== "true") {
    throw new AngelListAutomationError("configuration_invalid");
  }
  configuredSubject(env);
  if (env.ANGELLIST_BROWSER === undefined) {
    throw new AngelListAutomationError("configuration_invalid");
  }
  const storageState = await loadAngelListSession(env);
  const now = options.now ?? new Date();
  const launcher = options.launcher ?? defaultBrowserLauncher;
  let browser: Browser | undefined;
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  try {
    browser = await launcher(env.ANGELLIST_BROWSER, {
      keep_alive: 120_000,
      recording: false,
    });
    context = await browser.newContext({
      acceptDownloads: true,
      serviceWorkers: "block",
      storageState,
    });
    const page = await context.newPage();
    await page.goto(ANGELLIST_ORIGIN, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    if (new URL(page.url()).origin !== ANGELLIST_ORIGIN) {
      throw new AngelListAutomationError("auth_required");
    }
    const exportButton = page.getByRole("button", {
      exact: true,
      name: "Export CSV",
    });
    if (!(await exportButton.isVisible().catch(() => false))) {
      throw new AngelListAutomationError("auth_required");
    }

    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await exportButton.click({ timeout: 15_000 });
    const download = await downloadPromise;
    const filename = validateFilename(download.suggestedFilename());
    const bytes = await readDownload(download);
    await download.delete().catch(() => undefined);
    const retrievedAt = now.toISOString();
    const staged = await (options.stage ?? stageExport)({
      bytes,
      env,
      filename,
      retrievedAt,
    });
    const refreshedState = filterRefreshedStorageState(
      await context.storageState(),
    );
    await automationStore(env).put(
      SESSION_KEY,
      await encryptStorageState(refreshedState, env.ANGELLIST_SESSION_KEY),
    );
    const status: AngelListAutomationStatus = {
      version: 1,
      status: staged.status,
      checkedAt: retrievedAt,
      importId: staged.importId,
      errorCode: null,
    };
    await writeStatus(env, status);
    return status;
  } catch (error) {
    if (error instanceof AngelListAutomationError) {
      throw error;
    }
    if (browser === undefined) {
      throw new AngelListAutomationError("browser_unavailable");
    }
    throw new AngelListAutomationError("unexpected_failure");
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export async function runAngelListImportForCaller(
  env: AutomationEnv,
  callerSubject: string,
): Promise<AngelListAutomationStatus> {
  assertConfiguredCaller(env, callerSubject);
  try {
    return await runAngelListImport(env);
  } catch (error) {
    const errorCode = safeErrorCode(error);
    await writeStatus(env, {
      version: 1,
      status: errorCode === "auth_required" ? "auth_required" : "failed",
      checkedAt: new Date().toISOString(),
      importId: null,
      errorCode,
    });
    throw error;
  }
}

export function shouldRunAngelListImport(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return (
    value("weekday") === "Mon" &&
    value("hour") === "09" &&
    value("minute") === "00"
  );
}

export async function handleAngelListScheduled(
  controller: ScheduledController,
  env: AutomationEnv,
): Promise<void> {
  if (
    env.ANGELLIST_AUTOMATION_ENABLED !== "true" ||
    !shouldRunAngelListImport(new Date(controller.scheduledTime))
  ) {
    return;
  }
  try {
    await runAngelListImport(env);
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const status: AngelListAutomationStatus = {
      version: 1,
      status: errorCode === "auth_required" ? "auth_required" : "failed",
      checkedAt: new Date(controller.scheduledTime).toISOString(),
      importId: null,
      errorCode,
    };
    try {
      await writeStatus(env, status);
    } finally {
      console.error(
        JSON.stringify({ event: "angellist_import_failed", code: errorCode }),
      );
    }
  }
}
