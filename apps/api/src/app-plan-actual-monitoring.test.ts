import type { PlanActualMonitoringRepository } from "@keel/database";
import type { PlanActualMonitoringState } from "@keel/domain/plan-actual-monitoring";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Env } from "./types";

const sourceRevision = "a".repeat(64);
const actionItem = {
  key: "cash_drift" as const,
  metric: "cash" as const,
  severity: "decision" as const,
  title: "Reviewed cash moved beyond the plan guardrail",
  reason: "Reviewed cash differs from the accepted baseline.",
  nextAction: "Reconcile cash and baseline",
  route: "holdings" as const,
  observedAt: "2026-08-15T12:00:00.000Z",
  plannedValueMinor: 10_000_000,
  actualValueMinor: 8_000_000,
  differenceMinor: -2_000_000,
  thresholdMinor: 500_000,
  plannedMonths: null,
  actualMonths: null,
  sourceRevision,
  cooldownUntil: null,
};

const state: PlanActualMonitoringState = {
  version: 1,
  policyVersion: "plan-actual-v1",
  evaluatedAt: "2026-08-16T12:00:00.000Z",
  sourceRevision,
  planId: "plan-synthetic",
  status: "needs_action",
  coverage: {
    cash: "current",
    debt: "not_configured",
    burn: "not_configured",
    runway: "limited",
  },
  actionItems: [actionItem],
  deferredItems: [],
};

function env(): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
}

describe("plan-versus-actual monitoring API", () => {
  it("returns the no-store monitoring projection", async () => {
    const getState = vi
      .fn<PlanActualMonitoringRepository["getState"]>()
      .mockResolvedValue(state);
    const repository: PlanActualMonitoringRepository = {
      getState,
      snooze: vi.fn(),
    };

    const response = await createApp({
      planActualMonitoringRepository: repository,
    }).request("/api/plan-actual-monitoring", {}, env());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(state);
    expect(getState).toHaveBeenCalledWith("synthetic-access-subject");
  });

  it("records only a validated exact-source seven-day reminder", async () => {
    const deferred: PlanActualMonitoringState = {
      ...state,
      status: "deferred",
      actionItems: [],
      deferredItems: [
        {
          ...actionItem,
          cooldownUntil: "2026-08-23T12:00:00.000Z",
        },
      ],
    };
    const snooze = vi
      .fn<PlanActualMonitoringRepository["snooze"]>()
      .mockResolvedValue(deferred);
    const repository: PlanActualMonitoringRepository = {
      getState: vi.fn(),
      snooze,
    };
    const input = {
      itemKey: "cash_drift" as const,
      sourceRevision,
      durationDays: 7 as const,
    };

    const response = await createApp({
      planActualMonitoringRepository: repository,
    }).request(
      "/api/plan-actual-monitoring/snooze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      env(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(deferred);
    expect(snooze).toHaveBeenCalledWith("synthetic-access-subject", input);
  });

  it("rejects malformed and stale reminders without retrying", async () => {
    const snooze = vi
      .fn<PlanActualMonitoringRepository["snooze"]>()
      .mockRejectedValue(
        new Error("Monitoring item changed or is already deferred."),
      );
    const repository: PlanActualMonitoringRepository = {
      getState: vi.fn(),
      snooze,
    };
    const app = createApp({ planActualMonitoringRepository: repository });

    const malformed = await app.request(
      "/api/plan-actual-monitoring/snooze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemKey: "cash_drift",
          sourceRevision,
          durationDays: 30,
        }),
      },
      env(),
    );
    expect(malformed.status).toBe(400);
    expect(snooze).not.toHaveBeenCalled();

    const stale = await app.request(
      "/api/plan-actual-monitoring/snooze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemKey: "cash_drift",
          sourceRevision,
          durationDays: 7,
        }),
      },
      env(),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({
      error: "This decision changed. Review the latest comparison.",
    });
    expect(snooze).toHaveBeenCalledOnce();
  });
});
