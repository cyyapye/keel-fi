import { beforeEach, describe, expect, it, vi } from "vitest";

import { processPlaidHoldingsWebhookJob } from "./plaid-webhook";
import { processScheduledInvestmentSyncJob } from "./plaid-investments-schedule";
import {
  handlePortfolioWatchQueue,
  PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS,
} from "./portfolio-watch";
import type { Env } from "./types";

vi.mock("./plaid-webhook", () => ({
  processPlaidHoldingsWebhookJob: vi.fn(),
}));

vi.mock("./plaid-investments-schedule", () => ({
  processScheduledInvestmentSyncJob: vi.fn(),
}));

const job = {
  type: "plaid_holdings_webhook",
  messageId: "11111111-1111-4111-8111-111111111111",
  deliveryId: "22222222-2222-4222-8222-222222222222",
  requestedAt: "2026-08-14T12:00:00.000Z",
};

const scheduledJob = {
  type: "plaid_investments_scheduled_sync",
  messageId: "33333333-3333-4333-8333-333333333333",
  connectionId: "44444444-4444-4444-8444-444444444444",
  requestedAt: "2026-08-14T13:00:00.000Z",
};

function batch(body: unknown = job) {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    value: {
      messages: [{ body, ack, retry }],
    } as unknown as MessageBatch<unknown>,
  };
}

describe("Plaid holdings queue routing", () => {
  beforeEach(() => {
    vi.mocked(processPlaidHoldingsWebhookJob).mockReset();
    vi.mocked(processScheduledInvestmentSyncJob).mockReset();
  });

  it("acknowledges a scheduled investment sync job", async () => {
    vi.mocked(processScheduledInvestmentSyncJob).mockResolvedValue("processed");
    const queued = batch(scheduledJob);

    await handlePortfolioWatchQueue(queued.value, {} as Env);

    expect(processScheduledInvestmentSyncJob).toHaveBeenCalledWith(
      scheduledJob,
      {},
    );
    expect(queued.ack).toHaveBeenCalledOnce();
    expect(queued.retry).not.toHaveBeenCalled();
  });

  it("retries a scheduled investment sync job after an exception", async () => {
    vi.mocked(processScheduledInvestmentSyncJob).mockRejectedValue(
      new Error("synthetic scheduled failure"),
    );
    const queued = batch(scheduledJob);

    await handlePortfolioWatchQueue(queued.value, {} as Env);

    expect(queued.ack).not.toHaveBeenCalled();
    expect(queued.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("acknowledges a processed delivery", async () => {
    vi.mocked(processPlaidHoldingsWebhookJob).mockResolvedValue("processed");
    const queued = batch();

    await handlePortfolioWatchQueue(queued.value, {} as Env);

    expect(processPlaidHoldingsWebhookJob).toHaveBeenCalledWith(job, {});
    expect(queued.ack).toHaveBeenCalledOnce();
    expect(queued.retry).not.toHaveBeenCalled();
  });

  it("retries a delivery when processing asks for another attempt", async () => {
    vi.mocked(processPlaidHoldingsWebhookJob).mockResolvedValue("retry");
    const queued = batch();

    await handlePortfolioWatchQueue(queued.value, {} as Env);

    expect(queued.ack).not.toHaveBeenCalled();
    expect(queued.retry).toHaveBeenCalledWith({
      delaySeconds: PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS,
    });
  });
});
