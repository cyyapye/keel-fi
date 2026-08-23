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
  D1InvestmentExposureViewRepository,
  D1LiabilitiesRepository,
  D1MacAgentCredentialRepository,
  D1PlanActualMonitoringRepository,
  D1PlanInputsRepository,
  D1PortfolioBaselineRepository,
  D1ProviderPortfolioAgentRepository,
  PrivateExposureReviewError,
  ProviderPortfolioAgentRepositoryError,
  D1InvestmentConnectionsRepository,
  D1InvestmentPositionViewRepository,
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
  type InvestmentExposureViewRepository,
  type InvestmentPositionViewRepository,
} from "@keel/database";
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
  MacAgentTokenSchema,
  ManualLiabilityInputSchema,
  PlanInputSaveSchema,
  ProviderPortfolioAgentConfigInputSchema,
  ProviderPortfolioAgentFailureInputSchema,
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
import { PlanActualSnoozeInputSchema } from "@keel/domain/plan-actual-monitoring";
import { ReviewInputSchema } from "@keel/evidence";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";

import { verifyAccessToken, type AccessVerifier } from "./auth";
import {
  deploymentSmokeTokenMatches,
  runDeploymentSmoke,
} from "./deployment-smoke";
import {
  HoldingImportUploadError,
  readAngelListCsvUpload,
  readProviderTemplateCsvUpload,
} from "./holding-import-upload";
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
import type { AccessIdentity, Env } from "./types";

type Variables = {
  identity: AccessIdentity;
  requestId: string;
};

type AppEnvironment = {
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
  investmentExposureViewRepository?: InvestmentExposureViewRepository;
  investmentPositionViewRepository?: InvestmentPositionViewRepository;
  privateExposureReviewRepository?: PrivateExposureReviewRepository;
  retainedPublicExposureReconciler?: RetainedPublicExposureReconciler;
  newInvestmentConnectionsAvailable?: boolean;
  repository?: AlphaRepository;
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
    monthly_limit_reached: {
      message: "This institution has used its live balance checks this month.",
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
      message: "Keel could not prepare the cash balances for review.",
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

  try {
    const canonicalScope = await buildAngelListCanonicalScope({
      env,
      accessSubject,
      rows: parsed.rows,
    });
    const staged = await repository.stageHoldingImport(accessSubject, {
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
    return staged;
  } catch {
    await discardPrivateObject(env.DOCUMENTS, objectKey);
    throw new AngelListImportRequestError(
      500,
      "Keel could not prepare this import for review.",
    );
  }
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
  try {
    const canonicalScope = await buildProviderTemplateCanonicalScope({
      env,
      accessSubject,
      provider,
      rows: parsed.rows,
    });
    phase = "review_staging";
    const staged = await repository.stageHoldingImport(accessSubject, {
      provider,
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
    return staged;
  } catch {
    await discardPrivateObject(env.DOCUMENTS, objectKey);
    throw new ProviderTemplateImportRequestError(
      500,
      "Keel could not prepare this import for review.",
      phase,
    );
  }
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
  const providerLease =
    /^\/api\/automation\/provider-holdings\/(tokenfolio|sydecar)\/mac-agent\/(?:lease|run)$/u.exec(
      pathname,
    );
  if (providerLease !== null) {
    return providerLease[1] as ProviderPortfolioAgentProvider;
  }
  const providerRun =
    /^\/api\/automation\/provider-holdings\/(tokenfolio|sydecar)\/mac-agent\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:fail|complete)$/iu.exec(
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
  const investmentConnectionsRepositoryFor = (env: Env) =>
    options.investmentConnectionsRepository ??
    new D1InvestmentConnectionsRepository(env.DB);
  const investmentPositionViewRepositoryFor = (env: Env) =>
    options.investmentPositionViewRepository ??
    new D1InvestmentPositionViewRepository(env.DB);
  const investmentExposureViewRepositoryFor = (env: Env) =>
    options.investmentExposureViewRepository ??
    new D1InvestmentExposureViewRepository(env.DB);
  const privateExposureReviewRepositoryFor = (env: Env) =>
    options.privateExposureReviewRepository ?? new D1ExposureRepository(env.DB);
  const retainedPublicExposureReconcilerFor = (env: Env) =>
    options.retainedPublicExposureReconciler ??
    new D1RetainedPublicExposureReconciler(env);
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
    options.cashAccountsRepository ?? new D1CashAccountsRepository(env.DB);
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
      return context.json(await runDeploymentSmoke(context.env), 200, {
        "Cache-Control": "no-store",
      });
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
        { error: "Every cash account needs a valid review decision." },
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

  app.get("/api/investment-holdings", async (context) => {
    const accessSubject = context.get("identity").subject;
    const asOf = new Date().toISOString();
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
    try {
      const state = await syncDueInvestmentConnections({
        env: context.env,
        repository: investmentConnectionsRepositoryFor(context.env),
        holdingImports: holdingImportRepositoryFor(context.env),
        portfolioBaselines: portfolioBaselineRepositoryFor(context.env),
        client: plaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
      });
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
      try {
        const status = await syncInvestmentConnection({
          env: context.env,
          repository: investmentConnectionsRepositoryFor(context.env),
          holdingImports: holdingImportRepositoryFor(context.env),
          portfolioBaselines: portfolioBaselineRepositoryFor(context.env),
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

  app.post("/api/watch/scan", async (context) => {
    try {
      const preparation = await repositoryFor(
        context.env,
      ).preparePortfolioWatchScan(context.get("identity").subject);
      await Promise.all(
        preparation.jobs.map((job) =>
          context.env.INGESTION_QUEUE.send({
            ...job,
            messageId: crypto.randomUUID(),
            requestedAt: preparation.checkedAt,
          }),
        ),
      );
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

  return app;
}
