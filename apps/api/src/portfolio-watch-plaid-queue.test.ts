import { beforeEach, describe, expect, it, vi } from "vitest";

import { processPlaidHoldingsWebhookJob } from "./plaid-webhook";
import { handlePortfolioWatchQueue } from "./portfolio-watch";
import type { Env } from "./types";

vi.mock("./plaid-webhook", () => ({
  processPlaidHoldingsWebhookJob: vi.fn(),
}));

const job = {
  type: "plaid_holdings_webhook",
  messageId: "11111111-1111-4111-8111-111111111111",
  deliveryId: "22222222-2222-4222-8222-222222222222",
  requestedAt: "2026-08-14T12:00:00.000Z",
};

function batch() {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    value: {
      messages: [{ body: job, ack, retry }],
    } as unknown as MessageBatch<unknown>,
  };
}

describe("Plaid holdings queue routing", () => {
  beforeEach(() => vi.mocked(processPlaidHoldingsWebhookJob).mockReset());

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
    expect(queued.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });
});
