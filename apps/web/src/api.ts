import {
  AlphaDataSchema,
  GoalDraftInputSchema,
  PortfolioWatchScanResultSchema,
  ScenarioDraftInputSchema,
  type AlphaData,
  type GoalDraftInput,
  type PortfolioWatchScanResult,
  type ScenarioDraftInput,
} from "@keel/domain";

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
