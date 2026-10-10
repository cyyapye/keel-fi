import { AcceptPositionLinkSchema } from "@keel/domain/position-links";
import { D1PositionLinkRepository, PositionLinkError } from "@keel/database";
import { searchIssuerEvidence } from "./public-company-search";
import { AcceptValuationSchema } from "@keel/domain/valuation-record";
import {
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
} from "@keel/domain/position-purchases";
import {
  D1PositionPurchaseRepository,
  PositionPurchaseError,
  type PositionPurchaseRepository,
} from "@keel/database";
import {
  CompanyIdentityCatalogSchema,
  CompanyAliasProposalSchema,
  CompanyAliasPreviewSchema,
  CompanyAliasReviewInputSchema,
  CompanyAliasReceiptSchema,
} from "@keel/domain/company-identity";
import {
  D1CompanyIdentityRepository,
  CompanyIdentityError,
  type CompanyIdentityRepository,
} from "@keel/database";
import {
  PublicCompanyLinkCatalogSchema,
  PublicCompanyMatchSchema,
  PublicCompanyLookupInputSchema,
  PublicCompanyApprovalInputSchema,
  PublicCompanyLinkReceiptSchema,
  PublicCompanyLinkReviewSchema,
} from "@keel/domain/public-company-links";
import {
  D1PublicCompanyLinkRepository,
  PublicCompanyLinkError,
} from "@keel/database";
import {
  WatchCompanySearchSchema,
  WatchReadInputSchema,
} from "@keel/domain/portfolio-watch-activity";
import { WatchWebsiteInputSchema } from "@keel/domain/watch-website";
import { searchWatchWebsite } from "./watch-website-search";
import {
  AngelListCsvParseError,
  parseAngelListInvestmentsCsv,
  parseProviderHoldingsTemplateCsv,
  providerHoldingsTemplateCsv,
  ProviderHoldingsTemplateCsvParseError,
  type ProviderHoldingsTemplateProvider,
} from "@keel/connectors";
import {
  AngelListMacAgentRepositoryError,
  CashAccountRepositoryError,
  D1AlphaRepository,
  D1AngelListMacAgentRepository,
  D1CashAccountsRepository,
  D1CashFlowRepository,
  D1ExposureRepository,
  D1HoldingImportRepository,
  D1HoldingsPageRepository,
  D1InvestmentExposureViewRepository,
  D1LegalEntityRepository,
  D1InvestmentReviewRepository,
  D1AutomaticInvestmentReviewRepository,
  type AutomaticInvestmentReviewRepository,
  InvestmentReviewError,
  type InvestmentReviewRepository,
  D1LiabilitiesRepository,
  D1MacAgentCredentialRepository,
  D1PlanActualMonitoringRepository,
  D1PlanInputsRepository,
  D1PortfolioBaselineRepository,
  D1PortfolioWatchActivityRepository,
  D1PortfolioWatchInboxRepository,
  D1WatchWebsiteRepository,
  D1ProviderPortfolioAgentRepository,
  PrivateExposureReviewError,
  ProviderPortfolioAgentRepositoryError,
  D1InvestmentConnectionsRepository,
  D1InvestmentPositionViewRepository,
  D1PositionEconomicsRepository,
  D1PositionValueAdjustmentRepository,
  D1ProviderBrowserSessionRepository,
  refreshAcceptedPortfolioBaseline,
  type AlphaRepository,
  type AngelListMacAgentRepository,
  type CashAccountsRepository,
  type CashFlowRepository,
  type LiabilitiesRepository,
  type MacAgentCredentialRepository,
  type PlanActualMonitoringRepository,
  type PlanInputsRepository,
  type PortfolioBaselineRepository,
  type ProviderPortfolioAgentRepository,
  type PrivateExposureReviewRepository,
  type InvestmentConnectionsRepository,
  type HoldingsPageRepository,
  type InvestmentExposureViewRepository,
  type InvestmentPositionViewRepository,
  type LegalEntityRepository,
  type PositionEconomicsRepository,
  type PositionValueAdjustmentRepository,
  type ProviderBrowserSessionRepository,
  ProviderBrowserSessionRepositoryError,
  LegalEntityRepositoryError,
  PositionEconomicsError,
  PositionValueAdjustmentError,
} from "@keel/database";
import {
  ResolveInvestmentReviewsInputSchema,
  ResolveInvestmentReviewsResultSchema,
} from "@keel/domain/automatic-investment-review";
import {
  AngelListMacAgentConfigInputSchema,
  AngelListMacAgentFailureInputSchema,
  CashAccountApplyInputSchema,
  CashAccountExchangeInputSchema,
  CashAccountIdentityReviewInputSchema,
  CashAccountsErrorCodeSchema,
  CashFlowErrorCodeSchema,
  CashFlowReviewInputSchema,
  CashFlowSyncInputSchema,
  CreateSignalUpdateProposalInputSchema,
  GoalDraftInputSchema,
  HoldingImportApplyInputSchema,
  LiabilitiesErrorCodeSchema,
  LiabilityApplyInputSchema,
  LiabilityExchangeInputSchema,
  MacAgentApiOriginSchema,
  MacAgentAuthorizationSchema,
  MacAgentTargetSchema,
  MacAgentTokenSchema,
  ManualLiabilityInputSchema,
  PlanInputSaveSchema,
  ProviderPortfolioAgentConfigInputSchema,
  ProviderBrowserSessionCompletionInputSchema,
  ProviderBrowserSessionFailureInputSchema,
  ProviderBrowserSessionReadyInputSchema,
  ProviderPortfolioAgentFailureInputSchema,
  ProviderSessionRenewalFailureSchema,
  ProviderSessionRenewalVerificationSchema,
  ProviderPortfolioAgentProviderSchema,
  PrivateExposureExactBatchInputSchema,
  PrivateExposureExactBatchResultSchema,
  PrivateExposureResolutionInputSchema,
  PrivateExposureResolutionResultSchema,
  PrivateExposureReviewStateSchema,
  PortfolioBaselineConfirmInputSchema,
  PortfolioWatchScanResultSchema,
  InvestmentConnectionLifecycleActionInputSchema,
  InvestmentExchangeInputSchema,
  ScenarioDraftInputSchema,
  type ProviderPortfolioAgentProvider,
  type MacAgentTarget,
} from "@keel/domain";
import { InvestmentHoldingsViewSchema } from "@keel/domain/investment-holdings-view";
import { HoldingsPageSchema } from "@keel/domain/holdings-page";
import {
  CreateLegalEntityInputSchema,
  LegalEntityExactBatchInputSchema,
  LegalEntityExactBatchResultSchema,
  LegalEntityExportInputSchema,
  LegalEntityExportOptionsSchema,
  LegalEntityInventorySchema,
  LegalEntityRecordSchema,
  LegalEntitySourceReviewResultSchema,
  ReviewLegalEntitySourceInputSchema,
  UpdateLegalEntityInputSchema,
} from "@keel/domain/legal-entities";
import {
  AcceptPositionEconomicsInputSchema,
  PositionEconomicsTermsSchema,
} from "@keel/domain/position-economics";
import { PlanActualSnoozeInputSchema } from "@keel/domain/plan-actual-monitoring";
import {
  AcceptPositionValueAdjustmentInputSchema,
  PositionValueAdjustmentSchema,
} from "@keel/domain/position-value";
import { ReviewInputSchema } from "@keel/evidence";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";

import { verifyAccessToken, type AccessVerifier } from "./auth";
import {
  deploymentSmokeTokenMatches,
  runDeploymentSmoke,
  type AlphaProjectionLoader,
} from "./deployment-smoke";
import {
  HoldingImportUploadError,
  readAngelListCsvUpload,
  readProviderTemplateCsvUpload,
} from "./holding-import-upload";
import {
  legalEntityExportCsv,
  legalEntityExportTable,
} from "./legal-entity-export";
import {
  CreateDocumentInvestmentInputSchema,
  CreateDocumentInvestmentResultSchema,
  InvestmentCompanyReceiptSchema,
  InvestmentCompanyReviewInputSchema,
  InvestmentReviewContextSchema,
  InvestmentReviewStateSchema,
  ReviewInvestmentInputSchema,
} from "@keel/domain/investment-review";
import {
  buildAngelListCanonicalScope,
  buildProviderTemplateCanonicalScope,
} from "./holding-import-scope";
import { PlaidWebhookRequestError, receivePlaidWebhook } from "./plaid-webhook";
import {
  cashFlowConfigured,
  createPlaidCashFlowClient,
  syncObservedCashFlow,
  type PlaidCashFlowClient,
} from "./plaid-cash-flow-sync";
import {
  cashAccountsConfigured,
  cashRefreshUsagePlan,
  connectCashAccount,
  createPlaidCashClient,
  disconnectCashAccount,
  refreshCashAccount,
  refreshDueCashAccounts,
  type PlaidCashClient,
} from "./plaid-cash-sync";
import {
  connectLiabilities,
  createPlaidLiabilitiesClient,
  disconnectLiabilities,
  liabilitiesConfigured,
  refreshLiabilities,
  type PlaidLiabilitiesClient,
} from "./plaid-liabilities-sync";
import {
  connectInvestmentConnection,
  createInvestmentReconnectLinkToken,
  createPlaidInvestmentsClient,
  disconnectInvestmentConnection,
  PlaidInvestmentsClientError,
  investmentsSyncConfigured,
  syncDueInvestmentConnections,
  syncInvestmentConnection,
  type PlaidInvestmentsClient,
} from "./plaid-investments-sync";
import {
  D1RetainedPublicExposureReconciler,
  type RetainedPublicExposureReconciler,
} from "./retained-public-exposure";
import { providerBrowserFailureDiagnostic } from "./provider-browser-diagnostics";
import type { AccessIdentity, Env } from "./types";
import { registerProviderLegalDocumentRoutes } from "./provider-legal-documents";

type Variables = {
  identity: AccessIdentity;
  macAgentTarget: MacAgentTarget | null;
  requestId: string;
};

export type AppEnvironment = {
  Bindings: Env;
  Variables: Variables;
};

type AppOptions = {
  angelListMacAgentRepository?: AngelListMacAgentRepository;
  providerPortfolioAgentRepository?: ProviderPortfolioAgentRepository;
  holdingImportRepository?: Pick<
    D1HoldingImportRepository,
    | "stagePlaidInvestmentsHoldingImport"
    | "autoAdjudicatePlaidInvestmentsHoldingImport"
  >;
  cashAccountsRepository?: CashAccountsRepository;
  cashPlaidClient?: PlaidCashClient;
  cashFlowRepository?: CashFlowRepository;
  cashFlowPlaidClient?: PlaidCashFlowClient;
  liabilitiesRepository?: LiabilitiesRepository;
  liabilitiesPlaidClient?: PlaidLiabilitiesClient;
  macAgentCredentialRepository?: MacAgentCredentialRepository;
  plaidClient?: PlaidInvestmentsClient;
  planActualMonitoringRepository?: PlanActualMonitoringRepository;
  planInputsRepository?: PlanInputsRepository;
  portfolioBaselineRepository?: PortfolioBaselineRepository;
  investmentConnectionsRepository?: InvestmentConnectionsRepository;
  holdingsPageRepository?: HoldingsPageRepository;
  investmentExposureViewRepository?: InvestmentExposureViewRepository;
  investmentPositionViewRepository?: InvestmentPositionViewRepository;
  legalEntityRepository?: LegalEntityRepository;
  investmentReviewRepository?: InvestmentReviewRepository;
  companyIdentityRepository?: CompanyIdentityRepository;
  automaticInvestmentReviewRepository?: AutomaticInvestmentReviewRepository;
  positionPurchaseRepository?: PositionPurchaseRepository;
  positionEconomicsRepository?: PositionEconomicsRepository;
  positionValueAdjustmentRepository?: PositionValueAdjustmentRepository;
  providerBrowserSessionRepository?: ProviderBrowserSessionRepository;
  privateExposureReviewRepository?: PrivateExposureReviewRepository;
  retainedPublicExposureReconciler?: RetainedPublicExposureReconciler;
  newInvestmentConnectionsAvailable?: boolean;
  repository?: AlphaRepository;
  deploymentSmokeAlphaLoader?: AlphaProjectionLoader;
  verifyAccess?: AccessVerifier;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function investmentsErrorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
) {
  const code =
    error instanceof PlaidInvestmentsClientError
      ? error.code
      : "unexpected_failure";
  console.error(
    JSON.stringify({
      event: "investment_sync_failed",
      requestId: context.get("requestId"),
      errorCode: code,
    }),
  );
  const response = {
    configuration_required: {
      message: "Investment sync is not configured.",
      status: 503 as const,
    },
    connection_invalid: {
      message: "Reconnect this institution to continue syncing.",
      status: 409 as const,
    },
    provider_unavailable: {
      message: "Investment sync is temporarily unavailable.",
      status: 503 as const,
    },
    response_invalid: {
      message: "The institution returned unsupported holdings data.",
      status: 502 as const,
    },
    holdings_incomplete: {
      message:
        "The institution returned incomplete holdings. Prior positions were preserved.",
      status: 409 as const,
    },
    staging_failed: {
      message: "Keel could not safely prepare the investment update.",
      status: 503 as const,
    },
    unexpected_failure: {
      message: "Keel could not sync this institution.",
      status: 503 as const,
    },
  }[code];
  return context.json({ error: response.message }, response.status, {
    "Cache-Control": "private, no-store",
  });
}

function cashAccountErrorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
) {
  const rawCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unexpected_failure";
  const parsedCode = CashAccountsErrorCodeSchema.safeParse(rawCode);
  const code = parsedCode.success ? parsedCode.data : "unexpected_failure";
  console.error(
    JSON.stringify({
      event: "cash_accounts_failed",
      requestId: context.get("requestId"),
      errorCode: code,
    }),
  );
  const responses = {
    configuration_required: {
      message: "Cash accounts are not configured.",
      status: 503 as const,
    },
    connection_invalid: {
      message: "Reconnect this institution to continue.",
      status: 409 as const,
    },
    cooldown_active: {
      message: "Plaid has limited balance checks. Try again after seven days.",
      status: 429 as const,
    },
    free_usage_exhausted: {
      message:
        "Plaid's free Balance usage is exhausted. Check your Plaid plan.",
      status: 429 as const,
    },
    monthly_limit_reached: {
      message: "This institution has used its live balance checks this month.",
      status: 429 as const,
    },
    provider_rate_limited: {
      message:
        "Plaid has limited balance checks. Keel will retry after seven days.",
      status: 429 as const,
    },
    review_required: {
      message:
        "Review the waiting balances before checking this institution again.",
      status: 409 as const,
    },
    provider_unavailable: {
      message: "Cash balances are temporarily unavailable.",
      status: 503 as const,
    },
    response_invalid: {
      message: "Plaid returned an unsupported balance response.",
      status: 502 as const,
    },
    staging_failed: {
      message: "Keel could not process the cash balances.",
      status: 503 as const,
    },
    unexpected_failure: {
      message: "Keel could not update cash accounts.",
      status: 503 as const,
    },
  } as const;
  const response = responses[code];
  return context.json({ error: response.message }, response.status, {
    "Cache-Control": "private, no-store",
  });
}

function cashFlowErrorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
) {
  const rawCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unexpected_failure";
  const parsedCode = CashFlowErrorCodeSchema.safeParse(rawCode);
  const code = parsedCode.success ? parsedCode.data : "unexpected_failure";
  console.error(
    JSON.stringify({
      event: "cash_flow_failed",
      requestId: context.get("requestId"),
      errorCode: code,
    }),
  );
  const responses = {
    configuration_required: {
      message: "Observed cash flow is not configured.",
      status: 503 as const,
    },
    connection_invalid: {
      message: "Reconnect this institution to continue.",
      status: 409 as const,
    },
    consent_required: {
      message:
        "Review cash accounts and confirm Transactions pricing before starting.",
      status: 409 as const,
    },
    daily_limit_reached: {
      message: "This institution has used its cash-flow checks for today.",
      status: 429 as const,
    },
    review_required: {
      message: "Finish the current cash-flow review before checking again.",
      status: 409 as const,
    },
    provider_not_ready: {
      message:
        "Plaid is still preparing transaction history. Check again later.",
      status: 409 as const,
    },
    provider_unavailable: {
      message: "Transaction data is temporarily unavailable.",
      status: 503 as const,
    },
    response_invalid: {
      message: "Plaid returned unsupported transaction data.",
      status: 502 as const,
    },
    history_incomplete: {
      message: "Three complete months are not available yet.",
      status: 409 as const,
    },
    coverage_incomplete: {
      message: "Check every reviewed cash institution before comparing burn.",
      status: 409 as const,
    },
    staging_failed: {
      message: "Keel could not prepare observed cash flow for review.",
      status: 503 as const,
    },
    unexpected_failure: {
      message: "Keel could not update observed cash flow.",
      status: 503 as const,
    },
  } as const;
  const response = responses[code];
  return context.json({ error: response.message }, response.status, {
    "Cache-Control": "private, no-store",
  });
}

function liabilitiesErrorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
) {
  const rawCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unexpected_failure";
  const parsedCode = LiabilitiesErrorCodeSchema.safeParse(rawCode);
  const code = parsedCode.success ? parsedCode.data : "unexpected_failure";
  console.error(
    JSON.stringify({
      event: "liabilities_failed",
      requestId: context.get("requestId"),
      errorCode: code,
    }),
  );
  const responses = {
    configuration_required: {
      message: "Obligation import is not configured.",
      status: 503 as const,
    },
    connection_invalid: {
      message: "Reconnect this institution to continue.",
      status: 409 as const,
    },
    monthly_limit_reached: {
      message: "This institution has used its obligation checks this month.",
      status: 429 as const,
    },
    review_required: {
      message: "Review the waiting obligations before continuing.",
      status: 409 as const,
    },
    provider_unavailable: {
      message: "Obligation data is temporarily unavailable.",
      status: 503 as const,
    },
    response_invalid: {
      message: "Plaid returned unsupported obligation data.",
      status: 502 as const,
    },
    staging_failed: {
      message: "Keel could not prepare the obligations for review.",
      status: 503 as const,
    },
    unexpected_failure: {
      message: "Keel could not update obligations.",
      status: 503 as const,
    },
  } as const;
  const response = responses[code];
  return context.json({ error: response.message }, response.status, {
    "Cache-Control": "private, no-store",
  });
}

function legalEntityErrorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
) {
  const code =
    error instanceof LegalEntityRepositoryError ? error.code : "unexpected";
  console.error(
    JSON.stringify({
      event: "legal_entity_inventory_failed",
      requestId: context.get("requestId"),
      errorCode: code,
    }),
  );
  const response = {
    invalid_source: {
      message: "This legal entity source is unavailable.",
      status: 400 as const,
    },
    no_matches: {
      message: "No exact LLC or LP names are ready for batch review.",
      status: 409 as const,
    },
    not_found: {
      message: "This legal entity is unavailable.",
      status: 404 as const,
    },
    stale: {
      message: "This legal entity record changed. Review it and try again.",
      status: 409 as const,
    },
    unexpected: {
      message: "Legal entities are unavailable.",
      status: 503 as const,
    },
  }[code];
  return context.json({ error: response.message }, response.status, {
    "Cache-Control": "private, no-store",
  });
}

async function sha256Bytes(contents: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function discardPrivateObject(bucket: R2Bucket, objectKey: string) {
  try {
    await bucket.delete(objectKey);
  } catch {
    // The database never references this object. A bucket lifecycle rule is the
    // final fallback for an orphaned failed-upload object.
  }
}

class AngelListImportRequestError extends Error {
  public constructor(
    public readonly status: 400 | 413 | 500,
    message: string,
  ) {
    super(message);
    this.name = "AngelListImportRequestError";
  }
}

async function stageAngelListUpload(
  env: Env,
  repository: AlphaRepository,
  accessSubject: string,
  upload: Awaited<ReturnType<typeof readAngelListCsvUpload>>,
) {
  let parsed: Awaited<ReturnType<typeof parseAngelListInvestmentsCsv>>;
  try {
    parsed = await parseAngelListInvestmentsCsv(upload.bytes);
  } catch (error) {
    throw new AngelListImportRequestError(
      error instanceof AngelListCsvParseError && error.code === "file_too_large"
        ? 413
        : 400,
      error instanceof AngelListCsvParseError
        ? error.message
        : "This is not a supported AngelList investments export.",
    );
  }

  const objectKey = `holding-imports/${crypto.randomUUID()}.csv`;
  try {
    await env.DOCUMENTS.put(objectKey, upload.bytes, {
      httpMetadata: { contentType: "text/csv" },
    });
  } catch {
    throw new AngelListImportRequestError(
      500,
      "Keel could not retain this import for review.",
    );
  }

  let staged: Awaited<ReturnType<AlphaRepository["stageHoldingImport"]>>;
  try {
    const canonicalScope = await buildAngelListCanonicalScope({
      env,
      accessSubject,
      rows: parsed.rows,
    });
    staged = await repository.stageHoldingImport(accessSubject, {
      objectKey,
      sha256: await sha256Bytes(upload.bytes),
      byteSize: upload.bytes.byteLength,
      effectiveDate: upload.effectiveDate,
      retrievedAt: upload.retrievedAt,
      rows: parsed.rows,
      canonicalScope,
    });
    if (!staged.created) {
      await discardPrivateObject(env.DOCUMENTS, objectKey);
    }
  } catch {
    await discardPrivateObject(env.DOCUMENTS, objectKey);
    throw new AngelListImportRequestError(
      500,
      "Keel could not prepare this import for review.",
    );
  }
  // Evidence is already durable. A later failure must not delete its document.
  return {
    ...staged,
    preview: await repository.reconcileHoldingImport(
      accessSubject,
      staged.preview.id,
    ),
  };
}

class ProviderTemplateImportRequestError extends Error {
  public constructor(
    public readonly status: 400 | 413 | 500,
    message: string,
    public readonly reason:
      | "canonical_scope"
      | "document_store"
      | "review_staging"
      | "validation"
      | "unexpected" = "unexpected",
  ) {
    super(message);
    this.name = "ProviderTemplateImportRequestError";
  }
}

async function stageProviderTemplateUpload(
  env: Env,
  repository: AlphaRepository,
  accessSubject: string,
  provider: ProviderHoldingsTemplateProvider,
  upload: Awaited<ReturnType<typeof readProviderTemplateCsvUpload>>,
) {
  const label = provider === "tokenfolio" ? "Tokenfolio" : "Sydecar";
  let parsed: Awaited<ReturnType<typeof parseProviderHoldingsTemplateCsv>>;
  try {
    parsed = await parseProviderHoldingsTemplateCsv(provider, upload.bytes);
  } catch (error) {
    throw new ProviderTemplateImportRequestError(
      error instanceof ProviderHoldingsTemplateCsvParseError &&
        error.code === "file_too_large"
        ? 413
        : 400,
      error instanceof ProviderHoldingsTemplateCsvParseError
        ? error.message
        : `This is not a supported Keel ${label} holdings template.`,
      "validation",
    );
  }
  if (parsed.effectiveDate > upload.retrievedAt.slice(0, 10)) {
    throw new ProviderTemplateImportRequestError(
      400,
      `${label} template As Of Date cannot be in the future.`,
      "validation",
    );
  }

  const objectKey = `holding-imports/${provider}/${crypto.randomUUID()}.csv`;
  try {
    await env.DOCUMENTS.put(objectKey, upload.bytes, {
      httpMetadata: { contentType: "text/csv" },
    });
  } catch {
    throw new ProviderTemplateImportRequestError(
      500,
      "Keel could not retain this import for review.",
      "document_store",
    );
  }

  let phase: "canonical_scope" | "review_staging" = "canonical_scope";
  let staged: Awaited<ReturnType<AlphaRepository["stageHoldingImport"]>>;
  try {
    const canonicalScope = await buildProviderTemplateCanonicalScope({
      env,
      accessSubject,
      provider,
      rows: parsed.rows,
    });
    phase = "review_staging";
    staged = await repository.stageHoldingImport(accessSubject, {
      provider,
      formatVersion: parsed.formatVersion,
      objectKey,
      sha256: await sha256Bytes(upload.bytes),
      byteSize: upload.bytes.byteLength,
      effectiveDate: parsed.effectiveDate,
      retrievedAt: upload.retrievedAt,
      rows: parsed.rows,
      canonicalScope,
    });
    if (!staged.created) {
      await discardPrivateObject(env.DOCUMENTS, objectKey);
    }
  } catch {
    await discardPrivateObject(env.DOCUMENTS, objectKey);
    throw new ProviderTemplateImportRequestError(
      500,
      "Keel could not prepare this import for review.",
      phase,
    );
  }
  return {
    ...staged,
    preview: await repository.reconcileHoldingImport(
      accessSubject,
      staged.preview.id,
    ),
  };
}

function providerPortfolioAgentProvider(
  rawProvider: string,
): ProviderPortfolioAgentProvider | null {
  const parsed = ProviderPortfolioAgentProviderSchema.safeParse(rawProvider);
  return parsed.success ? parsed.data : null;
}

function providerPortfolioLabel(provider: ProviderPortfolioAgentProvider) {
  return provider === "tokenfolio" ? "Tokenfolio" : "Sydecar";
}

function providerBrowserTarget(rawProvider: string): MacAgentTarget | null {
  const parsed = MacAgentTargetSchema.safeParse(rawProvider);
  return parsed.success ? parsed.data : null;
}

function providerBrowserLabel(provider: MacAgentTarget): string {
  if (provider === "angellist") {
    return "AngelList";
  }
  return providerPortfolioLabel(provider);
}

function machineRouteTarget(
  method: string,
  pathname: string,
): MacAgentTarget | null {
  if (method !== "POST") {
    return null;
  }
  if (pathname === "/api/automation/angellist/mac-agent/lease") {
    return "angellist";
  }
  if (pathname === "/api/automation/angellist/mac-agent/run") {
    return "angellist";
  }
  if (
    /^\/api\/automation\/angellist\/mac-agent\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:fail|complete)$/iu.test(
      pathname,
    )
  ) {
    return "angellist";
  }
  const browserSession =
    /^\/api\/automation\/provider-browser\/(angellist|tokenfolio|sydecar)\/mac-agent\/(?:lease|rotate|sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:status|ready|complete|fail))$/iu.exec(
      pathname,
    );
  if (browserSession !== null) {
    return browserSession[1]?.toLowerCase() as MacAgentTarget;
  }
  const providerLease =
    /^\/api\/automation\/provider-holdings\/(tokenfolio|sydecar)\/mac-agent\/(?:lease|run)$/u.exec(
      pathname,
    );
  if (providerLease !== null) {
    return providerLease[1] as ProviderPortfolioAgentProvider;
  }
  if (
    /^\/api\/automation\/provider-holdings\/sydecar\/mac-agent\/session-renewal\/(?:lease|complete|fail)$/u.test(
      pathname,
    )
  ) {
    return "sydecar";
  }
  const providerRun =
    /^\/api\/automation\/provider-holdings\/(tokenfolio|sydecar)\/mac-agent\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:fail|complete|document-manifest|documents)$/iu.exec(
      pathname,
    );
  return providerRun === null
    ? null
    : (providerRun[1]?.toLowerCase() as ProviderPortfolioAgentProvider);
}

function macAgentApiOrigin(env: Env, requestUrl: string): string | null {
  const raw =
    env.ENVIRONMENT === "local"
      ? new URL(requestUrl).origin
      : env.MAC_AGENT_API_ORIGIN;
  if (raw === undefined) {
    return null;
  }
  const parsed = MacAgentApiOriginSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnvironment>();
  const verifier = options.verifyAccess ?? verifyAccessToken;
  const repositoryFor = (env: Env) =>
    options.repository ?? new D1AlphaRepository(env.DB);
  const angelListMacAgentRepositoryFor = (env: Env) =>
    options.angelListMacAgentRepository ??
    new D1AngelListMacAgentRepository(env.DB);
  const providerPortfolioAgentRepositoryFor = (env: Env) =>
    options.providerPortfolioAgentRepository ??
    new D1ProviderPortfolioAgentRepository(env.DB);
  const macAgentCredentialRepositoryFor = (env: Env) =>
    options.macAgentCredentialRepository ??
    new D1MacAgentCredentialRepository(env.DB);
  const providerBrowserSessionRepositoryFor = (env: Env) =>
    options.providerBrowserSessionRepository ??
    new D1ProviderBrowserSessionRepository(env.DB);
  const investmentConnectionsRepositoryFor = (env: Env) =>
    options.investmentConnectionsRepository ??
    new D1InvestmentConnectionsRepository(env.DB);
  const holdingsPageRepositoryFor = (env: Env) =>
    options.holdingsPageRepository ?? new D1HoldingsPageRepository(env.DB);
  const investmentPositionViewRepositoryFor = (env: Env) =>
    options.investmentPositionViewRepository ??
    new D1InvestmentPositionViewRepository(env.DB);
  const investmentExposureViewRepositoryFor = (env: Env) =>
    options.investmentExposureViewRepository ??
    new D1InvestmentExposureViewRepository(env.DB);
  const legalEntityRepositoryFor = (env: Env) =>
    options.legalEntityRepository ?? new D1LegalEntityRepository(env.DB);
  const companyIdentityRepositoryFor = (env: Env) =>
    options.companyIdentityRepository ??
    new D1CompanyIdentityRepository(env.DB);
  const investmentReviewRepositoryFor = (env: Env) =>
    options.investmentReviewRepository ??
    new D1InvestmentReviewRepository(env.DB);
  const automaticInvestmentReviewRepositoryFor = (env: Env) =>
    options.automaticInvestmentReviewRepository ??
    new D1AutomaticInvestmentReviewRepository(env.DB);
  const positionValueAdjustmentRepositoryFor = (env: Env) =>
    options.positionValueAdjustmentRepository ??
    new D1PositionValueAdjustmentRepository(env.DB);
  const positionEconomicsRepositoryFor = (env: Env) =>
    options.positionEconomicsRepository ??
    new D1PositionEconomicsRepository(env.DB);
  const privateExposureReviewRepositoryFor = (env: Env) =>
    options.privateExposureReviewRepository ?? new D1ExposureRepository(env.DB);
  const retainedPublicExposureReconcilerFor = (env: Env) =>
    options.retainedPublicExposureReconciler ??
    new D1RetainedPublicExposureReconciler(env);
  const reconcileRetainedPublicExposureHistory = async (
    context: Context<AppEnvironment>,
    accessSubject: string,
  ): Promise<void> => {
    try {
      const reconciliation = await retainedPublicExposureReconcilerFor(
        context.env,
      ).reconcile(accessSubject);
      if (reconciliation.skippedDocumentCount > 0) {
        console.error(
          JSON.stringify({
            event: "retained_public_exposure_reconciliation_incomplete",
            requestId: context.get("requestId"),
            skippedDocumentCount: reconciliation.skippedDocumentCount,
          }),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "retained_public_exposure_reconciliation_failed",
          requestId: context.get("requestId"),
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
  };
  const portfolioBaselineRepositoryFor = (env: Env) =>
    options.portfolioBaselineRepository ??
    new D1PortfolioBaselineRepository(env.DB);
  const planInputsRepositoryFor = (env: Env) =>
    options.planInputsRepository ?? new D1PlanInputsRepository(env.DB);
  const planActualMonitoringRepositoryFor = (env: Env) =>
    options.planActualMonitoringRepository ??
    new D1PlanActualMonitoringRepository(env.DB);
  const holdingImportRepositoryFor = (env: Env) =>
    options.holdingImportRepository ?? new D1HoldingImportRepository(env.DB);
  const plaidClientFor = (env: Env) =>
    options.plaidClient ?? createPlaidInvestmentsClient(env);
  const investmentsConfiguredFor = (env: Env) =>
    options.plaidClient !== undefined || investmentsSyncConfigured(env);
  const newInvestmentConnectionsAvailableFor = (env: Env) =>
    options.newInvestmentConnectionsAvailable ??
    env.INVESTMENTS_NEW_CONNECTIONS_ENABLED === "true";
  const cashAccountsRepositoryFor = (env: Env) =>
    options.cashAccountsRepository ??
    new D1CashAccountsRepository(env.DB, cashRefreshUsagePlan(env));
  const cashPlaidClientFor = (env: Env) =>
    options.cashPlaidClient ?? createPlaidCashClient(env);
  const cashAccountsConfiguredFor = (env: Env) =>
    options.cashPlaidClient !== undefined || cashAccountsConfigured(env);
  const cashFlowRepositoryFor = (env: Env) =>
    options.cashFlowRepository ?? new D1CashFlowRepository(env.DB);
  const cashFlowPlaidClientFor = (env: Env) =>
    options.cashFlowPlaidClient ?? createPlaidCashFlowClient(env);
  const cashFlowConfiguredFor = (env: Env) =>
    options.cashFlowPlaidClient !== undefined || cashFlowConfigured(env);
  const liabilitiesRepositoryFor = (env: Env) =>
    options.liabilitiesRepository ?? new D1LiabilitiesRepository(env.DB);
  const liabilitiesPlaidClientFor = (env: Env) =>
    options.liabilitiesPlaidClient ?? createPlaidLiabilitiesClient(env);
  const liabilitiesConfiguredFor = (env: Env) =>
    options.liabilitiesPlaidClient !== undefined || liabilitiesConfigured(env);

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      crossOriginResourcePolicy: "same-site",
      referrerPolicy: "no-referrer",
      strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    }),
  );

  app.use("*", async (context, next) => {
    const startedAt = Date.now();
    const requestId =
      context.req.header("Cf-Ray") ??
      context.req.header("X-Request-Id") ??
      crypto.randomUUID();
    context.set("requestId", requestId);

    await next();

    console.info(
      JSON.stringify({
        event: "request_complete",
        requestId,
        method: context.req.method,
        route: context.req.routePath || "unmatched",
        status: context.res.status,
        durationMs: Date.now() - startedAt,
      }),
    );
  });

  app.get("/health", (context) =>
    context.json({
      status: "ok",
      service: "keel-api",
      deployedGitSha: context.env.DEPLOYED_GIT_SHA ?? null,
      workerVersionId: context.env.CF_VERSION_METADATA?.id ?? null,
      workerVersionTag: context.env.CF_VERSION_METADATA?.tag ?? null,
    }),
  );

  app.post("/webhooks/plaid", async (context) => {
    if (!investmentsConfiguredFor(context.env)) {
      return context.body(null, 503, { "Cache-Control": "no-store" });
    }
    try {
      const result = await receivePlaidWebhook({
        request: context.req.raw,
        env: context.env,
        repository: investmentConnectionsRepositoryFor(context.env),
        client: plaidClientFor(context.env),
      });
      console.info(
        JSON.stringify({
          event: "plaid_webhook_received",
          requestId: context.get("requestId"),
          result,
        }),
      );
      return context.body(null, result === "ignored" ? 204 : 202, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const status =
        error instanceof PlaidWebhookRequestError ? error.status : 503;
      console.error(
        JSON.stringify({
          event: "plaid_webhook_rejected",
          requestId: context.get("requestId"),
          errorCode:
            error instanceof PlaidWebhookRequestError
              ? error.code
              : "temporary_failure",
        }),
      );
      return context.body(null, status, { "Cache-Control": "no-store" });
    }
  });

  app.use("/api/*", async (context, next) => {
    const target = machineRouteTarget(context.req.method, context.req.path);
    const authorization = context.req.header("Authorization");
    if (target !== null && authorization !== undefined) {
      const expectedOrigin = macAgentApiOrigin(context.env, context.req.url);
      if (expectedOrigin === null) {
        return context.json(
          { error: "Portfolio agent access is unavailable." },
          503,
          { "Cache-Control": "no-store" },
        );
      }
      if (new URL(context.req.url).origin !== expectedOrigin) {
        return context.json({ error: "Not found." }, 404, {
          "Cache-Control": "no-store",
        });
      }
      const bearer = /^Bearer (.+)$/u.exec(authorization)?.[1] ?? "";
      const parsedToken = MacAgentTokenSchema.safeParse(bearer);
      const accessSubject = parsedToken.success
        ? await macAgentCredentialRepositoryFor(context.env)
            .authenticate(target, parsedToken.data)
            .catch(() => null)
        : null;
      if (accessSubject === null) {
        return context.json(
          { error: "Portfolio agent access could not be validated." },
          401,
          { "Cache-Control": "no-store" },
        );
      }
      context.set("identity", {
        kind: "user",
        subject: accessSubject,
        email: null,
      });
      context.set("macAgentTarget", target);
      await next();
      return;
    }

    const token = context.req.header("Cf-Access-Jwt-Assertion");

    if (context.env.ENVIRONMENT === "local" && token === undefined) {
      context.set("identity", {
        kind: "user",
        subject: "synthetic-access-subject",
        email: "demo@example.invalid",
      });
      context.set("macAgentTarget", null);
      await next();
      return;
    }

    if (token === undefined || token.length === 0) {
      return context.json(
        { error: "Cloudflare Access authentication is required." },
        401,
      );
    }

    try {
      const identity = await verifier(token, context.env);
      if (
        identity.kind === "service" &&
        (context.req.method !== "POST" ||
          context.req.path !== "/api/deployment-smoke")
      ) {
        return context.json(
          { error: "Access identity is not authorized for this route." },
          403,
        );
      }
      context.set("identity", identity);
      context.set("macAgentTarget", null);
      await next();
      return;
    } catch {
      return context.json(
        { error: "Access identity could not be validated." },
        401,
      );
    }
  });

  app.post("/api/deployment-smoke", async (context) => {
    if (context.env.ENVIRONMENT !== "preview") {
      return context.json({ error: "Not found." }, 404);
    }

    const authorized = await deploymentSmokeTokenMatches(
      context.req.header("X-Keel-Deployment-Smoke-Token"),
      context.env.DEPLOYMENT_SMOKE_TOKEN,
    );
    if (!authorized) {
      return context.json({ error: "Deployment smoke access denied." }, 403);
    }

    try {
      return context.json(
        await runDeploymentSmoke(
          context.env,
          options.deploymentSmokeAlphaLoader,
        ),
        200,
        {
          "Cache-Control": "no-store",
        },
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "deployment_smoke_failed",
          requestId: context.get("requestId"),
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return context.json({ error: "Deployment smoke failed." }, 503);
    }
  });

  app.get("/api/session", async (context) => {
    try {
      const provisioned = await context.env.DB.prepare(
        `SELECT 1 AS allowed FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ? LIMIT 1`,
      )
        .bind(context.get("identity").subject)
        .first<{ allowed: number }>();
      return context.json(
        { authenticated: provisioned !== null },
        provisioned === null ? 403 : 200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json({ authenticated: false }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
  });

  app.get("/api/alpha", async (context) => {
    try {
      const data = await repositoryFor(context.env).getAlphaData(
        context.get("identity").subject,
      );
      return context.json(data, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_failed",
          requestId: context.get("requestId"),
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return context.json(
        { error: "Keel could not load the household view." },
        500,
      );
    }
  });

  app.get("/api/portfolio-baseline", async (context) => {
    try {
      const state = await portfolioBaselineRepositoryFor(context.env).getState(
        context.get("identity").subject,
      );
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Keel could not prepare the portfolio baseline." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/portfolio-baseline/refresh", async (context) => {
    const repository = portfolioBaselineRepositoryFor(context.env);
    const subject = context.get("identity").subject;
    try {
      await refreshAcceptedPortfolioBaseline(repository, subject);
      return context.json(await repository.getState(subject), 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Planning values could not be refreshed. Try again." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/portfolio-baselines", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const result = PortfolioBaselineConfirmInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Portfolio baseline input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      const confirmed = await portfolioBaselineRepositoryFor(
        context.env,
      ).confirm(context.get("identity").subject, result.data);
      return context.json(confirmed, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("stale") || message.includes("already current")) {
        return context.json(
          {
            error:
              "The portfolio or forecast changed. Review the latest baseline before confirming.",
          },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
      if (message.includes("overlaps")) {
        return context.json(
          { error: "Review the possible overlaps before confirming." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "The portfolio baseline could not be confirmed." },
        500,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/plan-inputs", async (context) => {
    try {
      const state = await planInputsRepositoryFor(context.env).getState(
        context.get("identity").subject,
      );
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Keel could not load the runway plan." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/plan-inputs", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const result = PlanInputSaveSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Plan input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }

    try {
      const saved = await planInputsRepositoryFor(context.env).save(
        context.get("identity").subject,
        result.data,
      );
      return context.json(saved, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (
        message.includes("stale") ||
        message.includes("already current") ||
        message.includes("UNIQUE")
      ) {
        return context.json(
          {
            error:
              "The plan or forecast changed. Reload the latest plan before saving.",
          },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "The runway plan could not be saved." },
        500,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/plan-actual-monitoring", async (context) => {
    try {
      const state = await planActualMonitoringRepositoryFor(
        context.env,
      ).getState(context.get("identity").subject);
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Keel could not compare the plan with reviewed actuals." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/plan-actual-monitoring/snooze", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const result = PlanActualSnoozeInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Monitoring reminder input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const state = await planActualMonitoringRepositoryFor(context.env).snooze(
        context.get("identity").subject,
        result.data,
      );
      return context.json(state, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      if (errorMessage(error).includes("changed or is already deferred")) {
        return context.json(
          { error: "This decision changed. Review the latest comparison." },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "Keel could not defer this decision." },
        500,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/cash-accounts", async (context) => {
    try {
      const state = await cashAccountsRepositoryFor(context.env).getState(
        context.get("identity").subject,
        cashAccountsConfiguredFor(context.env),
      );
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Cash account status is unavailable." },
        503,
        {
          "Cache-Control": "private, no-store",
        },
      );
    }
  });

  app.post("/api/cash-accounts/link-token", async (context) => {
    if (!cashAccountsConfiguredFor(context.env)) {
      return context.json({ error: "Cash accounts are not configured." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
    try {
      const linkToken = await cashPlaidClientFor(context.env).createLinkToken(
        context.get("identity").subject,
      );
      return context.json(linkToken, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return cashAccountErrorResponse(context, error);
    }
  });

  app.post("/api/cash-accounts/exchange", async (context) => {
    if (!cashAccountsConfiguredFor(context.env)) {
      return context.json({ error: "Cash accounts are not configured." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json(
        { error: "Cash account connection is invalid." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    const parsed = CashAccountExchangeInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { error: "Cash account connection is invalid." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const state = await connectCashAccount({
        env: context.env,
        repository: cashAccountsRepositoryFor(context.env),
        client: cashPlaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
        publicToken: parsed.data.publicToken,
      });
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return cashAccountErrorResponse(context, error);
    }
  });

  app.post("/api/cash-accounts/auto-refresh", async (context) => {
    if (!cashAccountsConfiguredFor(context.env)) {
      return context.json({ error: "Cash accounts are not configured." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
    try {
      const state = await refreshDueCashAccounts({
        env: context.env,
        repository: cashAccountsRepositoryFor(context.env),
        client: cashPlaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
      });
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return cashAccountErrorResponse(context, error);
    }
  });

  app.post(
    "/api/cash-accounts/connections/:connectionId/refresh",
    async (context) => {
      if (!cashAccountsConfiguredFor(context.env)) {
        return context.json(
          { error: "Cash accounts are not configured." },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
      try {
        const state = await refreshCashAccount({
          env: context.env,
          repository: cashAccountsRepositoryFor(context.env),
          client: cashPlaidClientFor(context.env),
          accessSubject: context.get("identity").subject,
          connectionId: context.req.param("connectionId"),
          refreshKind: "live",
        });
        return context.json(state, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        return cashAccountErrorResponse(context, error);
      }
    },
  );

  app.delete(
    "/api/cash-accounts/connections/:connectionId",
    async (context) => {
      if (!cashAccountsConfiguredFor(context.env)) {
        return context.json(
          { error: "Cash accounts are not configured." },
          503,
          {
            "Cache-Control": "private, no-store",
          },
        );
      }
      try {
        const state = await disconnectCashAccount({
          env: context.env,
          repository: cashAccountsRepositoryFor(context.env),
          client: cashPlaidClientFor(context.env),
          accessSubject: context.get("identity").subject,
          connectionId: context.req.param("connectionId"),
        });
        return context.json(state, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        return cashAccountErrorResponse(context, error);
      }
    },
  );

  app.post("/api/cash-account-proposals/:proposalId/apply", async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = CashAccountApplyInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        {
          error: "Cash account review input is invalid.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const result = await cashAccountsRepositoryFor(context.env).applyProposal(
        context.get("identity").subject,
        context.req.param("proposalId"),
        parsed.data,
      );
      return context.json(result, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("stale") || message.includes("UNIQUE")) {
        return context.json(
          { error: "This cash account review is no longer current." },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        {
          error:
            message.startsWith("Resolve the possible account match") ||
            message.startsWith("Cash accounts are limited to")
              ? message
              : "Every unresolved cash account needs a valid decision.",
        },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/cash-account-identities/review", async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = CashAccountIdentityReviewInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { error: "Cash account identity review input is invalid." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    const repository = cashAccountsRepositoryFor(context.env);
    try {
      await repository.reviewIdentity(
        context.get("identity").subject,
        parsed.data,
      );
      const state = await repository.getState(
        context.get("identity").subject,
        cashAccountsConfiguredFor(context.env),
      );
      return context.json(state, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (
        error instanceof CashAccountRepositoryError ||
        message.includes("already exists") ||
        message.includes("UNIQUE")
      ) {
        return context.json(
          { error: "This account match is no longer waiting for review." },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "The account match could not be saved." },
        500,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/cash-flow", async (context) => {
    try {
      const state = await cashFlowRepositoryFor(context.env).getState(
        context.get("identity").subject,
        cashFlowConfiguredFor(context.env),
      );
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Observed cash-flow status is unavailable." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/cash-flow/connections/:connectionId/sync", async (context) => {
    if (!cashFlowConfiguredFor(context.env)) {
      return context.json(
        { error: "Observed cash flow is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = CashFlowSyncInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { error: "Cash-flow check confirmation is invalid." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const state = await syncObservedCashFlow({
        env: context.env,
        repository: cashFlowRepositoryFor(context.env),
        client: cashFlowPlaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
        connectionId: context.req.param("connectionId"),
        syncInput: parsed.data,
      });
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return cashFlowErrorResponse(context, error);
    }
  });

  app.post("/api/cash-flow-proposals/:proposalId/review", async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = CashFlowReviewInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        {
          error: "Cash-flow review input is invalid.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const result = await cashFlowRepositoryFor(context.env).reviewProposal(
        context.get("identity").subject,
        context.req.param("proposalId"),
        parsed.data,
      );
      return context.json(result, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return cashFlowErrorResponse(context, error);
    }
  });

  app.get("/api/liabilities", async (context) => {
    try {
      const state = await liabilitiesRepositoryFor(context.env).getState(
        context.get("identity").subject,
        liabilitiesConfiguredFor(context.env),
      );
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json({ error: "Obligation status is unavailable." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
  });

  app.post("/api/liabilities/link-token", async (context) => {
    if (!liabilitiesConfiguredFor(context.env)) {
      return context.json(
        { error: "Obligation import is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const linkToken = await liabilitiesPlaidClientFor(
        context.env,
      ).createLinkToken(context.get("identity").subject);
      return context.json(linkToken, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return liabilitiesErrorResponse(context, error);
    }
  });

  app.post("/api/liabilities/exchange", async (context) => {
    if (!liabilitiesConfiguredFor(context.env)) {
      return context.json(
        { error: "Obligation import is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "Obligation connection is invalid." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = LiabilityExchangeInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json({ error: "Obligation connection is invalid." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    try {
      const state = await connectLiabilities({
        env: context.env,
        repository: liabilitiesRepositoryFor(context.env),
        client: liabilitiesPlaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
        publicToken: parsed.data.publicToken,
      });
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return liabilitiesErrorResponse(context, error);
    }
  });

  app.post(
    "/api/liabilities/connections/:connectionId/refresh",
    async (context) => {
      if (!liabilitiesConfiguredFor(context.env)) {
        return context.json(
          { error: "Obligation import is not configured." },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
      try {
        const state = await refreshLiabilities({
          env: context.env,
          repository: liabilitiesRepositoryFor(context.env),
          client: liabilitiesPlaidClientFor(context.env),
          accessSubject: context.get("identity").subject,
          connectionId: context.req.param("connectionId"),
          refreshKind: "live",
        });
        return context.json(state, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        return liabilitiesErrorResponse(context, error);
      }
    },
  );

  app.delete("/api/liabilities/connections/:connectionId", async (context) => {
    if (!liabilitiesConfiguredFor(context.env)) {
      return context.json(
        { error: "Obligation import is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const state = await disconnectLiabilities({
        env: context.env,
        repository: liabilitiesRepositoryFor(context.env),
        client: liabilitiesPlaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
        connectionId: context.req.param("connectionId"),
      });
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return liabilitiesErrorResponse(context, error);
    }
  });

  app.post("/api/liability-proposals/manual", async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = ManualLiabilityInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        {
          error: "Manual obligation input is invalid.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const proposal = await liabilitiesRepositoryFor(
        context.env,
      ).stageManualProposal(context.get("identity").subject, parsed.data);
      return context.json(proposal, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return liabilitiesErrorResponse(context, error);
    }
  });

  app.post("/api/liability-proposals/:proposalId/apply", async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = LiabilityApplyInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        {
          error: "Obligation review input is invalid.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const result = await liabilitiesRepositoryFor(context.env).applyProposal(
        context.get("identity").subject,
        context.req.param("proposalId"),
        parsed.data,
      );
      return context.json(result, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("stale") || message.includes("UNIQUE")) {
        return context.json(
          { error: "This obligation review is no longer current." },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "Every obligation needs a valid review decision." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/investment-connections", async (context) => {
    try {
      const state = await investmentConnectionsRepositoryFor(
        context.env,
      ).getState(
        context.get("identity").subject,
        investmentsConfiguredFor(context.env),
      );
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Investment connection status is unavailable." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/holdings-page", async (context) => {
    try {
      const page = await holdingsPageRepositoryFor(context.env).getPage(
        context.get("identity").subject,
        !investmentsConfiguredFor(context.env)
          ? "configuration_required"
          : newInvestmentConnectionsAvailableFor(context.env)
            ? "available"
            : "provider_approval_required",
      );
      return context.json(HoldingsPageSchema.parse(page), 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json({ error: "Holdings are unavailable." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
  });

  app.get("/api/investment-position-links", async (context) => {
    try {
      return context.json(
        await new D1PositionLinkRepository(context.env.DB).workspace(
          context.get("identity").subject,
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json(
        { error: "Investment records are unavailable. Try again." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });
  app.post("/api/investment-position-links", async (context) => {
    const input = AcceptPositionLinkSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json(
        { error: "Choose valid investment records and a relationship." },
        400,
      );
    try {
      const receipt = await new D1PositionLinkRepository(context.env.DB).accept(
        context.get("identity").subject,
        input.data,
      );
      return context.json(receipt, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      if (error instanceof PositionLinkError)
        return context.json({ error: error.message }, 409, {
          "Cache-Control": "private, no-store",
        });
      return context.json(
        { error: "The investment link could not be saved. Try again." },
        503,
      );
    }
  });

  app.get("/api/investment-holdings", async (context) => {
    const accessSubject = context.get("identity").subject;
    const asOf = new Date().toISOString();
    try {
      const positionView = await investmentPositionViewRepositoryFor(
        context.env,
      ).list(accessSubject, asOf);
      const exposureView = await investmentExposureViewRepositoryFor(
        context.env,
      ).list(accessSubject, asOf, positionView);
      return context.json(
        InvestmentHoldingsViewSchema.parse({
          version: 1,
          authorizationStatus: !investmentsConfiguredFor(context.env)
            ? "configuration_required"
            : newInvestmentConnectionsAvailableFor(context.env)
              ? "available"
              : "provider_approval_required",
          positionView,
          exposureView,
        }),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json(
        { error: "Investment holdings are unavailable." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  const companyIdentityErrorResponse = (
    context: Context<AppEnvironment>,
    error: unknown,
  ) => {
    if (error instanceof CompanyIdentityError)
      return context.json(
        { error: error.message },
        error.code === "not_found" ? 404 : error.code === "stale" ? 409 : 400,
        { "Cache-Control": "private, no-store" },
      );
    throw error;
  };
  app.get("/api/companies/identity", async (context) => {
    try {
      return context.json(
        CompanyIdentityCatalogSchema.parse(
          await companyIdentityRepositoryFor(context.env).getCatalog(
            context.get("identity").subject,
          ),
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return companyIdentityErrorResponse(context, error);
    }
  });
  app.post("/api/companies/aliases/preview", async (context) => {
    const input = CompanyAliasProposalSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json(
        { error: "Choose a valid company and alternative name." },
        400,
      );
    try {
      return context.json(
        CompanyAliasPreviewSchema.parse(
          await companyIdentityRepositoryFor(context.env).preview(
            context.get("identity").subject,
            input.data,
          ),
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return companyIdentityErrorResponse(context, error);
    }
  });
  app.post("/api/companies/aliases", async (context) => {
    const input = CompanyAliasReviewInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json(
        { error: "Review the company grouping and explain the name match." },
        400,
      );
    try {
      return context.json(
        CompanyAliasReceiptSchema.parse(
          await companyIdentityRepositoryFor(context.env).review(
            context.get("identity").subject,
            input.data,
          ),
        ),
        201,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return companyIdentityErrorResponse(context, error);
    }
  });
  app.get("/api/companies/public-links", async (context) => {
    try {
      return context.json(
        PublicCompanyLinkCatalogSchema.parse(
          await new D1PublicCompanyLinkRepository(context.env.DB).getCatalog(
            context.get("identity").subject,
          ),
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json({ error: "Public holdings are unavailable." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
  });
  app.post(
    "/api/companies/public-links/:exposureId/recommendation",
    async (context) => {
      const input = PublicCompanyLookupInputSchema.safeParse({
        exposureId: context.req.param("exposureId"),
      });
      if (!input.success)
        return context.json({ error: "Choose a valid public holding." }, 400);
      try {
        const key = context.env.BRAVE_SEARCH_API_KEY;
        return context.json(
          PublicCompanyMatchSchema.parse(
            await new D1PublicCompanyLinkRepository(context.env.DB).recommend(
              context.get("identity").subject,
              context.req.param("exposureId"),
              (issuer) => searchIssuerEvidence(issuer, key),
            ),
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        return context.json(
          {
            error:
              error instanceof PublicCompanyLinkError
                ? error.message
                : "Couldn’t check the issuer match. Try again.",
          },
          error instanceof PublicCompanyLinkError && error.code === "not_found"
            ? 404
            : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );
  app.post(
    "/api/companies/public-links/recommendations/:id/approve",
    async (context) => {
      const input = PublicCompanyApprovalInputSchema.safeParse({
        id: context.req.param("id"),
      });
      if (!input.success)
        return context.json(
          { error: "Choose a valid issuer recommendation." },
          400,
        );
      try {
        return context.json(
          await new D1PublicCompanyLinkRepository(
            context.env.DB,
          ).approveRecommendation(
            context.get("identity").subject,
            context.req.param("id"),
          ),
          201,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        return context.json(
          {
            error:
              error instanceof PublicCompanyLinkError
                ? error.message
                : "The company grouping could not be saved.",
          },
          error instanceof PublicCompanyLinkError
            ? error.code === "not_found"
              ? 404
              : error.code === "stale"
                ? 409
                : 400
            : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );
  app.post("/api/companies/public-links", async (context) => {
    const input = PublicCompanyLinkReviewSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json(
        { error: "Choose the security, company and issuer evidence." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    try {
      return context.json(
        PublicCompanyLinkReceiptSchema.parse(
          await new D1PublicCompanyLinkRepository(context.env.DB).review(
            context.get("identity").subject,
            input.data,
          ),
        ),
        201,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      if (error instanceof PublicCompanyLinkError)
        return context.json(
          { error: error.message },
          error.code === "not_found" ? 404 : error.code === "stale" ? 409 : 400,
          { "Cache-Control": "private, no-store" },
        );
      throw error;
    }
  });

  const investmentReviewErrorResponse = (
    context: Context<AppEnvironment>,
    error: unknown,
  ) => {
    const known = error instanceof InvestmentReviewError;
    return context.json(
      { error: known ? error.message : "Investment review is unavailable." },
      known
        ? error.code === "not_found"
          ? 404
          : error.code === "stale"
            ? 409
            : 400
        : 503,
      { "Cache-Control": "private, no-store" },
    );
  };
  app.get("/api/investment-positions/:positionId/review", async (context) => {
    try {
      return context.json(
        InvestmentReviewContextSchema.parse(
          await investmentReviewRepositoryFor(context.env).getContext(
            context.get("identity").subject,
            context.req.param("positionId"),
          ),
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return investmentReviewErrorResponse(context, error);
    }
  });
  app.post("/api/investment-positions/:positionId/review", async (context) => {
    const input = ReviewInvestmentInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json({ error: "Enter valid investment details." }, 400, {
        "Cache-Control": "private, no-store",
      });
    try {
      return context.json(
        InvestmentReviewStateSchema.parse(
          await investmentReviewRepositoryFor(context.env).review(
            context.get("identity").subject,
            context.req.param("positionId"),
            input.data,
          ),
        ),
        201,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return investmentReviewErrorResponse(context, error);
    }
  });
  app.post(
    "/api/investment-positions/:positionId/company-review",
    async (context) => {
      const input = InvestmentCompanyReviewInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!input.success)
        return context.json({ error: "Choose valid company evidence." }, 400, {
          "Cache-Control": "private, no-store",
        });
      try {
        return context.json(
          InvestmentCompanyReceiptSchema.parse(
            await investmentReviewRepositoryFor(context.env).reviewCompany(
              context.get("identity").subject,
              context.req.param("positionId"),
              input.data,
            ),
          ),
          201,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        return investmentReviewErrorResponse(context, error);
      }
    },
  );
  app.post(
    "/api/investment-positions/:positionId/related-investments",
    async (context) => {
      const input = CreateDocumentInvestmentInputSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!input.success)
        return context.json(
          { error: "Choose agreements for the separate investment." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      try {
        return context.json(
          CreateDocumentInvestmentResultSchema.parse(
            await investmentReviewRepositoryFor(context.env).createRelated(
              context.get("identity").subject,
              context.req.param("positionId"),
              input.data,
            ),
          ),
          201,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        return investmentReviewErrorResponse(context, error);
      }
    },
  );

  app.post("/api/legal-entities/resolve", async (context) => {
    const input = ResolveInvestmentReviewsInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json(
        { error: "Enter a valid automatic review cursor." },
        400,
      );
    const result = await automaticInvestmentReviewRepositoryFor(
      context.env,
    ).resolve(context.get("identity").subject, input.data.afterPositionId);
    return context.json(
      ResolveInvestmentReviewsResultSchema.parse(result),
      200,
      { "Cache-Control": "private, no-store" },
    );
  });

  app.get("/api/legal-entities", async (context) => {
    const accessSubject = context.get("identity").subject;
    const asOf = new Date().toISOString();
    try {
      const positionView = investmentPositionViewRepositoryFor(
        context.env,
      ).list(accessSubject, asOf, true);
      const inventory = await legalEntityRepositoryFor(context.env).getState(
        accessSubject,
        positionView,
      );
      return context.json(LegalEntityInventorySchema.parse(inventory), 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return legalEntityErrorResponse(context, error);
    }
  });

  app.post("/api/legal-entities", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const input = CreateLegalEntityInputSchema.safeParse(rawInput);
    if (!input.success) {
      return context.json({ error: "Enter valid legal entity details." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const accessSubject = context.get("identity").subject;
    const asOf = new Date().toISOString();
    try {
      const positionView = await investmentPositionViewRepositoryFor(
        context.env,
      ).list(accessSubject, asOf, true);
      const entity = await legalEntityRepositoryFor(context.env).create(
        accessSubject,
        input.data,
        positionView,
      );
      return context.json(LegalEntityRecordSchema.parse(entity), 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return legalEntityErrorResponse(context, error);
    }
  });

  app.put("/api/legal-entities/:legalEntityId", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const input = UpdateLegalEntityInputSchema.safeParse(rawInput);
    if (!input.success) {
      return context.json({ error: "Enter valid legal entity details." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    try {
      const entity = await legalEntityRepositoryFor(context.env).update(
        context.get("identity").subject,
        context.req.param("legalEntityId"),
        input.data,
      );
      return context.json(LegalEntityRecordSchema.parse(entity), 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return legalEntityErrorResponse(context, error);
    }
  });

  app.post("/api/legal-entity-sources/review", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const input = ReviewLegalEntitySourceInputSchema.safeParse(rawInput);
    if (!input.success) {
      return context.json(
        { error: "Choose a valid source review decision." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    const accessSubject = context.get("identity").subject;
    const asOf = new Date().toISOString();
    try {
      const positionView = await investmentPositionViewRepositoryFor(
        context.env,
      ).list(accessSubject, asOf, true);
      const result = await legalEntityRepositoryFor(context.env).reviewSource(
        accessSubject,
        input.data,
        positionView,
      );
      return context.json(
        LegalEntitySourceReviewResultSchema.parse(result),
        201,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return legalEntityErrorResponse(context, error);
    }
  });

  app.post("/api/legal-entity-sources/exact-batch", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const input = LegalEntityExactBatchInputSchema.safeParse(rawInput);
    if (!input.success) {
      return context.json(
        { error: "The exact legal entity review is invalid." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    const accessSubject = context.get("identity").subject;
    const asOf = new Date().toISOString();
    try {
      const positionView = await investmentPositionViewRepositoryFor(
        context.env,
      ).list(accessSubject, asOf, true);
      const result = await legalEntityRepositoryFor(
        context.env,
      ).applyExactBatch(accessSubject, input.data, positionView);
      return context.json(
        LegalEntityExactBatchResultSchema.parse(result),
        201,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return legalEntityErrorResponse(context, error);
    }
  });

  app.get("/api/legal-entity-export/options", (context) => {
    const options = LegalEntityExportOptionsSchema.safeParse({
      googleSheetsClientId: context.env.GOOGLE_SHEETS_CLIENT_ID ?? null,
    });
    return context.json(
      options.success ? options.data : { googleSheetsClientId: null },
      200,
      { "Cache-Control": "private, no-store" },
    );
  });

  app.post("/api/legal-entity-export", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const input = LegalEntityExportInputSchema.safeParse(rawInput);
    if (!input.success) {
      return context.json(
        { error: "Choose at least one supported export field." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    const accessSubject = context.get("identity").subject;
    const asOf = new Date().toISOString();
    try {
      const positionView = await investmentPositionViewRepositoryFor(
        context.env,
      ).list(accessSubject, asOf, true);
      const inventory = await legalEntityRepositoryFor(context.env).getState(
        accessSubject,
        positionView,
      );
      if (context.req.header("Accept")?.includes("application/json")) {
        return context.json(
          legalEntityExportTable(inventory, input.data),
          200,
          {
            "Cache-Control": "private, no-store",
          },
        );
      }
      return context.body(legalEntityExportCsv(inventory, input.data), 200, {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="keel-legal-entities-${asOf.slice(0, 10)}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      });
    } catch (error) {
      return legalEntityErrorResponse(context, error);
    }
  });

  app.post(
    "/api/investment-positions/:positionId/value-adjustments",
    async (context) => {
      let rawInput: unknown;
      try {
        rawInput = await context.req.json();
      } catch {
        return context.json({ error: "A JSON request body is required." }, 400);
      }
      const input =
        AcceptPositionValueAdjustmentInputSchema.safeParse(rawInput);
      if (!input.success) {
        return context.json(
          {
            error: "Position value evidence is invalid.",
            issues: input.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }

      try {
        const adjustment = await positionValueAdjustmentRepositoryFor(
          context.env,
        ).accept(
          context.get("identity").subject,
          context.req.param("positionId"),
          input.data,
        );
        return context.json(
          PositionValueAdjustmentSchema.parse(adjustment),
          201,
          {
            "Cache-Control": "private, no-store",
          },
        );
      } catch (error) {
        if (error instanceof PositionValueAdjustmentError) {
          if (error.code === "not_found") {
            return context.json({ error: "Position was not found." }, 404, {
              "Cache-Control": "private, no-store",
            });
          }
          return context.json(
            {
              error:
                error.code === "stale"
                  ? "The position value changed. Review the latest value and try again."
                  : error.message,
            },
            409,
            { "Cache-Control": "private, no-store" },
          );
        }
        return context.json(
          { error: "Position value evidence could not be accepted." },
          500,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/investment-positions/:positionId/economics",
    async (context) => {
      let rawInput: unknown;
      try {
        rawInput = await context.req.json();
      } catch {
        return context.json({ error: "A JSON request body is required." }, 400);
      }
      const input = AcceptPositionEconomicsInputSchema.safeParse(rawInput);
      if (!input.success) {
        return context.json(
          {
            error: "SPV fee and carry terms are invalid.",
            issues: input.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }

      try {
        const terms = await positionEconomicsRepositoryFor(context.env).accept(
          context.get("identity").subject,
          context.req.param("positionId"),
          input.data,
        );
        return context.json(PositionEconomicsTermsSchema.parse(terms), 201, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        if (error instanceof PositionEconomicsError) {
          if (error.code === "not_found") {
            return context.json({ error: "Position was not found." }, 404, {
              "Cache-Control": "private, no-store",
            });
          }
          return context.json(
            {
              error:
                error.code === "stale"
                  ? "The position changed. Review the latest terms and try again."
                  : error.message,
            },
            409,
            { "Cache-Control": "private, no-store" },
          );
        }
        return context.json(
          { error: "SPV fee and carry terms could not be accepted." },
          500,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.get("/api/investment-positions/:positionId/history", async (context) => {
    const query = z
      .object({
        date: z.iso.datetime(),
        id: z.string().min(1).max(200),
        kind: z.enum(["investment", "link"]),
      })
      .safeParse(context.req.query());
    if (Object.keys(context.req.query()).length && !query.success)
      return context.json({ error: "Invalid history cursor." }, 400);
    const history = await new D1PositionPurchaseRepository(
      context.env.DB,
    ).history(
      context.get("identity").subject,
      context.req.param("positionId"),
      query.success ? query.data : undefined,
    );
    return context.json(history, 200, { "Cache-Control": "private, no-store" });
  });

  app.post(
    "/api/investment-positions/:positionId/valuation",
    async (context) => {
      let raw: unknown;
      try {
        raw = await context.req.json();
      } catch {
        return context.json({ error: "A JSON request body is required." }, 400);
      }
      const parsed = AcceptValuationSchema.safeParse(raw);
      if (!parsed.success)
        return context.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid valuation." },
          400,
        );
      try {
        const receipt = await new D1PositionPurchaseRepository(
          context.env.DB,
        ).acceptValuation(
          context.get("identity").subject,
          context.req.param("positionId"),
          parsed.data,
        );
        return context.json(PurchaseReceiptSchema.parse(receipt), 201, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        if (error instanceof PositionPurchaseError)
          return context.json(
            { error: error.message },
            error.code === "not_found" ? 404 : 409,
          );
        return context.json(
          { error: "The valuation could not be saved." },
          500,
        );
      }
    },
  );

  app.get(
    "/api/investment-positions/:positionId/share-price-evidence",
    async (context) => {
      const evidence = await new D1PositionPurchaseRepository(
        context.env.DB,
      ).valuationEvidence(
        context.get("identity").subject,
        context.req.param("positionId"),
      );
      return context.json(evidence, 200, {
        "Cache-Control": "private, no-store",
      });
    },
  );

  app.post(
    "/api/investment-positions/:positionId/purchases",
    async (context) => {
      let raw: unknown;
      try {
        raw = await context.req.json();
      } catch {
        return context.json({ error: "A JSON request body is required." }, 400);
      }
      const input = AcceptPurchasesSchema.safeParse(raw);
      if (!input.success)
        return context.json(
          {
            error:
              input.error.issues[0]?.message ?? "Purchase details are invalid.",
          },
          400,
        );
      try {
        const receipt = await (
          options.positionPurchaseRepository ??
          new D1PositionPurchaseRepository(context.env.DB)
        ).accept(
          context.get("identity").subject,
          context.req.param("positionId"),
          input.data,
        );
        return context.json(PurchaseReceiptSchema.parse(receipt), 201, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        if (error instanceof PositionPurchaseError)
          return context.json(
            { error: error.message },
            error.code === "not_found" ? 404 : 409,
          );
        return context.json(
          { error: "Purchase details could not be saved." },
          500,
        );
      }
    },
  );

  app.get("/api/private-exposure-reviews", async (context) => {
    try {
      const state = await privateExposureReviewRepositoryFor(
        context.env,
      ).getPrivateExposureReviewState(context.get("identity").subject);
      return context.json(PrivateExposureReviewStateSchema.parse(state), 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Private exposure reviews are unavailable." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/private-exposure-reviews/exact-batch", async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400, {
        "Cache-Control": "private, no-store",
      });
    }
    const parsed = PrivateExposureExactBatchInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { error: "Review the current exact company assignments." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const result = await privateExposureReviewRepositoryFor(
        context.env,
      ).applyPrivateExposureExactBatch(
        context.get("identity").subject,
        parsed.data,
      );
      return context.json(
        PrivateExposureExactBatchResultSchema.parse(result),
        201,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      if (error instanceof PrivateExposureReviewError) {
        return context.json(
          {
            error:
              error.code === "no_matches"
                ? "No exact company assignments are ready."
                : "The exact company assignments changed. Review them again.",
          },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "Keel could not assign the exact company matches." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post(
    "/api/private-exposure-reviews/:positionId/assign",
    async (context) => {
      let input: unknown;
      try {
        input = await context.req.json();
      } catch {
        return context.json(
          { error: "A JSON request body is required." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }
      const parsed = PrivateExposureResolutionInputSchema.safeParse(input);
      if (!parsed.success) {
        return context.json(
          { error: "Choose a valid reviewed company." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }
      try {
        const result = await privateExposureReviewRepositoryFor(
          context.env,
        ).assignPrivateCompanyExposure(
          context.get("identity").subject,
          context.req.param("positionId"),
          parsed.data,
        );
        return context.json(
          PrivateExposureResolutionResultSchema.parse(result),
          201,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        if (error instanceof PrivateExposureReviewError) {
          if (error.code === "not_found") {
            return context.json(
              { error: "This position is not available for exposure review." },
              404,
              { "Cache-Control": "private, no-store" },
            );
          }
          if (error.code === "invalid_company") {
            return context.json(
              { error: "Choose a company from this household." },
              400,
              { "Cache-Control": "private, no-store" },
            );
          }
          if (error.code === "company_conflict") {
            return context.json(
              {
                error:
                  "That reviewed company already exists. Choose it from the list.",
              },
              409,
              { "Cache-Control": "private, no-store" },
            );
          }
          return context.json(
            { error: "This exposure review is no longer current." },
            409,
            { "Cache-Control": "private, no-store" },
          );
        }
        return context.json(
          { error: "Keel could not assign this exposure." },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post("/api/investment-connections/link-token", async (context) => {
    if (!investmentsConfiguredFor(context.env)) {
      return context.json(
        { error: "Investment sync is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    if (!newInvestmentConnectionsAvailableFor(context.env)) {
      return context.json(
        {
          error: "New investment connections are not enabled.",
        },
        409,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const linkToken = await plaidClientFor(context.env).createLinkToken(
        context.get("identity").subject,
      );
      return context.json(linkToken, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return investmentsErrorResponse(context, error);
    }
  });

  app.post(
    "/api/investment-connections/:connectionId/link-token",
    async (context) => {
      if (!investmentsConfiguredFor(context.env)) {
        return context.json(
          { error: "Investment sync is not configured." },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
      const connectionId = z
        .uuid()
        .safeParse(context.req.param("connectionId"));
      if (!connectionId.success) {
        return context.json(
          { error: "Investment connection is invalid." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }
      try {
        const linkToken = await createInvestmentReconnectLinkToken({
          env: context.env,
          repository: investmentConnectionsRepositoryFor(context.env),
          client: plaidClientFor(context.env),
          accessSubject: context.get("identity").subject,
          connectionId: connectionId.data,
        });
        return context.json(linkToken, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        return investmentsErrorResponse(context, error);
      }
    },
  );

  app.post("/api/investment-connections/exchange", async (context) => {
    if (!investmentsConfiguredFor(context.env)) {
      return context.json(
        { error: "Investment sync is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "Investment connection is invalid." }, 400);
    }
    const parsed = InvestmentExchangeInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json({ error: "Investment connection is invalid." }, 400);
    }
    if (!newInvestmentConnectionsAvailableFor(context.env)) {
      return context.json(
        { error: "New investment connections are not enabled." },
        409,
        { "Cache-Control": "private, no-store" },
      );
    }
    const accessSubject = context.get("identity").subject;
    try {
      const repository = investmentConnectionsRepositoryFor(context.env);
      const client = plaidClientFor(context.env);
      const connection = await connectInvestmentConnection({
        env: context.env,
        repository,
        client,
        accessSubject,
        publicToken: parsed.data.publicToken,
      });
      const status = await syncInvestmentConnection({
        env: context.env,
        repository,
        holdingImports: holdingImportRepositoryFor(context.env),
        portfolioBaselines: portfolioBaselineRepositoryFor(context.env),
        client,
        accessSubject,
        connectionId: connection.connectionId,
      });
      await reconcileRetainedPublicExposureHistory(context, accessSubject);
      return context.json(status, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return investmentsErrorResponse(context, error);
    }
  });

  app.post("/api/investment-connections/auto-sync", async (context) => {
    if (!investmentsConfiguredFor(context.env)) {
      return context.json(
        { error: "Investment sync is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    const accessSubject = context.get("identity").subject;
    try {
      const state = await syncDueInvestmentConnections({
        env: context.env,
        repository: investmentConnectionsRepositoryFor(context.env),
        holdingImports: holdingImportRepositoryFor(context.env),
        portfolioBaselines: portfolioBaselineRepositoryFor(context.env),
        client: plaidClientFor(context.env),
        accessSubject,
      });
      await reconcileRetainedPublicExposureHistory(context, accessSubject);
      return context.json(state, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return investmentsErrorResponse(context, error);
    }
  });

  app.post(
    "/api/investment-connections/:connectionId/sync",
    async (context) => {
      if (!investmentsConfiguredFor(context.env)) {
        return context.json(
          { error: "Investment sync is not configured." },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
      const connectionId = z
        .uuid()
        .safeParse(context.req.param("connectionId"));
      if (!connectionId.success) {
        return context.json(
          { error: "Investment connection is invalid." },
          400,
        );
      }
      const accessSubject = context.get("identity").subject;
      try {
        const status = await syncInvestmentConnection({
          env: context.env,
          repository: investmentConnectionsRepositoryFor(context.env),
          holdingImports: holdingImportRepositoryFor(context.env),
          portfolioBaselines: portfolioBaselineRepositoryFor(context.env),
          client: plaidClientFor(context.env),
          accessSubject,
          connectionId: connectionId.data,
        });
        await reconcileRetainedPublicExposureHistory(context, accessSubject);
        return context.json(status, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        return investmentsErrorResponse(context, error);
      }
    },
  );

  app.patch(
    "/api/investment-connections/:connectionId/lifecycle",
    async (context) => {
      const connectionId = z
        .uuid()
        .safeParse(context.req.param("connectionId"));
      if (!connectionId.success) {
        return context.json(
          { error: "Investment connection is invalid." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }
      let input: unknown;
      try {
        input = await context.req.json();
      } catch {
        return context.json(
          { error: "Investment connection action is invalid." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }
      const parsed =
        InvestmentConnectionLifecycleActionInputSchema.safeParse(input);
      if (!parsed.success) {
        return context.json(
          { error: "Investment connection action is invalid." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }
      try {
        const repository = investmentConnectionsRepositoryFor(context.env);
        await repository.setConnectionPaused(
          context.get("identity").subject,
          connectionId.data,
          parsed.data.action === "pause",
        );
        const status = await repository.getConnectionStatus(
          context.get("identity").subject,
          connectionId.data,
        );
        return context.json(status, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch {
        return context.json(
          { error: "Investment connection state could not be changed." },
          409,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.delete("/api/investment-connections/:connectionId", async (context) => {
    if (!investmentsConfiguredFor(context.env)) {
      return context.json(
        { error: "Investment sync is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    const connectionId = z.uuid().safeParse(context.req.param("connectionId"));
    if (!connectionId.success) {
      return context.json({ error: "Investment connection is invalid." }, 400);
    }
    try {
      const status = await disconnectInvestmentConnection({
        env: context.env,
        repository: investmentConnectionsRepositoryFor(context.env),
        client: plaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
        connectionId: connectionId.data,
      });
      return context.json(status, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return investmentsErrorResponse(context, error);
    }
  });

  app.post(
    "/api/automation/provider-browser/:provider/reconnect",
    async (context) => {
      const provider = providerBrowserTarget(context.req.param("provider"));
      if (provider === null) {
        return context.json({ error: "Provider is not supported." }, 404, {
          "Cache-Control": "private, no-store",
        });
      }
      try {
        const session = await providerBrowserSessionRepositoryFor(
          context.env,
        ).create(context.get("identity").subject, provider);
        return context.json(session, 202, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "provider_browser_session_failed",
            requestId: context.get("requestId"),
            operation: "create",
            provider,
            ...providerBrowserFailureDiagnostic(error),
          }),
        );
        const setupRequired =
          error instanceof ProviderBrowserSessionRepositoryError &&
          error.code === "agent_not_registered";
        return context.json(
          {
            error: setupRequired
              ? `Set up ${providerBrowserLabel(provider)} updates first.`
              : `Keel could not start the ${providerBrowserLabel(provider)} reconnect.`,
          },
          setupRequired ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.get(
    "/api/automation/provider-browser/sessions/:sessionId",
    async (context) => {
      const sessionId = z.uuid().safeParse(context.req.param("sessionId"));
      if (!sessionId.success) {
        return context.json({ error: "Reconnect session is invalid." }, 400, {
          "Cache-Control": "private, no-store",
        });
      }
      try {
        return context.json(
          await providerBrowserSessionRepositoryFor(context.env).get(
            context.get("identity").subject,
            sessionId.data,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const notFound =
          error instanceof ProviderBrowserSessionRepositoryError &&
          error.code === "session_not_found";
        return context.json(
          { error: "Reconnect session is not available." },
          notFound ? 404 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.delete(
    "/api/automation/provider-browser/sessions/:sessionId",
    async (context) => {
      const sessionId = z.uuid().safeParse(context.req.param("sessionId"));
      if (!sessionId.success) {
        return context.json({ error: "Reconnect session is invalid." }, 400, {
          "Cache-Control": "private, no-store",
        });
      }
      try {
        return context.json(
          await providerBrowserSessionRepositoryFor(context.env).cancel(
            context.get("identity").subject,
            sessionId.data,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const notFound =
          error instanceof ProviderBrowserSessionRepositoryError &&
          error.code === "session_not_found";
        return context.json(
          { error: "Reconnect session could not be cancelled." },
          notFound ? 404 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.get(
    "/api/automation/provider-browser/sessions/:sessionId/open",
    async (context) => {
      const sessionId = z.uuid().safeParse(context.req.param("sessionId"));
      if (!sessionId.success) {
        return context.json({ error: "Reconnect session is invalid." }, 400, {
          "Cache-Control": "private, no-store",
        });
      }
      try {
        const destination = await providerBrowserSessionRepositoryFor(
          context.env,
        ).consume(context.get("identity").subject, sessionId.data);
        return new Response(null, {
          status: 302,
          headers: {
            "Cache-Control": "private, no-store",
            Location: destination,
            "Referrer-Policy": "no-referrer",
          },
        });
      } catch (error) {
        const notFound =
          error instanceof ProviderBrowserSessionRepositoryError &&
          error.code === "session_not_found";
        return context.json(
          {
            error: notFound
              ? "Reconnect session is not available."
              : "The secure browser is not ready or was already opened.",
          },
          notFound ? 404 : 409,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-browser/:provider/mac-agent/lease",
    async (context) => {
      const provider = providerBrowserTarget(context.req.param("provider"));
      if (provider === null || context.get("macAgentTarget") !== provider) {
        return context.json({ error: "Not found." }, 404, {
          "Cache-Control": "no-store",
        });
      }
      try {
        return context.json(
          await providerBrowserSessionRepositoryFor(context.env).lease(
            context.get("identity").subject,
            provider,
          ),
          200,
          { "Cache-Control": "no-store" },
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "provider_browser_session_failed",
            requestId: context.get("requestId"),
            operation: "lease",
            provider,
            ...providerBrowserFailureDiagnostic(error),
          }),
        );
        return context.json(
          { error: "Reconnect work could not be checked." },
          503,
          { "Cache-Control": "no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-browser/:provider/mac-agent/rotate",
    async (context) => {
      const provider = providerBrowserTarget(context.req.param("provider"));
      if (provider === null || context.get("macAgentTarget") !== provider) {
        return context.json({ error: "Not found." }, 404, {
          "Cache-Control": "no-store",
        });
      }
      const apiOrigin = macAgentApiOrigin(context.env, context.req.url);
      const bearer =
        /^Bearer (.+)$/u.exec(context.req.header("Authorization") ?? "")?.[1] ??
        "";
      const token = MacAgentTokenSchema.safeParse(bearer);
      if (apiOrigin === null || !token.success) {
        return context.json(
          { error: "Portfolio agent access is unavailable." },
          503,
          { "Cache-Control": "no-store" },
        );
      }
      try {
        const replacement = await macAgentCredentialRepositoryFor(
          context.env,
        ).rotateToken(context.get("identity").subject, provider, token.data);
        return context.json(
          MacAgentAuthorizationSchema.parse({
            version: 1,
            target: provider,
            apiOrigin,
            token: replacement,
          }),
          200,
          { "Cache-Control": "no-store" },
        );
      } catch {
        return context.json(
          { error: "Portfolio agent access could not be rotated." },
          409,
          { "Cache-Control": "no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/status",
    async (context) => {
      const provider = providerBrowserTarget(context.req.param("provider"));
      const sessionId = z.uuid().safeParse(context.req.param("sessionId"));
      if (
        provider === null ||
        !sessionId.success ||
        context.get("macAgentTarget") !== provider
      ) {
        return context.json({ error: "Not found." }, 404, {
          "Cache-Control": "no-store",
        });
      }
      try {
        const session = await providerBrowserSessionRepositoryFor(
          context.env,
        ).get(context.get("identity").subject, sessionId.data);
        if (session.provider !== provider) {
          return context.json({ error: "Not found." }, 404, {
            "Cache-Control": "no-store",
          });
        }
        return context.json(session, 200, { "Cache-Control": "no-store" });
      } catch {
        return context.json(
          { error: "Reconnect session is not available." },
          404,
          { "Cache-Control": "no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/ready",
    async (context) => {
      const provider = providerBrowserTarget(context.req.param("provider"));
      const sessionId = z.uuid().safeParse(context.req.param("sessionId"));
      if (
        provider === null ||
        !sessionId.success ||
        context.get("macAgentTarget") !== provider
      ) {
        return context.json({ error: "Not found." }, 404, {
          "Cache-Control": "no-store",
        });
      }
      const rawInput: unknown = await context.req.json().catch(() => null);
      const input = ProviderBrowserSessionReadyInputSchema.safeParse(rawInput);
      if (!input.success) {
        return context.json({ error: "Reconnect session is invalid." }, 400, {
          "Cache-Control": "no-store",
        });
      }
      try {
        return context.json(
          await providerBrowserSessionRepositoryFor(context.env).ready(
            context.get("identity").subject,
            provider,
            sessionId.data,
            input.data,
          ),
          200,
          { "Cache-Control": "no-store" },
        );
      } catch {
        return context.json(
          { error: "Reconnect session is no longer available." },
          409,
          { "Cache-Control": "no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/complete",
    async (context) => {
      const provider = providerBrowserTarget(context.req.param("provider"));
      const sessionId = z.uuid().safeParse(context.req.param("sessionId"));
      if (
        provider === null ||
        !sessionId.success ||
        context.get("macAgentTarget") !== provider
      ) {
        return context.json({ error: "Not found." }, 404, {
          "Cache-Control": "no-store",
        });
      }
      const rawInput: unknown = await context.req.json().catch(() => null);
      const input =
        ProviderBrowserSessionCompletionInputSchema.safeParse(rawInput);
      if (!input.success) {
        return context.json({ error: "Reconnect session is invalid." }, 400, {
          "Cache-Control": "no-store",
        });
      }
      try {
        return context.json(
          await providerBrowserSessionRepositoryFor(context.env).complete(
            context.get("identity").subject,
            provider,
            sessionId.data,
            input.data,
          ),
          200,
          { "Cache-Control": "no-store" },
        );
      } catch {
        return context.json(
          { error: "Reconnect session is no longer available." },
          409,
          { "Cache-Control": "no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/fail",
    async (context) => {
      const provider = providerBrowserTarget(context.req.param("provider"));
      const sessionId = z.uuid().safeParse(context.req.param("sessionId"));
      if (
        provider === null ||
        !sessionId.success ||
        context.get("macAgentTarget") !== provider
      ) {
        return context.json({ error: "Not found." }, 404, {
          "Cache-Control": "no-store",
        });
      }
      const rawInput: unknown = await context.req.json().catch(() => null);
      const input =
        ProviderBrowserSessionFailureInputSchema.safeParse(rawInput);
      if (!input.success) {
        return context.json({ error: "Reconnect session is invalid." }, 400, {
          "Cache-Control": "no-store",
        });
      }
      try {
        return context.json(
          await providerBrowserSessionRepositoryFor(context.env).fail(
            context.get("identity").subject,
            provider,
            sessionId.data,
            input.data,
          ),
          200,
          { "Cache-Control": "no-store" },
        );
      } catch {
        return context.json(
          { error: "Reconnect session is no longer available." },
          409,
          { "Cache-Control": "no-store" },
        );
      }
    },
  );

  app.get("/api/automation/angellist/status", async (context) => {
    try {
      const status = await angelListMacAgentRepositoryFor(
        context.env,
      ).getOverview(context.get("identity").subject);
      return context.json(status, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "AngelList update status is unavailable." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/automation/angellist/run", async (context) => {
    try {
      const status = await angelListMacAgentRepositoryFor(
        context.env,
      ).requestRun(context.get("identity").subject);
      return context.json(status, 202, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const notRegistered =
        error instanceof AngelListMacAgentRepositoryError &&
        error.code === "agent_not_registered";
      return context.json(
        {
          error: notRegistered
            ? "Finish AngelList agent setup first."
            : "Keel could not queue this AngelList update.",
        },
        notRegistered ? 409 : 503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/automation/angellist/mac-agent/register", async (context) => {
    try {
      return context.json(
        await angelListMacAgentRepositoryFor(context.env).register(
          context.get("identity").subject,
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json(
        { error: "Agent setup could not be registered." },
        503,
        {
          "Cache-Control": "private, no-store",
        },
      );
    }
  });

  app.post("/api/automation/angellist/mac-agent/authorize", async (context) => {
    if (context.req.header("X-Keel-Mac-Setup") !== "1") {
      return context.json({ error: "Agent setup request is invalid." }, 403, {
        "Cache-Control": "private, no-store",
      });
    }
    const apiOrigin = macAgentApiOrigin(context.env, context.req.url);
    if (apiOrigin === null) {
      return context.json(
        { error: "Secure agent access is not configured." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
    try {
      const accessSubject = context.get("identity").subject;
      await angelListMacAgentRepositoryFor(context.env).register(accessSubject);
      const token = await macAgentCredentialRepositoryFor(
        context.env,
      ).issueToken(accessSubject, "angellist");
      return context.json(
        MacAgentAuthorizationSchema.parse({
          version: 1,
          target: "angellist",
          apiOrigin,
          token,
        }),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json(
        { error: "Secure agent access could not be created." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/automation/angellist/mac-agent/run", async (context) => {
    try {
      return context.json(
        await angelListMacAgentRepositoryFor(context.env).requestRun(
          context.get("identity").subject,
        ),
        202,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      const notRegistered =
        error instanceof AngelListMacAgentRepositoryError &&
        error.code === "agent_not_registered";
      return context.json(
        {
          error: notRegistered
            ? "Finish agent setup before requesting work."
            : "Keel could not queue this AngelList update.",
        },
        notRegistered ? 409 : 503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.put("/api/automation/angellist/mac-agent/config", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const parsed = AngelListMacAgentConfigInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return context.json(
        { error: "Choose a supported update interval." },
        400,
      );
    }
    try {
      return context.json(
        await angelListMacAgentRepositoryFor(context.env).configure(
          context.get("identity").subject,
          parsed.data,
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      const notRegistered =
        error instanceof AngelListMacAgentRepositoryError &&
        error.code === "agent_not_registered";
      return context.json(
        {
          error: notRegistered
            ? "Finish AngelList agent setup first."
            : "The AngelList interval could not be saved.",
        },
        notRegistered ? 409 : 503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/automation/angellist/mac-agent/lease", async (context) => {
    try {
      return context.json(
        await angelListMacAgentRepositoryFor(context.env).lease(
          context.get("identity").subject,
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      const notRegistered =
        error instanceof AngelListMacAgentRepositoryError &&
        error.code === "agent_not_registered";
      return context.json(
        {
          error: notRegistered
            ? "Register this agent before requesting work."
            : "Keel could not check for an AngelList update.",
        },
        notRegistered ? 409 : 503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post(
    "/api/automation/angellist/mac-agent/runs/:runId/fail",
    async (context) => {
      const leaseToken = context.req.header("X-Keel-Agent-Lease") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/u.test(leaseToken)) {
        return context.json(
          { error: "This run lease is no longer valid." },
          409,
        );
      }
      let rawInput: unknown;
      try {
        rawInput = await context.req.json();
      } catch {
        return context.json({ error: "A JSON request body is required." }, 400);
      }
      const parsed = AngelListMacAgentFailureInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return context.json({ error: "Choose a supported failure code." }, 400);
      }
      try {
        return context.json(
          await angelListMacAgentRepositoryFor(context.env).fail(
            context.get("identity").subject,
            context.req.param("runId"),
            leaseToken,
            parsed.data,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const invalidLease =
          error instanceof AngelListMacAgentRepositoryError &&
          error.code === "lease_invalid";
        return context.json(
          {
            error: invalidLease
              ? "This run lease is no longer valid."
              : "Keel could not record the AngelList update failure.",
          },
          invalidLease ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.get("/api/watch/activity/progress", async (context) => {
    const runId = context.req.query("runId");
    if (runId === undefined || runId.length === 0 || runId.length > 200)
      return context.json({ error: "Invalid watch run." }, 400);
    try {
      return context.json(
        await new D1PortfolioWatchActivityRepository(
          context.env.DB,
        ).readProgress(context.get("identity").subject, runId),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json(
        { error: "Couldn’t refresh source activity. Try again." },
        503,
      );
    }
  });

  app.get("/api/watch/activity", async (context) => {
    const cursor = context.req.query("cursor") ?? null;
    if (cursor !== null && (cursor.length === 0 || cursor.length > 200))
      return context.json({ error: "Invalid watch page." }, 400);
    const search = WatchCompanySearchSchema.safeParse(
      context.req.query("q") ?? "",
    );
    if (!search.success)
      return context.json(
        { error: "Company search must be 200 characters or fewer." },
        400,
      );
    try {
      return context.json(
        {
          ...(await new D1PortfolioWatchActivityRepository(context.env.DB).read(
            context.get("identity").subject,
            cursor,
            undefined,
            search.data,
          )),
          websiteSearchAvailable: Boolean(context.env.BRAVE_SEARCH_API_KEY),
        },
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch {
      return context.json(
        { error: "Couldn’t load source activity. Try again." },
        503,
      );
    }
  });

  app.post("/api/watch/targets/:targetId/website-search", async (context) => {
    try {
      const target = await new D1WatchWebsiteRepository(context.env.DB).target(
        context.get("identity").subject,
        context.req.param("targetId"),
      );
      if (!context.env.BRAVE_SEARCH_API_KEY)
        return context.json(
          {
            error:
              "Website search is not connected. Enter the company’s official website below.",
          },
          503,
        );
      return context.json(
        await searchWatchWebsite(
          target.companyName,
          context.env.BRAVE_SEARCH_API_KEY,
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      return context.json(
        {
          error:
            "Couldn’t find websites. Enter a known official website or try again.",
        },
        errorMessage(error) === "watch_target_not_found" ? 404 : 503,
      );
    }
  });

  app.post("/api/watch/targets/:targetId/website", async (context) => {
    const input = WatchWebsiteInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!input.success)
      return context.json(
        {
          error:
            "Enter an HTTPS website and a reason for matching it to this company.",
        },
        400,
      );
    try {
      return context.json(
        await new D1WatchWebsiteRepository(context.env.DB).confirm(
          context.get("identity").subject,
          context.req.param("targetId"),
          input.data,
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      const message = errorMessage(error);
      if (message === "watch_target_not_found")
        return context.json(
          { error: "This company is no longer monitored." },
          404,
        );
      if (
        message === "watch_website_changed" ||
        message.includes("Company website changed")
      )
        return context.json(
          {
            error:
              "The company or website changed. Refresh coverage before confirming.",
          },
          409,
        );
      if (message.includes("Watch source limit reached"))
        return context.json(
          {
            error:
              "This company’s source list is full. Existing sources need correction before adding a website.",
          },
          409,
        );
      if (message.includes("Company homepage"))
        return context.json(
          {
            error:
              "Use the company’s public HTTPS website, without a port, credentials, or fragment.",
          },
          400,
        );
      return context.json(
        { error: "Couldn’t confirm the website. Try again." },
        503,
      );
    }
  });

  app.post("/api/watch/observations/:observationId/read", async (context) => {
    const input = WatchReadInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    const observationId = context.req.param("observationId");
    if (!input.success || observationId.length > 200)
      return context.json({ error: "Invalid news read state." }, 400);
    try {
      return context.json(
        await new D1PortfolioWatchInboxRepository(context.env.DB).setRead(
          context.get("identity").subject,
          observationId,
          input.data,
        ),
        200,
        { "Cache-Control": "private, no-store" },
      );
    } catch (error) {
      const message = errorMessage(error);
      if (message === "watch_observation_not_found")
        return context.json(
          { error: "This update is no longer available." },
          404,
        );
      if (message === "watch_read_state_changed")
        return context.json(
          {
            error:
              "Read status changed in another window. Refresh updates and try again.",
          },
          409,
        );
      return context.json(
        { error: "Couldn’t save read status. Try again." },
        503,
      );
    }
  });

  app.post("/api/watch/scan", async (context) => {
    try {
      const preparation = await repositoryFor(
        context.env,
      ).preparePortfolioWatchScan(context.get("identity").subject);
      if (preparation.jobs.length > 0) {
        await context.env.INGESTION_QUEUE.sendBatch(
          preparation.jobs.map((job) => ({
            body: {
              ...job,
              messageId: job.messageId ?? crypto.randomUUID(),
              requestedAt: preparation.checkedAt,
            },
          })),
        );
      }
      return context.json(
        PortfolioWatchScanResultSchema.parse({
          checkedAt: preparation.checkedAt,
          queuedCount: preparation.jobs.length,
          discoveredCount: 0,
          proposedCount: 0,
        }),
        202,
        {
          "Cache-Control": "private, no-store",
        },
      );
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json(
          { error: "Portfolio Watch is not configured for this household." },
          404,
        );
      }
      return context.json(
        { error: "Public-source scan could not be completed." },
        500,
      );
    }
  });

  app.post(
    "/api/automation/angellist/mac-agent/runs/:runId/complete",
    async (context) => {
      const leaseToken = context.req.header("X-Keel-Agent-Lease") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/u.test(leaseToken)) {
        return context.json(
          { error: "This run lease is no longer valid." },
          409,
        );
      }
      const accessSubject = context.get("identity").subject;
      const runId = context.req.param("runId");
      const agentRepository = angelListMacAgentRepositoryFor(context.env);
      try {
        await agentRepository.assertLease(accessSubject, runId, leaseToken);
      } catch (error) {
        const invalidLease =
          error instanceof AngelListMacAgentRepositoryError &&
          error.code === "lease_invalid";
        return context.json(
          {
            error: invalidLease
              ? "This run lease is no longer valid."
              : "Keel could not validate this AngelList update.",
          },
          invalidLease ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }

      let upload: Awaited<ReturnType<typeof readAngelListCsvUpload>>;
      try {
        upload = await readAngelListCsvUpload(context.req.raw);
      } catch (error) {
        if (error instanceof HoldingImportUploadError) {
          return context.json(
            { error: error.message },
            error.code === "file_too_large" ? 413 : 400,
            { "Cache-Control": "private, no-store" },
          );
        }
        return context.json(
          { error: "Keel could not read that CSV upload." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }

      let importId: string;
      try {
        const staged = await stageAngelListUpload(
          context.env,
          repositoryFor(context.env),
          accessSubject,
          upload,
        );
        importId = staged.preview.id;
      } catch (error) {
        const failure =
          error instanceof AngelListImportRequestError
            ? error
            : new AngelListImportRequestError(
                500,
                "Keel could not prepare this import for review.",
              );
        return context.json({ error: failure.message }, failure.status, {
          "Cache-Control": "private, no-store",
        });
      }

      try {
        return context.json(
          await agentRepository.complete(
            accessSubject,
            runId,
            leaseToken,
            importId,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const invalidLease =
          error instanceof AngelListMacAgentRepositoryError &&
          error.code === "lease_invalid";
        return context.json(
          {
            error: invalidLease
              ? "The CSV is saved for review, but this run lease expired."
              : "The CSV is saved for review, but Keel could not close the run.",
          },
          invalidLease ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.get(
    "/api/automation/provider-holdings/:provider/status",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      try {
        const status = await providerPortfolioAgentRepositoryFor(
          context.env,
        ).getOverview(context.get("identity").subject, provider);
        return context.json(status, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch {
        return context.json(
          {
            error: `${providerPortfolioLabel(provider)} update status is unavailable.`,
          },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-holdings/:provider/run",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      const label = providerPortfolioLabel(provider);
      try {
        const status = await providerPortfolioAgentRepositoryFor(
          context.env,
        ).requestRun(context.get("identity").subject, provider);
        return context.json(status, 202, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        const notRegistered =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "agent_not_registered";
        return context.json(
          {
            error: notRegistered
              ? `Finish ${label} agent setup first.`
              : `Keel could not queue this ${label} update.`,
          },
          notRegistered ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-holdings/:provider/mac-agent/register",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      try {
        return context.json(
          await providerPortfolioAgentRepositoryFor(context.env).register(
            context.get("identity").subject,
            provider,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch {
        return context.json(
          {
            error: `${providerPortfolioLabel(provider)} agent setup could not be registered.`,
          },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-holdings/:provider/mac-agent/authorize",
    async (context) => {
      if (context.req.header("X-Keel-Mac-Setup") !== "1") {
        return context.json({ error: "Agent setup request is invalid." }, 403, {
          "Cache-Control": "private, no-store",
        });
      }
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      const apiOrigin = macAgentApiOrigin(context.env, context.req.url);
      if (apiOrigin === null) {
        return context.json(
          { error: "Secure agent access is not configured." },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
      try {
        const accessSubject = context.get("identity").subject;
        await providerPortfolioAgentRepositoryFor(context.env).register(
          accessSubject,
          provider,
        );
        const token = await macAgentCredentialRepositoryFor(
          context.env,
        ).issueToken(accessSubject, provider);
        return context.json(
          MacAgentAuthorizationSchema.parse({
            version: 1,
            target: provider,
            apiOrigin,
            token,
          }),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch {
        return context.json(
          {
            error: `${providerPortfolioLabel(provider)} secure agent access could not be created.`,
          },
          503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-holdings/:provider/mac-agent/run",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      try {
        return context.json(
          await providerPortfolioAgentRepositoryFor(context.env).requestRun(
            context.get("identity").subject,
            provider,
          ),
          202,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const notRegistered =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "agent_not_registered";
        return context.json(
          {
            error: notRegistered
              ? "Finish agent setup before requesting work."
              : `Keel could not queue this ${providerPortfolioLabel(provider)} update.`,
          },
          notRegistered ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.put(
    "/api/automation/provider-holdings/:provider/mac-agent/config",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      let rawInput: unknown;
      try {
        rawInput = await context.req.json();
      } catch {
        return context.json({ error: "A JSON request body is required." }, 400);
      }
      const parsed =
        ProviderPortfolioAgentConfigInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return context.json(
          { error: "Choose a supported update interval." },
          400,
        );
      }
      const label = providerPortfolioLabel(provider);
      try {
        return context.json(
          await providerPortfolioAgentRepositoryFor(context.env).configure(
            context.get("identity").subject,
            provider,
            parsed.data,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const notRegistered =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "agent_not_registered";
        return context.json(
          {
            error: notRegistered
              ? `Finish ${label} agent setup first.`
              : `The ${label} interval could not be saved.`,
          },
          notRegistered ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-holdings/:provider/mac-agent/lease",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      try {
        return context.json(
          await providerPortfolioAgentRepositoryFor(context.env).lease(
            context.get("identity").subject,
            provider,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const notRegistered =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "agent_not_registered";
        return context.json(
          {
            error: notRegistered
              ? "Register this agent before requesting work."
              : `Keel could not check for a ${providerPortfolioLabel(provider)} update.`,
          },
          notRegistered ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-holdings/sydecar/mac-agent/session-renewal/lease",
    async (context) => {
      try {
        return context.json(
          await providerPortfolioAgentRepositoryFor(
            context.env,
          ).leaseSessionRenewal(context.get("identity").subject),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const missing =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "agent_not_registered";
        return context.json(
          { error: "Keel could not check session maintenance." },
          missing ? 409 : 503,
        );
      }
    },
  );
  for (const outcome of ["complete", "fail"] as const) {
    app.post(
      `/api/automation/provider-holdings/sydecar/mac-agent/session-renewal/${outcome}`,
      async (context) => {
        const leaseToken = context.req.header("X-Keel-Agent-Lease") ?? "";
        if (!/^[A-Za-z0-9_-]{43}$/u.test(leaseToken))
          return context.json(
            { error: "This session lease is no longer valid." },
            409,
          );
        let failure = null;
        let verification;
        if (outcome === "fail") {
          const parsed = ProviderSessionRenewalFailureSchema.safeParse(
            await context.req.json().catch(() => null),
          );
          if (!parsed.success)
            return context.json(
              { error: "Choose a supported failure code." },
              400,
            );
          failure = parsed.data;
        }
        if (outcome === "complete") {
          const body = await context.req.text();
          if (body !== "") {
            const parsed = ProviderSessionRenewalVerificationSchema.safeParse(
              (() => {
                try {
                  return JSON.parse(body) as unknown;
                } catch {
                  return null;
                }
              })(),
            );
            if (!parsed.success)
              return context.json(
                { error: "Provide verified expiry metadata." },
                400,
              );
            verification = parsed.data;
          }
        }
        try {
          await providerPortfolioAgentRepositoryFor(
            context.env,
          ).finishSessionRenewal(
            context.get("identity").subject,
            leaseToken,
            failure,
            verification,
          );
          return context.json({ version: 1 }, 200, {
            "Cache-Control": "private, no-store",
          });
        } catch (error) {
          const invalid =
            error instanceof ProviderPortfolioAgentRepositoryError &&
            error.code === "lease_invalid";
          return context.json(
            { error: "Keel could not record session maintenance." },
            invalid ? 409 : 503,
          );
        }
      },
    );
  }

  app.post(
    "/api/automation/provider-holdings/:provider/mac-agent/runs/:runId/fail",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      const leaseToken = context.req.header("X-Keel-Agent-Lease") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/u.test(leaseToken)) {
        return context.json(
          { error: "This run lease is no longer valid." },
          409,
        );
      }
      let rawInput: unknown;
      try {
        rawInput = await context.req.json();
      } catch {
        return context.json({ error: "A JSON request body is required." }, 400);
      }
      const parsed =
        ProviderPortfolioAgentFailureInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return context.json({ error: "Choose a supported failure code." }, 400);
      }
      try {
        return context.json(
          await providerPortfolioAgentRepositoryFor(context.env).fail(
            context.get("identity").subject,
            provider,
            context.req.param("runId"),
            leaseToken,
            parsed.data,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const invalidLease =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "lease_invalid";
        return context.json(
          {
            error: invalidLease
              ? "This run lease is no longer valid."
              : `Keel could not record the ${providerPortfolioLabel(provider)} update failure.`,
          },
          invalidLease ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post(
    "/api/automation/provider-holdings/:provider/mac-agent/runs/:runId/complete",
    async (context) => {
      const provider = providerPortfolioAgentProvider(
        context.req.param("provider"),
      );
      if (provider === null) {
        return context.json({ error: "Provider not found." }, 404);
      }
      const leaseToken = context.req.header("X-Keel-Agent-Lease") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/u.test(leaseToken)) {
        return context.json(
          { error: "This run lease is no longer valid." },
          409,
        );
      }
      const accessSubject = context.get("identity").subject;
      const runId = context.req.param("runId");
      const agentRepository = providerPortfolioAgentRepositoryFor(context.env);
      try {
        await agentRepository.assertLease(
          accessSubject,
          provider,
          runId,
          leaseToken,
        );
      } catch (error) {
        const invalidLease =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "lease_invalid";
        return context.json(
          {
            error: invalidLease
              ? "This run lease is no longer valid."
              : `Keel could not validate this ${providerPortfolioLabel(provider)} update.`,
          },
          invalidLease ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }

      let upload: Awaited<ReturnType<typeof readProviderTemplateCsvUpload>>;
      try {
        upload = await readProviderTemplateCsvUpload(context.req.raw, provider);
      } catch (error) {
        if (error instanceof HoldingImportUploadError) {
          return context.json(
            { error: error.message },
            error.code === "file_too_large" ? 413 : 400,
            { "Cache-Control": "private, no-store" },
          );
        }
        return context.json(
          { error: "Keel could not read that local capture." },
          400,
          { "Cache-Control": "private, no-store" },
        );
      }

      let importId: string;
      try {
        const staged = await stageProviderTemplateUpload(
          context.env,
          repositoryFor(context.env),
          accessSubject,
          provider,
          upload,
        );
        importId = staged.preview.id;
      } catch (error) {
        const failure =
          error instanceof ProviderTemplateImportRequestError
            ? error
            : new ProviderTemplateImportRequestError(
                500,
                "Keel could not prepare this update for review.",
              );
        return context.json(
          { error: failure.message, reason: failure.reason },
          failure.status,
          { "Cache-Control": "private, no-store" },
        );
      }

      try {
        return context.json(
          await agentRepository.complete(
            accessSubject,
            provider,
            runId,
            leaseToken,
            importId,
          ),
          200,
          { "Cache-Control": "private, no-store" },
        );
      } catch (error) {
        const invalidLease =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "lease_invalid";
        return context.json(
          {
            error: invalidLease
              ? "The update is saved for review, but this run lease expired."
              : "The update is saved for review, but Keel could not close the run.",
          },
          invalidLease ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );

  app.post("/api/holding-imports/angellist", async (context) => {
    let upload: Awaited<ReturnType<typeof readAngelListCsvUpload>>;
    try {
      upload = await readAngelListCsvUpload(context.req.raw);
    } catch (error) {
      if (error instanceof HoldingImportUploadError) {
        return context.json(
          { error: error.message },
          error.code === "file_too_large" ? 413 : 400,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "Keel could not read that CSV upload." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }

    try {
      const staged = await stageAngelListUpload(
        context.env,
        repositoryFor(context.env),
        context.get("identity").subject,
        upload,
      );
      return context.json(staged.preview, staged.created ? 201 : 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const failure =
        error instanceof AngelListImportRequestError
          ? error
          : new AngelListImportRequestError(
              500,
              "Keel could not prepare this import for review.",
            );
      return context.json({ error: failure.message }, failure.status, {
        "Cache-Control": "private, no-store",
      });
    }
  });

  const reviewProviderTemplateUpload = async (
    context: Context<AppEnvironment>,
    provider: ProviderHoldingsTemplateProvider,
  ) => {
    let upload: Awaited<ReturnType<typeof readProviderTemplateCsvUpload>>;
    try {
      upload = await readProviderTemplateCsvUpload(context.req.raw, provider);
    } catch (error) {
      if (error instanceof HoldingImportUploadError) {
        return context.json(
          { error: error.message },
          error.code === "file_too_large" ? 413 : 400,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "Keel could not read that CSV template." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }

    try {
      const staged = await stageProviderTemplateUpload(
        context.env,
        repositoryFor(context.env),
        context.get("identity").subject,
        provider,
        upload,
      );
      return context.json(staged.preview, staged.created ? 201 : 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const failure =
        error instanceof ProviderTemplateImportRequestError
          ? error
          : new ProviderTemplateImportRequestError(
              500,
              "Keel could not prepare this import for review.",
            );
      return context.json({ error: failure.message }, failure.status, {
        "Cache-Control": "private, no-store",
      });
    }
  };

  app.post("/api/holding-imports/tokenfolio", (context) =>
    reviewProviderTemplateUpload(context, "tokenfolio"),
  );

  app.post("/api/holding-imports/sydecar", (context) =>
    reviewProviderTemplateUpload(context, "sydecar"),
  );

  const downloadProviderTemplate = (
    context: Context<AppEnvironment>,
    provider: ProviderHoldingsTemplateProvider,
  ) =>
    context.body(providerHoldingsTemplateCsv(provider), 200, {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${provider}-holdings.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    });

  app.get("/api/holding-import-templates/tokenfolio", (context) =>
    downloadProviderTemplate(context, "tokenfolio"),
  );

  app.get("/api/holding-import-templates/sydecar", (context) =>
    downloadProviderTemplate(context, "sydecar"),
  );

  app.get("/api/holding-imports", async (context) => {
    try {
      const imports = await repositoryFor(
        context.env,
      ).listPendingHoldingImports(context.get("identity").subject);
      return context.json(imports, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Keel could not load pending holding imports." },
        500,
      );
    }
  });

  app.post("/api/holding-imports/:importId/reconcile", async (context) => {
    try {
      const preview = await repositoryFor(context.env).reconcileHoldingImport(
        context.get("identity").subject,
        context.req.param("importId"),
      );
      return context.json(preview, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return context.json(
        { error: "This update could not be checked. Try again." },
        errorMessage(error).includes("not found") ? 404 : 503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/holding-imports/:importId", async (context) => {
    try {
      const preview = await repositoryFor(context.env).getHoldingImport(
        context.get("identity").subject,
        context.req.param("importId"),
      );
      return context.json(preview, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      if (errorMessage(error).includes("not found")) {
        return context.json({ error: "Holding import not found." }, 404);
      }
      return context.json(
        { error: "Keel could not load this holding import." },
        500,
      );
    }
  });

  app.post("/api/holding-imports/:importId/apply", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const parsedInput = HoldingImportApplyInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      return context.json(
        { error: "Every imported position needs a valid review decision." },
        400,
      );
    }

    try {
      const result = await repositoryFor(context.env).applyHoldingImport(
        context.get("identity").subject,
        context.req.param("importId"),
        parsedInput.data,
      );
      return context.json(result, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Holding import not found." }, 404);
      }
      if (message.includes("already reviewed")) {
        return context.json(
          { error: "This import was already reviewed differently." },
          409,
        );
      }
      if (
        message.includes("every row") ||
        message.includes("needs attention") ||
        message.includes("currency") ||
        message.includes("Matched holding")
      ) {
        return context.json(
          { error: "The import review is incomplete or inconsistent." },
          409,
        );
      }
      return context.json(
        { error: "Nothing changed. The holding import could not be applied." },
        500,
      );
    }
  });

  app.post("/api/evidence/:eventId/review", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = ReviewInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Review input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      await repositoryFor(context.env).reviewEvidence(
        context.get("identity").subject,
        context.req.param("eventId"),
        result.data,
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Evidence event not found." }, 404);
      }
      if (message.includes("transition")) {
        return context.json(
          { error: "Evidence event was already reviewed." },
          409,
        );
      }
      return context.json(
        { error: "Evidence review could not be recorded." },
        500,
      );
    }
  });

  app.post("/api/evidence/:eventId/apply", async (context) => {
    try {
      await repositoryFor(context.env).applyEvidence(
        context.get("identity").subject,
        context.req.param("eventId"),
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Evidence event not found." }, 404);
      }
      if (
        message.includes("transition") ||
        message.includes("direct") ||
        message.includes("already") ||
        message.includes("target") ||
        message.includes("financial value") ||
        message.includes("complete proposed") ||
        message.includes("review decision")
      ) {
        return context.json(
          { error: "Evidence cannot be applied automatically." },
          409,
        );
      }
      return context.json(
        { error: "Evidence application could not be recorded." },
        500,
      );
    }
  });

  app.post("/api/signal-update-proposals", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = CreateSignalUpdateProposalInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Signal update proposal input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      const proposal = await repositoryFor(
        context.env,
      ).createSignalUpdateProposal(
        context.get("identity").subject,
        result.data,
      );
      return context.json(proposal, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json(
          { error: "Signal group or scenario not found." },
          404,
        );
      }
      if (
        message.includes("stale") ||
        message.includes("not ready") ||
        message.includes("version mismatch") ||
        message.includes("UNIQUE")
      ) {
        return context.json(
          {
            error:
              "Signals or the scenario changed. Reload before creating the proposal.",
          },
          409,
        );
      }
      return context.json(
        { error: "Signal update proposal could not be created." },
        500,
      );
    }
  });

  app.post("/api/goals", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = GoalDraftInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Goal input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      await repositoryFor(context.env).saveGoal(
        context.get("identity").subject,
        result.data,
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Goal not found." }, 404);
      }
      if (message.includes("template")) {
        return context.json(
          { error: "A saved goal cannot change templates." },
          409,
        );
      }
      return context.json({ error: "Goal version could not be saved." }, 500);
    }
  });

  app.post("/api/scenarios", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = ScenarioDraftInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Scenario input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      await repositoryFor(context.env).saveScenario(
        context.get("identity").subject,
        result.data,
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Scenario not found." }, 404);
      }
      if (message.includes("stale") || message.includes("between")) {
        return context.json(
          {
            error:
              "Scenario inputs changed elsewhere. Your draft is still local.",
          },
          409,
        );
      }
      if (message.includes("Probability assumptions")) {
        return context.json({ error: message }, 400);
      }
      return context.json(
        { error: "Scenario version could not be saved." },
        500,
      );
    }
  });

  app.notFound((context) => context.json({ error: "Not found." }, 404));

  registerProviderLegalDocumentRoutes(app);
  return app;
}
