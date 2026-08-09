import {
  AngelListBrowserStorageStateSchema,
  type AngelListBrowserStorageState,
} from "../packages/domain/src/index";

export const ANGELLIST_ORIGIN = "https://venture.angellist.com";

type RawStorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

function isAngelListHostname(hostname: string): boolean {
  return (
    hostname.toLowerCase() === "angellist.com" ||
    hostname.toLowerCase().endsWith(".angellist.com")
  );
}

function isAngelListCookieDomain(domain: string): boolean {
  const hostname = domain.startsWith(".") ? domain.slice(1) : domain;
  return isAngelListHostname(hostname);
}

export function filterAngelListStorageState(
  state: RawStorageState,
): AngelListBrowserStorageState {
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
}

export function keelOrigin(rawValue: string): string {
  const url = new URL(rawValue);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Keel URL must be one HTTPS origin.");
  }
  return url.origin;
}

export function setupKeelUrl(argv: readonly string[]): string {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length !== 2 || args[0] !== "--keel-url" || args[1] === undefined) {
    throw new Error(
      "Usage: pnpm angellist:setup -- --keel-url https://keel.example",
    );
  }
  return keelOrigin(args[1]);
}
