import {
  AngelListCsvParseError,
  parseAngelListInvestmentsCsv,
} from "@keel/connectors";
import {
  AngelListMacAgentRepositoryError,
  D1AlphaRepository,
  D1AngelListMacAgentRepository,
  D1CashAccountsRepository,
  D1CashFlowRepository,
  D1HoldingImportRepository,
  D1LiabilitiesRepository,
  D1PlanInputsRepository,
  D1PortfolioBaselineRepository,
  D1PublicHoldingsRepository,
  type AlphaRepository,
  type AngelListMacAgentRepository,
  type CashAccountsRepository,
  type CashFlowRepository,
  type LiabilitiesRepository,
  type PlanInputsRepository,
  type PortfolioBaselineRepository,
  type PublicHoldingsRepository,
} from "@keel/database";
import {
  AngelListMacAgentConfigInputSchema,
  AngelListMacAgentFailureInputSchema,
  CashAccountApplyInputSchema,
  CashAccountExchangeInputSchema,
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
  ManualLiabilityInputSchema,
  PlanInputSaveSchema,
  PortfolioBaselineConfirmInputSchema,
  PortfolioWatchScanResultSchema,
  RobinhoodExchangeInputSchema,
  ScenarioDraftInputSchema,
} from "@keel/domain";
import { ReviewInputSchema } from "@keel/evidence";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { verifyAccessToken, type AccessVerifier } from "./auth";
import {
  deploymentSmokeTokenMatches,
  runDeploymentSmoke,
} from "./deployment-smoke";
import {
  HoldingImportUploadError,
  readAngelListCsvUpload,
} from "./holding-import-upload";
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
  connectRobinhood,
  createPlaidInvestmentsClient,
  PlaidClientError,
  robinhoodSyncConfigured,
  syncRobinhood,
  type PlaidInvestmentsClient,
} from "./robinhood-sync";
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
  holdingImportRepository?: Pick<
    D1HoldingImportRepository,
    | "stageRobinhoodHoldingImport"
    | "autoAdjudicateRobinhoodHoldingImport"
    | "hasAcceptedRobinhoodPlanningPositions"
  >;
  cashAccountsRepository?: CashAccountsRepository;
  cashPlaidClient?: PlaidCashClient;
  cashFlowRepository?: CashFlowRepository;
  cashFlowPlaidClient?: PlaidCashFlowClient;
  liabilitiesRepository?: LiabilitiesRepository;
  liabilitiesPlaidClient?: PlaidLiabilitiesClient;
  plaidClient?: PlaidInvestmentsClient;
  planInputsRepository?: PlanInputsRepository;
  portfolioBaselineRepository?: PortfolioBaselineRepository;
  publicHoldingsRepository?: PublicHoldingsRepository;
  repository?: AlphaRepository;
  verifyAccess?: AccessVerifier;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function robinhoodErrorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
) {
  const code =
    error instanceof PlaidClientError ? error.code : "unexpected_failure";
  console.error(
    JSON.stringify({
      event: "robinhood_sync_failed",
      requestId: context.get("requestId"),
      errorCode: code,
    }),
  );
  const response = {
    configuration_required: {
      message: "Robinhood sync is not configured.",
      status: 503 as const,
    },
    connection_invalid: {
      message: "Reconnect Robinhood to continue syncing.",
      status: 409 as const,
    },
    provider_unavailable: {
      message: "Robinhood sync is temporarily unavailable.",
      status: 503 as const,
    },
    response_invalid: {
      message: "Robinhood returned an unsupported holdings response.",
      status: 502 as const,
    },
    holdings_incomplete: {
      message:
        "Robinhood returned an incomplete holdings snapshot. Prior positions were preserved.",
      status: 409 as const,
    },
    staging_failed: {
      message: "Keel could not safely prepare the Robinhood update.",
      status: 503 as const,
    },
    unexpected_failure: {
      message: "Keel could not sync Robinhood.",
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
    const staged = await repository.stageHoldingImport(accessSubject, {
      objectKey,
      sha256: await sha256Bytes(upload.bytes),
      byteSize: upload.bytes.byteLength,
      effectiveDate: upload.effectiveDate,
      retrievedAt: upload.retrievedAt,
      rows: parsed.rows,
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

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnvironment>();
  const verifier = options.verifyAccess ?? verifyAccessToken;
  const repositoryFor = (env: Env) =>
    options.repository ?? new D1AlphaRepository(env.DB);
  const angelListMacAgentRepositoryFor = (env: Env) =>
    options.angelListMacAgentRepository ??
    new D1AngelListMacAgentRepository(env.DB);
  const publicHoldingsRepositoryFor = (env: Env) =>
    options.publicHoldingsRepository ?? new D1PublicHoldingsRepository(env.DB);
  const portfolioBaselineRepositoryFor = (env: Env) =>
    options.portfolioBaselineRepository ??
    new D1PortfolioBaselineRepository(env.DB);
  const planInputsRepositoryFor = (env: Env) =>
    options.planInputsRepository ?? new D1PlanInputsRepository(env.DB);
  const holdingImportRepositoryFor = (env: Env) =>
    options.holdingImportRepository ?? new D1HoldingImportRepository(env.DB);
  const plaidClientFor = (env: Env) =>
    options.plaidClient ?? createPlaidInvestmentsClient(env);
  const robinhoodConfiguredFor = (env: Env) =>
    options.plaidClient !== undefined || robinhoodSyncConfigured(env);
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
    if (!robinhoodConfiguredFor(context.env)) {
      return context.body(null, 503, { "Cache-Control": "no-store" });
    }
    try {
      const result = await receivePlaidWebhook({
        request: context.req.raw,
        env: context.env,
        repository: publicHoldingsRepositoryFor(context.env),
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

  app.get("/api/public-holdings/robinhood/status", async (context) => {
    try {
      const status = await publicHoldingsRepositoryFor(context.env).getStatus(
        context.get("identity").subject,
        robinhoodConfiguredFor(context.env),
      );
      return context.json(status, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      return context.json(
        { error: "Robinhood sync status is unavailable." },
        503,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.post("/api/public-holdings/robinhood/link-token", async (context) => {
    if (!robinhoodConfiguredFor(context.env)) {
      return context.json({ error: "Robinhood sync is not configured." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
    try {
      const linkToken = await plaidClientFor(context.env).createLinkToken(
        context.get("identity").subject,
      );
      return context.json(linkToken, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return robinhoodErrorResponse(context, error);
    }
  });

  app.post("/api/public-holdings/robinhood/exchange", async (context) => {
    if (!robinhoodConfiguredFor(context.env)) {
      return context.json({ error: "Robinhood sync is not configured." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "Robinhood connection is invalid." }, 400);
    }
    const parsed = RobinhoodExchangeInputSchema.safeParse(input);
    if (!parsed.success) {
      return context.json({ error: "Robinhood connection is invalid." }, 400);
    }
    const accessSubject = context.get("identity").subject;
    try {
      const repository = publicHoldingsRepositoryFor(context.env);
      const client = plaidClientFor(context.env);
      await connectRobinhood({
        env: context.env,
        repository,
        client,
        accessSubject,
        publicToken: parsed.data.publicToken,
      });
      const status = await syncRobinhood({
        env: context.env,
        repository,
        holdingImports: holdingImportRepositoryFor(context.env),
        portfolioBaselines: portfolioBaselineRepositoryFor(context.env),
        client,
        accessSubject,
      });
      return context.json(status, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return robinhoodErrorResponse(context, error);
    }
  });

  app.post("/api/public-holdings/robinhood/sync", async (context) => {
    if (!robinhoodConfiguredFor(context.env)) {
      return context.json({ error: "Robinhood sync is not configured." }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
    try {
      const status = await syncRobinhood({
        env: context.env,
        repository: publicHoldingsRepositoryFor(context.env),
        holdingImports: holdingImportRepositoryFor(context.env),
        portfolioBaselines: portfolioBaselineRepositoryFor(context.env),
        client: plaidClientFor(context.env),
        accessSubject: context.get("identity").subject,
      });
      return context.json(status, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      return robinhoodErrorResponse(context, error);
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
            ? "Finish AngelList setup on your Mac first."
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
        { error: "Mac setup could not be registered." },
        503,
        {
          "Cache-Control": "private, no-store",
        },
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
            ? "Finish AngelList setup on your Mac first."
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
            ? "Register this Mac before requesting work."
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
