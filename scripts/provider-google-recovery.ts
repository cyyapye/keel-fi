import type { BrowserContext, Page, Route } from "@playwright/test";
import type { ProviderPortfolioAgentProvider } from "../packages/domain/src/index";
import {
  matchingGoogleAccount,
  soleSavedGoogleAccount,
  verifiedProviderGoogleAccount,
} from "./provider-google-account";

export type ProviderRecoveryState =
  "ready" | "waiting" | "input_required" | "unavailable";
export const PROVIDER_AUTH_REQUEST_CHAIN_LIMIT = 150;

export function providerGoogleLoginUrl(
  url: URL,
  provider: ProviderPortfolioAgentProvider,
): boolean {
  return provider === "sydecar"
    ? url.origin === "https://app.sydecar.io" && url.pathname === "/login"
    : (url.origin === "https://tokenfolio.eu.auth0.com" &&
        /^\/u\/login(?:\/|$)/u.test(url.pathname)) ||
        (url.origin === "https://app.tokenfolio.co" &&
          /^\/(?:auth\/)?(?:log-?in|sign-?in)\/?$/iu.test(url.pathname));
}

export function createProviderGoogleRecovery(options: {
  provider: ProviderPortfolioAgentProvider;
  context: BrowserContext;
  expectedHash: string | null;
  interactive: boolean;
  deadline: number;
  isReady: (page: Page) => Promise<boolean>;
  needsInput?: (page: Page) => Promise<boolean>;
  accountHash?: (page: Page) => Promise<string | null>;
}) {
  let primary: Page | undefined;
  let googleStarted = false;
  let selected = false;
  let selectedHash: string | null = null;
  let reported = false;
  let guarded = false;
  let disposed = false;
  let exhausted = false;
  let admitted = 0;
  let readyHash: string | null = null;
  let identity: Promise<string | null> | undefined;
  const ownedPopups = new Set<Page>();
  const admit = async (route: Route) => {
    if (
      Date.now() >= options.deadline ||
      admitted >= PROVIDER_AUTH_REQUEST_CHAIN_LIMIT
    ) {
      exhausted = true;
      await route.abort("blockedbyclient").catch(() => undefined);
    } else {
      admitted++;
      await route.fallback().catch(() => undefined);
    }
  };
  const guard = async () => {
    if (!guarded) {
      guarded = true;
      await options.context.route("**/*", admit);
    }
  };
  return {
    get accountHash() {
      return readyHash;
    },
    get requestChains() {
      return admitted;
    },
    async check(page: Page): Promise<ProviderRecoveryState> {
      if (disposed) return "unavailable";
      primary ??= page;
      if (Date.now() >= options.deadline || exhausted) return "unavailable";
      if (await options.isReady(primary)) {
        identity ??= (
          options.accountHash ??
          ((page) =>
            verifiedProviderGoogleAccount(
              page,
              options.provider,
              Math.max(1, Math.min(1000, options.deadline - Date.now())),
            ))
        )(primary);
        readyHash = await identity;
        if (Date.now() >= options.deadline || exhausted) return "unavailable";
        const expected = options.expectedHash ?? selectedHash;
        if (expected !== null && readyHash !== expected)
          return readyHash === null ? "unavailable" : "input_required";
        if (googleStarted && !reported) {
          reported = true;
          console.info(
            JSON.stringify({
              event: "provider_google_recovery_verified",
              provider: options.provider,
              accountSelected: selected,
              requestChains: admitted,
            }),
          );
        }
        return "ready";
      }
      const popups: Page[] = [];
      const pages = options.context.pages();
      if (pages.length > 8) return "unavailable";
      for (const candidate of pages) {
        if (candidate === primary || candidate.isClosed()) continue;
        if ((await candidate.opener()) === primary) {
          popups.push(candidate);
          ownedPopups.add(candidate);
        }
      }
      if (popups.length > 1) return "unavailable";
      const auth = popups[0] ?? primary;
      const url = new URL(auth.url());
      if (
        url.origin === "https://accounts.google.com" &&
        (googleStarted || popups.length === 1)
      ) {
        googleStarted = true;
        await guard();
        // These remain human interactions. No password, MFA, consent or CAPTCHA
        // submission is automated, including when an old portfolio is mounted.
        if (
          (await auth
            .locator(
              'input[type="password"]:visible, input[type="email"]:visible, input[autocomplete="one-time-code"]:visible, iframe[src*="recaptcha"]:visible',
            )
            .count()) > 0 ||
          (await auth
            .getByRole("heading", {
              name: /verify (?:your identity|it.s you)|two.factor|multi.factor|2.step|passkey|wants access|allow .+ access/iu,
            })
            .filter({ visible: true })
            .count()) > 0 ||
          /\/(?:challenge|consent)(?:\/|$)/u.test(url.pathname)
        )
          return "input_required";
        const chooser =
          /^\/(?:AccountChooser|(?:v[0-9]+\/)?signin\/accountchooser|gsi\/select)\/?$/iu.test(
            url.pathname,
          );
        if (chooser && !selected) {
          const choices = auth
            .locator("[data-identifier], [data-email]")
            .filter({ visible: true });
          if ((await choices.count()) > 0) {
            const expected =
              options.expectedHash ??
              (options.interactive ? await soleSavedGoogleAccount(auth) : null);
            const index = await matchingGoogleAccount(auth, expected);
            if (index === null) return "input_required";
            selectedHash = expected;
            selected = true;
            await choices
              .nth(index)
              .click({
                timeout: Math.max(
                  1,
                  Math.min(1000, options.deadline - Date.now()),
                ),
                noWaitAfter: true,
              })
              .catch(() => undefined);
          }
        }
        return "waiting";
      }
      if (!providerGoogleLoginUrl(url, options.provider)) {
        return (await options.needsInput?.(auth))
          ? "input_required"
          : "waiting";
      }
      if (
        (await auth
          .locator('input[autocomplete="one-time-code"]:visible')
          .count()) > 0 ||
        (await auth
          .locator('form, dialog, [role="dialog"]')
          .filter({
            has: auth
              .getByRole("heading", {
                name: /verify (?:your identity|it.s you)|two.factor|multi.factor|passkey/iu,
              })
              .filter({ visible: true }),
          })
          .filter({ visible: true })
          .count()) > 0
      )
        return "input_required";
      const names =
        options.provider === "sydecar"
          ? /^Continue with Google(?:\. Opens in new tab(?: Sign in with Google Button)?)?$/iu
          : /^(?:sign in|log in|continue) with Google$/iu;
      const buttons = auth
        .getByRole("button", { name: names })
        .or(auth.getByRole("link", { name: names }))
        .filter({ visible: true });
      // Google personalizes the iframe's accessible name for the saved account.
      // Sydecar's native parent button then has no "Continue with Google" name.
      // Identify that one provider-owned control by its embedded Google button.
      const wrapper =
        options.provider === "sydecar"
          ? auth
              .locator('button, [role="button"]')
              .filter({
                has: auth.locator('iframe[title="Sign in with Google Button"]'),
              })
              .filter({ visible: true })
          : buttons.filter({
              has: auth.locator('iframe[title="Sign in with Google Button"]'),
            });
      const google = (await wrapper.count()) > 0 ? wrapper : buttons;
      if ((await google.count()) > 0) {
        if (
          (await google.count()) !== 1 ||
          (!options.interactive && options.expectedHash === null)
        )
          return "input_required";
        if (!googleStarted && (await google.isEnabled())) {
          await guard();
          googleStarted = true;
          await google
            .click({
              timeout: Math.max(
                1,
                Math.min(1000, options.deadline - Date.now()),
              ),
              noWaitAfter: true,
            })
            .catch(() => undefined);
        }
      } else if (
        (await auth
          .locator(
            'input[type="password"]:visible, input[type="email"]:visible, input[autocomplete="one-time-code"]:visible',
          )
          .count()) > 0 ||
        (await auth
          .getByRole("heading", {
            name: /verify (?:your identity|it.s you)|two.factor|multi.factor|passkey/iu,
          })
          .filter({ visible: true })
          .count()) > 0
      )
        return "input_required";
      return "waiting";
    },
    async dispose(success = false): Promise<void> {
      if (disposed) return;
      disposed = true;
      // Failed automatic recovery must not leave a provider/OAuth page running
      // outside admission. Interactive pages remain available until lease teardown.
      const pages = [...ownedPopups];
      if (!success && !options.interactive && googleStarted && primary)
        pages.push(primary);
      await Promise.all(
        pages.map((page) => page.close().catch(() => undefined)),
      );
      if (guarded)
        await options.context.unroute("**/*", admit).catch(() => undefined);
      guarded = false;
      ownedPopups.clear();
    },
  };
}
