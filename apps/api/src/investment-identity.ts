import { z } from "zod";

import {
  deriveProtectedProviderKey,
  ProtectedProviderKeySchema,
} from "./protected-provider-key";
import type { Env } from "./types";

const RawProviderIdentifierSchema = z.string().min(1).max(512);
const INVESTMENT_KEY_SALT = "keel-provider-account-key-v1";

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
