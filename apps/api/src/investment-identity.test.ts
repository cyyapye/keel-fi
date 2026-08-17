import { describe, expect, it } from "vitest";

import {
  angelListInvestmentsSourceKey,
  angelListOwnershipContainerKey,
  angelListPositionKey,
  investmentCashCurrencyExposureKey,
  plaidInvestmentsAccountKey,
  plaidInvestmentsExposureKey,
  plaidInvestmentsPositionKey,
  plaidInvestmentsProviderSecurityExposureKey,
  plaidInvestmentsSourceKey,
} from "./investment-identity";
import type { Env } from "./types";

const credentialKey = btoa("k".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");
const env = { CONNECTOR_CREDENTIAL_KEY: credentialKey } as Env;

describe("protected investment identity", () => {
  it("preserves the shipped Robinhood Item fingerprint", async () => {
    await expect(
      plaidInvestmentsSourceKey(env, "synthetic-item"),
    ).resolves.toBe(
      "5e8acfa77955812b53741e6ce7cefb15b00f863a4f29cf0e3218639870c4ad5c",
    );
  });

  it("scopes accounts to Items and positions to ownership containers", async () => {
    const [firstSource, secondSource] = await Promise.all([
      plaidInvestmentsSourceKey(env, "synthetic-item-one"),
      plaidInvestmentsSourceKey(env, "synthetic-item-two"),
    ]);
    const [firstAccount, secondAccount] = await Promise.all([
      plaidInvestmentsAccountKey(env, firstSource, "same-account-id"),
      plaidInvestmentsAccountKey(env, secondSource, "same-account-id"),
    ]);
    const [firstPosition, secondPosition] = await Promise.all([
      plaidInvestmentsPositionKey(env, firstAccount, "same-position-id"),
      plaidInvestmentsPositionKey(env, secondAccount, "same-position-id"),
    ]);

    for (const key of [
      firstSource,
      secondSource,
      firstAccount,
      secondAccount,
      firstPosition,
      secondPosition,
    ]) {
      expect(key).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(firstAccount).not.toBe(secondAccount);
    expect(firstPosition).not.toBe(secondPosition);
    await expect(
      plaidInvestmentsAccountKey(env, firstSource, "same-account-id"),
    ).resolves.toBe(firstAccount);
    await expect(
      plaidInvestmentsPositionKey(env, firstAccount, "same-position-id"),
    ).resolves.toBe(firstPosition);
  });

  it("domain-separates source, account, and position identities", async () => {
    const source = await plaidInvestmentsSourceKey(env, "same-provider-id");
    const account = await plaidInvestmentsAccountKey(
      env,
      source,
      "same-provider-id",
    );
    const position = await plaidInvestmentsPositionKey(
      env,
      source,
      "same-provider-id",
    );

    expect(new Set([source, account, position]).size).toBe(3);
  });

  it("shares a protected public exposure identity across connections", async () => {
    const first = await plaidInvestmentsExposureKey(env, "cusip", "67066G104");
    const second = await plaidInvestmentsExposureKey(env, "cusip", "67066G104");
    const differentKind = await plaidInvestmentsExposureKey(
      env,
      "isin",
      "US67066G1040",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(differentKind).not.toBe(first);
  });

  it("shares provider security only inside one protected Item", async () => {
    const firstSource = await plaidInvestmentsSourceKey(
      env,
      "synthetic-item-one",
    );
    const secondSource = await plaidInvestmentsSourceKey(
      env,
      "synthetic-item-two",
    );
    const first = await plaidInvestmentsProviderSecurityExposureKey(
      env,
      firstSource,
      "same-provider-security",
    );
    const sameItem = await plaidInvestmentsProviderSecurityExposureKey(
      env,
      firstSource,
      "same-provider-security",
    );
    const otherItem = await plaidInvestmentsProviderSecurityExposureKey(
      env,
      secondSource,
      "same-provider-security",
    );

    expect(first).toBe(sameItem);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(otherItem).not.toBe(first);
  });

  it("shares exact cash currency across connections", async () => {
    const [first, second, publicSecurity] = await Promise.all([
      investmentCashCurrencyExposureKey(env, "USD"),
      investmentCashCurrencyExposureKey(env, "USD"),
      plaidInvestmentsExposureKey(env, "cusip", "67066G104"),
    ]);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toBe(publicSecurity);
    await expect(
      investmentCashCurrencyExposureKey(env, "EUR" as "USD"),
    ).rejects.toThrow();
  });

  it("scopes AngelList ownership and positions without retaining labels", async () => {
    const source = await angelListInvestmentsSourceKey(
      env,
      "synthetic-access-subject",
    );
    const firstContainer = await angelListOwnershipContainerKey(
      env,
      source,
      "Demo Family Trust",
    );
    const normalizedContainer = await angelListOwnershipContainerKey(
      env,
      source,
      "  demo family trust  ",
    );
    const position = await angelListPositionKey(
      env,
      firstContainer,
      "a".repeat(64),
    );

    expect(firstContainer).toBe(normalizedContainer);
    expect(new Set([source, firstContainer, position]).size).toBe(3);
    for (const key of [source, firstContainer, position]) {
      expect(key).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("fails closed on malformed secrets, parents, and raw identifiers", async () => {
    await expect(
      plaidInvestmentsSourceKey({} as Env, "synthetic-item"),
    ).rejects.toThrow();
    await expect(
      plaidInvestmentsSourceKey(
        { CONNECTOR_CREDENTIAL_KEY: "not-base64url!" } as Env,
        "synthetic-item",
      ),
    ).rejects.toThrow();
    await expect(plaidInvestmentsSourceKey(env, "")).rejects.toThrow();
    await expect(
      plaidInvestmentsAccountKey(env, "not-a-protected-key", "account"),
    ).rejects.toThrow();
    await expect(
      plaidInvestmentsPositionKey(env, "a".repeat(64), "x".repeat(513)),
    ).rejects.toThrow();
    await expect(
      angelListOwnershipContainerKey(env, "a".repeat(64), "x".repeat(1_001)),
    ).rejects.toThrow();
  });
});
