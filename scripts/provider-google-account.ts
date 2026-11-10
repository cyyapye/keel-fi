import { constants } from "node:fs";
import { chmod, lstat, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { z } from "zod";
import {
  ProviderPortfolioAgentProviderSchema,
  type ProviderPortfolioAgentProvider,
} from "../packages/domain/src/index";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Account = z
  .object({
    version: z.literal(1),
    provider: ProviderPortfolioAgentProviderSchema,
    accountHash: Hash,
  })
  .strict();
const filename = "provider-google-account.json";

export async function readProviderGoogleAccount(
  directory: string,
  provider: ProviderPortfolioAgentProvider,
): Promise<string | null> {
  const file = path.join(directory, filename);
  try {
    const parent = await lstat(directory);
    if (
      !parent.isDirectory() ||
      parent.uid !== process.getuid?.() ||
      (parent.mode & 0o777) !== 0o700
    )
      throw new Error();
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const metadata = await handle.stat();
      if (
        !metadata.isFile() ||
        metadata.uid !== process.getuid?.() ||
        metadata.size > 256 ||
        ![0o400, 0o600].includes(metadata.mode & 0o777)
      )
        throw new Error();
      const buffer = Buffer.alloc(257);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 256) throw new Error();
      const account = Account.parse(
        JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")),
      );
      if (account.provider !== provider) throw new Error();
      return account.accountHash;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    // eslint-disable-next-line preserve-caught-error -- Private account data and paths must not escape through errors.
    throw new Error("Invalid private provider account binding.");
  }
}

export async function storeProviderGoogleAccount(
  directory: string,
  provider: ProviderPortfolioAgentProvider,
  accountHash: string,
): Promise<void> {
  const account = Account.parse({ version: 1, provider, accountHash });
  const parent = await lstat(directory);
  if (
    !parent.isDirectory() ||
    parent.uid !== process.getuid?.() ||
    (parent.mode & 0o777) !== 0o700
  )
    throw new Error("Invalid private provider account directory.");
  const temporary = path.join(directory, `.${filename}.${crypto.randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(account)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await chmod(temporary, 0o600);
    await rename(temporary, path.join(directory, filename));
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

export async function verifiedProviderGoogleAccount(
  page: Page,
  provider: ProviderPortfolioAgentProvider,
  timeoutMs = 1000,
): Promise<string | null> {
  const origin =
    provider === "tokenfolio"
      ? "https://app.tokenfolio.co"
      : "https://app.sydecar.io";
  if (new URL(page.url()).origin !== origin) return null;
  // Provider credentials and account details stay in the browser. Only an
  // account fingerprint crosses this boundary, after portfolio readiness.
  const result: unknown = await page.evaluate(
    async ({ provider, timeoutMs }) => {
      const identities = new Set<string>();
      if (provider === "tokenfolio") {
        if (location.origin !== "https://app.tokenfolio.co") return null;
        // The current Next.js portal passes the authenticated provider user and
        // Auth0 email together in its server-rendered auth boundary. Parse only
        // JSON flight records, never execute script text or export session data.
        let flight = "";
        for (const script of document.scripts) {
          const source = script.textContent ?? "";
          if (source.length > 2_097_152) {
            if (source.startsWith("self.__next_f.push(")) return null;
            continue;
          }
          const match = source.match(/^self\.__next_f\.push\((\[.*\])\);?$/su);
          if (!match) continue;
          try {
            const chunk: unknown = JSON.parse(match[1]!);
            if (
              Array.isArray(chunk) &&
              chunk[0] === 1 &&
              typeof chunk[1] === "string"
            )
              flight += chunk[1];
            if (flight.length > 2_097_152) return null;
          } catch {
            /* Unknown bootstrap formats cannot establish identity. */
          }
        }
        const records = new Map<string, unknown>();
        for (const line of flight.split("\n")) {
          const split = line.indexOf(":");
          if (split < 1) continue;
          if (records.size >= 4096) return null;
          try {
            records.set(
              line.slice(0, split),
              JSON.parse(line.slice(split + 1)) as unknown,
            );
          } catch {
            /* Non-JSON flight records are not identity data. */
          }
        }
        const pending: Array<{ value: unknown; depth: number }> = [
          ...records.values(),
        ].map((value) => ({ value, depth: 0 }));
        for (
          let visited = 0;
          pending.length > 0 && visited < 20_000;
          visited++
        ) {
          const entry = pending.pop()!;
          if (typeof entry.value !== "object" || entry.value === null) continue;
          if (entry.depth > 32) return null;
          const value = entry.value;
          if (
            "auth0UserEmail" in value &&
            "authenticatedUser" in value &&
            typeof value.auth0UserEmail === "string"
          ) {
            let user: unknown = value.authenticatedUser;
            if (typeof user === "string" && /^\$[a-f0-9]+$/u.test(user))
              user = records.get(user.slice(1));
            if (
              typeof user === "object" &&
              user !== null &&
              "email" in user &&
              typeof user.email === "string" &&
              user.email.trim().toLowerCase() ===
                value.auth0UserEmail.trim().toLowerCase()
            )
              identities.add(user.email.trim().toLowerCase());
            else return null;
          }
          for (const child of Object.values(value))
            pending.push({ value: child as unknown, depth: entry.depth + 1 });
        }
        if (pending.length > 0) return null;
        const keys = Object.keys(localStorage).filter((key) =>
          key.startsWith("@@auth0spajs@@::"),
        );
        if (keys.length > 32) return null;
        for (const key of keys) {
          const raw = localStorage.getItem(key);
          if (raw === null || raw.length > 65_536) continue;
          try {
            type Decoded = {
              user?: {
                email?: unknown;
                email_verified?: unknown;
                sub?: unknown;
              };
              claims?: {
                sub?: unknown;
                iss?: unknown;
                aud?: unknown;
                exp?: unknown;
              };
            };
            const entry = JSON.parse(raw) as {
              body?: { decodedToken?: Decoded };
              decodedToken?: Decoded;
            };
            const decoded = (entry.body ?? entry).decodedToken;
            const user = decoded?.user,
              claims = decoded?.claims;
            if (
              typeof user?.email !== "string" ||
              user.email_verified !== true ||
              typeof user.sub !== "string" ||
              !/^google-oauth2\|[^|\s]+$/u.test(user.sub) ||
              claims?.sub !== user.sub ||
              claims.iss !== "https://tokenfolio.eu.auth0.com/" ||
              claims.aud !== key.split("::")[1] ||
              typeof claims.exp !== "number" ||
              !Number.isSafeInteger(claims.exp) ||
              claims.exp * 1000 <= Date.now()
            )
              continue;
            identities.add(user.email.trim().toLowerCase());
          } catch {
            /* Unknown provider cache shapes cannot establish identity. */
          }
        }
      } else {
        if (location.origin !== "https://app.sydecar.io") return null;
        const token = localStorage.getItem("auth_token");
        if (!token || token.length > 32_768) return null;
        try {
          const response = await fetch("https://api-backend.sydecar.io/user/", {
            method: "GET",
            redirect: "error",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (
            !response.ok ||
            !response.headers
              .get("content-type")
              ?.includes("application/json") ||
            response.body === null
          )
            return null;
          const reader = response.body.getReader();
          let size = 0;
          const chunks: Uint8Array[] = [];
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > 262_144) {
                await reader.cancel();
                return null;
              }
              chunks.push(part.value);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          const user: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (
            typeof user !== "object" ||
            user === null ||
            !("email" in user) ||
            !("id" in user) ||
            typeof user.email !== "string" ||
            typeof user.id !== "string"
          )
            return null;
          identities.add(user.email.trim().toLowerCase());
        } catch {
          return null;
        }
      }
      if (identities.size !== 1) return null;
      const email = [...identities][0]!;
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
        return null;
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(email),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    { provider, timeoutMs },
  );
  return Hash.nullable().parse(result);
}

export async function matchingGoogleAccount(
  page: Page,
  hash: string | null,
): Promise<number | null> {
  if (hash === null) return null;
  Hash.parse(hash);
  const url = new URL(page.url());
  if (
    url.origin !== "https://accounts.google.com" ||
    !/^\/(?:AccountChooser|(?:v[0-9]+\/)?signin\/accountchooser|gsi\/select)\/?$/iu.test(
      url.pathname,
    )
  )
    return null;
  const result: unknown = await page
    .locator("[data-identifier], [data-email]")
    .filter({ visible: true })
    .evaluateAll(async (elements, expected) => {
      if (elements.length > 10) return null;
      const matches: number[] = [];
      for (const [index, element] of elements.entries()) {
        const email = (
          element.getAttribute("data-identifier") ??
          element.getAttribute("data-email")
        )
          ?.trim()
          .toLowerCase();
        if (!email || email.length > 254) continue;
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(email),
        );
        const actual = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (actual === expected) matches.push(index);
      }
      return matches.length === 1 ? matches[0] : null;
    }, hash);
  return z.number().int().min(0).max(9).nullable().parse(result);
}

export async function soleSavedGoogleAccount(
  page: Page,
): Promise<string | null> {
  const url = new URL(page.url());
  if (
    url.origin !== "https://accounts.google.com" ||
    !/^\/(?:AccountChooser|(?:v[0-9]+\/)?signin\/accountchooser|gsi\/select)\/?$/iu.test(
      url.pathname,
    )
  )
    return null;
  const result: unknown = await page
    .locator("[data-identifier], [data-email]")
    .filter({ visible: true })
    .evaluateAll(async (elements) => {
      if (elements.length !== 1) return null;
      const email = (
        elements[0]!.getAttribute("data-identifier") ??
        elements[0]!.getAttribute("data-email")
      )
        ?.trim()
        .toLowerCase();
      if (
        !email ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
      )
        return null;
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(email),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    });
  return Hash.nullable().parse(result);
}
