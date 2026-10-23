import { afterEach, expect, test, vi } from "vitest";
import { __providerPortfolioMacAgentTest } from "./provider-portfolio-mac-agent";
const { readSydecarSessionExpiry, verifySydecarExpiry } =
  __providerPortfolioMacAgentTest;
const now = Date.parse("2026-09-01T00:00:00.000Z") / 1000;
const token = (exp: unknown) =>
  `synthetic.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.synthetic`;
afterEach(() => vi.unstubAllGlobals());

for (const fixture of [
  {
    name: "renewed",
    access: token(now + 3600),
    refresh: token(now + 12 * 3600),
    expected: "verified",
  },
  {
    name: "missing access",
    access: null,
    refresh: token(now + 12 * 3600),
    expected: "unexpected_failure",
  },
  {
    name: "missing refresh",
    access: token(now + 3600),
    refresh: null,
    expected: "unexpected_failure",
  },
  {
    name: "malformed refresh",
    access: token(now + 3600),
    refresh: "synthetic.invalid.synthetic",
    expected: "unexpected_failure",
  },
  {
    name: "invalid expiry",
    access: token(now + 3600),
    refresh: token("invalid"),
    expected: "unexpected_failure",
  },
  {
    name: "expired access",
    access: token(now),
    refresh: token(now + 12 * 3600),
    expected: "unexpected_failure",
  },
  {
    name: "expired refresh",
    access: token(now + 3600),
    refresh: token(now),
    expected: "provider_sign_in_required",
  },
  {
    name: "short refresh",
    access: token(now + 3600),
    refresh: token(now + 8 * 3600 - 1),
    expected: "unexpected_failure",
  },
  {
    name: "exact refresh horizon",
    access: token(now + 3600),
    refresh: token(now + 8 * 3600),
    expected: "verified",
  },
]) {
  test(`session expiry ${fixture.name}`, () => {
    const getItem = vi.fn((key: string) =>
      key === "auth_token" ? fixture.access : fixture.refresh,
    );
    vi.stubGlobal("localStorage", { getItem });
    const observed = readSydecarSessionExpiry();
    expect(getItem.mock.calls).toEqual([["auth_token"], ["refresh_token"]]);
    expect(Object.keys(observed).sort()).toEqual(["access", "refresh"]);
    expect(JSON.stringify(observed)).not.toContain("synthetic");
    if (fixture.expected === "verified")
      expect(verifySydecarExpiry(observed, now, false)).toBeGreaterThanOrEqual(
        now + 8 * 3600,
      );
    else
      expect(() => verifySydecarExpiry(observed, now, false)).toThrow(
        fixture.expected,
      );
  });
}

test.each([
  "negative",
  "out of range",
  "fractional",
  "unsafe",
  "unexpected field",
])("rejects %s browser expiry metadata", (name) => {
  const value =
    name === "negative"
      ? -1
      : name === "out of range"
        ? 20_000_000_001
        : name === "fractional"
          ? now + 0.5
          : Number.MAX_SAFE_INTEGER + 1;
  expect(() =>
    verifySydecarExpiry(
      {
        access: now + 3600,
        refresh: name === "unexpected field" ? now + 12 * 3600 : value,
        ...(name === "unexpected field" ? { token: "synthetic" } : {}),
      },
      now,
      false,
    ),
  ).toThrow();
});

test("exhausted request admission rejects otherwise sufficient session expiry", () => {
  expect(() =>
    verifySydecarExpiry(
      { access: now + 3600, refresh: now + 12 * 3600 },
      now,
      true,
    ),
  ).toThrow("unexpected_failure");
});
