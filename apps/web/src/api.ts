import { AlphaDataSchema, type AlphaData } from "@keel/domain";

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
