import { PLAID_INVESTMENTS_DAILY_SYNC_CRON } from "@keel/connectors";
import { describe, expect, it, vi } from "vitest";

import {
  enqueueDueInvestmentSyncs,
  MAX_DAILY_INVESTMENT_SYNC_JOBS,
  processScheduledInvestmentSyncJobWithDependencies,
} from "./plaid-investments-schedule";
import type { Env } from "./types";

const firstConnectionId = "11111111-1111-4111-8111-111111111111";
const secondConnectionId = "22222222-2222-4222-8222-222222222222";
const firstMessageId = "33333333-3333-4333-8333-333333333333";
const secondMessageId = "44444444-4444-4444-8444-444444444444";

function dependencies(connectionIds: readonly string[]) {
  const listDueAutomaticSyncConnectionIds = vi
    .fn()
    .mockResolvedValue(connectionIds);
  const findAutomaticSyncAccessSubject = vi.fn();
  const sendBatch = vi.fn().mockResolvedValue(undefined);
  const messageIds = [firstMessageId, secondMessageId];
  return {
    listDueAutomaticSyncConnectionIds,
    sendBatch,
    value: {
      repository: {
        listDueAutomaticSyncConnectionIds,
        findAutomaticSyncAccessSubject,
      },
      queue: { sendBatch },
      randomUuid: () => messageIds.shift() ?? crypto.randomUUID(),
    },
  };
}

describe("Plaid Investments daily scheduler", () => {
  it("enqueues one bounded job per due canonical connection", async () => {
    const scheduledAt = new Date("2026-08-28T13:00:00.000Z");
    const scheduled = dependencies([firstConnectionId, secondConnectionId]);

    await expect(
      enqueueDueInvestmentSyncs({
        cron: PLAID_INVESTMENTS_DAILY_SYNC_CRON,
        scheduledAt,
        dependencies: scheduled.value,
      }),
    ).resolves.toBe(2);

    expect(scheduled.listDueAutomaticSyncConnectionIds).toHaveBeenCalledWith(
      "2026-08-27T13:00:00.000Z",
      MAX_DAILY_INVESTMENT_SYNC_JOBS,
    );
    expect(scheduled.sendBatch).toHaveBeenCalledWith([
      {
        body: {
          type: "plaid_investments_scheduled_sync",
          messageId: firstMessageId,
          connectionId: firstConnectionId,
          requestedAt: "2026-08-28T13:00:00.000Z",
        },
      },
      {
        body: {
          type: "plaid_investments_scheduled_sync",
          messageId: secondMessageId,
          connectionId: secondConnectionId,
          requestedAt: "2026-08-28T13:00:00.000Z",
        },
      },
    ]);
  });

  it("ignores unknown schedules without reading or writing", async () => {
    const scheduled = dependencies([firstConnectionId]);

    await expect(
      enqueueDueInvestmentSyncs({
        cron: "0 1 * * *",
        scheduledAt: new Date("2026-08-28T13:00:00.000Z"),
        dependencies: scheduled.value,
      }),
    ).resolves.toBe(0);
    expect(scheduled.listDueAutomaticSyncConnectionIds).not.toHaveBeenCalled();
    expect(scheduled.sendBatch).not.toHaveBeenCalled();
  });

  it("does not write an empty queue batch", async () => {
    const scheduled = dependencies([]);

    await expect(
      enqueueDueInvestmentSyncs({
        cron: PLAID_INVESTMENTS_DAILY_SYNC_CRON,
        scheduledAt: new Date("2026-08-28T13:00:00.000Z"),
        dependencies: scheduled.value,
      }),
    ).resolves.toBe(0);
    expect(scheduled.sendBatch).not.toHaveBeenCalled();
  });

  it("resolves the active owner and reclaims the connection cooldown", async () => {
    type ProcessDependencies = Parameters<
      typeof processScheduledInvestmentSyncJobWithDependencies
    >[2];
    const findAutomaticSyncAccessSubject = vi
      .fn()
      .mockResolvedValue("synthetic-access-subject");
    const getConnectionStatus = vi.fn().mockResolvedValue({
      version: 1,
      connectionId: firstConnectionId,
      institutionKey: "ins_synthetic",
      institutionLabel: "Synthetic brokerage",
      status: "ready",
      lastSyncedAt: null,
      automaticUpdatesEnabled: true,
      latestImportId: null,
      latestRunStatus: null,
      errorCode: null,
      latestAdjudication: null,
    });
    const beginAutomaticSync = vi.fn().mockResolvedValue(null);
    const repository = {
      findAutomaticSyncAccessSubject,
      getConnectionStatus,
      beginAutomaticSync,
    } as unknown as ProcessDependencies["repository"];

    await expect(
      processScheduledInvestmentSyncJobWithDependencies(
        {
          type: "plaid_investments_scheduled_sync",
          messageId: firstMessageId,
          connectionId: firstConnectionId,
          requestedAt: "2026-08-28T13:00:00.000Z",
        },
        {} as Env,
        {
          repository,
          holdingImports: {} as ProcessDependencies["holdingImports"],
          portfolioBaselines: {} as ProcessDependencies["portfolioBaselines"],
          client: {} as ProcessDependencies["client"],
        },
      ),
    ).resolves.toBe("processed");

    expect(findAutomaticSyncAccessSubject).toHaveBeenCalledWith(
      firstConnectionId,
    );
    expect(beginAutomaticSync).toHaveBeenCalledWith(
      "synthetic-access-subject",
      firstConnectionId,
      "2026-08-27T13:00:00.000Z",
    );
  });
});
