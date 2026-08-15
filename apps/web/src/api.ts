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
  CashAccountLinkTokenSchema,
  CashAccountsStateSchema,
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
  PlanInputSaveResultSchema,
  PlanInputSaveSchema,
  PlanInputStateSchema,
  PortfolioWatchScanResultSchema,
  PortfolioBaselineConfirmInputSchema,
  PortfolioBaselineConfirmResultSchema,
  PortfolioBaselineStateSchema,
  RobinhoodExchangeInputSchema,
  RobinhoodLinkTokenSchema,
  RobinhoodSyncStatusSchema,
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
  type CashAccountsState,
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
  type PlanInputSave,
  type PlanInputSaveResult,
  type PlanInputState,
  type PortfolioWatchScanResult,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineConfirmResult,
  type PortfolioBaselineState,
  type RobinhoodLinkToken,
  type RobinhoodSyncStatus,
  type ScenarioDraftInput,
  SignalUpdateProposalSchema,
  type SignalUpdateProposal,
} from "@keel/domain";

async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const result = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return new Error(result?.error ?? fallback);
}

export async function loadAlphaData(signal?: AbortSignal): Promise<AlphaData> {
  const response = await fetch("/api/alpha", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new Error(`Keel API returned ${response.status}.`);
  }

  return AlphaDataSchema.parse(await response.json());
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

export async function scanPortfolioWatch(): Promise<PortfolioWatchScanResult> {
  const response = await fetch("/api/watch/scan", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      result?.error ?? `Portfolio Watch scan returned ${response.status}.`,
    );
  }

  return PortfolioWatchScanResultSchema.parse(await response.json());
}

export async function previewAngelListHoldingImport(
  file: File,
): Promise<HoldingImportPreview> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/holding-imports/angellist", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    body,
  });

  if (!response.ok) {
    throw await responseError(
      response,
      `AngelList import review returned ${response.status}.`,
    );
  }

  return HoldingImportPreviewSchema.parse(await response.json());
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

export async function loadRobinhoodSyncStatus(): Promise<RobinhoodSyncStatus> {
  const response = await fetch("/api/public-holdings/robinhood/status", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Robinhood sync status returned ${response.status}.`,
    );
  }
  return RobinhoodSyncStatusSchema.parse(await response.json());
}

export async function createRobinhoodLinkToken(): Promise<RobinhoodLinkToken> {
  const response = await fetch("/api/public-holdings/robinhood/link-token", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Robinhood connection returned ${response.status}.`,
    );
  }
  return RobinhoodLinkTokenSchema.parse(await response.json());
}

export async function exchangeRobinhoodPublicToken(
  publicToken: string,
): Promise<RobinhoodSyncStatus> {
  const body = RobinhoodExchangeInputSchema.parse({ publicToken });
  const response = await fetch("/api/public-holdings/robinhood/exchange", {
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
      `Robinhood connection returned ${response.status}.`,
    );
  }
  return RobinhoodSyncStatusSchema.parse(await response.json());
}

export async function syncRobinhoodHoldings(): Promise<RobinhoodSyncStatus> {
  const response = await fetch("/api/public-holdings/robinhood/sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await responseError(
      response,
      `Robinhood sync returned ${response.status}.`,
    );
  }
  return RobinhoodSyncStatusSchema.parse(await response.json());
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
    throw new Error(`Evidence review returned ${response.status}.`);
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
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      result?.error ?? `Evidence application returned ${response.status}.`,
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
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      result?.error ?? `Signal update proposal returned ${response.status}.`,
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
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(result?.error ?? `Goal save returned ${response.status}.`);
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
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      result?.error ?? `Scenario save returned ${response.status}.`,
    );
  }
}
