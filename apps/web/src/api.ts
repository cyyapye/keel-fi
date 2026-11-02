import { d1ServiceError } from "@keel/domain/d1-service";
import { requestKeel } from "./api-request";
import {
  AcceptPositionLinkSchema,
  PositionLinkReceiptSchema,
  PositionLinkWorkspaceSchema,
  type AcceptPositionLink,
} from "@keel/domain/position-links";
import {
  CompanyIdentityCatalogSchema,
  CompanyAliasProposalSchema,
  CompanyAliasPreviewSchema,
  CompanyAliasReviewInputSchema,
  CompanyAliasReceiptSchema,
  type CompanyAliasProposal,
  type CompanyAliasReviewInput,
} from "@keel/domain/company-identity";
import {
  PublicCompanyLinkCatalogSchema,
  PublicCompanyMatchSchema,
  PublicCompanyLinkReceiptSchema,
  PublicCompanyLinkReviewSchema,
  type PublicCompanyLinkReview,
} from "@keel/domain/public-company-links";
import {
  PortfolioWatchActivitySchema,
  PortfolioWatchProgressSchema,
  WatchReadReceiptSchema,
} from "@keel/domain/portfolio-watch-activity";
import {
  WatchWebsiteReceiptSchema,
  WatchWebsiteSearchSchema,
  type WatchWebsiteInput,
} from "@keel/domain/watch-website";
import {
  CreateDocumentInvestmentInputSchema,
  CreateDocumentInvestmentResultSchema,
  InvestmentCompanyReceiptSchema,
  InvestmentCompanyReviewInputSchema,
  InvestmentReviewContextSchema,
  InvestmentReviewStateSchema,
  ReviewInvestmentInputSchema,
  type CreateDocumentInvestmentInput,
  type InvestmentCompanyReviewInput,
  type ReviewInvestmentInput,
} from "@keel/domain/investment-review";
import {
  AlphaDataSchema,
  AngelListAutomationOverviewSchema,
  AngelListMacAgentConfigInputSchema,
  AngelListMacAgentOverviewSchema,
  AngelListMacAgentRunRequestSchema,
  AngelListSignInRefreshSchema,
  CashAccountApplyInputSchema,
  CashAccountApplyResultSchema,
  CashAccountExchangeInputSchema,
  CashAccountIdentityReviewInputSchema,
  CashAccountLinkTokenSchema,
  CashAccountsStateSchema,
  CASH_FLOW_POLICY_VERSION,
  CashFlowReviewInputSchema,
  CashFlowReviewResultSchema,
  CashFlowStateSchema,
  CreateSignalUpdateProposalInputSchema,
  GoalDraftInputSchema,
  HoldingImportApplyInputSchema,
  HoldingImportApplyResultSchema,
  HoldingImportPreviewSchema,
  HoldingImportSummariesSchema,
  LiabilitiesStateSchema,
  LiabilityApplyInputSchema,
  LiabilityApplyResultSchema,
  LiabilityExchangeInputSchema,
  LiabilityLinkTokenSchema,
  LiabilityProposalSchema,
  ManualLiabilityInputSchema,
  MacAgentTargetSchema,
  PlanInputSaveResultSchema,
  PlanInputSaveSchema,
  PlanInputStateSchema,
  ProviderPortfolioAgentConfigInputSchema,
  ProviderPortfolioAgentOverviewSchema,
  ProviderPortfolioAgentProviderSchema,
  ProviderPortfolioAgentRunRequestSchema,
  ProviderBrowserSessionSchema,
  PrivateExposureExactBatchInputSchema,
  PrivateExposureExactBatchResultSchema,
  PrivateExposureResolutionInputSchema,
  PrivateExposureResolutionResultSchema,
  PrivateExposureReviewStateSchema,
  PortfolioWatchScanResultSchema,
  PortfolioBaselineConfirmInputSchema,
  PortfolioBaselineConfirmResultSchema,
  PortfolioBaselineStateSchema,
  InvestmentConnectionStatusSchema,
  InvestmentConnectionLifecycleActionInputSchema,
  InvestmentConnectionsStateSchema,
  InvestmentExchangeInputSchema,
  InvestmentLinkTokenSchema,
  ScenarioDraftInputSchema,
  type AlphaData,
  type AngelListAutomationOverview,
  type AngelListMacAgentConfigInput,
  type AngelListMacAgentOverview,
  type AngelListMacAgentRunRequest,
  type AngelListSignInRefresh,
  type CashAccountApplyInput,
  type CashAccountApplyResult,
  type CashAccountLinkToken,
  type CashAccountIdentityReviewInput,
  type CashAccountsState,
  type CashFlowReviewInput,
  type CashFlowReviewResult,
  type CashFlowState,
  type CreateSignalUpdateProposalInput,
  type GoalDraftInput,
  type HoldingImportApplyInput,
  type HoldingImportApplyResult,
  type HoldingImportPreview,
  type HoldingImportSummary,
  type LiabilitiesState,
  type LiabilityApplyInput,
  type LiabilityApplyResult,
  type LiabilityLinkToken,
  type LiabilityProposal,
  type ManualLiabilityInput,
  type MacAgentTarget,
  type PlanInputSave,
  type PlanInputSaveResult,
  type PlanInputState,
  type ProviderPortfolioAgentConfigInput,
  type ProviderPortfolioAgentOverview,
  type ProviderPortfolioAgentProvider,
  type ProviderPortfolioAgentRunRequest,
  type ProviderBrowserSession,
  type PrivateExposureExactBatchInput,
  type PrivateExposureExactBatchResult,
  type PrivateExposureResolutionInput,
  type PrivateExposureResolutionResult,
  type PrivateExposureReviewState,
  type PortfolioWatchScanResult,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineConfirmResult,
  type PortfolioBaselineState,
  type InvestmentConnectionStatus,
  type InvestmentConnectionsState,
  type InvestmentLinkToken,
  type ScenarioDraftInput,
  SignalUpdateProposalSchema,
  type SignalUpdateProposal,
} from "@keel/domain";
import {
  AcceptPositionValueAdjustmentInputSchema,
  PositionValueAdjustmentSchema,
  type AcceptPositionValueAdjustmentInput,
  type PositionValueAdjustment,
} from "@keel/domain/position-value";
import {
  AcceptPositionEconomicsInputSchema,
  PositionEconomicsTermsSchema,
  type AcceptPositionEconomicsInput,
  type PositionEconomicsTerms,
} from "@keel/domain/position-economics";
import {
  InvestmentHoldingsViewSchema,
  type InvestmentHoldingsView,
} from "@keel/domain/investment-holdings-view";
import {
  HoldingsPageSchema,
  type HoldingsPage,
} from "@keel/domain/holdings-page";
import {
  CreateLegalEntityInputSchema,
  LegalEntityExactBatchInputSchema,
  LegalEntityExactBatchResultSchema,
  LegalEntityExportInputSchema,
  LegalEntityExportOptionsSchema,
  LegalEntityExportTableSchema,
  LegalEntityInventorySchema,
  LegalEntityRecordSchema,
  LegalEntitySourceReviewResultSchema,
  ReviewLegalEntitySourceInputSchema,
  UpdateLegalEntityInputSchema,
  type CreateLegalEntityInput,
  type LegalEntityExactBatchInput,
  type LegalEntityExactBatchResult,
  type LegalEntityExportInput,
  type LegalEntityInventory,
  type LegalEntityRecord,
  type ReviewLegalEntitySourceInput,
  type UpdateLegalEntityInput,
} from "@keel/domain/legal-entities";
import {
  ResolveInvestmentReviewsInputSchema,
  ResolveInvestmentReviewsResultSchema,
} from "@keel/domain/automatic-investment-review";
import {
  PLAN_ACTUAL_COOLDOWN_DAYS,
  PlanActualMonitoringStateSchema,
  PlanActualSnoozeInputSchema,
  type PlanActualMonitoringState,
  type PlanActualSnoozeInput,
} from "@keel/domain/plan-actual-monitoring";

import {
  takeAlphaPreload,
  takeHoldingsPagePreload,
  takeLegalEntitiesPreload,
} from "./initial-data";

async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const result = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return (
    (response.status === 503 ? d1ServiceError(result) : null) ??
    new Error(result?.error ?? fallback)
  );
}

export async function loadAlphaData(signal?: AbortSignal): Promise<AlphaData> {
  const preloaded = takeAlphaPreload();
  const response =
    (preloaded === null ? null : await preloaded) ??
    (await fetch("/api/alpha", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: signal ?? null,
    }));

  if (!response.ok) {
    throw await responseError(
      response,
      `Keel API returned ${response.status}.`,
    );
  }

  return AlphaDataSchema.parse(await response.json());
}

export async function loadHoldingsPage(
  signal?: AbortSignal,
): Promise<HoldingsPage> {
  const preloaded = takeHoldingsPagePreload();
  const response =
    (preloaded === null ? null : await preloaded) ??
    (await requestKeel("/api/holdings-page", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: signal ?? null,
    }));
  if (!response.ok) {
    throw await responseError(
      response,
      `Holdings returned ${response.status}.`,
    );
  }
  return HoldingsPageSchema.parse(await response.json());
}

export async function loadLegalEntities(
  signal?: AbortSignal,
): Promise<LegalEntityInventory> {
  const preloaded = takeLegalEntitiesPreload();
  const response =
    (preloaded === null ? null : await preloaded) ??
    (await requestKeel("/api/legal-entities", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: signal ?? null,
    }));
  if (!response.ok) {
    throw await responseError(
      response,
      `Legal entities returned ${response.status}.`,
    );
  }
  return LegalEntityInventorySchema.parse(await response.json());
}

export async function resolveInvestmentReviews(
  afterPositionId: string | null = null,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/legal-entities/resolve", {
    method: "POST",
    credentials: "same-origin",
    signal: signal ?? null,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(
      ResolveInvestmentReviewsInputSchema.parse({ afterPositionId }),
    ),
  });
  if (!response.ok)
    throw await responseError(
      response,
      "Automatic review could not finish. Your saved records are available.",
    );
  return ResolveInvestmentReviewsResultSchema.parse(await response.json());
}

async function investmentReviewRequest(
  positionId: string,
  suffix: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(
    `/api/investment-positions/${encodeURIComponent(positionId)}/${suffix}`,
    {
      method: input === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(input === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: signal ?? null,
    },
  );
  if (!response.ok)
    throw await responseError(response, "Investment review is unavailable.");
  return response.json();
}
export async function loadInvestmentReview(
  positionId: string,
  signal?: AbortSignal,
) {
  return InvestmentReviewContextSchema.parse(
    await investmentReviewRequest(positionId, "review", undefined, signal),
  );
}
export async function saveInvestmentReview(
  positionId: string,
  input: ReviewInvestmentInput,
) {
  return InvestmentReviewStateSchema.parse(
    await investmentReviewRequest(
      positionId,
      "review",
      ReviewInvestmentInputSchema.parse(input),
    ),
  );
}
export async function saveInvestmentCompany(
  positionId: string,
  input: InvestmentCompanyReviewInput,
) {
  return InvestmentCompanyReceiptSchema.parse(
    await investmentReviewRequest(
      positionId,
      "company-review",
      InvestmentCompanyReviewInputSchema.parse(input),
    ),
  );
}
export async function createDocumentInvestment(
  positionId: string,
  input: CreateDocumentInvestmentInput,
) {
  return CreateDocumentInvestmentResultSchema.parse(
    await investmentReviewRequest(
      positionId,
      "related-investments",
      CreateDocumentInvestmentInputSchema.parse(input),
    ),
  );
}

export async function createLegalEntity(
  input: CreateLegalEntityInput,
): Promise<LegalEntityRecord> {
  const response = await requestKeel("/api/legal-entities", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(CreateLegalEntityInputSchema.parse(input)),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Legal entity creation returned ${response.status}.`,
    );
  }
  return LegalEntityRecordSchema.parse(await response.json());
}

export async function updateLegalEntity(
  legalEntityId: string,
  input: UpdateLegalEntityInput,
): Promise<LegalEntityRecord> {
  const response = await fetch(
    `/api/legal-entities/${encodeURIComponent(legalEntityId)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(UpdateLegalEntityInputSchema.parse(input)),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Legal entity update returned ${response.status}.`,
    );
  }
  return LegalEntityRecordSchema.parse(await response.json());
}

export async function reviewLegalEntitySource(
  input: ReviewLegalEntitySourceInput,
): Promise<void> {
  const response = await fetch("/api/legal-entity-sources/review", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ReviewLegalEntitySourceInputSchema.parse(input)),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Legal entity source review returned ${response.status}.`,
    );
  }
  LegalEntitySourceReviewResultSchema.parse(await response.json());
}

export async function applyLegalEntityExactBatch(
  input: LegalEntityExactBatchInput,
): Promise<LegalEntityExactBatchResult> {
  const response = await fetch("/api/legal-entity-sources/exact-batch", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(LegalEntityExactBatchInputSchema.parse(input)),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Exact legal entity review returned ${response.status}.`,
    );
  }
  return LegalEntityExactBatchResultSchema.parse(await response.json());
}

export class AgreementSecurityCheckError extends Error {
  constructor() {
    super(
      "Download blocked. Recheck this agreement for the current security result.",
    );
  }
}

export async function downloadLegalEntityDocument(id: string): Promise<Blob> {
  const response = await fetch(
    `/api/legal-entity-documents/${encodeURIComponent(id)}`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/pdf" },
    },
  );
  if (response.status === 423) throw new AgreementSecurityCheckError();
  if (
    !response.ok ||
    response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf"
  )
    throw await responseError(
      response,
      "The agreement could not be downloaded. Try again or check source access.",
    );
  return response.blob();
}

export async function recheckLegalEntityDocument(
  id: string,
  provider?: "sydecar" | "tokenfolio",
) {
  const response = await fetch(
    `/api/legal-entity-documents/${encodeURIComponent(id)}/recheck`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(provider === undefined ? {} : { provider }),
    },
  );
  if (!response.ok)
    throw await responseError(
      response,
      "The agreement check could not be queued.",
    );
  return ProviderPortfolioAgentRunRequestSchema.parse(await response.json());
}

export async function loadLegalEntityExportOptions() {
  const response = await fetch("/api/legal-entity-export/options", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      "Export destinations could not be loaded. Try again.",
    );
  }
  return LegalEntityExportOptionsSchema.parse(await response.json());
}

export async function loadLegalEntityExportTable(
  input: LegalEntityExportInput,
) {
  const response = await fetch("/api/legal-entity-export", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(LegalEntityExportInputSchema.parse(input)),
  });
  if (!response.ok) {
    throw await responseError(response, "The export could not be prepared.");
  }
  return LegalEntityExportTableSchema.parse(await response.json());
}

export async function downloadLegalEntityExport(
  input: LegalEntityExportInput,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch("/api/legal-entity-export", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "text/csv",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(LegalEntityExportInputSchema.parse(input)),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Legal entity export returned ${response.status}.`,
    );
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename =
    /filename="([^"]+)"/u.exec(disposition)?.[1] ?? "keel-legal-entities.csv";
  return { blob: await response.blob(), filename };
}

export async function loadPortfolioBaseline(
  signal?: AbortSignal,
): Promise<PortfolioBaselineState> {
  const response = await fetch("/api/portfolio-baseline", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Portfolio baseline returned ${response.status}.`,
    );
  }
  return PortfolioBaselineStateSchema.parse(await response.json());
}

export async function loadCashAccounts(
  signal?: AbortSignal,
): Promise<CashAccountsState> {
  const response = await fetch("/api/cash-accounts", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Cash accounts returned ${response.status}.`,
    );
  }
  return CashAccountsStateSchema.parse(await response.json());
}

export async function loadCashFlow(
  signal?: AbortSignal,
): Promise<CashFlowState> {
  const response = await fetch("/api/cash-flow", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Observed cash flow returned ${response.status}.`,
    );
  }
  return CashFlowStateSchema.parse(await response.json());
}

export async function loadPlanActualMonitoring(
  signal?: AbortSignal,
): Promise<PlanActualMonitoringState> {
  const response = await fetch("/api/plan-actual-monitoring", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Plan versus actual monitoring returned ${response.status}.`,
    );
  }
  return PlanActualMonitoringStateSchema.parse(await response.json());
}

export async function snoozePlanActualMonitoring(
  input: Pick<PlanActualSnoozeInput, "itemKey" | "sourceRevision">,
): Promise<PlanActualMonitoringState> {
  const body = PlanActualSnoozeInputSchema.parse({
    ...input,
    durationDays: PLAN_ACTUAL_COOLDOWN_DAYS,
  });
  const response = await fetch("/api/plan-actual-monitoring/snooze", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Review-later update returned ${response.status}.`,
    );
  }
  return PlanActualMonitoringStateSchema.parse(await response.json());
}

export async function syncCashFlow(
  connectionId: string,
  pricingConfirmed: boolean,
): Promise<CashFlowState> {
  const response = await fetch(
    `/api/cash-flow/connections/${encodeURIComponent(connectionId)}/sync`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policyVersion: CASH_FLOW_POLICY_VERSION,
        pricingConfirmed,
      }),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Observed cash-flow check returned ${response.status}.`,
    );
  }
  return CashFlowStateSchema.parse(await response.json());
}

export async function reviewCashFlow(
  proposalId: string,
  input: CashFlowReviewInput,
): Promise<CashFlowReviewResult> {
  const body = CashFlowReviewInputSchema.parse(input);
  const response = await fetch(
    `/api/cash-flow-proposals/${encodeURIComponent(proposalId)}/review`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Observed cash-flow review returned ${response.status}.`,
    );
  }
  return CashFlowReviewResultSchema.parse(await response.json());
}

export async function createCashAccountLinkToken(): Promise<CashAccountLinkToken> {
  const response = await fetch("/api/cash-accounts/link-token", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Cash account connection returned ${response.status}.`,
    );
  }
  return CashAccountLinkTokenSchema.parse(await response.json());
}

export async function exchangeCashAccountPublicToken(
  publicToken: string,
): Promise<CashAccountsState> {
  const body = CashAccountExchangeInputSchema.parse({ publicToken });
  const response = await fetch("/api/cash-accounts/exchange", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Cash account connection returned ${response.status}.`,
    );
  }
  return CashAccountsStateSchema.parse(await response.json());
}

export async function refreshCashAccount(
  connectionId: string,
): Promise<CashAccountsState> {
  const response = await fetch(
    `/api/cash-accounts/connections/${encodeURIComponent(connectionId)}/refresh`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Cash balance check returned ${response.status}.`,
    );
  }
  return CashAccountsStateSchema.parse(await response.json());
}

export async function refreshDueCashAccounts(): Promise<CashAccountsState> {
  const response = await fetch("/api/cash-accounts/auto-refresh", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Automatic cash balance check returned ${response.status}.`,
    );
  }
  return CashAccountsStateSchema.parse(await response.json());
}

export async function disconnectCashAccount(
  connectionId: string,
): Promise<CashAccountsState> {
  const response = await fetch(
    `/api/cash-accounts/connections/${encodeURIComponent(connectionId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Cash account disconnect returned ${response.status}.`,
    );
  }
  return CashAccountsStateSchema.parse(await response.json());
}

export async function applyCashAccountProposal(
  proposalId: string,
  input: CashAccountApplyInput,
): Promise<CashAccountApplyResult> {
  const body = CashAccountApplyInputSchema.parse(input);
  const response = await fetch(
    `/api/cash-account-proposals/${encodeURIComponent(proposalId)}/apply`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Cash account review returned ${response.status}.`,
    );
  }
  return CashAccountApplyResultSchema.parse(await response.json());
}

export async function reviewCashAccountIdentity(
  input: CashAccountIdentityReviewInput,
): Promise<CashAccountsState> {
  const body = CashAccountIdentityReviewInputSchema.parse(input);
  const response = await fetch("/api/cash-account-identities/review", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Cash account identity review returned ${response.status}.`,
    );
  }
  return CashAccountsStateSchema.parse(await response.json());
}

export async function loadLiabilities(
  signal?: AbortSignal,
): Promise<LiabilitiesState> {
  const response = await fetch("/api/liabilities", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Obligations returned ${response.status}.`,
    );
  }
  return LiabilitiesStateSchema.parse(await response.json());
}

export async function createLiabilityLinkToken(): Promise<LiabilityLinkToken> {
  const response = await fetch("/api/liabilities/link-token", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Obligation connection returned ${response.status}.`,
    );
  }
  return LiabilityLinkTokenSchema.parse(await response.json());
}

export async function exchangeLiabilityPublicToken(
  publicToken: string,
): Promise<LiabilitiesState> {
  const body = LiabilityExchangeInputSchema.parse({ publicToken });
  const response = await fetch("/api/liabilities/exchange", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Obligation connection returned ${response.status}.`,
    );
  }
  return LiabilitiesStateSchema.parse(await response.json());
}

export async function refreshLiabilities(
  connectionId: string,
): Promise<LiabilitiesState> {
  const response = await fetch(
    `/api/liabilities/connections/${encodeURIComponent(connectionId)}/refresh`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Obligation check returned ${response.status}.`,
    );
  }
  return LiabilitiesStateSchema.parse(await response.json());
}

export async function disconnectLiabilities(
  connectionId: string,
): Promise<LiabilitiesState> {
  const response = await fetch(
    `/api/liabilities/connections/${encodeURIComponent(connectionId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Obligation disconnect returned ${response.status}.`,
    );
  }
  return LiabilitiesStateSchema.parse(await response.json());
}

export async function stageManualLiability(
  input: ManualLiabilityInput,
): Promise<LiabilityProposal> {
  const body = ManualLiabilityInputSchema.parse(input);
  const response = await fetch("/api/liability-proposals/manual", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Manual obligation returned ${response.status}.`,
    );
  }
  return LiabilityProposalSchema.parse(await response.json());
}

export async function applyLiabilityProposal(
  proposalId: string,
  input: LiabilityApplyInput,
): Promise<LiabilityApplyResult> {
  const body = LiabilityApplyInputSchema.parse(input);
  const response = await fetch(
    `/api/liability-proposals/${encodeURIComponent(proposalId)}/apply`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Obligation review returned ${response.status}.`,
    );
  }
  return LiabilityApplyResultSchema.parse(await response.json());
}

export async function confirmPortfolioBaseline(
  input: PortfolioBaselineConfirmInput,
): Promise<PortfolioBaselineConfirmResult> {
  const body = PortfolioBaselineConfirmInputSchema.parse(input);
  const response = await fetch("/api/portfolio-baselines", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Portfolio baseline confirmation returned ${response.status}.`,
    );
  }
  return PortfolioBaselineConfirmResultSchema.parse(await response.json());
}

export async function loadPlanInputs(
  signal?: AbortSignal,
): Promise<PlanInputState> {
  const response = await fetch("/api/plan-inputs", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Runway plan returned ${response.status}.`,
    );
  }
  return PlanInputStateSchema.parse(await response.json());
}

export async function savePlanInputs(
  input: PlanInputSave,
): Promise<PlanInputSaveResult> {
  const body = PlanInputSaveSchema.parse(input);
  const response = await fetch("/api/plan-inputs", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Runway plan save returned ${response.status}.`,
    );
  }
  return PlanInputSaveResultSchema.parse(await response.json());
}

export async function loadPortfolioWatchActivity(
  cursor: string | null = null,
  query = "",
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (cursor !== null) params.set("cursor", cursor);
  if (query.trim().length > 0) params.set("q", query.trim());
  const response = await fetch(
    `/api/watch/activity${params.size === 0 ? "" : `?${params}`}`,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal:
        signal === undefined
          ? AbortSignal.timeout(15_000)
          : AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  );
  if (!response.ok)
    throw await responseError(response, "Couldn’t load source activity.");
  return PortfolioWatchActivitySchema.parse(await response.json());
}

export async function loadPortfolioWatchProgress(runId: string) {
  const response = await fetch(
    `/api/watch/activity/progress?runId=${encodeURIComponent(runId)}`,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw await responseError(response, "Couldn’t refresh source activity.");
  return PortfolioWatchProgressSchema.parse(await response.json());
}

export async function confirmWatchWebsite(
  targetId: string,
  input: WatchWebsiteInput,
) {
  const response = await fetch(
    `/api/watch/targets/${encodeURIComponent(targetId)}/website`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw await responseError(response, "Couldn’t confirm the website.");
  return WatchWebsiteReceiptSchema.parse(await response.json());
}
export async function findWatchWebsite(targetId: string) {
  const response = await fetch(
    `/api/watch/targets/${encodeURIComponent(targetId)}/website-search`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw await responseError(response, "Couldn’t find websites.");
  return WatchWebsiteSearchSchema.parse(await response.json());
}

export async function setPortfolioWatchRead(
  observationId: string,
  read: boolean,
  expectedVersion: number,
) {
  const response = await fetch(
    `/api/watch/observations/${encodeURIComponent(observationId)}/read`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ read, expectedVersion }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw await responseError(response, "Couldn’t save read status.");
  return WatchReadReceiptSchema.parse(await response.json());
}

export async function scanPortfolioWatch(): Promise<PortfolioWatchScanResult> {
  const response = await fetch("/api/watch/scan", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `Portfolio Watch scan returned ${response.status}.`,
    );
  }

  return PortfolioWatchScanResultSchema.parse(await response.json());
}

export type UploadHoldingImportProvider =
  "angellist" | "tokenfolio" | "sydecar" | "wefunder";

export async function previewHoldingImport(
  provider: UploadHoldingImportProvider,
  file: File,
): Promise<HoldingImportPreview> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`/api/holding-imports/${provider}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    body,
  });

  if (!response.ok) {
    const providerLabel = {
      angellist: "AngelList",
      sydecar: "Sydecar",
      tokenfolio: "Tokenfolio",
      wefunder: "Wefunder",
    }[provider];
    throw await responseError(
      response,
      `${providerLabel} import review returned ${response.status}.`,
    );
  }

  return HoldingImportPreviewSchema.parse(await response.json());
}

export async function previewAngelListHoldingImport(
  file: File,
): Promise<HoldingImportPreview> {
  return previewHoldingImport("angellist", file);
}

export async function loadAngelListAutomationOverview(): Promise<AngelListMacAgentOverview> {
  const response = await fetch("/api/automation/angellist/status", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList automation status returned ${response.status}.`,
    );
  }
  return AngelListMacAgentOverviewSchema.parse(await response.json());
}

export async function loadLegacyAngelListAutomationOverview(): Promise<AngelListAutomationOverview> {
  const response = await fetch("/api/automation/angellist/status", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList automation status returned ${response.status}.`,
    );
  }
  return AngelListAutomationOverviewSchema.parse(await response.json());
}

export async function requestAngelListUpdate(): Promise<AngelListMacAgentRunRequest> {
  const response = await fetch("/api/automation/angellist/run", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList update request returned ${response.status}.`,
    );
  }
  return AngelListMacAgentRunRequestSchema.parse(await response.json());
}

export async function configureAngelListMacAgent(
  input: AngelListMacAgentConfigInput,
): Promise<AngelListMacAgentOverview> {
  const body = AngelListMacAgentConfigInputSchema.parse(input);
  const response = await fetch("/api/automation/angellist/mac-agent/config", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList interval update returned ${response.status}.`,
    );
  }
  return AngelListMacAgentOverviewSchema.parse(await response.json());
}

export async function loadProviderPortfolioAgentOverview(
  rawProvider: ProviderPortfolioAgentProvider,
): Promise<ProviderPortfolioAgentOverview> {
  const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
  const response = await fetch(
    `/api/automation/provider-holdings/${provider}/status`,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `${provider} update status returned ${response.status}.`,
    );
  }
  return ProviderPortfolioAgentOverviewSchema.parse(await response.json());
}

export async function requestProviderPortfolioUpdate(
  rawProvider: ProviderPortfolioAgentProvider,
): Promise<ProviderPortfolioAgentRunRequest> {
  const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
  const response = await fetch(
    `/api/automation/provider-holdings/${provider}/run`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `${provider} update request returned ${response.status}.`,
    );
  }
  return ProviderPortfolioAgentRunRequestSchema.parse(await response.json());
}

export async function configureProviderPortfolioAgent(
  rawProvider: ProviderPortfolioAgentProvider,
  input: ProviderPortfolioAgentConfigInput,
): Promise<ProviderPortfolioAgentOverview> {
  const provider = ProviderPortfolioAgentProviderSchema.parse(rawProvider);
  const body = ProviderPortfolioAgentConfigInputSchema.parse(input);
  const response = await fetch(
    `/api/automation/provider-holdings/${provider}/mac-agent/config`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `${provider} interval update returned ${response.status}.`,
    );
  }
  return ProviderPortfolioAgentOverviewSchema.parse(await response.json());
}

export async function startProviderBrowserReconnect(
  rawProvider: MacAgentTarget,
): Promise<ProviderBrowserSession> {
  const provider = MacAgentTargetSchema.parse(rawProvider);
  const response = await fetch(
    `/api/automation/provider-browser/${provider}/reconnect`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `${provider} reconnect returned ${response.status}.`,
    );
  }
  return ProviderBrowserSessionSchema.parse(await response.json());
}

export async function getProviderBrowserReconnect(
  sessionId: string,
): Promise<ProviderBrowserSession> {
  const response = await fetch(
    `/api/automation/provider-browser/sessions/${encodeURIComponent(sessionId)}`,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Provider reconnect status returned ${response.status}.`,
    );
  }
  return ProviderBrowserSessionSchema.parse(await response.json());
}

export async function cancelProviderBrowserReconnect(
  sessionId: string,
): Promise<ProviderBrowserSession> {
  const response = await fetch(
    `/api/automation/provider-browser/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Provider reconnect cancellation returned ${response.status}.`,
    );
  }
  return ProviderBrowserSessionSchema.parse(await response.json());
}

export function providerBrowserReconnectOpenPath(sessionId: string): string {
  return `/api/automation/provider-browser/sessions/${encodeURIComponent(sessionId)}/open`;
}

// Kept only as a one-release rollback path while the Mac agent is accepted in
// preview. The Holdings UI no longer exposes Browser Run sign-in.
export async function startAngelListSignInRefresh(): Promise<AngelListSignInRefresh> {
  const response = await fetch("/api/automation/angellist/sign-in-refreshes", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList sign-in refresh returned ${response.status}.`,
    );
  }
  return AngelListSignInRefreshSchema.parse(await response.json());
}

export async function getAngelListSignInRefresh(
  refreshId: string,
): Promise<AngelListSignInRefresh> {
  const response = await fetch(
    `/api/automation/angellist/sign-in-refreshes/${encodeURIComponent(refreshId)}`,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList sign-in status returned ${response.status}.`,
    );
  }
  return AngelListSignInRefreshSchema.parse(await response.json());
}

export async function submitAngelListMagicLink(
  refreshId: string,
  magicLink: string,
): Promise<AngelListSignInRefresh> {
  const response = await fetch(
    `/api/automation/angellist/sign-in-refreshes/${encodeURIComponent(refreshId)}/magic-link`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ magicLink }),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList magic link returned ${response.status}.`,
    );
  }
  return AngelListSignInRefreshSchema.parse(await response.json());
}

export async function submitAngelListHandoffInput(
  refreshId: string,
  text: string,
): Promise<AngelListSignInRefresh> {
  const response = await fetch(
    `/api/automation/angellist/sign-in-refreshes/${encodeURIComponent(refreshId)}/handoff-input`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList phone input returned ${response.status}.`,
    );
  }
  return AngelListSignInRefreshSchema.parse(await response.json());
}

export async function cancelAngelListSignInRefresh(
  refreshId: string,
): Promise<AngelListSignInRefresh> {
  const response = await fetch(
    `/api/automation/angellist/sign-in-refreshes/${encodeURIComponent(refreshId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList sign-in cancellation returned ${response.status}.`,
    );
  }
  return AngelListSignInRefreshSchema.parse(await response.json());
}

export async function listPendingHoldingImports(): Promise<
  HoldingImportSummary[]
> {
  const response = await fetch("/api/holding-imports", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Pending holding imports returned ${response.status}.`,
    );
  }
  return HoldingImportSummariesSchema.parse(await response.json());
}

export async function loadInvestmentConnections(): Promise<InvestmentConnectionsState> {
  const response = await fetch("/api/investment-connections", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment connection status returned ${response.status}.`,
    );
  }
  return InvestmentConnectionsStateSchema.parse(await response.json());
}

export async function loadInvestmentHoldings(
  signal?: AbortSignal,
): Promise<InvestmentHoldingsView> {
  const response = await fetch("/api/investment-holdings", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment holdings returned ${response.status}.`,
    );
  }
  return InvestmentHoldingsViewSchema.parse(await response.json());
}

export async function acceptPositionValueAdjustment(
  positionId: string,
  input: AcceptPositionValueAdjustmentInput,
): Promise<PositionValueAdjustment> {
  const body = AcceptPositionValueAdjustmentInputSchema.parse(input);
  const response = await fetch(
    `/api/investment-positions/${encodeURIComponent(positionId)}/value-adjustments`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Position value review returned ${response.status}.`,
    );
  }
  return PositionValueAdjustmentSchema.parse(await response.json());
}

export async function acceptPositionEconomics(
  positionId: string,
  input: AcceptPositionEconomicsInput,
): Promise<PositionEconomicsTerms> {
  const body = AcceptPositionEconomicsInputSchema.parse(input);
  const response = await fetch(
    `/api/investment-positions/${encodeURIComponent(positionId)}/economics`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Position economics review returned ${response.status}.`,
    );
  }
  return PositionEconomicsTermsSchema.parse(await response.json());
}

export async function loadPrivateExposureReviews(): Promise<PrivateExposureReviewState> {
  const response = await fetch("/api/private-exposure-reviews", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Private exposure reviews returned ${response.status}.`,
    );
  }
  return PrivateExposureReviewStateSchema.parse(await response.json());
}

export async function assignPrivateCompanyExposure(
  positionId: string,
  input: PrivateExposureResolutionInput,
): Promise<PrivateExposureResolutionResult> {
  const body = PrivateExposureResolutionInputSchema.parse(input);
  const response = await fetch(
    `/api/private-exposure-reviews/${encodeURIComponent(positionId)}/assign`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Private exposure review returned ${response.status}.`,
    );
  }
  return PrivateExposureResolutionResultSchema.parse(await response.json());
}

export async function applyPrivateExposureExactBatch(
  input: PrivateExposureExactBatchInput,
): Promise<PrivateExposureExactBatchResult> {
  const body = PrivateExposureExactBatchInputSchema.parse(input);
  const response = await fetch("/api/private-exposure-reviews/exact-batch", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Exact company assignments returned ${response.status}.`,
    );
  }
  return PrivateExposureExactBatchResultSchema.parse(await response.json());
}

export async function createInvestmentLinkToken(): Promise<InvestmentLinkToken> {
  const response = await fetch("/api/investment-connections/link-token", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment connection returned ${response.status}.`,
    );
  }
  return InvestmentLinkTokenSchema.parse(await response.json());
}

export async function createInvestmentReconnectLinkToken(
  connectionId: string,
): Promise<InvestmentLinkToken> {
  const response = await fetch(
    `/api/investment-connections/${encodeURIComponent(connectionId)}/link-token`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment reconnect returned ${response.status}.`,
    );
  }
  return InvestmentLinkTokenSchema.parse(await response.json());
}

export async function exchangeInvestmentPublicToken(
  publicToken: string,
): Promise<InvestmentConnectionStatus> {
  const body = InvestmentExchangeInputSchema.parse({ publicToken });
  const response = await fetch("/api/investment-connections/exchange", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment connection returned ${response.status}.`,
    );
  }
  return InvestmentConnectionStatusSchema.parse(await response.json());
}

export async function syncInvestmentHoldings(
  connectionId: string,
): Promise<InvestmentConnectionStatus> {
  const response = await fetch(
    `/api/investment-connections/${encodeURIComponent(connectionId)}/sync`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment sync returned ${response.status}.`,
    );
  }
  return InvestmentConnectionStatusSchema.parse(await response.json());
}

export async function syncDueInvestmentHoldings(): Promise<InvestmentConnectionsState> {
  const response = await fetch("/api/investment-connections/auto-sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Automatic investment sync returned ${response.status}.`,
    );
  }
  return InvestmentConnectionsStateSchema.parse(await response.json());
}

export async function disconnectInvestmentConnection(
  connectionId: string,
): Promise<InvestmentConnectionStatus> {
  const response = await fetch(
    `/api/investment-connections/${encodeURIComponent(connectionId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment disconnect returned ${response.status}.`,
    );
  }
  return InvestmentConnectionStatusSchema.parse(await response.json());
}

export async function changeInvestmentConnectionLifecycle(
  connectionId: string,
  action: "pause" | "resume",
): Promise<InvestmentConnectionStatus> {
  const body = InvestmentConnectionLifecycleActionInputSchema.parse({ action });
  const response = await fetch(
    `/api/investment-connections/${encodeURIComponent(connectionId)}/lifecycle`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Investment connection action returned ${response.status}.`,
    );
  }
  return InvestmentConnectionStatusSchema.parse(await response.json());
}

export async function reconcileHoldingImport(
  importId: string,
): Promise<HoldingImportPreview> {
  const response = await fetch(
    `/api/holding-imports/${encodeURIComponent(importId)}/reconcile`,
    { method: "POST" },
  );
  if (!response.ok)
    throw await responseError(
      response,
      "This update could not be checked. Try again.",
    );
  return HoldingImportPreviewSchema.parse(await response.json());
}

export async function refreshPortfolioBaseline(
  signal?: AbortSignal,
): Promise<PortfolioBaselineState> {
  const response = await fetch("/api/portfolio-baseline/refresh", {
    method: "POST",
    signal: signal ?? null,
  });
  if (!response.ok)
    throw await responseError(
      response,
      "Planning values could not be refreshed. Try again.",
    );
  return PortfolioBaselineStateSchema.parse(await response.json());
}

export async function loadHoldingImport(
  importId: string,
): Promise<HoldingImportPreview> {
  const response = await fetch(
    `/api/holding-imports/${encodeURIComponent(importId)}`,
    {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw await responseError(
      response,
      `Holding import returned ${response.status}.`,
    );
  }
  return HoldingImportPreviewSchema.parse(await response.json());
}

export async function applyHoldingImport(
  importId: string,
  input: HoldingImportApplyInput,
): Promise<HoldingImportApplyResult> {
  const body = HoldingImportApplyInputSchema.parse(input);
  const response = await fetch(
    `/api/holding-imports/${encodeURIComponent(importId)}/apply`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList import application returned ${response.status}.`,
    );
  }

  return HoldingImportApplyResultSchema.parse(await response.json());
}

export async function submitEvidenceReview(
  eventId: string,
  decision: "accepted" | "rejected" | "scenario_only",
): Promise<void> {
  const response = await fetch(
    `/api/evidence/${encodeURIComponent(eventId)}/review`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision,
        rationale:
          decision === "scenario_only"
            ? "Retained as a scenario-only assumption in the private alpha."
            : `Explicitly ${decision} during private-alpha review.`,
      }),
    },
  );

  if (!response.ok) {
    throw await responseError(
      response,
      `Evidence review returned ${response.status}.`,
    );
  }
}

export async function applyAcceptedEvidence(eventId: string): Promise<void> {
  const response = await fetch(
    `/api/evidence/${encodeURIComponent(eventId)}/apply`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw await responseError(
      response,
      `Evidence application returned ${response.status}.`,
    );
  }
}

export async function createSignalUpdateProposal(
  input: CreateSignalUpdateProposalInput,
): Promise<SignalUpdateProposal> {
  const body = CreateSignalUpdateProposalInputSchema.parse(input);
  const response = await fetch("/api/signal-update-proposals", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `Signal update proposal returned ${response.status}.`,
    );
  }

  return SignalUpdateProposalSchema.parse(await response.json());
}

export async function saveGoalVersion(input: GoalDraftInput): Promise<void> {
  const body = GoalDraftInputSchema.parse(input);
  const response = await fetch("/api/goals", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `Goal save returned ${response.status}.`,
    );
  }
}

export async function saveScenarioVersion(
  input: ScenarioDraftInput,
): Promise<void> {
  const body = ScenarioDraftInputSchema.parse(input);
  const response = await fetch("/api/scenarios", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `Scenario save returned ${response.status}.`,
    );
  }
}

async function companyIdentityRequest(
  path: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api/companies/${path}`, {
    method: input === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal: signal ?? null,
    headers: {
      Accept: "application/json",
      ...(input === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  if (!response.ok)
    throw await responseError(
      response,
      "Company names are unavailable. Try again.",
    );
  const body: unknown = await response.json();
  return body;
}
export async function loadCompanyIdentities(signal?: AbortSignal) {
  return CompanyIdentityCatalogSchema.parse(
    await companyIdentityRequest("identity", undefined, signal),
  );
}
export async function previewCompanyAlias(input: CompanyAliasProposal) {
  return CompanyAliasPreviewSchema.parse(
    await companyIdentityRequest(
      "aliases/preview",
      CompanyAliasProposalSchema.parse(input),
    ),
  );
}
export async function reviewCompanyAlias(input: CompanyAliasReviewInput) {
  return CompanyAliasReceiptSchema.parse(
    await companyIdentityRequest(
      "aliases",
      CompanyAliasReviewInputSchema.parse(input),
    ),
  );
}
export async function loadPublicCompanyLinks(signal?: AbortSignal) {
  return PublicCompanyLinkCatalogSchema.parse(
    await companyIdentityRequest("public-links", undefined, signal),
  );
}
export async function reviewPublicCompanyLink(input: PublicCompanyLinkReview) {
  return PublicCompanyLinkReceiptSchema.parse(
    await companyIdentityRequest(
      "public-links",
      PublicCompanyLinkReviewSchema.parse(input),
    ),
  );
}

export async function recommendPublicCompanyLink(exposureId: string) {
  return PublicCompanyMatchSchema.parse(
    await companyIdentityRequest(
      `public-links/${encodeURIComponent(exposureId)}/recommendation`,
      {},
    ),
  );
}
export async function approvePublicCompanyRecommendation(id: string) {
  return PublicCompanyLinkReceiptSchema.parse(
    await companyIdentityRequest(
      `public-links/recommendations/${encodeURIComponent(id)}/approve`,
      {},
    ),
  );
}

export async function loadPositionLinks(signal?: AbortSignal) {
  const response = await fetch("/api/investment-position-links", {
    signal: signal ?? null,
  });
  if (!response.ok)
    throw await responseError(
      response,
      "Investment records are unavailable. Try again.",
    );
  return PositionLinkWorkspaceSchema.parse(await response.json());
}
export async function acceptPositionLink(input: AcceptPositionLink) {
  const response = await fetch("/api/investment-position-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(AcceptPositionLinkSchema.parse(input)),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      "The link could not be saved. Try again.",
    );
  }
  return PositionLinkReceiptSchema.parse(await response.json());
}
