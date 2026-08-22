import { z } from "zod";

import {
  deriveProtectedProviderKey,
  ProtectedProviderKeySchema,
} from "./protected-provider-key";
import type { Env } from "./types";

const RawProviderIdentifierSchema = z.string().min(1).max(512);
const StrongSecurityIdentifierKindSchema = z.enum(["cusip", "isin", "sedol"]);
const SupportedCashCurrencySchema = z.literal("USD");
const AngelListOwnershipLabelSchema = z.string().trim().min(1).max(1_000);
const INVESTMENT_KEY_SALT = "keel-provider-account-key-v1";
const ANGELLIST_SOURCE_ID = "angellist-investments-export";
const PROVIDER_TEMPLATE_SOURCE_IDS = {
  sydecar: "sydecar-keel-holdings-template-v1",
  tokenfolio: "tokenfolio-keel-holdings-template-v1",
} as const;

function scopedValue(parentKey: string, rawIdentifier: string): string {
  return JSON.stringify([
    ProtectedProviderKeySchema.parse(parentKey),
    RawProviderIdentifierSchema.parse(rawIdentifier),
  ]);
}

/**
 * Preserve the shipped Robinhood Item fingerprint while giving the canonical
 * investment connection model a provider-neutral name.
 */
export async function plaidInvestmentsSourceKey(
  env: Env,
  rawItemId: string,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "plaid-item-id",
    value: RawProviderIdentifierSchema.parse(rawItemId),
  });
}

/** Scope a provider account to exactly one Plaid Investments Item. */
export async function plaidInvestmentsAccountKey(
  env: Env,
  sourceKey: string,
  rawAccountId: string,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "plaid-investments-account-id",
    value: scopedValue(sourceKey, rawAccountId),
  });
}

/** Scope a provider position to exactly one protected ownership container. */
export async function plaidInvestmentsPositionKey(
  env: Env,
  accountKey: string,
  rawPositionId: string,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "plaid-investments-position-id",
    value: scopedValue(accountKey, rawPositionId),
  });
}

/** Canonicalize one checksum-validated public identifier across connections. */
export async function plaidInvestmentsExposureKey(
  env: Env,
  kind: "cusip" | "isin" | "sedol",
  normalizedIdentifier: string,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "public-security-exposure-id",
    value: JSON.stringify([
      StrongSecurityIdentifierKindSchema.parse(kind),
      RawProviderIdentifierSchema.parse(normalizedIdentifier),
    ]),
  });
}

/** Canonicalize exact investment cash currency across every connection. */
export async function investmentCashCurrencyExposureKey(
  env: Env,
  currencyCode: "USD",
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "cash-currency-exposure-id",
    value: SupportedCashCurrencySchema.parse(currencyCode),
  });
}

/** Group one Plaid security only inside its exact protected Item identity. */
export async function plaidInvestmentsProviderSecurityExposureKey(
  env: Env,
  sourceKey: string,
  rawSecurityId: string,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "public-provider-security-exposure-id",
    value: scopedValue(sourceKey, rawSecurityId),
  });
}

/** Identify the household's AngelList export stream without retaining identity. */
export async function angelListInvestmentsSourceKey(
  env: Env,
  accessSubject: string,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "angellist-investments-source",
    value: scopedValue(
      await deriveProtectedProviderKey({
        credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
        salt: INVESTMENT_KEY_SALT,
        info: "keel-access-subject",
        value: RawProviderIdentifierSchema.parse(accessSubject),
      }),
      ANGELLIST_SOURCE_ID,
    ),
  });
}

/** Protect an AngelList ownership label before it becomes container identity. */
export async function angelListOwnershipContainerKey(
  env: Env,
  sourceKey: string,
  ownershipLabel: string,
): Promise<string> {
  const normalizedLabel =
    AngelListOwnershipLabelSchema.parse(ownershipLabel).toLowerCase();
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "angellist-ownership-container",
    value: JSON.stringify([
      ProtectedProviderKeySchema.parse(sourceKey),
      normalizedLabel,
    ]),
  });
}

/** Scope one AngelList position identity to its declared ownership container. */
export async function angelListPositionKey(
  env: Env,
  accountKey: string,
  naturalKeySha256: string,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: "angellist-position-id",
    value: scopedValue(accountKey, naturalKeySha256),
  });
}

export async function providerTemplateInvestmentsSourceKey(
  env: Env,
  accessSubject: string,
  provider: keyof typeof PROVIDER_TEMPLATE_SOURCE_IDS,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: `${provider}-holdings-template-source`,
    value: scopedValue(
      await deriveProtectedProviderKey({
        credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
        salt: INVESTMENT_KEY_SALT,
        info: "keel-access-subject",
        value: RawProviderIdentifierSchema.parse(accessSubject),
      }),
      PROVIDER_TEMPLATE_SOURCE_IDS[provider],
    ),
  });
}

export async function providerTemplateOwnershipContainerKey(
  env: Env,
  sourceKey: string,
  ownershipLabel: string,
  provider: keyof typeof PROVIDER_TEMPLATE_SOURCE_IDS,
): Promise<string> {
  const normalizedLabel =
    AngelListOwnershipLabelSchema.parse(ownershipLabel).toLowerCase();
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: `${provider}-holdings-template-container`,
    value: JSON.stringify([
      ProtectedProviderKeySchema.parse(sourceKey),
      normalizedLabel,
    ]),
  });
}

export async function providerTemplatePositionKey(
  env: Env,
  accountKey: string,
  naturalKeySha256: string,
  provider: keyof typeof PROVIDER_TEMPLATE_SOURCE_IDS,
): Promise<string> {
  return deriveProtectedProviderKey({
    credentialKey: env.CONNECTOR_CREDENTIAL_KEY,
    salt: INVESTMENT_KEY_SALT,
    info: `${provider}-holdings-template-position`,
    value: scopedValue(accountKey, naturalKeySha256),
  });
}
