import { PLAID_INVESTMENTS_DAILY_SYNC_CRON } from "@keel/connectors";
import { describe, expect, it, vi } from "vitest";

import {
  enqueueDuePortfolioWatchSources,
  MAX_DAILY_PORTFOLIO_WATCH_JOBS,
} from "./portfolio-watch-schedule";

const firstMessageId = "11111111-1111-4111-8111-111111111111";
const secondMessageId = "22222222-2222-4222-8222-222222222222";

function dependencies(
  jobs: readonly {
    type: "portfolio_watch_source_scan" | "portfolio_watch_source_verify";
    sourceId: string;
  }[],
) {
  const listDueSourceJobs = vi.fn().mockResolvedValue(jobs);
  const sendBatch = vi.fn().mockResolvedValue(undefined);
  const messageIds = [firstMessageId, secondMessageId];
  return {
    listDueSourceJobs,
    sendBatch,
    value: {
      repository: {
        listDueSourceJobs,
        admitSourceJobs: vi
          .fn()
          .mockImplementation((jobs) => Promise.resolve(jobs)),
      },
      queue: { sendBatch },
      randomUuid: () => messageIds.shift() ?? crypto.randomUUID(),
    },
  };
}

describe("Portfolio Watch due-source scheduler", () => {
  it("queues one bounded opaque job per due source", async () => {
    const scheduledAt = new Date("2026-08-28T13:00:00.000Z");
    const scheduled = dependencies([
      {
        type: "portfolio_watch_source_scan",
        sourceId: "source_active",
      },
      {
        type: "portfolio_watch_source_verify",
        sourceId: "source_degraded",
      },
    ]);

    await expect(
      enqueueDuePortfolioWatchSources({
        cron: PLAID_INVESTMENTS_DAILY_SYNC_CRON,
        scheduledAt,
        dependencies: scheduled.value,
      }),
    ).resolves.toBe(2);

    expect(scheduled.listDueSourceJobs).toHaveBeenCalledWith(
      "2026-08-28T13:00:00.000Z",
      MAX_DAILY_PORTFOLIO_WATCH_JOBS,
    );
    expect(scheduled.sendBatch).toHaveBeenCalledWith([
      {
        body: {
          type: "portfolio_watch_source_scan",
          messageId: firstMessageId,
          sourceId: "source_active",
          requestedAt: "2026-08-28T13:00:00.000Z",
        },
      },
      {
        body: {
          type: "portfolio_watch_source_verify",
          messageId: secondMessageId,
          sourceId: "source_degraded",
          requestedAt: "2026-08-28T13:00:00.000Z",
        },
      },
    ]);
  });

  it("ignores unknown schedules without reading or writing", async () => {
    const scheduled = dependencies([
      {
        type: "portfolio_watch_source_scan",
        sourceId: "source_active",
      },
    ]);

    await expect(
      enqueueDuePortfolioWatchSources({
        cron: "0 1 * * *",
        scheduledAt: new Date("2026-08-28T13:00:00.000Z"),
        dependencies: scheduled.value,
      }),
    ).resolves.toBe(0);
    expect(scheduled.listDueSourceJobs).not.toHaveBeenCalled();
    expect(scheduled.sendBatch).not.toHaveBeenCalled();
  });

  it("does not write an empty queue batch", async () => {
    const scheduled = dependencies([]);

    await expect(
      enqueueDuePortfolioWatchSources({
        cron: PLAID_INVESTMENTS_DAILY_SYNC_CRON,
        scheduledAt: new Date("2026-08-28T13:00:00.000Z"),
        dependencies: scheduled.value,
      }),
    ).resolves.toBe(0);
    expect(scheduled.sendBatch).not.toHaveBeenCalled();
  });
});
